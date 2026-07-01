import secrets

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.config import get_settings
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import AppError, Conflict, NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.integrations.payments import PaymentGateway
from clientbridge.models.catalog import GiftCard, Item
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business
from clientbridge.schemas.gift_cards import (
    GiftCardOut,
    GiftCardPurchase,
    GiftCardPurchaseOut,
    GiftCardRedeem,
)
from clientbridge.services.payment_service import open_entitlement_payment, resolve_saved_method_ref

_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"  # base32, no easily-confused 0/1/8/9


def _gift_code() -> str:
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(12))


class GiftCardService:
    def __init__(self, db: AsyncSession, principal: Principal, gateway: PaymentGateway) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id
        self.gateway = gateway

    async def purchase_gift_card(
        self, data: GiftCardPurchase, idempotency_key: str | None = None
    ) -> GiftCardPurchaseOut:
        self._assert_admin()
        face = await self._face_value(data)
        if data.purchaser_client_id is None:
            raise AppError(
                "a purchaser is required to charge a gift card",
                status_code=422,
                code="purchaser_required",
            )
        client = await self._client(data.purchaser_client_id)
        business = await self._business()
        if not business.stripe_charges_enabled or business.stripe_account_id is None:
            raise Conflict("connect your Stripe account before taking payments")
        account_id = business.stripe_account_id
        fee_bps = get_settings().platform_fee_bps
        pm_ref = await resolve_saved_method_ref(
            self.db, self.biz, data.payment_method_id, data.purchaser_client_id
        )

        async def run(cmd: Command) -> GiftCardPurchaseOut:
            card_id = new_id("gift_card")
            payment, client_secret = await open_entitlement_payment(
                self.db,
                self.gateway,
                account_id=account_id,
                business_id=self.biz,
                client=client,
                amount=face,  # a gift certificate is not taxed at sale (taxed on redemption)
                currency="CAD",
                fee_bps=fee_bps,
                entitlement_kind="gift_card",
                entitlement_id=card_id,
                payment_method=pm_ref,
                idempotency_key=idempotency_key,
            )
            card = GiftCard(
                id=card_id,
                business_id=self.biz,
                code=_gift_code(),
                item_id=data.item_id,
                initial_cents=face,
                balance_cents=face,
                purchaser_client_id=data.purchaser_client_id,
                recipient=data.recipient,
                status="pending",
                payment_id=payment.id,
            )
            self.db.add(card)
            try:
                await self.db.flush()  # (business_id, code) is unique — a collision is a rare retry
            except IntegrityError as exc:
                raise Conflict("gift card code collision — please retry") from exc
            cmd.record("gift_card.purchase", entity_type="gift_card", entity_id=card.id)
            return GiftCardPurchaseOut(
                gift_card_id=card.id,
                code=card.code,
                payment_id=payment.id,
                client_secret=client_secret,
            )

        return await run_command(
            self.db,
            self.principal,
            action="gift_card.purchase",
            run=run,
            response_model=GiftCardPurchaseOut,
            idempotency_key=idempotency_key,
        )

    async def redeem_gift_card(
        self, data: GiftCardRedeem, idempotency_key: str | None = None
    ) -> GiftCardOut:
        self._assert_admin()
        card = await self._by_code(data.code)

        async def run(cmd: Command) -> GiftCardOut:
            if card.status != "active":
                raise Conflict("only an active gift card can be redeemed")
            if data.amount_cents <= 0 or data.amount_cents > card.balance_cents:
                raise Conflict("invalid redemption amount")
            card.balance_cents -= data.amount_cents
            if card.balance_cents == 0:
                card.status = "redeemed"
            await self.db.flush()
            cmd.record("gift_card.redeem", entity_type="gift_card", entity_id=card.id)
            return _out(card)

        return await run_command(
            self.db,
            self.principal,
            action="gift_card.redeem",
            run=run,
            response_model=GiftCardOut,
            idempotency_key=idempotency_key,
        )

    async def _face_value(self, data: GiftCardPurchase) -> int:
        if (data.item_id is None) == (data.amount_cents is None):
            raise AppError(
                "provide exactly one of item_id or amount_cents",
                status_code=422,
                code="invalid_gift_card",
            )
        if data.amount_cents is not None:
            return data.amount_cents
        item = await self._item(str(data.item_id))
        if item.kind != "gift":
            raise Conflict("item is not a gift card")
        if item.price_cents <= 0:
            raise Conflict("gift card item has no price")
        return item.price_cents

    def _assert_admin(self) -> None:
        assert_role(
            self.principal, "owner", "admin", message="only an owner or admin can manage gift cards"
        )

    async def _business(self) -> Business:
        row = await self.db.get(Business, self.biz)
        if row is None:
            raise NotFound("business not found")
        return row

    async def _client(self, client_id: str) -> Client:
        row = (
            await self.db.execute(
                scoped(Client, self.biz, soft_delete=True).where(Client.id == client_id)
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("client not found")
        return row

    async def _item(self, item_id: str) -> Item:
        row = (
            await self.db.execute(scoped(Item, self.biz).where(Item.id == item_id))
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("item not found")
        return row

    async def _by_code(self, code: str) -> GiftCard:
        row = (
            await self.db.execute(scoped(GiftCard, self.biz).where(GiftCard.code == code))
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("gift card not found")
        return row


def _out(card: GiftCard) -> GiftCardOut:
    return GiftCardOut(
        id=card.id,
        code=card.code,
        initial_cents=card.initial_cents,
        balance_cents=card.balance_cents,
        status=card.status,
    )
