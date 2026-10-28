from datetime import date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.deps import Principal
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.integrations.stripe import ChargeFees
from clientbridge.models.billing import Estimate, Invoice, Line, Order
from clientbridge.models.business import Business, Staff
from clientbridge.models.catalog import GiftCard, Item, Package, StockMovement, Subscription
from clientbridge.models.clients import Note
from clientbridge.models.ledger import Account, Entry
from clientbridge.models.payments import Payment, PaymentMethod
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.schemas.payments import RemittanceIn, TaxFamily
from clientbridge.services import bookings, earnings, ledger
from clientbridge.services.business import registered_on
from clientbridge.services.lines import fetch_lines, included_totals, price_lines
from clientbridge.services.remittances import RemittanceService
from clientbridge.services.tax import (
    TaxComponent,
    TaxLine,
    TaxResult,
    compute_tax,
    issued_tax,
    rates_on,
)
from scripts.demo_context import DemoContext

GIFT_TENDERS = (
    ("gc_used", "inv_gift_david", 5000, -15),
    ("gc_expired", "inv_gift_ethan", 2500, -20),
)
APPLIED_DEPOSIT = "bk_001"
PACKAGE_VISITS = (
    ("pkg_marcus", "cl_marcus", "sj_rex", (-52, -24)),
    ("pkg_grace", "cl_grace", "sj_pepper", (-105, -84, -63, -42, -21)),
    ("pkg_sophie", "cl_sophie", "sj_mochi", (-7,)),
)
FILING_LEAD_DAYS = (9, 5, 12, 7, 4, 13, 6, 10)


def add_finance_scenarios(ctx: DemoContext) -> None:
    for package_id, client_id, pet_id, days in PACKAGE_VISITS:
        for index, day in enumerate(days):
            slot_id, booking_id = (
                f"ses_package_{package_id}_{index}",
                f"bk_package_{package_id}_{index}",
            )
            start = ctx.at(day, 14)
            ctx.add(
                Slot(
                    id=slot_id,
                    business_id=ctx.business_id,
                    item_id="it_bath",
                    staff_id="st_priya",
                    starts_at=start,
                    ends_at=start + timedelta(minutes=45),
                    capacity=1,
                    status="scheduled",
                )
            )
            ctx.add(
                Booking(
                    id=booking_id,
                    business_id=ctx.business_id,
                    slot_id=slot_id,
                    starts_at=start,
                    staff_id="st_priya",
                    client_id=client_id,
                    subject_id=pet_id,
                    package_id=package_id,
                    status="completed",
                    completed_at=start + timedelta(minutes=45),
                    price_cents=4500,
                )
            )


def tax_on(ctx: DemoContext, lines: list[Line]) -> TaxResult:
    result = _taxed(ctx, [TaxLine(line.amount_cents, tax_class=line.tax_class) for line in lines])
    for line, part in zip(lines, result.lines, strict=True):
        line.tax_amount_cents = part.tax_cents
    return result


def charge_tax(
    ctx: DemoContext, cents: int, tax_class: str, on: date, *, included: bool = False
) -> TaxResult:
    """Tax on one amount at the rates of `on`, added to it or, when `included`, contained in it."""
    return _taxed(ctx, [TaxLine(cents, tax_class=tax_class)], on, included=included)


def _taxed(
    ctx: DemoContext, lines: list[TaxLine], on: date | None = None, *, included: bool = False
) -> TaxResult:
    business = ctx.get(Business, ctx.business_id)
    if business.province is None:
        raise ValueError(f"{business.id} needs a province for its demo taxes")
    return compute_tax(
        lines,
        [
            TaxComponent(r.jurisdiction, r.rate)
            for r in rates_on(business.province, on or ctx.now.date())
        ],
        registered=registered_on(
            business.tax_registered, business.tax_registered_on, on or ctx.now.date()
        ),
        prices_include_tax=included,
    )


def _line(
    ctx: DemoContext,
    item_id: str,
    line_id: str,
    *,
    invoice_id: str | None = None,
    estimate_id: str | None = None,
    amount: int | None = None,
) -> Line:
    item = ctx.get(Item, item_id)
    price = item.price_cents if amount is None else amount
    line = Line(
        id=line_id,
        business_id=ctx.business_id,
        invoice_id=invoice_id,
        estimate_id=estimate_id,
        item_id=item.id,
        description=item.name,
        quantity=1,
        unit_amount_cents=price,
        amount_cents=price,
        tax_class=item.tax_class,
        position=0,
    )
    ctx.add(line)
    return line


