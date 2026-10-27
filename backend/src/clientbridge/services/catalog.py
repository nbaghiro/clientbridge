from sqlalchemy import distinct, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import Conflict, NotFound, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.models.business import Staff
from clientbridge.models.catalog import BOOKABLE_KINDS, Item
from clientbridge.models.scheduling import Addon, Booking, Resource
from clientbridge.schemas.catalog import (
    ItemCreate,
    ItemOut,
    ItemUpdate,
    TaxClassChange,
    TaxClassResult,
)
from clientbridge.services import ledger


class CatalogService:
    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal

    def _assert_admin(self) -> None:
        assert_role(
            self.principal, "owner", "admin", message="only an owner or admin can edit the catalog"
        )

    async def set_tax_class(
        self, data: TaxClassChange, idempotency_key: str | None
    ) -> TaxClassResult:
        """One tax class for many items; issued documents keep the class copied onto their lines."""
        self._assert_admin()
        ids = set(data.item_ids)
        items = (
            (
                await self.db.execute(
                    scoped(Item, self.principal.business_id).where(Item.id.in_(ids))
                )
            )
            .scalars()
            .all()
        )
        if len(items) != len(ids):
            raise NotFound("item not found")

        async def run(cmd: Command) -> TaxClassResult:
            for item in items:
                if item.tax_class != data.tax_class:
                    cmd.record(
                        "item.tax_class",
                        entity_type="item",
                        entity_id=item.id,
                        changes={"from": item.tax_class, "to": data.tax_class},
                    )
                    item.tax_class = data.tax_class
            await self.db.flush()
            return TaxClassResult(count=len(items))

        return await run_command(
            self.db,
            self.principal,
            action="item.tax_class",
            run=run,
            response_model=TaxClassResult,
            idempotency_key=idempotency_key,
            request=data,
        )

    async def create(self, data: ItemCreate, idempotency_key: str | None = None) -> ItemOut:
        self._assert_admin()

        async def run(cmd: Command) -> ItemOut:
            bookable = (
                data.kind in BOOKABLE_KINDS
                if data.online_bookable is None
                else data.online_bookable
            )
            item = Item(
                id=new_id("item"),
                business_id=self.principal.business_id,
                created_by=self.principal.user_id,
                kind=data.kind,
                name=data.name,
                description=data.description,
                variant_parent_id=data.variant_parent_id,
                variant_label=data.variant_label,
                price_cents=data.price_cents,
                currency=data.currency,
                duration_min=data.duration_min,
                capacity=data.capacity,
                category=data.category,
                color=data.color,
                online_bookable=bookable,
                active=data.active,
                tax_class=data.tax_class,
                sku=data.sku,
                cost_cents=data.cost_cents,
                track_stock=data.track_stock,
                sell_online=data.sell_online,
                stock_on_hand=0 if data.track_stock else None,
                low_stock_at=data.low_stock_at,
                buffer_before_min=data.buffer_before_min,
                buffer_after_min=data.buffer_after_min,
                deposit_type=data.deposit_type,
                deposit_value=data.deposit_value,
                session_count=data.session_count,
                validity_days=data.validity_days,
                interval=data.interval,
                frequency=data.frequency,
                covers_item_id=data.covers_item_id,
                visits_per_period=data.visits_per_period,
                member_discount_bps=data.member_discount_bps,
                gift_amounts=_amounts(data.gift_amounts),
                staff_ids=sorted(set(data.staff_ids)),
                resource_ids=sorted(set(data.resource_ids)),
            )
            _assert_shape(item)
            await self._assert_covers(item)
            await self._assert_variant(item)
            await self._assert_staff(item.staff_ids)
            await self._assert_resources(item.resource_ids)
            self.db.add(item)
            await self.db.flush()
            await self.db.refresh(item)
            cmd.record("item.create", entity_type="item", entity_id=item.id)
            return ItemOut.model_validate(item)

        try:
            return await run_command(
                self.db,
                self.principal,
                action="item.create",
                run=run,
                response_model=ItemOut,
                idempotency_key=idempotency_key,
                request=data,
            )
        except IntegrityError as exc:
            _raise_if_sku_taken(exc)
            raise

    async def update(self, item_id: str, data: ItemUpdate) -> Item:
        self._assert_admin()
        item = await load_item(self.db, self.principal.business_id, item_id, require_active=False)
        changes = data.model_dump(exclude_unset=True)
        if item.kind == "product" and changes.get("duration_min", item.duration_min) != (
            item.duration_min
        ):
            await self._assert_length_unused(item)
        offered_before = set(item.staff_ids)
        pool_before = set(item.resource_ids)
        for listed in ("staff_ids", "resource_ids"):
            if changes.get(listed, ()) is None:
                changes[listed] = []
        for key, value in changes.items():
            setattr(item, key, _amounts(value) if key == "gift_amounts" else value)
        item.staff_ids = sorted(set(item.staff_ids))
        item.resource_ids = sorted(set(item.resource_ids))
        if "online_bookable" not in changes and item.kind not in BOOKABLE_KINDS:
            item.online_bookable = False
        if item.track_stock and item.stock_on_hand is None:
            item.stock_on_hand = 0
        _assert_shape(item)
        # the checks' queries would flush the edit early, so a taken SKU must wait for _save
        with self.db.no_autoflush:
            await self._assert_covers(item)
            await self._assert_variant(item)
            await self._assert_staff([s for s in item.staff_ids if s not in offered_before])
            await self._assert_resources([r for r in item.resource_ids if r not in pool_before])
        await self._save(item)
        return item

    async def _assert_length_unused(self, item: Item) -> None:
        """An add-on's minutes are part of each visit it is on, so its length holds until then."""
        visits = await self.db.scalar(
            scoped(Addon, self.principal.business_id)
            .with_only_columns(func.count(distinct(Addon.booking_id)))
            .join(Booking, Booking.id == Addon.booking_id)
            .where(
                Addon.item_id == item.id,
                Booking.deleted_at.is_(None),
                Booking.status.in_(("pending", "confirmed")),
                Booking.invoice_id.is_(None),
            )
        )
        if visits:
            raise Conflict(
                f"this add-on is on {visits} upcoming visits; its length can't change until then",
                code="addon_length_in_use",
                detail={"count": visits},
            )

    async def _assert_staff(self, staff_ids: list[str]) -> None:
        """Each newly named member is active in this business; one removed later stays listed."""
        if not staff_ids:
            return
        found = await self.db.scalars(
            scoped(Staff, self.principal.business_id)
            .with_only_columns(Staff.id)
            .where(Staff.id.in_(staff_ids), Staff.status == "active")
        )
        if set(found) != set(staff_ids):
            raise NotFound("staff not found")

    async def _assert_resources(self, resource_ids: list[str]) -> None:
        """Each newly added resource is active in this business; one retired later stays listed."""
        if not resource_ids:
            return
        found = await self.db.scalars(
            scoped(Resource, self.principal.business_id)
            .with_only_columns(Resource.id)
            .where(Resource.id.in_(resource_ids), Resource.active.is_(True))
        )
        if set(found) != set(resource_ids):
            raise NotFound("resource not found")

    async def _assert_variant(self, item: Item) -> None:
        if item.variant_parent_id is not None:
            parent = await load_item(self.db, self.principal.business_id, item.variant_parent_id)
            if (
                item.kind != "product"
                or parent.kind != "product"
                or parent.id == item.id
                or parent.variant_parent_id is not None
            ):
                raise Unprocessable("a product variant must belong to a standalone product")
            if parent.currency != item.currency:
                raise Unprocessable("a variant must use its product's currency")
            if not item.variant_label:
                raise Unprocessable("a variant needs a label")
        children = (
            (
                await self.db.execute(
                    scoped(Item, self.principal.business_id).where(
                        Item.variant_parent_id == item.id
                    )
                )
            )
            .scalars()
            .all()
        )
        if children and (
            item.kind != "product"
            or item.variant_parent_id is not None
            or any(child.currency != item.currency for child in children)
        ):
            raise Unprocessable(
                "a product with variants must stay a standalone product in their currency"
            )

    async def _assert_covers(self, item: Item) -> None:
        if item.covers_item_id is None:
            return
        covered = (
            await self.db.execute(
                scoped(Item, self.principal.business_id).where(Item.id == item.covers_item_id)
            )
        ).scalar_one_or_none()
        if covered is None:
            raise NotFound("the covered service was not found")
        if covered.kind not in BOOKABLE_KINDS or covered.id == item.id:
            raise Unprocessable("a package visit covers a service or a class")

    async def _save(self, item: Item) -> None:
        try:
            await self.db.flush()
        except IntegrityError as exc:
            await self.db.rollback()
            _raise_if_sku_taken(exc)
            raise
        await self.db.refresh(item)
        await self.db.commit()


