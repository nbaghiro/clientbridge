from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.scoping import scoped
from clientbridge.integrations.stripe import ChargeFees
from clientbridge.models.billing import Estimate, Invoice, Line, Order
from clientbridge.models.business import Business
from clientbridge.models.catalog import GiftCard, Item, Package, StockMovement, Subscription
from clientbridge.models.clients import Note
from clientbridge.models.ledger import Account, Entry
from clientbridge.models.payments import Payment, PaymentMethod
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.services import earnings, ledger
from clientbridge.services.lines import fetch_lines, included_totals, price_lines
from clientbridge.services.tax import TaxComponent, TaxLine, TaxResult, compute_tax, tax_for_lines
from scripts.demo_context import DemoContext

PACKAGE_VISITS = (
    ("pkg_marcus", "cl_marcus", "sj_rex", (-52, -24)),
    ("pkg_grace", "cl_grace", "sj_pepper", (-105, -84, -63, -42, -21)),
    ("pkg_sophie", "cl_sophie", "sj_mochi", (-7,)),
)


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
                    resource_id="rs_bath",
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
                    staff_id="st_priya",
                    client_id=client_id,
                    subject_id=pet_id,
                    package_id=package_id,
                    status="completed",
                    completed_at=start + timedelta(minutes=45),
                    price_cents=4500,
                )
            )


def _tax(ctx: DemoContext, lines: list[Line]) -> TaxResult:
    business = ctx.get(Business, ctx.business_id)
    result = compute_tax(
        [TaxLine(line.amount_cents, tax_class=line.tax_class) for line in lines],
        [TaxComponent("GST", 500), TaxComponent("PST", 700)],
        registered=business.tax_registered,
    )
    for line, part in zip(lines, result.lines, strict=True):
        line.tax_amount_cents = part.tax_cents
    return result


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


def _estimates(ctx: DemoContext) -> None:
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
                invoice.issued_at = estimate.accepted_at + timedelta(minutes=5)
                invoice.created_at = invoice.issued_at


def _membership(ctx: DemoContext) -> None:
    subscription = ctx.get(Subscription, "sub_david")
    item = ctx.get(Item, subscription.item_id)
    method = ctx.get(PaymentMethod, "pm_david")
    subscription.payment_method_id = method.id
    when = subscription.current_period_start or ctx.at(-6)
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
    payment.amount_cents = _tax(ctx, [ctx.get(Line, "ln_subscription_david")]).total_cents
    payment.paid_at = when + timedelta(minutes=5)
    payment.created_at = when
    payment.updated_at = payment.paid_at
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
    for card_id, invoice_id, amount, day in (
        ("gc_used", "inv_gift_david", 5000, -15),
        ("gc_expired", "inv_gift_ethan", 2500, -20),
    ):
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


def _headers(ctx: DemoContext) -> None:
    items = {item.id: item for item in ctx.all(Item)}
    for line in ctx.all(Line):
        if line.item_id:
            line.tax_class = items[line.item_id].tax_class
    for kind, parents in (
        ("invoice", ctx.all(Invoice)),
        ("estimate", ctx.all(Estimate)),
        ("order", ctx.all(Order)),
    ):
        for parent in parents:
            lines = sorted(
                [line for line in ctx.all(Line) if getattr(line, f"{kind}_id") == parent.id],
                key=lambda line: line.position,
            )
            price_lines(lines, parent)
            result = included_totals(lines, _tax(ctx, lines))
            parent.subtotal_cents, parent.tax_total_cents, parent.total_cents = (
                result.subtotal_cents,
                result.tax_total_cents,
                result.total_cents,
            )