def _new_invoice(
    ctx: DemoContext, invoice_id: str, client_id: str, when: datetime, note: str
) -> Invoice:
    number = max((i.number or 0 for i in ctx.all(Invoice)), default=1000) + 1
    invoice = Invoice(
        id=invoice_id,
        business_id=ctx.business_id,
        client_id=client_id,
        number=number,
        status="sent",
        currency="CAD",
        issued_at=when,
        due_at=when + timedelta(days=14),
        notes=note,
        pay_token=f"demo_pay_{invoice_id}",
        created_at=when,
        updated_at=when,
    )
    ctx.add(invoice)
    return invoice


def prepare_estimates(ctx: DemoContext) -> None:
    for estimate in ctx.all(Estimate):
        lines = [line for line in ctx.all(Line) if line.estimate_id == estimate.id]
        if not lines and estimate.converted_invoice_id:
            invoice = ctx.get(Invoice, estimate.converted_invoice_id)
            estimate.discount_kind = invoice.discount_kind
            estimate.discount_value = invoice.discount_value
            estimate.discount_reason = invoice.discount_reason
            for source in [
                line for line in ctx.all(Line) if line.invoice_id == estimate.converted_invoice_id
            ]:
                ctx.add(
                    Line(
                        id=f"ln_{estimate.id}_{source.id}",
                        business_id=ctx.business_id,
                        estimate_id=estimate.id,
                        item_id=source.item_id,
                        description=source.description,
                        quantity=source.quantity,
                        unit_amount_cents=source.unit_amount_cents,
                        amount_cents=source.amount_cents,
                        tax_class=source.tax_class,
                        discount_kind=source.discount_kind,
                        discount_value=source.discount_value,
                        discount_reason=source.discount_reason,
                        position=source.position,
                    )
                )
        elif not lines:
            _line(ctx, "it_groom_lg", f"ln_{estimate.id}", estimate_id=estimate.id)
        if estimate.id == "est_1001":
            for line in lines:
                if line.item_id in {"it_deshed", "it_shampoo"}:
                    line.optional = True
                    line.selected = line.item_id == "it_deshed"
        if estimate.accepted_at:
            estimate.created_at = estimate.accepted_at - timedelta(days=2)
            estimate.updated_at = estimate.accepted_at
            if estimate.converted_invoice_id:
                invoice = ctx.get(Invoice, estimate.converted_invoice_id)
                issued = estimate.accepted_at + timedelta(minutes=5)
                invoice.issued_at = invoice.created_at = issued


def _membership(ctx: DemoContext) -> None:
    subscription = ctx.get(Subscription, "sub_david")
    item = ctx.get(Item, subscription.item_id)
    method = ctx.get(PaymentMethod, "pm_david")
    subscription.payment_method_id = method.id
    when = ctx.at(-6, 0)
    invoice = _new_invoice(
        ctx,
        "inv_subscription_david",
        subscription.client_id,
        when,
        f"Monthly Daycare: {when.date()} to {subscription.current_period_end}; "
        f"demo subscription {subscription.id}.",
    )
    _line(ctx, item.id, "ln_subscription_david", invoice_id=invoice.id)
    payment = ctx.get(Payment, "pay_sub_david")
    payment.invoice_id, payment.method = invoice.id, method.method
    payment.amount_cents = tax_on(ctx, [ctx.get(Line, "ln_subscription_david")]).total_cents
    payment.paid_at = payment.updated_at = when + timedelta(minutes=5)
    payment.created_at = when
    payment.note = f"Simulated recurring charge for {subscription.id}, method {method.id}."
    for note in ctx.all(Note):
        if note.parent_type == "client" and note.parent_id == "cl_david":
            note.body = (
                "Zeus attends supervised daycare regularly. Monthly Daycare is paid "
                "with the saved demo Visa; individual grooming visits are billed separately."
            )


