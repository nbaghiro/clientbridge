from datetime import UTC, date, datetime, timedelta

from sqlalchemy import ColumnElement, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.config import get_settings
from clientbridge.core.db import Base
from clientbridge.core.errors import Conflict, NotFound, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.integrations.payments import PaymentGateway
from clientbridge.integrations.s3 import FileStorage
from clientbridge.models.billing import Invoice, Order
from clientbridge.models.catalog import BOOKABLE_KINDS, Item
from clientbridge.models.crm import Client
from clientbridge.models.documents import Contract, Form, FormField, FormResponse, Signature
from clientbridge.models.identity import Business, Staff, User
from clientbridge.models.platform import File, IdempotencyKey
from clientbridge.models.reviews import REVIEW_OPEN, Review
from clientbridge.models.scheduling import Addon, Booking
from clientbridge.schemas.billing import LineInput
from clientbridge.schemas.contracts import PublicContractContext, PublicContractSign
from clientbridge.schemas.files import PublicFileCreate, PublicFileUpload
from clientbridge.schemas.forms import PublicFormContext, PublicFormField, PublicFormSubmit
from clientbridge.schemas.payments import InteracRequest, PublicCardIntent, PublicInvoice
from clientbridge.schemas.public import (
    HEX_COLOR,
    PublicAddon,
    PublicBookingClient,
    PublicBookingCreate,
    PublicBookingPage,
    PublicBookingResult,
    PublicBrand,
    PublicService,
    PublicShop,
    PublicShopItem,
    PublicShopLine,
    PublicShopOrderCreate,
    PublicShopOrderResult,
    PublicSlot,
    PublicSlots,
    PublicStaff,
)
from clientbridge.schemas.reviews import PublicReviewContext, PublicReviewSubmit
from clientbridge.services import ledger
from clientbridge.services.bookings import create_booking_core, open_slots
from clientbridge.services.catalog import deposit_cents
from clientbridge.services.clients import find_or_create_by_contact
from clientbridge.services.files import item_images, media_url, mint_upload
from clientbridge.services.lines import apply_totals, replace_lines, tax_for_lines
from clientbridge.services.payments import (
    assert_payable,
    open_booking_deposit,
    open_card_payment,
    open_interac_payment,
    open_order_card_payment,
)


def _account(business: Business) -> str | None:
    """The connected account the client pays into, exposed only once charges are enabled."""
    return business.stripe_account_id if business.stripe_charges_enabled else None


def _service_out(item: Item, image_url: str | None) -> PublicService:
    return PublicService(
        id=item.id,
        name=item.name,
        description=item.description,
        duration_min=item.duration_min,
        price_cents=item.price_cents,
        currency=item.currency,
        deposit_required=item.deposit_type != "none",
        deposit_amount_cents=deposit_cents(item),
        image_url=image_url,
    )


