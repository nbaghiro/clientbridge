"""Two writers on one ledger row against the real database; rows stay in a throwaway business."""

import asyncio
import json
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import timedelta

import pytest
from scripts.seed_demo import purge_businesses
from sqlalchemy import delete, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from clientbridge.core import clock
from clientbridge.core.config import get_settings
from clientbridge.core.db import SessionLocal
from clientbridge.core.deps import Principal
from clientbridge.core.errors import Conflict
from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice, Line
from clientbridge.models.business import Business
from clientbridge.models.catalog import GiftCard, Item, Package
from clientbridge.models.clients import Client
from clientbridge.models.ledger import Entry
from clientbridge.models.payments import Payment
from clientbridge.models.platform import Webhook
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.schemas.billing import InvoiceCreate, LineInput
from clientbridge.schemas.catalog import ItemUpdate
from clientbridge.schemas.entitlements import GiftCardRedeem, PackageCover, PackagePurchase
from clientbridge.schemas.orders import OrderCreate, OrderUpdate
from clientbridge.schemas.payments import InvoicePaymentIn
from clientbridge.services import ledger
from clientbridge.services.billing import BillingService
from clientbridge.services.catalog import CatalogService
from clientbridge.services.entitlements import GiftCardService, PackageService
from clientbridge.services.ledger import Leg
from clientbridge.services.orders import OrderService
from clientbridge.services.payments import PaymentService, process_stripe_event
from tests.conftest import Factory, FakePaymentGateway, book_invoice

RACE_EVENT = "evt_race_"  # webhooks are not business-scoped, so the purge finds them by id

type Throwaway = Callable[[], Awaitable[tuple[Business, Client, Principal]]]


@pytest.fixture
async def throwaway(db: AsyncSession) -> AsyncIterator[Throwaway]:
    """A business, client and owner of their own, purged afterwards like the demo seed's rows."""
    made: list[tuple[str, str]] = []

    async def make() -> tuple[Business, Client, Principal]:
        async with SessionLocal() as session:
            factory = Factory(session)
            business = await factory.business(name="Race Studio")
            client = await factory.client(business=business)
            user = await factory.user()
            staff = await factory.staff(business=business, user=user, role="owner")
            await session.commit()
            made.append((business.id, user.id))
            principal = Principal(
                user_id=user.id, business_id=business.id, staff_id=staff.id, role="owner"
            )
            return business, client, principal

    yield make
    owner = create_async_engine(get_settings().migration_database_url)
    async with AsyncSession(owner) as session:
        await purge_businesses(session, [b for b, _ in made], [u for _, u in made])
        await session.execute(delete(Webhook).where(Webhook.id.like(f"{RACE_EVENT}%")))
        await session.commit()
    await owner.dispose()


async def _journals(session: AsyncSession, ref: str) -> int:
    rows = await session.execute(select(Entry.journal_id).where(Entry.ref == ref))
    return len(set(rows.scalars().all()))


async def _pid(session: AsyncSession) -> int:
    return (await session.execute(text("SELECT pg_backend_pid()"))).scalar_one()


class Race[T]:
    """The first writer keeps its lock until Postgres reports the second blocked on its backend."""

    def __init__(self) -> None:
        self._first_pid: asyncio.Future[int] = asyncio.get_running_loop().create_future()
        self._second_pid: asyncio.Future[int] = asyncio.get_running_loop().create_future()
        self._second: asyncio.Task[T] | None = None

    async def hold(self, session: AsyncSession) -> None:
        first_pid = await _pid(session)
        self._first_pid.set_result(first_pid)
        second = self._second
        assert second is not None
        async with SessionLocal() as probe:
            while not second.done():
                if self._second_pid.done():
                    blocked = await probe.execute(
                        text("SELECT :first = ANY(pg_blocking_pids(:second))"),
                        {"first": first_pid, "second": self._second_pid.result()},
                    )
                    if blocked.scalar_one():
                        return
                await asyncio.sleep(0.01)
        second.result()
        raise AssertionError("the second writer finished without queueing behind the first")

    async def join(self, session: AsyncSession) -> None:
        await self._first_pid
        self._second_pid.set_result(await _pid(session))

    async def run(
        self, first: Callable[[], Awaitable[T]], second: Callable[[], Awaitable[T]]
    ) -> tuple[T, T]:
        self._second = asyncio.ensure_future(second())
        try:
            winner = await first()
        except BaseException:
            self._second.cancel()
            raise
        return winner, await self._second