def _entitlements(ctx: DemoContext) -> None:
    for package in ctx.all(Package):
        visits = sorted(
            [b for b in ctx.all(Booking) if b.package_id == package.id],
            key=lambda b: ctx.get(Slot, b.slot_id).starts_at,
        )
        first = ctx.get(Slot, visits[0].slot_id).starts_at if visits else ctx.now
        package.created_at = first - timedelta(days=2)
        package.updated_at = (
            visits[-1].completed_at if visits and visits[-1].completed_at else package.created_at
        )
        package.expires_at = package.created_at + timedelta(days=365)
        package.status = "used" if len(visits) == package.sessions_total else "active"
    for card in ctx.all(GiftCard):
        card.expires_at = None
        card.status = "active"
        card.created_at = ctx.at(-120 if card.id == "gc_used" else -60)
        card.updated_at = card.created_at
    for card_id, invoice_id, amount, day in GIFT_TENDERS:
        card = ctx.get(GiftCard, card_id)
        client_id = card.purchaser_client_id
        if client_id is None:
            raise ValueError(f"{card.id} needs a purchaser for its demo sale")
        invoice = _new_invoice(
            ctx,
            invoice_id,
            client_id,
            ctx.at(day),
            f"Gift tender {card.code}: {amount} cents applied to this taxed bath service.",
        )
        _line(
            ctx,
            "it_bath",
            f"ln_{invoice_id}",
            invoice_id=invoice.id,
            amount=5000 if amount == 5000 else 4500,
        )
        card.updated_at = invoice.issued_at or card.created_at


def price_documents(ctx: DemoContext) -> None:
    items = {item.id: item for item in ctx.all(Item)}
    for line in ctx.all(Line):
        if line.item_id:
            line.tax_class = items[line.item_id].tax_class
    for kind, parents in (
        ("invoice", ctx.all(Invoice)),
        ("estimate", ctx.all(Estimate)),
        ("order", ctx.all(Order)),
    ):
        children: dict[str, list[Line]] = {}
        for line in ctx.all(Line):
            parent_id = getattr(line, f"{kind}_id")
            if parent_id is not None:
                children.setdefault(parent_id, []).append(line)
        for parent in parents:
            lines = sorted(children.get(parent.id, []), key=lambda line: line.position)
            price_lines(lines, parent)
            result = included_totals(lines, tax_on(ctx, lines))
            parent.subtotal_cents, parent.tax_total_cents, parent.total_cents = (
                result.subtotal_cents,
                result.tax_total_cents,
                result.total_cents,
            )


def _payments(ctx: DemoContext, previous_totals: dict[str, int]) -> None:
    invoices = {invoice.id: invoice for invoice in ctx.all(Invoice)}
    orders = {order.id: order for order in ctx.all(Order)}
    tendered = {invoice_id for _, invoice_id, _, _ in GIFT_TENDERS}
    for invoice in invoices.values():
        if invoice.status == "draft":
            invoice.issued_at = invoice.due_at = invoice.overdue_notified_at = None
            invoice.created_at = invoice.updated_at = invoice.created_at or ctx.at(-2)
            continue
        visits = [
            ctx.get(Booking, line.booking_id)
            for line in ctx.all(Line)
            if line.invoice_id == invoice.id and line.booking_id
        ]
        if visits:
            end = max(ctx.get(Slot, booking.slot_id).ends_at for booking in visits)
            invoice.issued_at = end if end <= ctx.now else ctx.now - timedelta(days=1)
            invoice.created_at = min(b.created_at for b in visits)
        issued = invoice.issued_at or ctx.at(-2)
        due = issued + timedelta(days=14)
        invoice.issued_at = invoice.updated_at = issued
        invoice.created_at = min(invoice.created_at or issued, issued)
        invoice.due_at = due
        invoice.overdue_notified_at = (
            due + timedelta(days=1)
            if due + timedelta(days=1) < ctx.now and invoice.id not in tendered
            else None
        )
    original_amounts = {p.id: p.amount_cents for p in ctx.all(Payment)}
    for payment in ctx.all(Payment):
        if payment.kind == "refund":
            continue
        parent = invoices.get(payment.invoice_id or "") or orders.get(payment.order_id or "")
        if parent:
            old_total = previous_totals.get(parent.id, parent.total_cents)
            payment.amount_cents = int(
                (Decimal(payment.amount_cents) * parent.total_cents / max(old_total, 1)).quantize(
                    Decimal(1), rounding=ROUND_HALF_UP
                )
            )
            payment.client_id = parent.client_id
            if isinstance(parent, Invoice):
                payment.paid_at = (
                    min(parent.issued_at + timedelta(minutes=5), ctx.now)
                    if parent.issued_at
                    else ctx.at(-1)
                )
            else:
                paid = min(payment.paid_at or ctx.at(-1), ctx.now - timedelta(hours=1))
                payment.paid_at = parent.updated_at = paid
                parent.created_at = paid - timedelta(hours=1)
        if payment.kind == "deposit" and payment.booking_id:
            payment.amount_cents = ctx.get(Booking, payment.booking_id).deposit_amount_cents
        payment.created_at = (
            payment.paid_at - timedelta(minutes=5)
            if payment.paid_at
            else ctx.now - timedelta(hours=1)
        )
        payment.updated_at = payment.paid_at or payment.created_at
        if payment.status != "succeeded":
            payment.paid_at = None
    for payment in ctx.all(Payment):
        if payment.kind != "refund":
            continue
        original = ctx.get(Payment, payment.parent_payment_id or "")
        payment.amount_cents = int(
            Decimal(original.amount_cents)
            * payment.amount_cents
            / max(original_amounts[original.id], 1)
        )
        paid = min(
            (original.paid_at or ctx.at(-3)) + timedelta(days=1), ctx.now - timedelta(hours=1)
        )
        payment.paid_at = payment.updated_at = paid
        payment.created_at = paid - timedelta(minutes=5)
    for order in orders.values():
        paid_at = [
            p.paid_at
            for p in ctx.all(Payment)
            if p.order_id == order.id and p.status == "succeeded" and p.kind != "refund"
        ]
        order.paid_at = max((at for at in paid_at if at), default=None)