class PublicBookingService:
    """Online booking, keyed by business slug; writes go through create_booking_core."""

    def __init__(self, db: AsyncSession, gateway: PaymentGateway) -> None:
        self.db = db
        self.gateway = gateway

    async def page(self, slug: str) -> PublicBookingPage:
        business = await self._business(slug)
        items = (
            (
                await self.db.execute(
                    scoped(Item, business.id)
                    .where(
                        Item.online_bookable.is_(True),
                        Item.active.is_(True),
                        Item.kind.in_(BOOKABLE_KINDS),
                    )
                    .order_by(Item.id)
                )
            )
            .scalars()
            .all()
        )
        staff_rows = (
            await self.db.execute(
                scoped(Staff, business.id)
                .add_columns(User.name)
                .join(User, User.id == Staff.user_id, isouter=True)
                .where(Staff.status == "active")
                .order_by(Staff.id)
            )
        ).all()
        images = await item_images(self.db, business.id, [i.id for i in items])
        addons = [
            PublicAddon(
                id=p.id,
                name=p.name,
                price_cents=p.price_cents,
                currency=p.currency,
                image_url=p.image_url,
            )
            for p in await shop_items(self.db, business.id)
        ]
        return PublicBookingPage(
            business_name=business.name,
            brand=public_brand(business),
            services=[_service_out(i, images.get(i.id)) for i in items],
            staff=[PublicStaff(id=r[0].id, name=r[1], title=r[0].title) for r in staff_rows],
            addons=addons,
            stripe_account_id=_account(business),
        )

    async def slots(self, slug: str, item_id: str, staff_id: str, on_date: date) -> PublicSlots:
        business = await self._business(slug)
        item = await self._bookable_item(business.id, item_id)
        await self._active_staff(business.id, staff_id)
        starts = await open_slots(self.db, business.id, item, staff_id, on_date)
        delta = timedelta(minutes=item.duration_min or 0)
        return PublicSlots(slots=[PublicSlot(starts_at=s, ends_at=s + delta) for s in starts])

    async def book(self, slug: str, data: PublicBookingCreate) -> PublicBookingResult:
        business = await self._business(slug)
        item = await self._bookable_item(business.id, data.item_id)
        if item.duration_min is None or item.duration_min <= 0:
            raise Unprocessable("that service has no duration and can't be booked")
        await self._active_staff(business.id, data.staff_id)
        addons = await online_items(
            self.db,
            business.id,
            [PublicShopLine(item_id=a.item_id, quantity=a.quantity) for a in data.addons],
        )
        client = await self._find_or_create_client(business.id, data.client)
        booking, _ = await create_booking_core(
            self.db,
            business.id,
            item=item,
            staff_id=data.staff_id,
            starts_at=data.starts_at,
            client_id=client.id,
            source="online",
            dedupe_client=True,
        )
        for item, qty in addons:
            self.db.add(
                Addon(
                    id=new_id("addon"),
                    business_id=business.id,
                    booking_id=booking.id,
                    staff_id=booking.staff_id,
                    item_id=item.id,
                    description=item.name,
                    quantity=qty,
                    unit_amount_cents=item.price_cents,
                )
            )
        secret = await self._open_deposit(business, booking, client)
        await self.db.commit()
        return PublicBookingResult(
            booking_id=booking.id,
            deposit_client_secret=secret,
            stripe_account_id=_account(business),
        )

    async def _open_deposit(
        self, business: Business, booking: Booking, client: Client
    ) -> str | None:
        """Open a deposit PaymentIntent, unless none is due or the business can't take cards."""
        if booking.deposit_amount_cents <= 0:
            return None
        if not business.stripe_charges_enabled or business.stripe_account_id is None:
            return None
        _, client_secret = await open_booking_deposit(
            self.db,
            self.gateway,
            account_id=business.stripe_account_id,
            business_id=business.id,
            booking=booking,
            client=client,
            amount=booking.deposit_amount_cents,
            fee_bps=get_settings().platform_fee_bps,
        )
        return client_secret

    async def _find_or_create_client(self, business_id: str, data: PublicBookingClient) -> Client:
        return await find_or_create_by_contact(
            self.db,
            business_id,
            name=data.name,
            email=data.email,
            phone=data.phone,
            source="online_booking",
        )

    async def _business(self, slug: str) -> Business:
        business = (
            await self.db.execute(select(Business).where(Business.slug == slug))
        ).scalar_one_or_none()
        if business is None:
            raise NotFound("booking page not found")
        return business

    async def _bookable_item(self, business_id: str, item_id: str) -> Item:
        item = (
            await self.db.execute(
                scoped(Item, business_id).where(Item.id == item_id, Item.active.is_(True))
            )
        ).scalar_one_or_none()
        if item is None:
            raise NotFound("service not found")
        if not item.online_bookable or item.kind not in BOOKABLE_KINDS:
            raise Conflict("that service isn't available for online booking")
        return item

    async def _active_staff(self, business_id: str, staff_id: str) -> Staff:
        staff = (
            await self.db.execute(
                scoped(Staff, business_id).where(Staff.id == staff_id, Staff.status == "active")
            )
        ).scalar_one_or_none()
        if staff is None:
            raise NotFound("staff not found")
        return staff