async def test_two_posts_on_one_ref_write_one_journal(
    db: AsyncSession, throwaway: Throwaway
) -> None:
    business, client, _ = await throwaway()
    ref = f"race:{uuid.uuid4().hex}"
    legs = [
        Leg("client", client.id, "receivable", 100),
        Leg("business", business.id, "revenue", -100),
    ]
    race = Race[IntegrityError | None]()

    async def post(first: bool) -> IntegrityError | None:
        async with SessionLocal() as session:
            try:
                if not first:
                    await race.join(session)
                await ledger.post(session, business.id, event="invoice", ref=ref, legs=legs)
                if first:
                    await race.hold(session)
                await session.commit()
            except IntegrityError as exc:
                return exc
            return None

    first, second = await race.run(lambda: post(True), lambda: post(False))
    # the second waits on the first's account locks, then finds its journal and returns it
    assert first is None and second is None
    async with SessionLocal() as check:
        assert await _journals(check, ref) == 1
        assert (
            await ledger.balance(
                check, business.id, owner_type="client", owner_id=client.id, category="receivable"
            )
            == 100
        )


@pytest.mark.parametrize(
    ("amount", "refusal", "detail", "left"),
    [
        (700, "gift_card_short", {"balance_cents": 300}, 300),
        (1000, "gift_card_unusable", {"status": "redeemed"}, 0),
    ],
)
async def test_two_redemptions_of_one_card_cannot_overspend_it(
    db: AsyncSession,
    throwaway: Throwaway,
    amount: int,
    refusal: str,
    detail: dict[str, object],
    left: int,
) -> None:
    business, client, principal = await throwaway()
    code = f"RACE-{uuid.uuid4().hex[:8].upper()}"
    async with SessionLocal() as session:
        card = GiftCard(
            id=new_id("gift_card"),
            business_id=business.id,
            code=code,
            initial_cents=1000,
            status="active",
            purchaser_client_id=client.id,
        )
        session.add(card)
        await session.flush()
        await ledger.post(
            session,
            business.id,
            event="payment",
            ref=f"payment:{card.id}",
            legs=[
                Leg("business", business.id, "cash", 1000),
                Leg("gift_card", card.id, "gift_card", -1000),
            ],
            subject=("gift_card", card.id),
        )
        await session.commit()
        card_id = card.id
    race = Race[Conflict | None]()

    async def redeem(first: bool) -> Conflict | None:
        async with SessionLocal() as session:
            service = GiftCardService(session, principal, FakePaymentGateway())
            try:
                if first:
                    await session.execute(
                        select(GiftCard.id).where(GiftCard.id == card_id).with_for_update()
                    )
                    await race.hold(session)
                else:
                    await race.join(session)
                await service.redeem_gift_card(
                    GiftCardRedeem(code=code, amount_cents=amount), f"race-redeem-{first}"
                )
            except Conflict as exc:
                return exc
            return None

    first, second = await race.run(lambda: redeem(True), lambda: redeem(False))
    assert first is None
    assert second is not None and second.code == refusal
    assert second.detail == detail
    async with SessionLocal() as check:
        settled = await check.get(GiftCard, card_id)
        assert settled is not None and await ledger.gift_card_balance(check, settled) == left


async def test_two_consumes_of_a_one_session_package_use_it_once(
    db: AsyncSession, throwaway: Throwaway
) -> None:
    business, client, principal = await throwaway()
    async with SessionLocal() as session:
        item = Item(
            id=new_id("item"),
            business_id=business.id,
            kind="service",
            name="Race session",
            price_cents=1000,
        )
        session.add(item)
        await session.flush()
        package = Package(
            id=new_id("package"),
            business_id=business.id,
            client_id=client.id,
            item_id=item.id,
            sessions_total=1,
            status="active",
        )
        session.add(package)
        await session.flush()
        await ledger.post(
            session,
            business.id,
            event="payment",
            ref=f"payment:{package.id}",
            legs=[
                Leg("business", business.id, "cash", 1000),
                Leg("package", package.id, "deferred", -1000),
            ],
            subject=("package", package.id),
        )
        await session.commit()
        package_id = package.id
    race = Race[Conflict | None]()

    async def consume(first: bool) -> Conflict | None:
        async with SessionLocal() as session:
            service = PackageService(session, principal, FakePaymentGateway())
            try:
                if first:
                    await session.execute(
                        select(Package.id).where(Package.id == package_id).with_for_update()
                    )
                    await race.hold(session)
                else:
                    await race.join(session)
                await service.consume_session(package_id)
            except Conflict as exc:
                return exc
            return None

    first, second = await race.run(lambda: consume(True), lambda: consume(False))
    assert first is None and second is not None
    async with SessionLocal() as check:
        used = await check.get(Package, package_id)
        assert used is not None and used.status == "used"
        assert await ledger.sessions_used(check, used) == 1