def _applied_deposit(ctx: DemoContext) -> None:
    """A visit whose deposit was taken at booking; seed_finance applies it to the invoice."""
    booking = ctx.get(Booking, APPLIED_DEPOSIT)
    paid = booking.created_at + timedelta(minutes=10)
    booking.deposit_status = "collected"
    settled = next(
        p for p in ctx.all(Payment) if p.invoice_id == booking.invoice_id and p.kind == "payment"
    )
    settled.amount_cents -= booking.deposit_amount_cents
    ctx.add(
        Payment(
            id="pay_dep_applied",
            business_id=ctx.business_id,
            client_id=booking.client_id,
            booking_id=booking.id,
            kind="deposit",
            amount_cents=booking.deposit_amount_cents,
            currency="CAD",
            method="card",
            provider="stripe",
            provider_ref="pi_demo_dep_applied",
            status="succeeded",
            paid_at=paid,
            created_at=paid - timedelta(minutes=5),
            updated_at=paid,
        )
    )


def _inventory(ctx: DemoContext) -> None:
    for order in ctx.all(Order):
        payments = [
            p
            for p in ctx.all(Payment)
            if p.order_id == order.id and p.status == "succeeded" and p.kind != "refund"
        ]
        lines = [line for line in ctx.all(Line) if line.order_id == order.id]
        if order.source == "online":
            order.status_token = order.status_token or f"demo_status_{order.id}"
            for line in lines:
                line.for_pickup = True
        if not payments:
            continue
        when = max(p.paid_at for p in payments if p.paid_at)
        for line in lines:
            item = ctx.get(Item, line.item_id) if line.item_id else None
            if (
                item is not None
                and item.track_stock
                and not any(
                    m.line_id == line.id and m.reason == "sale" for m in ctx.all(StockMovement)
                )
            ):
                ctx.add(
                    StockMovement(
                        id=f"sm_sale_{line.id}",
                        business_id=ctx.business_id,
                        item_id=item.id,
                        line_id=line.id,
                        reason="sale",
                        quantity=-int(line.quantity),
                        created_by=ctx.owner_id,
                        created_at=when,
                        updated_at=when,
                    )
                )
    for item in ctx.all(Item):
        if item.track_stock:
            item.stock_on_hand = sum(
                m.quantity for m in ctx.all(StockMovement) if m.item_id == item.id
            )