async def resolve_by_token[M: Base](
    db: AsyncSession, model: type[M], criterion: ColumnElement[bool], message: str
) -> M:
    """The single row matching a public-link token criterion, else 404 with `message`."""
    row = (await db.execute(select(model).where(criterion))).scalar_one_or_none()
    if row is None:
        raise NotFound(message)
    return row


async def business_or_404(db: AsyncSession, business_id: str, message: str) -> Business:
    """A public link's business, else 404 with the same message."""
    business = await db.get(Business, business_id)
    if business is None:
        raise NotFound(message)
    return business


def public_brand(business: Business) -> PublicBrand:
    """A business's brand as a validated public DTO; malformed values are dropped."""
    brand = business.brand or {}
    logo_file_id = brand.get("logo_file_id")
    logo_url = media_url(logo_file_id) if isinstance(logo_file_id, str) else brand.get("logo_url")
    primary = brand.get("primary")
    tagline = brand.get("tagline")
    return PublicBrand(
        logo_url=logo_url if isinstance(logo_url, str) and _is_http(logo_url) else None,
        primary=(
            primary if isinstance(primary, str) and HEX_COLOR.match(primary) is not None else None
        ),
        tagline=(tagline.strip() or None) if isinstance(tagline, str) else None,
    )


def _is_http(url: str) -> bool:
    return url.startswith(("http://", "https://"))


class PublicContractService:
    """Public e-signing; the signature token is the only credential."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _resolve(self, token: str) -> tuple[Signature, Contract, Business]:
        signature = await resolve_by_token(
            self.db, Signature, Signature.token == token, "signing link not found"
        )
        contract = await self.db.get(Contract, signature.contract_id)
        if contract is None:
            raise NotFound("signing link not found")
        business = await business_or_404(self.db, signature.business_id, "signing link not found")
        return signature, contract, business

    async def context(self, token: str) -> PublicContractContext:
        signature, contract, business = await self._resolve(token)
        client = await self.db.get(Client, signature.client_id)
        return PublicContractContext(
            contract_name=contract.name,
            business_name=business.name,
            brand=public_brand(business),
            body=signature.signed_body or contract.body,
            signer_name=client.name if client is not None else None,
            status=signature.status,
        )

    async def sign(self, token: str, data: PublicContractSign, ip: str) -> PublicContractContext:
        signature, contract, business = await self._resolve(token)
        if signature.status != "pending":
            raise Conflict("this contract is no longer awaiting a signature")
        if data.signature_image_id is not None:
            await self._assert_image(data.signature_image_id, signature.business_id)
        signature.status = "signed"
        signature.signed_at = datetime.now(UTC)
        signature.signed_body = _snapshot(contract.body, data.typed_name)
        signature.signature_image_id = data.signature_image_id
        signature.ip = ip
        await self.db.commit()
        return await self._context(signature, contract, business)

    async def upload(
        self, token: str, data: PublicFileCreate, storage: FileStorage
    ) -> PublicFileUpload:
        signature, _, _ = await self._resolve(token)
        result = await mint_upload(
            self.db,
            storage,
            business_id=signature.business_id,
            parent_type="signature",
            parent_id=signature.id,
            purpose="signature",
            content_type=data.content_type,
            size=data.size,
        )
        await self.db.commit()
        return PublicFileUpload(file_id=result.file.id, upload_url=result.upload_url)

    async def decline(self, token: str) -> PublicContractContext:
        signature, contract, business = await self._resolve(token)
        if signature.status != "pending":
            raise Conflict("this contract is no longer awaiting a signature")
        signature.status = "declined"
        await self.db.commit()
        return await self._context(signature, contract, business)

    async def _context(
        self, signature: Signature, contract: Contract, business: Business
    ) -> PublicContractContext:
        client = await self.db.get(Client, signature.client_id)
        return PublicContractContext(
            contract_name=contract.name,
            business_name=business.name,
            brand=public_brand(business),
            body=signature.signed_body or contract.body,
            signer_name=client.name if client is not None else None,
            status=signature.status,
        )

    async def _assert_image(self, file_id: str, business_id: str) -> None:
        file = await self.db.get(File, file_id)
        if file is None or file.business_id != business_id:
            raise NotFound("signature image not found")


def _snapshot(body: str, typed_name: str | None) -> str:
    return f"{body}\n\n— Signed by {typed_name}" if typed_name else body


class PublicFormService:
    """Public forms; the response token is the only credential."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _resolve(self, token: str) -> tuple[FormResponse, Form, Business]:
        response = await resolve_by_token(
            self.db, FormResponse, FormResponse.token == token, "form link not found"
        )
        form = await self.db.get(Form, response.form_id)
        if form is None:
            raise NotFound("form link not found")
        business = await business_or_404(self.db, response.business_id, "form link not found")
        return response, form, business

    async def _fields(self, form_id: str) -> list[FormField]:
        return list(
            (
                await self.db.execute(
                    select(FormField)
                    .where(FormField.form_id == form_id)
                    .order_by(FormField.position)
                )
            )
            .scalars()
            .all()
        )

    async def context(self, token: str) -> PublicFormContext:
        response, form, business = await self._resolve(token)
        fields = await self._fields(form.id)
        return PublicFormContext(
            form_name=form.name,
            business_name=business.name,
            brand=public_brand(business),
            completed=response.status == "submitted",
            fields=[_field_out(f) for f in fields],
        )

    async def upload(
        self, token: str, data: PublicFileCreate, storage: FileStorage
    ) -> PublicFileUpload:
        response, _, _ = await self._resolve(token)
        result = await mint_upload(
            self.db,
            storage,
            business_id=response.business_id,
            parent_type="form_response",
            parent_id=response.id,
            purpose="attachment",
            content_type=data.content_type,
            size=data.size,
        )
        await self.db.commit()
        return PublicFileUpload(file_id=result.file.id, upload_url=result.upload_url)

    async def submit(self, token: str, data: PublicFormSubmit) -> PublicFormContext:
        response, form, business = await self._resolve(token)
        if response.status == "submitted":
            raise Conflict("this form was already submitted")
        fields = await self._fields(form.id)
        _validate(fields, data.answers)
        response.status = "submitted"
        response.answers = data.answers
        response.submitted_at = datetime.now(UTC)
        await self.db.commit()
        return PublicFormContext(
            form_name=form.name,
            business_name=business.name,
            brand=public_brand(business),
            completed=True,
            fields=[_field_out(f) for f in fields],
        )