@pytest.mark.parametrize(
    ("same", "refusal"), [(False, "package_used_up"), (True, "visit_already_covered")]
)
async def test_two_desks_covering_visits_with_the_last_session_settle_one(
    db: AsyncSession, throwaway: Throwaway, same: bool, refusal: str
) -> None:
    business, client, principal = await throwaway()
    assert principal.staff_id is not None
    started = clock.now() - timedelta(hours=2)
    async with SessionLocal() as session:
        item = Item(
            id=new_id("item"),
            business_id=business.id,
            kind="service",
            name="Race bath",
            price_cents=4500,
            duration_min=30,
        )
        session.add(item)
        await session.flush()
        booking_ids: list[str] = []
        for minutes in (0, 45):
            slot = Slot(
                id=new_id("slot"),
                business_id=business.id,
                item_id=item.id,
                staff_id=principal.staff_id,
                starts_at=started + timedelta(minutes=minutes),
                ends_at=started + timedelta(minutes=minutes + 30),
            )
            session.add(slot)
            await session.flush()
            booking = Booking(
                id=new_id("booking"),
                business_id=business.id,
                slot_id=slot.id,
                starts_at=slot.starts_at,
                staff_id=principal.staff_id,
                client_id=client.id,
                status="confirmed",
                source="manual",
            )
            session.add(booking)
            await session.flush()
            booking_ids.append(booking.id)
        package = Package(
            id=new_id("package"),
            business_id=business.id,
            client_id=client.id,
            item_id=item.id,
            sessions_total=1,
            status="active",
        )
        session.add(package)
        await session.flush()
        await ledger.post(
            session,
            business.id,
            event="payment",
            ref=f"payment:{package.id}",
            legs=[
                Leg("business", business.id, "cash", 4500),
                Leg("package", package.id, "deferred", -4500),
            ],
            subject=("package", package.id),
        )
        await session.commit()
        package_id = package.id
    race = Race[Conflict | None]()

    async def cover(first: bool) -> Conflict | None:
        async with SessionLocal() as session:
            service = PackageService(session, principal, FakePaymentGateway())
            try:
                if first:
                    await session.execute(
                        select(Package.id).where(Package.id == package_id).with_for_update()
                    )
                    await race.hold(session)
                else:
                    await race.join(session)
                await service.cover_visit(
                    package_id,
                    PackageCover(booking_id=booking_ids[0 if first or same else 1]),
                    f"race-cover-{first}",
                )
            except Conflict as exc:
                return exc
            return None

    first, second = await race.run(lambda: cover(True), lambda: cover(False))
    assert first is None
    assert second is not None and second.code == refusal
    async with SessionLocal() as check:
        used = await check.get(Package, package_id)
        assert used is not None and used.status == "used"
        assert await ledger.sessions_used(check, used) == 1
        won, untouched = [await check.get(Booking, booking_id) for booking_id in booking_ids]
        assert won is not None and (won.status, won.package_id) == ("completed", package_id)
        assert untouched is not None
        assert (untouched.status, untouched.package_id) == ("confirmed", None)