def _journeys(ctx: DemoContext) -> None:
    order = ctx.get(Order, "ord_1")
    order.discount_kind, order.discount_value, order.discount_reason = (
        "percent",
        10,
        "First retail bundle",
    )
    payment = ctx.get(Payment, "pay_ord1")
    payment.tip_cents, payment.tip_split = 500, [{"staff_id": order.staff_id, "cents": 500}]
    original = ctx.get(Payment, "pay_ord2")
    ctx.add(
        Payment(
            id="pay_demo_partial_refund",
            business_id=ctx.business_id,
            client_id=original.client_id,
            parent_payment_id=original.id,
            kind="refund",
            amount_cents=500,
            currency="CAD",
            method=original.method,
            provider=original.provider,
            status="succeeded",
            reason="Partial goodwill credit after the visit",
            credit_note="CN-S2-DEMO-1",
            paid_at=ctx.now - timedelta(hours=4),
        )
    )
    item = ctx.get(Item, "it_brush")
    for index, status in enumerate(("ready", "picked_up")):
        order_id = f"ord_demo_{status}"
        when = ctx.at(-3 - index, 10)
        ctx.add(
            Order(
                id=order_id,
                business_id=ctx.business_id,
                client_id="cl_grace",
                staff_id="st_owner",
                number=20 + index,
                status="open",
                currency="CAD",
                source="online",
                pickup_status=status,
                paid_at=when,
                preparing_at=when + timedelta(minutes=20),
                ready_at=when + timedelta(hours=1),
                picked_up_at=when + timedelta(hours=2) if status == "picked_up" else None,
                pickup_from=when + timedelta(hours=1),
                pickup_to=when + timedelta(days=3),
            )
        )
        ctx.add(
            Line(
                id=f"ln_{order_id}",
                business_id=ctx.business_id,
                order_id=order_id,
                item_id=item.id,
                description=item.name,
                quantity=1,
                unit_amount_cents=item.price_cents,
                amount_cents=item.price_cents,
                tax_class=item.tax_class,
                position=0,
                for_pickup=True,
            )
        )
        total = tax_on(ctx, [ctx.get(Line, f"ln_{order_id}")]).total_cents
        ctx.add(
            Payment(
                id=f"pay_{order_id}",
                business_id=ctx.business_id,
                client_id="cl_grace",
                order_id=order_id,
                kind="payment",
                amount_cents=total,
                currency="CAD",
                method="card",
                provider="stripe",
                provider_ref=f"pi_demo_{order_id}",
                status="succeeded",
                paid_at=when,
            )
        )
    for status in ("pending", "failed"):
        ctx.add(
            Payment(
                id=f"pay_demo_{status}",
                business_id=ctx.business_id,
                client_id="cl_sophie",
                invoice_id="inv_1095",
                kind="payment",
                amount_cents=ctx.get(Invoice, "inv_1095").total_cents,
                currency="CAD",
                method="card",
                provider="stripe",
                status=status,
                note=f"Simulated {status} attempt; no funds moved.",
                created_at=ctx.now - timedelta(hours=2),
                updated_at=ctx.now - timedelta(hours=1),
            )
        )


def prepare_finance(ctx: DemoContext) -> None:
    previous = {row.id: row.total_cents for row in ctx.all(Invoice)}
    previous.update({row.id: row.total_cents for row in ctx.all(Order)})
    prepare_estimates(ctx)
    _membership(ctx)
    _entitlements(ctx)
    _journeys(ctx)
    price_documents(ctx)
    _payments(ctx, previous)
    _applied_deposit(ctx)
    tipped = ctx.get(Payment, "pay_ord1")
    tipped.amount_cents = ctx.get(Order, "ord_1").total_cents + tipped.tip_cents
    for status in ("pending", "failed"):
        attempt = ctx.get(Payment, f"pay_demo_{status}")
        attempt.amount_cents = ctx.get(Invoice, "inv_1095").total_cents
        attempt.paid_at = None
    refund = ctx.get(Payment, "pay_demo_partial_refund")
    original = ctx.get(Payment, "pay_ord2")
    refund.amount_cents = min(500, original.amount_cents)
    assert original.paid_at is not None
    refund.paid_at = refund.created_at = refund.updated_at = original.paid_at + timedelta(
        minutes=30
    )
    _inventory(ctx)


