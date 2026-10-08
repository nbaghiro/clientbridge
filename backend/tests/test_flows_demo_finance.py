from datetime import UTC, datetime, timedelta

import httpx
import pytest
from scripts.demo_context import DemoContext
from scripts.demo_finance import _estimates, _headers, _payouts, add_finance_scenarios
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.scoping import scoped
from clientbridge.models.billing import Estimate, Invoice, Line
from clientbridge.models.business import Business
from clientbridge.models.catalog import Item, Package
from clientbridge.models.ledger import Entry
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking
from clientbridge.services import ledger
from tests.conftest import Factory
from tests.helpers import enable_payments


def test_demo_headers_tax_service_and_retail_separately_and_preserve_conversion() -> None:
    ctx = DemoContext(datetime(2026, 10, 8, tzinfo=UTC), "bz_test", "us_test")
    ctx.add(Business(id=ctx.business_id, tax_registered=True))
    ctx.add(Item(id="it_groom_lg", tax_class="federal_only", price_cents=11000, name="Groom"))
    ctx.add(Item(id="it_retail", tax_class="standard", price_cents=2400, name="Shampoo"))
    ctx.add(Invoice(id="inv_demo", total_cents=1, issued_at=ctx.at(-1)))
    ctx.add(
        Line(
            id="ln_service",
            invoice_id="inv_demo",
            item_id="it_groom_lg",
            description="Groom",
            quantity=1,
            unit_amount_cents=11000,
            amount_cents=11000,
            position=0,
        )
    )
    ctx.add(
        Line(
            id="ln_retail",
            invoice_id="inv_demo",
            item_id="it_retail",
            description="Shampoo",
            quantity=1,
            unit_amount_cents=2400,
            amount_cents=2400,
            position=1,
        )
    )
    ctx.add(Estimate(id="est_demo", converted_invoice_id="inv_demo", accepted_at=ctx.at(-2)))
    _estimates(ctx)
    _headers(ctx)
    invoice, estimate = ctx.get(Invoice, "inv_demo"), ctx.get(Estimate, "est_demo")
    assert (invoice.subtotal_cents, invoice.tax_total_cents, invoice.total_cents) == (
        13400,
        838,
        14238,
    )
    assert estimate.total_cents == invoice.total_cents
    assert estimate.subtotal_cents == invoice.subtotal_cents
    assert invoice.issued_at is not None and estimate.accepted_at is not None
    assert estimate.accepted_at < invoice.issued_at
    assert ctx.get(Line, "ln_service").tax_amount_cents == 550
    assert ctx.get(Line, "ln_retail").tax_amount_cents == 288


def test_package_visits_are_concrete_and_new_client_uses_only_one_session() -> None:
    ctx = DemoContext(datetime(2026, 10, 8, tzinfo=UTC), "bz_test", "us_test")
    add_finance_scenarios(ctx)
    bookings = ctx.all(Booking)
    assert len(bookings) == 8 and all(b.package_id and b.subject_id for b in bookings)
    sophie = [b for b in bookings if b.client_id == "cl_sophie"]
    assert len(sophie) == 1 and sophie[0].package_id == "pkg_sophie"
    assert sophie[0].completed_at is not None
    assert ctx.now - timedelta(days=8) < sophie[0].completed_at < ctx.now
    assert not ctx.all(Invoice) and not ctx.all(Payment)


async def test_weekly_payouts_sweep_actual_available_balance_once(db: AsyncSession) -> None:
    business = await Factory(db).business()
    ctx = DemoContext(datetime(2026, 10, 8, tzinfo=UTC), business.id, "us_dev")
    for index, (day, amount) in enumerate(((-120, 10000), (-100, 4000), (-30, 2000))):
        await ledger.post(
            db,
            business.id,
            event="payment",
            ref=f"test_demo_cash:{business.id}:{index}",
            legs=[
                ledger.Leg("business", business.id, "stripe", amount),
                ledger.Leg("business", business.id, "revenue", -amount),
            ],
            occurred_at=ctx.at(day),
            available_at=ctx.at(day + 2),
        )
    await _payouts(db, ctx)
    assert (
        await ledger.balance(
            db, business.id, owner_type="business", owner_id=business.id, category="stripe"
        )
        == 0
    )
    assert (
        await ledger.balance(
            db, business.id, owner_type="business", owner_id=business.id, category="bank"
        )
        == 16000
    )
    rows = (await db.execute(scoped(Entry, business.id))).scalars().all()
    assert any(row.ref.endswith(":failed") and row.occurred_at == ctx.at(-27, 10) for row in rows)
    assert all(row.occurred_at < ctx.now for row in rows)