@pytest.mark.parametrize(
    ("first", "refusal"), [("cover", "visit_covered"), ("send", "visit_settled")]
)
async def test_covering_a_visit_and_sending_its_invoice_at_once_bill_it_once(
    db: AsyncSession, throwaway: Throwaway, first: str, refusal: str
) -> None:
    business, client, principal = await throwaway()
    assert principal.staff_id is not None
    started = clock.now() - timedelta(hours=1)
    async with SessionLocal() as session:
        item = Item(
            id=new_id("item"),
            business_id=business.id,
            kind="service",
            name="Race bath",
            price_cents=4500,
            duration_min=30,
        )
        session.add(item)
        await session.flush()
        slot = Slot(
            id=new_id("slot"),
            business_id=business.id,
            item_id=item.id,
            staff_id=principal.staff_id,
            starts_at=started,
            ends_at=started + timedelta(minutes=30),
        )
        session.add(slot)
        await session.flush()
        booking = Booking(
            id=new_id("booking"),
            business_id=business.id,
            slot_id=slot.id,
            starts_at=started,
            staff_id=principal.staff_id,
            client_id=client.id,
            status="confirmed",
            source="manual",
        )
        session.add(booking)
        package = Package(
            id=new_id("package"),
            business_id=business.id,
            client_id=client.id,
            item_id=item.id,
            sessions_total=2,
            status="active",
        )
        session.add(package)
        await session.flush()
        await ledger.post(
            session,
            business.id,
            event="payment",
            ref=f"payment:{package.id}",
            legs=[
                Leg("business", business.id, "cash", 9000),
                Leg("package", package.id, "deferred", -9000),
            ],
            subject=("package", package.id),
        )
        line = LineInput(
            description="Race bath", quantity=1, unit_amount_cents=4500, booking_id=booking.id
        )
        draft = await BillingService(session, principal).create_invoice(
            InvoiceCreate(client_id=client.id, lines=[line]), "race-draft"
        )
        await session.commit()
        booking_id, package_id, invoice_id = booking.id, package.id, draft.id
    race = Race[Conflict | None]()

    async def act(kind: str) -> Conflict | None:
        async with SessionLocal() as session:
            try:
                if kind == first:
                    await session.execute(
                        select(Booking.id).where(Booking.id == booking_id).with_for_update()
                    )
                    await race.hold(session)
                else:
                    await race.join(session)
                if kind == "cover":
                    await PackageService(session, principal, FakePaymentGateway()).cover_visit(
                        package_id, PackageCover(booking_id=booking_id), "race-cover"
                    )
                else:
                    await BillingService(session, principal).send_invoice(invoice_id, "race-send")
            except Conflict as exc:
                return exc
            return None

    second = "send" if first == "cover" else "cover"
    won, lost = await race.run(lambda: act(first), lambda: act(second))
    assert won is None
    assert lost is not None and lost.code == refusal
    async with SessionLocal() as check:
        visit = await check.get(Booking, booking_id)
        invoice = await check.get(Invoice, invoice_id)
        assert visit is not None and invoice is not None
        billed = (visit.package_id is not None, invoice.status == "sent")
        assert billed == ((True, False) if first == "cover" else (False, True))


@pytest.mark.parametrize("first", ["sell", "edit"])
async def test_selling_a_package_and_changing_what_it_covers_at_once_keep_the_sale(
    db: AsyncSession, throwaway: Throwaway, first: str
) -> None:
    business, client, principal = await throwaway()
    async with SessionLocal() as session:
        baths, grooms = [
            Item(
                id=new_id("item"),
                business_id=business.id,
                kind="service",
                name=name,
                price_cents=4500,
                duration_min=30,
            )
            for name in ("Race bath", "Race groom")
        ]
        session.add_all([baths, grooms])
        await session.flush()
        pack = Item(
            id=new_id("item"),
            business_id=business.id,
            kind="package",
            name="Race pack",
            price_cents=9000,
            session_count=2,
            covers_item_id=baths.id,
        )
        session.add(pack)
        await session.commit()
        pack_id, baths_id, grooms_id = pack.id, baths.id, grooms.id
    race = Race[Conflict | None]()

    async def act(kind: str) -> Conflict | None:
        async with SessionLocal() as session:
            try:
                if kind == first:
                    held = select(Item.id).where(Item.id == pack_id)
                    await session.execute(
                        held.with_for_update(read=True)
                        if kind == "sell"
                        else held.with_for_update(key_share=True)
                    )
                    await race.hold(session)
                else:
                    await race.join(session)
                if kind == "sell":
                    await PackageService(session, principal, FakePaymentGateway()).purchase_package(
                        PackagePurchase(client_id=client.id, item_id=pack_id, cash=True),
                        "race-sell",
                    )
                else:
                    await CatalogService(session, principal).update(
                        pack_id, ItemUpdate(covers_item_id=grooms_id)
                    )
            except Conflict as exc:
                return exc
            return None

    second = "edit" if first == "sell" else "sell"
    won, lost = await race.run(lambda: act(first), lambda: act(second))
    assert won is None
    if first == "sell":
        assert lost is not None and lost.code == "package_item_sold"
    else:
        assert lost is None
    async with SessionLocal() as check:
        item = await check.get(Item, pack_id)
        sold = (await check.scalars(select(Package).where(Package.item_id == pack_id))).all()
        assert item is not None and len(sold) == 1
        assert item.covers_item_id == (baths_id if first == "sell" else grooms_id)