async def _purchases(db: AsyncSession, ctx: DemoContext) -> None:
    targets: list[Package | GiftCard] = [*ctx.all(Package), *ctx.all(GiftCard)]
    for target in targets:
        client_id: str | None
        if isinstance(target, Package):
            client_id = target.client_id
            item = ctx.get(Item, target.item_id)
            amount = tax_on(
                ctx, [Line(amount_cents=item.price_cents, tax_class=item.tax_class)]
            ).total_cents
        else:
            client_id, amount = target.purchaser_client_id, target.initial_cents
        when = target.created_at
        payment = Payment(
            id=f"pay_{target.id}",
            business_id=ctx.business_id,
            client_id=client_id,
            kind="payment",
            amount_cents=amount,
            currency="CAD",
            method="card",
            provider="stripe",
            provider_ref=f"pi_demo_{target.id}",
            status="succeeded",
            paid_at=when + timedelta(minutes=5),
            created_at=when,
            updated_at=when + timedelta(minutes=5),
            note="Simulated entitlement purchase; no external provider operation.",
        )
        db.add(payment)
        await db.flush()
        target.payment_id = payment.id
        ctx.add(payment)
    await db.flush()


async def _gift_tender(db: AsyncSession, ctx: DemoContext) -> None:
    for card_id, invoice_id, amount, _ in GIFT_TENDERS:
        card, invoice = ctx.get(GiftCard, card_id), ctx.get(Invoice, invoice_id)
        when = (invoice.issued_at or ctx.at(-1)) + timedelta(minutes=10)
        await ledger.post(
            db,
            ctx.business_id,
            event="redemption",
            ref=f"demo_redemption:{card.id}:{invoice.id}",
            legs=[
                ledger.Leg("gift_card", card.id, "gift_card", amount),
                ledger.Leg("client", invoice.client_id, "receivable", -amount),
            ],
            source=("gift_card", card.id),
            subject=("invoice", invoice.id),
            occurred_at=when,
        )
        remainder = invoice.total_cents - amount
        payment = Payment(
            id=f"pay_cash_{invoice.id}",
            business_id=ctx.business_id,
            client_id=invoice.client_id,
            invoice_id=invoice.id,
            kind="payment",
            amount_cents=remainder,
            currency="CAD",
            method="cash",
            provider="manual",
            status="succeeded",
            paid_at=when,
            created_at=when,
            updated_at=when,
        )
        db.add(payment)
        ctx.add(payment)
        await db.flush()
        await ledger.post_payment(db, payment, available_at=when)


async def seed_earnings(db: AsyncSession, ctx: DemoContext) -> None:
    for invoice in ctx.all(Invoice):
        if (await ledger.invoice_state(db, invoice))[0] != "paid":
            continue
        payments = [
            p
            for p in ctx.all(Payment)
            if p.invoice_id == invoice.id
            and p.status == "succeeded"
            and p.kind != "refund"
            and p.paid_at
        ]
        if not payments:
            continue
        when = max(p.paid_at for p in payments if p.paid_at)
        await earnings.ensure_earnings(db, invoice, occurred_at=when)
    resume = clock.now()
    try:
        for order in sorted(ctx.all(Order), key=lambda o: o.paid_at or ctx.now):
            if order.paid_at is None:
                continue
            if (await ledger.order_state(db, order))[0] == "paid":
                clock.freeze(order.paid_at)
                await earnings.ensure_order_earning(db, order)
                await earnings.ensure_earnings(db, order, occurred_at=order.paid_at)
    finally:
        clock.travel(resume)
    rows = (
        (
            await db.execute(
                scoped(Entry, ctx.business_id)
                .where(Entry.event == "earning")
                .order_by(Entry.occurred_at)
            )
        )
        .scalars()
        .all()
    )
    seen: set[str] = set()
    runs: dict[tuple[str, date], str] = {}
    for entry in rows:
        if entry.journal_id in seen:
            continue
        seen.add(entry.journal_id)
        earning = await earnings.load_earning(db, ctx.business_id, entry.journal_id)
        if earning is None or entry.occurred_at + timedelta(days=2) >= ctx.now:
            continue
        await earnings.move_earning(
            db, earning, "approve", occurred_at=entry.occurred_at + timedelta(days=1)
        )
        if entry.occurred_at + timedelta(days=8) < ctx.now:
            current = await earnings.load_earning(db, ctx.business_id, entry.journal_id)
            assert current is not None
            paid_at = entry.occurred_at + timedelta(days=3)
            run = runs.setdefault((current.staff_id, paid_at.date()), new_id("pay_run"))
            await earnings.move_earning(db, current, "pay", occurred_at=paid_at, meta={"run": run})
    await _seed_pay_corrections(db, ctx)