def _validate(fields: list[FormField], answers: dict[str, object]) -> None:
    for field in fields:
        if not field.required:
            continue
        value = answers.get(field.name)
        if value is None or (isinstance(value, str | list) and len(value) == 0):
            raise Unprocessable(f"missing required field: {field.name}")


def _field_out(field: FormField) -> PublicFormField:
    return PublicFormField(
        id=field.id,
        input=field.input,
        name=field.name,
        label=field.label,
        help=field.help,
        required=field.required,
        options=field.options,
        validation=field.validation,
        position=field.position,
    )


class PublicPayService:
    """Public pay links; the pay token is the only credential."""

    def __init__(self, db: AsyncSession, gateway: PaymentGateway) -> None:
        self.db = db
        self.gateway = gateway

    async def _resolve(self, token: str) -> tuple[Invoice, Business]:
        msg = "payment link not found"
        invoice = await resolve_by_token(self.db, Invoice, Invoice.pay_token == token, msg)
        return invoice, await business_or_404(self.db, invoice.business_id, msg)

    async def invoice(self, token: str) -> PublicInvoice:
        invoice, business = await self._resolve(token)
        return PublicInvoice(
            number=invoice.number,
            business_name=business.name,
            brand=public_brand(business),
            currency=invoice.currency,
            total_cents=invoice.total_cents,
            balance_cents=await ledger.invoice_balance(self.db, invoice),
            status=(await ledger.invoice_state(self.db, invoice))[0],
            accepts_card=business.stripe_charges_enabled,
            interac_email=business.billing_email,
        )

    async def pay_card(self, token: str) -> PublicCardIntent:
        invoice, business = await self._resolve(token)
        amount = await assert_payable(self.db, invoice)
        if not business.stripe_charges_enabled or business.stripe_account_id is None:
            raise Conflict("this business can't take card payments yet")
        client = await self.db.get(Client, invoice.client_id)
        if client is None:
            raise NotFound("client not found")
        _, client_secret = await open_card_payment(
            self.db,
            self.gateway,
            account_id=business.stripe_account_id,
            business_id=business.id,
            invoice=invoice,
            client=client,
            amount=amount,
            fee_bps=get_settings().platform_fee_bps,
        )
        await self.db.commit()
        return PublicCardIntent(
            client_secret=client_secret, stripe_account_id=business.stripe_account_id
        )

    async def pay_interac(self, token: str) -> InteracRequest:
        invoice, business = await self._resolve(token)
        amount = await assert_payable(self.db, invoice)
        payment = await open_interac_payment(
            self.db, business_id=invoice.business_id, invoice=invoice, amount=amount
        )
        await self.db.commit()
        return InteracRequest(
            payment_id=payment.id,
            reference_code=payment.reference_code or "",
            send_to=business.billing_email,
            amount_cents=amount,
        )