async def test_cash_is_refused_while_a_card_charge_is_pending(
    db: AsyncSession, throwaway: Throwaway
) -> None:
    """The pending sum, not a lock, is what keeps the cash out until the card settles or fails."""
    business, client, principal = await throwaway()
    pi = f"pi_race_{uuid.uuid4().hex[:10]}"
    async with SessionLocal() as session:
        business.stripe_account_id = f"acct_race_{uuid.uuid4().hex[:10]}"
        session.add(business)
        invoice = Invoice(
            id=new_id("invoice"),
            business_id=business.id,
            client_id=client.id,
            status="sent",
            currency="CAD",
            subtotal_cents=5000,
            tax_total_cents=0,
            total_cents=5000,
        )
        session.add(invoice)
        await session.flush()
        await book_invoice(session, invoice)
        session.add(
            Payment(
                id=new_id("payment"),
                business_id=business.id,
                client_id=client.id,
                kind="payment",
                invoice_id=invoice.id,
                amount_cents=5000,
                currency="CAD",
                method="card",
                provider="stripe",
                provider_ref=pi,
                status="pending",
            )
        )
        await session.commit()
        invoice_id = invoice.id
    event = json.dumps(
        {
            "id": f"{RACE_EVENT}{uuid.uuid4().hex}",
            "type": "payment_intent.succeeded",
            "data": {"object": {"id": pi}},
        }
    )
    async with SessionLocal() as session:
        service = PaymentService(session, principal, FakePaymentGateway())
        with pytest.raises(Conflict, match="already has a payment in progress"):
            await service.record_invoice_payment(
                invoice_id, InvoicePaymentIn(method="cash", amount_cents=5000), None
            )
    async with SessionLocal() as session:
        await process_stripe_event(session, FakePaymentGateway(), event.encode(), "good")
    async with SessionLocal() as check:
        paid = await check.get(Invoice, invoice_id)
        assert paid is not None
        assert (await ledger.invoice_state(check, paid))[0] == "paid"
        assert await ledger.collected(check, business.id, "invoice", invoice_id) == (5000, False)


async def test_two_open_tickets_cannot_both_take_one_visit(
    db: AsyncSession, throwaway: Throwaway
) -> None:
    business, client, principal = await throwaway()
    starts = clock.now() + timedelta(days=1)
    async with SessionLocal() as session:
        item = Item(
            id=new_id("item"),
            business_id=business.id,
            kind="service",
            name="Race groom",
            price_cents=4000,
            duration_min=60,
        )
        session.add(item)
        await session.flush()
        assert principal.staff_id is not None
        slot = Slot(
            id=new_id("slot"),
            business_id=business.id,
            item_id=item.id,
            staff_id=principal.staff_id,
            starts_at=starts,
            ends_at=starts + timedelta(hours=1),
        )
        session.add(slot)
        await session.flush()
        booking = Booking(
            id=new_id("booking"),
            business_id=business.id,
            slot_id=slot.id,
            starts_at=starts,
            staff_id=principal.staff_id,
            client_id=client.id,
            status="confirmed",
            source="manual",
            price_cents=4000,
        )
        session.add(booking)
        await session.flush()
        service = OrderService(session, principal, FakePaymentGateway())
        tickets = [(await service.create_order(OrderCreate())).id for _ in range(2)]
        await session.commit()
        booking_id = booking.id
    visit = LineInput(
        description="Race groom", quantity=1, unit_amount_cents=4000, booking_id=booking_id
    )
    race = Race[Conflict | None]()

    async def ring(first: bool) -> Conflict | None:
        async with SessionLocal() as session:
            service = OrderService(session, principal, FakePaymentGateway())
            try:
                if first:
                    # the lock a visit's own UPDATE takes, so the other ticket's read passes it
                    await session.execute(
                        select(Booking.id)
                        .where(Booking.id == booking_id)
                        .with_for_update(key_share=True)
                    )
                    await race.hold(session)
                else:
                    await race.join(session)
                await service.update_order(tickets[0 if first else 1], OrderUpdate(lines=[visit]))
            except Conflict as exc:
                return exc
            return None

    first, second = await race.run(lambda: ring(True), lambda: ring(False))
    assert first is None
    assert second is not None and second.message.startswith("this visit is already on sale")
    async with SessionLocal() as check:
        linked = await check.get(Booking, booking_id)
        assert linked is not None and linked.order_id == tickets[0]
        billed = await check.scalars(select(Line.order_id).where(Line.booking_id == booking_id))
        assert list(billed) == [tickets[0]]