def _raise_if_sku_taken(exc: IntegrityError) -> None:
    if "ux_items_business_sku" in str(exc.orig):
        raise Conflict("another item already uses that SKU", code="sku_taken") from exc


async def load_item(
    db: AsyncSession, biz: str, item_id: str, *, require_active: bool = True
) -> Item:
    """Load a catalog item by id (active only by default), else NotFound."""
    q = scoped(Item, biz).where(Item.id == item_id)
    if require_active:
        q = q.where(Item.active.is_(True))
    row = (await db.execute(q)).scalar_one_or_none()
    if row is None:
        raise NotFound("item not found")
    return row


def _assert_shape(item: Item) -> None:
    item.currency = ledger.supported(item.currency)
    if item.online_bookable and item.kind not in BOOKABLE_KINDS:
        raise Unprocessable("only services and classes can be booked online")
    if item.track_stock and item.kind != "product":
        raise Unprocessable("only products can track stock")
    if item.sell_online and item.kind != "product":
        raise Unprocessable("only products can be sold online")
    if item.deposit_type != "none" and item.kind not in BOOKABLE_KINDS:
        raise Unprocessable("only services and classes take a deposit")
    if (
        item.deposit_type == "percent"
        and item.deposit_value is not None
        and item.deposit_value > 100
    ):
        raise Unprocessable("a percentage deposit can't be over 100")
    if item.session_count is not None and item.kind not in ("package", "class"):
        raise Unprocessable("only packages and classes have a session count")
    if (item.interval is not None or item.frequency is not None) and item.kind != "subscription":
        raise Unprocessable("only subscriptions repeat")
    if item.covers_item_id is not None and item.kind != "package":
        raise Unprocessable("only a package covers a service")
    if (
        item.visits_per_period is not None or item.member_discount_bps is not None
    ) and item.kind != "subscription":
        raise Unprocessable("only memberships include visits or a member discount")
    if item.gift_amounts is not None and item.kind != "gift":
        raise Unprocessable("only gift cards have suggested amounts")
    if item.staff_ids and item.kind not in BOOKABLE_KINDS:
        raise Unprocessable("only services and classes name the staff who offer them")
    if item.resource_ids and item.kind not in BOOKABLE_KINDS:
        raise Unprocessable("only services and classes need rooms or equipment")


NOT_OFFERED = "that staff member doesn't offer this service"


def offers(item: Item, staff_id: str) -> bool:
    """Whether the member performs this service or class; an empty list means everyone does."""
    return not item.staff_ids or staff_id in item.staff_ids


def assert_offers(item: Item, staff_id: str) -> None:
    if not offers(item, staff_id):
        raise Unprocessable(NOT_OFFERED, code="service_not_offered")


def _amounts(value: object) -> list[int] | None:
    if not isinstance(value, list):
        return None
    return sorted({int(v) for v in value}) or None


def deposit_cents(item: Item) -> int:
    """Fixed cents or a percent of the price (half to even), never more than the price."""
    if item.deposit_type == "none" or item.deposit_value is None:
        return 0
    if item.deposit_type == "fixed":
        return min(int(item.deposit_value), item.price_cents)
    return min(round(item.price_cents * float(item.deposit_value) / 100), item.price_cents)