async def _seed_pay_corrections(db: AsyncSession, ctx: DemoContext) -> None:
    """Refund clawbacks, a bonus waiting for approval, and one payment undone and made again."""
    for document in [*ctx.all(Invoice), *ctx.all(Order)]:
        await earnings.claw_back(db, document)
    payees = sorted(
        (s for s in ctx.all(Staff) if s.payee and s.role != "owner" and s.status == "active"),
        key=lambda s: s.id,
    )
    if not payees:
        return
    await earnings.post_adjustment(db, payees[0], 5000, "Holiday bonus")
    paid = (
        await db.execute(
            scoped(Entry, ctx.business_id)
            .with_only_columns(Entry.source_id, Entry.occurred_at)
            .where(Entry.event == "staff_payment", Entry.owner_type == "staff")
            .order_by(Entry.occurred_at.desc(), Entry.journal_id)
            .limit(1)
        )
    ).first()
    if paid is None or paid.source_id is None:
        return
    earning = await earnings.load_earning(db, ctx.business_id, paid.source_id)
    assert earning is not None
    await earnings.move_earning(db, earning, "unpay", occurred_at=paid.occurred_at)
    await earnings.move_earning(
        db,
        earning,
        "pay",
        occurred_at=paid.occurred_at + timedelta(hours=1),
        meta={"run": new_id("pay_run")},
    )


async def _stripe_held(
    db: AsyncSession, ctx: DemoContext, before: datetime, *, available_by: datetime | None
) -> int:
    query = (
        scoped(Entry, ctx.business_id)
        .with_only_columns(func.coalesce(func.sum(Entry.amount_cents), 0))
        .join(Account, Account.id == Entry.account_id)
        .where(
            Account.owner_type == "business",
            Account.owner_id == ctx.business_id,
            Account.category == "stripe",
            Entry.occurred_at < before,
        )
    )
    if available_by is not None:
        query = query.where(func.coalesce(Entry.available_at, Entry.occurred_at) <= available_by)
    return int(await db.scalar(query) or 0)


async def seed_payouts(
    db: AsyncSession, ctx: DemoContext, *, first_day: int = -112, failed_day: int | None = -28
) -> None:
    for index, day in enumerate(range(first_day, -6, 7)):
        arrival = ctx.at(day, 10)
        amount = await _stripe_held(db, ctx, arrival, available_by=arrival)
        if amount <= 0:
            continue
        payout_id = f"po_demo_{ctx.business_id}_w{index}"
        await ledger.post_payout(
            db,
            ctx.business_id,
            payout_id=payout_id,
            amount=amount,
            currency="CAD",
            arrival_at=arrival,
            occurred_at=arrival - timedelta(days=2),
        )
        if day == failed_day:
            await ledger.fail_payout(
                db, ctx.business_id, payout_id, occurred_at=arrival + timedelta(days=1)
            )
        else:
            await ledger.arrive_payout(
                db,
                ctx.business_id,
                payout_id=payout_id,
                amount=amount,
                currency="CAD",
                arrival_at=arrival,
            )
    # deployed demo businesses link to empty Stripe test accounts, which reconcile_ledger compares
    swept = ctx.now - timedelta(minutes=1)
    remaining = await _stripe_held(db, ctx, swept, available_by=None)
    if remaining > 0:
        final = f"po_demo_{ctx.business_id}_final"
        await ledger.post_payout(
            db,
            ctx.business_id,
            payout_id=final,
            amount=remaining,
            currency="CAD",
            arrival_at=swept,
            occurred_at=swept,
        )
        await ledger.arrive_payout(
            db, ctx.business_id, payout_id=final, amount=remaining, currency="CAD", arrival_at=swept
        )


async def post_invoices(db: AsyncSession, ctx: DemoContext) -> None:
    for invoice in sorted(ctx.all(Invoice), key=lambda i: i.issued_at or ctx.now):
        if invoice.status in {"draft", "void"}:
            continue
        lines = await fetch_lines(db, ctx.business_id, "invoice", invoice.id)
        tax = await issued_tax(db, ctx.business_id, lines, invoice.issued_at or ctx.now)
        if tax.total_cents != invoice.total_cents:
            raise ValueError(f"{invoice.id}: header differs from its tax snapshot")
        await ledger.post_invoice(db, invoice, tax)