def _payments(ctx: DemoContext, previous_totals: dict[str, int]) -> None:
    invoices = {invoice.id: invoice for invoice in ctx.all(Invoice)}
    orders = {order.id: order for order in ctx.all(Order)}
    for invoice in invoices.values():
        visits = [
            ctx.get(Booking, line.booking_id)
            for line in ctx.all(Line)
            if line.invoice_id == invoice.id and line.booking_id
        ]
        if visits:
            end = max(ctx.get(Slot, booking.slot_id).ends_at for booking in visits)
            invoice.issued_at = end if end <= ctx.now else ctx.now - timedelta(days=1)
            invoice.created_at = min(b.created_at for b in visits)
        invoice.issued_at = invoice.issued_at or ctx.at(-2)
        invoice.created_at = min(invoice.created_at or invoice.issued_at, invoice.issued_at)
        invoice.updated_at = invoice.issued_at
        invoice.due_at = invoice.issued_at + timedelta(days=14)
        invoice.overdue_notified_at = (
            invoice.due_at + timedelta(days=1)
            if invoice.due_at + timedelta(days=1) < ctx.now
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
                payment.paid_at = min(payment.paid_at or ctx.at(-1), ctx.now - timedelta(hours=1))
                parent.created_at = payment.paid_at - timedelta(hours=1)
                parent.updated_at = payment.paid_at
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
        payment.paid_at = min(
            (original.paid_at or ctx.at(-3)) + timedelta(days=1), ctx.now - timedelta(hours=1)
        )
        payment.created_at = payment.paid_at - timedelta(minutes=5)
        payment.updated_at = payment.paid_at


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
        total = _tax(ctx, [ctx.get(Line, f"ln_{order_id}")]).total_cents
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
    _estimates(ctx)
    _membership(ctx)
    _entitlements(ctx)
    _journeys(ctx)
    _headers(ctx)
    _payments(ctx, previous)
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
    refund.paid_at = original.paid_at + timedelta(minutes=30)
    refund.created_at = refund.updated_at = refund.paid_at
    _inventory(ctx)


async def _purchases(db: AsyncSession, ctx: DemoContext) -> None:
    targets: list[Package | GiftCard] = [*ctx.all(Package), *ctx.all(GiftCard)]
    for target in targets:
        client_id: str | None
        if isinstance(target, Package):
            client_id = target.client_id
            item = ctx.get(Item, target.item_id)
            amount = _tax(
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
    for card_id, invoice_id, amount in (
        ("gc_used", "inv_gift_david", 5000),
        ("gc_expired", "inv_gift_ethan", 2500),
    ):
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


async def _earnings(db: AsyncSession, ctx: DemoContext) -> None:
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
    for entry in rows:
        if entry.journal_id in seen:
            continue
        seen.add(entry.journal_id)
        earning = await earnings.load_earning(db, ctx.business_id, entry.journal_id)
        if earning is None or entry.occurred_at + timedelta(days=2) >= ctx.now:
            continue
        await earnings.advance_earning(
            db, earning, "approved", occurred_at=entry.occurred_at + timedelta(days=1)
        )
        if entry.occurred_at + timedelta(days=8) < ctx.now:
            current = await earnings.load_earning(db, ctx.business_id, entry.journal_id)
            assert current is not None
            await earnings.advance_earning(
                db, current, "paid", occurred_at=entry.occurred_at + timedelta(days=3)
            )


async def _payouts(db: AsyncSession, ctx: DemoContext) -> None:
    for index, day in enumerate(range(-112, -6, 7)):
        arrival = ctx.at(day, 10)
        amount = int(
            await db.scalar(
                scoped(Entry, ctx.business_id)
                .with_only_columns(func.coalesce(func.sum(Entry.amount_cents), 0))
                .join(Account, Account.id == Entry.account_id)
                .where(
                    Account.owner_type == "business",
                    Account.owner_id == ctx.business_id,
                    Account.category == "stripe",
                    Entry.occurred_at < arrival,
                    func.coalesce(Entry.available_at, Entry.occurred_at) <= arrival,
                )
            )
            or 0
        )
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
        )
        if day == -28:
            await ledger.fail_payout(
                db, ctx.business_id, payout_id, occurred_at=arrival + timedelta(days=1)
            )


async def seed_finance(db: AsyncSession, ctx: DemoContext) -> None:
    for invoice in sorted(ctx.all(Invoice), key=lambda i: i.issued_at or ctx.now):
        if invoice.status in {"draft", "void"}:
            continue
        tax = await tax_for_lines(
            db, ctx.business_id, await fetch_lines(db, ctx.business_id, "invoice", invoice.id)
        )
        if tax.total_cents != invoice.total_cents:
            raise ValueError(f"{invoice.id}: header differs from its tax snapshot")
        await ledger.post_invoice(db, invoice, tax)
    await _purchases(db, ctx)
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
    await _gift_tender(db, ctx)
    for booking in sorted(ctx.all(Booking), key=lambda b: b.completed_at or ctx.now):
        if booking.package_id and booking.status == "completed":
            await ledger.post_consumption(
                db,
                ctx.get(Package, booking.package_id),
                occurred_at=booking.completed_at,
                booking_id=booking.id,
            )
    await _earnings(db, ctx)
    await _payouts(db, ctx)
