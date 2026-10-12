"""Two writers on one ledger row against the real database; rows stay in a throwaway business."""

import asyncio
import json
import uuid
from collections.abc import Awaitable, Callable

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.db import SessionLocal
from clientbridge.core.deps import Principal
from clientbridge.core.errors import Conflict
from clientbridge.core.ids import new_id
from clientbridge.integrations.stripe import ChargeFees
from clientbridge.models.billing import Invoice
from clientbridge.models.business import Business
from clientbridge.models.catalog import GiftCard, Item, Package
from clientbridge.models.clients import Client
from clientbridge.models.ledger import Entry
from clientbridge.models.payments import Payment
from clientbridge.schemas.entitlements import GiftCardRedeem
from clientbridge.schemas.payments import InvoicePaymentIn
from clientbridge.services import ledger
from clientbridge.services.entitlements import GiftCardService, PackageService
from clientbridge.services.ledger import Leg
from clientbridge.services.payments import PaymentService, process_stripe_event
from tests.conftest import Factory, FakePaymentGateway, book_invoice


async def _throwaway() -> tuple[Business, Client, Principal]:
    """A business, client and owner of their own, so nothing here touches the seed's rows."""
    async with SessionLocal() as session:
        factory = Factory(session)
        business = await factory.business(name="Race Studio")
        client = await factory.client(business=business)
        user = await factory.user()
        staff = await factory.staff(business=business, user=user, role="owner")
        await session.commit()
        principal = Principal(
            user_id=user.id, business_id=business.id, staff_id=staff.id, role="owner"
        )
        return business, client, principal


async def _journals(session: AsyncSession, ref: str) -> int:
    rows = await session.execute(select(Entry.journal_id).where(Entry.ref == ref))
    return len(set(rows.scalars().all()))


async def _second_after[T](
    started: asyncio.Event, first: Callable[[], Awaitable[T]], second: Callable[[], Awaitable[T]]
) -> tuple[T, T]:
    async def late() -> T:
        await started.wait()
        return await second()

    return await asyncio.gather(first(), late())


async def test_two_posts_on_one_ref_write_one_journal(db: AsyncSession) -> None:
    business, client, _ = await _throwaway()
    ref = f"race:{uuid.uuid4().hex}"
    legs = [
        Leg("client", client.id, "receivable", 100),
        Leg("business", business.id, "revenue", -100),
    ]
    started = asyncio.Event()

    async def post(hold: bool) -> IntegrityError | None:
        async with SessionLocal() as session:
            try:
                await ledger.post(session, business.id, event="adjustment", ref=ref, legs=legs)
                if hold:
                    started.set()
                    await asyncio.sleep(0.3)
                await session.commit()
            except IntegrityError as exc:
                return exc
            return None

    winner, loser = await _second_after(started, lambda: post(True), lambda: post(False))
    assert winner is None and loser is not None
    async with SessionLocal() as check:
        assert await _journals(check, ref) == 1
        assert (
            await ledger.balance(
                check, business.id, owner_type="client", owner_id=client.id, category="receivable"
            )
            == 100
        )


async def test_two_redemptions_of_one_card_cannot_overspend_it(db: AsyncSession) -> None:
    business, client, principal = await _throwaway()
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
    started = asyncio.Event()

    async def redeem(hold: bool) -> Conflict | None:
        async with SessionLocal() as session:
            service = GiftCardService(session, principal, FakePaymentGateway())
            try:
                if hold:  # take the card's row lock first, then keep it while the other arrives
                    await session.execute(
                        select(GiftCard.id).where(GiftCard.id == card_id).with_for_update()
                    )
                    started.set()
                    await asyncio.sleep(0.3)
                await service.redeem_gift_card(GiftCardRedeem(code=code, amount_cents=700))
            except Conflict as exc:
                return exc
            return None

    first, second = await _second_after(started, lambda: redeem(True), lambda: redeem(False))
    assert first is None
    assert second is not None and second.message == "invalid redemption amount"
    async with SessionLocal() as check:
        settled = await check.get(GiftCard, card_id)
        assert settled is not None and await ledger.gift_card_balance(check, settled) == 300


async def test_two_consumes_of_a_one_session_package_use_it_once(db: AsyncSession) -> None:
    business, client, principal = await _throwaway()
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
    started = asyncio.Event()

    async def consume(hold: bool) -> Conflict | None:
        async with SessionLocal() as session:
            service = PackageService(session, principal, FakePaymentGateway())
            try:
                if hold:
                    await session.execute(
                        select(Package.id).where(Package.id == package_id).with_for_update()
                    )
                    started.set()
                    await asyncio.sleep(0.3)
                await service.consume_session(package_id)
            except Conflict as exc:
                return exc
            return None

    first, second = await _second_after(started, lambda: consume(True), lambda: consume(False))
    assert first is None and second is not None
    async with SessionLocal() as check:
        used = await check.get(Package, package_id)
        assert used is not None and used.status == "used"
        assert await ledger.sessions_used(check, used) == 1


class _SlowFees(FakePaymentGateway):
    def __init__(self, started: asyncio.Event) -> None:
        super().__init__()
        self.started = started

    async def get_payment_fees(
        self, account_id: str, *, payment_intent_id: str
    ) -> ChargeFees | None:
        self.started.set()
        await asyncio.sleep(0.3)
        return ChargeFees(0, 0, None)


async def test_cash_cannot_land_while_a_card_charge_is_settling(db: AsyncSession) -> None:
    business, client, principal = await _throwaway()
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
    started = asyncio.Event()
    event = json.dumps(
        {
            "id": f"evt_{uuid.uuid4().hex}",
            "type": "payment_intent.succeeded",
            "data": {"object": {"id": pi}},
        }
    )

    async def settle() -> Conflict | None:
        async with SessionLocal() as session:
            await process_stripe_event(session, _SlowFees(started), event.encode(), "good")
            return None

    async def cash() -> Conflict | None:
        async with SessionLocal() as session:
            service = PaymentService(session, principal, FakePaymentGateway())
            try:
                await service.record_invoice_payment(
                    invoice_id, InvoicePaymentIn(method="cash", amount_cents=5000), None
                )
            except Conflict as exc:
                return exc
            return None

    _, refused = await _second_after(started, settle, cash)
    assert (
        refused is not None and refused.message == "this invoice already has a payment in progress"
    )
    async with SessionLocal() as check:
        paid = await check.get(Invoice, invoice_id)
        assert paid is not None
        assert (await ledger.invoice_state(check, paid))[0] == "paid"
        assert await ledger.collected(check, business.id, "invoice", invoice_id) == (5000, False)
