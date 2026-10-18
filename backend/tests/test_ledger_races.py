"""Two writers on one ledger row against the real database; rows stay in a throwaway business."""

import asyncio
import json
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable

import pytest
from scripts.seed_demo import purge_businesses
from sqlalchemy import delete, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from clientbridge.core.config import get_settings
from clientbridge.core.db import SessionLocal
from clientbridge.core.deps import Principal
from clientbridge.core.errors import Conflict
from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice
from clientbridge.models.business import Business
from clientbridge.models.catalog import GiftCard, Item, Package
from clientbridge.models.clients import Client
from clientbridge.models.ledger import Entry
from clientbridge.models.payments import Payment
from clientbridge.models.platform import Webhook
from clientbridge.schemas.entitlements import GiftCardRedeem
from clientbridge.schemas.payments import InvoicePaymentIn
from clientbridge.services import ledger
from clientbridge.services.entitlements import GiftCardService, PackageService
from clientbridge.services.ledger import Leg
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

    winner, loser = await race.run(lambda: post(True), lambda: post(False))
    assert winner is None and loser is not None
    async with SessionLocal() as check:
        assert await _journals(check, ref) == 1
        assert (
            await ledger.balance(
                check, business.id, owner_type="client", owner_id=client.id, category="receivable"
            )
            == 100
        )


async def test_two_redemptions_of_one_card_cannot_overspend_it(
    db: AsyncSession, throwaway: Throwaway
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
                await service.redeem_gift_card(GiftCardRedeem(code=code, amount_cents=700))
            except Conflict as exc:
                return exc
            return None

    first, second = await race.run(lambda: redeem(True), lambda: redeem(False))
    assert first is None
    assert second is not None and second.message == "invalid redemption amount"
    async with SessionLocal() as check:
        settled = await check.get(GiftCard, card_id)
        assert settled is not None and await ledger.gift_card_balance(check, settled) == 300


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