async def test_package_tax_and_dated_visit_consumption_use_real_posting(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    item = await db.get(Item, "it_pkg5")
    assert item is not None
    item.tax_class = "federal_only"
    await db.flush()
    response = await as_owner.post(
        "/v1/packages",
        json={"client_id": "cl_marcus", "item_id": item.id, "payment_method_id": "default"},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    package = await db.get(Package, body["package_id"])
    payment = await db.get(Payment, body["payment_id"])
    assert package is not None and payment is not None
    assert payment.amount_cents == 21000
    when = datetime(2026, 7, 1, 18, tzinfo=UTC)
    payment.paid_at = when
    await ledger.post_payment(db, payment, available_at=when)
    assert (
        await ledger.balance(
            db, package.business_id, owner_type="package", owner_id=package.id, category="deferred"
        )
        == -20000
    )
    booking = await db.get(Booking, "bk_001")
    assert booking is not None
    with pytest.raises(ValueError, match="owned booking"):
        await ledger.post_consumption(db, package, occurred_at=when, booking_id=booking.id)
    booking.package_id = package.id
    booking.status = "completed"
    await db.flush()
    used_at = when + timedelta(days=7)
    await ledger.post_consumption(db, package, occurred_at=used_at, booking_id=booking.id)
    await ledger.post_consumption(db, package, occurred_at=used_at, booking_id=booking.id)
    assert await ledger.sessions_used(db, package) == 1
    entries = (
        (
            await db.execute(
                scoped(Entry, package.business_id).where(
                    Entry.ref == f"consumption:{package.id}:booking:{booking.id}"
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(entries) == 2 and sum(row.amount_cents for row in entries) == 0
    assert all(row.occurred_at == used_at and row.source_id == booking.id for row in entries)


def test_demo_optional_estimate_totals_exclude_unselected_addons_and_match_conversion() -> None:
    ctx = DemoContext(datetime(2026, 10, 8, tzinfo=UTC), "bz_test", "us_test")
    ctx.add(Business(id=ctx.business_id, tax_registered=True))
    for item_id, price, tax_class in (
        ("it_service", 10000, "federal_only"),
        ("it_deshed", 2000, "federal_only"),
        ("it_shampoo", 2400, "standard"),
    ):
        ctx.add(
            Item(id=item_id, business_id=ctx.business_id, price_cents=price, tax_class=tax_class)
        )
    estimate = Estimate(
        id="est_1001", business_id=ctx.business_id, discount_kind="percent", discount_value=10
    )
    ctx.add(estimate)
    for position, (item_id, price) in enumerate(
        (("it_service", 10000), ("it_deshed", 2000), ("it_shampoo", 2400))
    ):
        ctx.add(
            Line(
                id=f"ln_optional_{position}",
                business_id=ctx.business_id,
                estimate_id=estimate.id,
                item_id=item_id,
                quantity=1,
                unit_amount_cents=price,
                amount_cents=price,
                position=position,
            )
        )
    _estimates(ctx)
    _headers(ctx)
    assert (estimate.subtotal_cents, estimate.tax_total_cents, estimate.total_cents) == (
        10800,
        540,
        11340,
    )
    selected, unselected = ctx.get(Line, "ln_optional_1"), ctx.get(Line, "ln_optional_2")
    assert selected.optional and selected.selected and selected.sale_discount_cents == 200
    assert unselected.optional and not unselected.selected and unselected.sale_discount_cents == 0
    assert unselected.amount_cents == 2400 and unselected.tax_amount_cents == 288
    invoice = Invoice(
        id="inv_accepted_snapshot",
        business_id=ctx.business_id,
        discount_kind="percent",
        discount_value=10,
    )
    ctx.add(invoice)
    for position, item_id in enumerate(("it_service", "it_deshed")):
        source = ctx.get(Line, f"ln_optional_{position}")
        ctx.add(
            Line(
                id=f"ln_accepted_{position}",
                business_id=ctx.business_id,
                invoice_id=invoice.id,
                item_id=item_id,
                quantity=source.quantity,
                unit_amount_cents=source.unit_amount_cents,
                amount_cents=source.amount_cents,
                position=position,
            )
        )
    accepted = Estimate(
        id="est_accepted_snapshot",
        business_id=ctx.business_id,
        converted_invoice_id=invoice.id,
        accepted_at=ctx.at(-1),
    )
    ctx.add(accepted)
    _estimates(ctx)
    _headers(ctx)
    assert accepted.total_cents == invoice.total_cents == estimate.total_cents
    assert accepted.discount_kind == "percent" and accepted.discount_value == 10
    assert len([r for r in ctx.all(Line) if r.estimate_id == accepted.id]) == 2


@pytest.mark.parametrize("hour", [0, 7, 12, 18, 23])
def test_seed_daily_money_and_completed_visit_chronology(hour: int) -> None:
    from zoneinfo import ZoneInfo

    from scripts.seed_demo import build_demo

    from clientbridge.models.scheduling import Slot

    zone = ZoneInfo("America/Vancouver")
    ctx = build_demo(datetime(2026, 10, 8, hour, tzinfo=zone))
    refund = ctx.get(Payment, "pay_demo_partial_refund")
    original = ctx.get(Payment, refund.parent_payment_id or "")
    assert original.paid_at is not None and refund.paid_at is not None
    assert original.paid_at < refund.paid_at < ctx.now
    assert refund.paid_at.astimezone(zone).date() < ctx.now.astimezone(zone).date()
    for payment in ctx.all(Payment):
        if payment.status == "succeeded":
            assert payment.paid_at is not None and payment.paid_at <= ctx.now
    for booking in ctx.all(Booking):
        if booking.status != "completed" or not booking.invoice_id:
            continue
        invoice = ctx.get(Invoice, booking.invoice_id)
        end = ctx.get(Slot, booking.slot_id).ends_at
        assert invoice.issued_at is not None and invoice.issued_at >= end
        for payment in ctx.all(Payment):
            if payment.invoice_id == invoice.id and payment.paid_at:
                assert payment.paid_at >= invoice.issued_at