async def post_payments(db: AsyncSession, ctx: DemoContext) -> None:
    for payment in sorted(ctx.all(Payment), key=lambda p: p.paid_at or ctx.now):
        if payment.status != "succeeded" or payment.kind == "refund":
            continue
        available = (
            payment.paid_at + timedelta(days=2)
            if payment.paid_at and payment.provider == "stripe"
            else payment.paid_at
        )
        await ledger.post_payment(db, payment, available_at=available)
        if payment.provider == "stripe":
            await ledger.post_fees(
                db,
                payment,
                ChargeFees(
                    processing_fee_cents=(payment.amount_cents * 29 + 500) // 1000 + 30,
                    application_fee_cents=payment.amount_cents * 200 // 10000,
                    available_at=available,
                ),
            )
        if payment.dispute_status:
            occurred = min(
                (payment.paid_at or ctx.at(-3)) + timedelta(days=3), ctx.now - timedelta(hours=1)
            )
            await ledger.post_dispute(
                db,
                payment,
                dispute_id=f"dp_demo_{payment.id}",
                amount=payment.amount_cents,
                fee=1500,
                occurred_at=occurred,
            )
    for refund in ctx.all(Payment):
        if refund.kind == "refund" and refund.status == "succeeded":
            await ledger.post_refund(db, refund, ctx.get(Payment, refund.parent_payment_id or ""))


async def apply_deposit_at(db: AsyncSession, booking: Booking, invoice: Invoice) -> None:
    """Apply a held deposit as of the invoice's issue, the way checkout applies it."""
    resume = clock.now()
    clock.freeze(invoice.issued_at or clock.now())
    try:
        if not await bookings.apply_deposit(db, booking, invoice):
            raise ValueError(f"{booking.id}: its deposit was not applied to {invoice.id}")
    finally:
        clock.travel(resume)


def owner_principal(ctx: DemoContext) -> Principal:
    owner = next(s for s in ctx.all(Staff) if s.user_id == ctx.owner_id)
    return Principal(
        user_id=ctx.owner_id, business_id=ctx.business_id, staff_id=owner.id, role="owner"
    )


def _filed_on(ctx: DemoContext, due: date) -> date:
    turn = due.year * 4 + due.month // 3 + sum(map(ord, ctx.business_id))
    return due - timedelta(days=FILING_LEAD_DAYS[turn % len(FILING_LEAD_DAYS)])


async def seed_returns(db: AsyncSession, ctx: DemoContext) -> None:
    """File GST and PST apart, as BC does, for every period whose due date has passed."""
    if not ctx.get(Business, ctx.business_id).tax_registered:
        return
    service = RemittanceService(db, owner_principal(ctx))
    resume = clock.now()
    clock.freeze(ctx.now)
    try:
        filings = await service.filings()
    finally:
        clock.travel(resume)
    today = ctx.now.astimezone(ctx.zone).date()
    for period in reversed(filings.periods):
        if period.due >= today:
            continue
        filed_on = _filed_on(ctx, period.due)
        families: list[tuple[TaxFamily, str, int]] = [
            ("federal", period.federal_status, 10),
            ("provincial", period.provincial_status, 11),
        ]
        for family, status, hour in families:
            if status != "due":
                continue
            await service.post_return(
                RemittanceIn(
                    period_start=period.start,
                    period_end=period.end,
                    family=family,
                    filed_on=filed_on,
                ),
                filed_on=filed_on,
                occurred_at=datetime.combine(filed_on, time(hour), tzinfo=ctx.zone),
            )


async def seed_finance(db: AsyncSession, ctx: DemoContext) -> None:
    await post_invoices(db, ctx)
    await _purchases(db, ctx)
    await post_payments(db, ctx)
    await _gift_tender(db, ctx)
    applied = ctx.get(Booking, APPLIED_DEPOSIT)
    await apply_deposit_at(db, applied, ctx.get(Invoice, applied.invoice_id or ""))
    for booking in sorted(ctx.all(Booking), key=lambda b: b.completed_at or ctx.now):
        if booking.package_id and booking.status == "completed":
            await ledger.post_consumption(
                db,
                ctx.get(Package, booking.package_id),
                occurred_at=booking.completed_at,
                booking_id=booking.id,
            )
    await seed_earnings(db, ctx)
    await seed_payouts(db, ctx)
    await seed_returns(db, ctx)