class PublicReviewService:
    """Public reviews; the review token is the only credential."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _resolve(self, token: str) -> tuple[Review, Business]:
        review = await resolve_by_token(
            self.db, Review, Review.token == token, "review link not found"
        )
        return review, await business_or_404(self.db, review.business_id, "review link not found")

    async def context(self, token: str) -> PublicReviewContext:
        review, business = await self._resolve(token)
        if review.status == "requested":
            review.status = "opened"
            await self.db.commit()
        return self._context(review, business)

    async def submit(self, token: str, data: PublicReviewSubmit) -> PublicReviewContext:
        review, business = await self._resolve(token)
        # Lock the row so a second concurrent submit sees the first and gets a 409.
        review = (
            await self.db.execute(select(Review).where(Review.id == review.id).with_for_update())
        ).scalar_one()
        if review.status not in REVIEW_OPEN:
            raise Conflict("this review was already submitted")
        now = datetime.now(UTC)
        review.rating = data.rating
        review.body = data.body
        review.submitted_at = now
        review.status = "published"
        if review.requested_at is None:
            review.requested_at = now
        await self.db.commit()
        return self._context(review, business)

    @staticmethod
    def _context(review: Review, business: Business) -> PublicReviewContext:
        return PublicReviewContext(
            business_name=business.name,
            brand=public_brand(business),
            completed=review.status not in REVIEW_OPEN,
            rating=review.rating,
        )


_SCOPE = "shop.order"


async def shop_items(db: AsyncSession, business_id: str) -> list[PublicShopItem]:
    """A business's products listed for sale online (also offered as booking add-ons)."""
    items = (
        (
            await db.execute(
                scoped(Item, business_id)
                .where(Item.sell_online.is_(True), Item.active.is_(True), Item.kind == "product")
                .order_by(Item.name)
            )
        )
        .scalars()
        .all()
    )
    images = await item_images(db, business_id, [i.id for i in items])
    return [
        PublicShopItem(
            id=i.id,
            name=i.name,
            description=i.description,
            price_cents=i.price_cents,
            currency=i.currency,
            image_url=images.get(i.id),
            in_stock=not i.track_stock or (i.stock_on_hand or 0) > 0,
        )
        for i in items
    ]


async def online_items(
    db: AsyncSession, business_id: str, lines: list[PublicShopLine]
) -> list[tuple[Item, int]]:
    """Each requested product with its merged quantity, if sold online in this business."""
    wanted: dict[str, int] = {}
    for line in lines:
        wanted[line.item_id] = wanted.get(line.item_id, 0) + line.quantity
    rows = (
        (
            await db.execute(
                scoped(Item, business_id).where(
                    Item.id.in_(wanted),
                    Item.sell_online.is_(True),
                    Item.active.is_(True),
                    Item.kind == "product",
                )
            )
        )
        .scalars()
        .all()
    )
    found = {i.id: i for i in rows}
    if set(found) != set(wanted):
        raise NotFound("product not found")
    return [(found[item_id], qty) for item_id, qty in wanted.items()]


class PublicShopService:
    """The online shop, keyed by business slug; orders are paid online and picked up."""

    def __init__(self, db: AsyncSession, gateway: PaymentGateway) -> None:
        self.db = db
        self.gateway = gateway

    async def shop(self, slug: str) -> PublicShop:
        business = await self._business(slug)
        return PublicShop(
            business_name=business.name,
            brand=public_brand(business),
            items=await shop_items(self.db, business.id),
            stripe_account_id=_account(business),
        )

    async def order(
        self, slug: str, data: PublicShopOrderCreate, idempotency_key: str
    ) -> PublicShopOrderResult:
        business = await self._business(slug)
        account_id = _account(business)
        if account_id is None:
            raise Conflict("this shop isn't taking online payments yet")
        prior = (
            await self.db.execute(
                scoped(IdempotencyKey, business.id).where(
                    IdempotencyKey.scope == _SCOPE,
                    IdempotencyKey.key == idempotency_key,
                )
            )
        ).scalar_one_or_none()
        if prior is not None:
            return PublicShopOrderResult.model_validate(prior.response)
        wanted = await online_items(self.db, business.id, data.lines)
        for item, qty in wanted:
            if item.track_stock and (item.stock_on_hand or 0) < qty:
                raise Conflict(f"only {max(item.stock_on_hand or 0, 0)} left of {item.name}")
        if len({item.currency for item, _ in wanted}) > 1:
            raise Unprocessable("one order can't mix currencies")
        client = await find_or_create_by_contact(
            self.db,
            business.id,
            name=data.client.name,
            email=data.client.email,
            phone=data.client.phone,
            source="online_shop",
        )
        order = Order(
            id=new_id("order"),
            business_id=business.id,
            client_id=client.id,
            staff_id=await self._owner_staff(business.id),
            status="open",
            currency=wanted[0][0].currency,
            source="online",
            pickup_status="unfulfilled",
        )
        self.db.add(order)
        await self.db.flush()
        lines = await replace_lines(
            self.db,
            business.id,
            "order",
            order.id,
            [
                LineInput(
                    description=item.name,
                    quantity=qty,
                    unit_amount_cents=item.price_cents,
                    item_id=item.id,
                )
                for item, qty in wanted
            ],
        )
        apply_totals(order, await tax_for_lines(self.db, business.id, lines))
        await self.db.flush()
        _, client_secret = await open_order_card_payment(
            self.db,
            self.gateway,
            account_id=account_id,
            business_id=business.id,
            order=order,
            client=client,
            amount=order.total_cents,
            fee_bps=get_settings().platform_fee_bps,
            idempotency_key=idempotency_key,
        )
        result = PublicShopOrderResult(
            order_id=order.id,
            total_cents=order.total_cents,
            currency=order.currency,
            client_secret=client_secret,
            stripe_account_id=account_id,
        )
        self.db.add(
            IdempotencyKey(
                id=new_id("idempotency_key"),
                business_id=business.id,
                scope=_SCOPE,
                key=idempotency_key,
                response=result.model_dump(mode="json"),
            )
        )
        await self.db.commit()
        return result

    async def _owner_staff(self, business_id: str) -> str:
        staff_id = (
            await self.db.execute(
                scoped(Staff, business_id)
                .with_only_columns(Staff.id)
                .where(Staff.role == "owner", Staff.status == "active")
                .order_by(Staff.created_at)
                .limit(1)
            )
        ).scalar_one_or_none()
        if staff_id is None:
            raise NotFound("shop not found")
        return staff_id

    async def _business(self, slug: str) -> Business:
        business = (
            await self.db.execute(select(Business).where(Business.slug == slug))
        ).scalar_one_or_none()
        if business is None:
            raise NotFound("shop not found")
        return business
