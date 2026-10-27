"""Birchbark's visits on the day: a checkout on Tap to Pay, a bath in progress and a house call."""

from datetime import datetime, time, timedelta

from clientbridge.models.billing import Line, Order
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Note
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking, Hours, Slot
from scripts.demo_context import DemoContext
from scripts.demo_finance import tax_on

OPEN, CLOSE = time(9, 0), time(17, 0)
GROOMERS = ("st_diego", "st_owner")
TIP_CENTS = 800


def _works(ctx: DemoContext, member: str, start: datetime, end: datetime) -> bool:
    """Inside the member's hours that day, with nothing else on their calendar."""
    local = start.astimezone(ctx.zone)
    if end.astimezone(ctx.zone).date() != local.date():
        return False
    mine = [h for h in ctx.all(Hours) if h.staff_id == member]
    dated = [h for h in mine if h.basis == "date" and h.date == local.date()]
    days = dated or [h for h in mine if h.basis == "recurring" and h.weekday == local.weekday()]
    open_rows = [h for h in days if h.available and h.start_time and h.end_time]
    if mine and not open_rows:
        return False
    opens = open_rows[0].start_time if open_rows else OPEN
    closes = open_rows[0].end_time if open_rows else CLOSE
    assert opens is not None and closes is not None
    if local.time() < opens or end.astimezone(ctx.zone).time() > closes:
        return False
    away = any(
        h.basis == "exception"
        and not h.available
        and h.starts_at is not None
        and h.ends_at is not None
        and h.starts_at < end
        and start < h.ends_at
        for h in mine
    )
    return not away and _free(ctx, member, None, start, end)


def _free(ctx: DemoContext, member: str, pet: str | None, start: datetime, end: datetime) -> bool:
    slots = {slot.id: slot for slot in ctx.all(Slot)}
    for booking in ctx.all(Booking):
        if booking.status in {"canceled", "waitlisted"}:
            continue
        slot = slots[booking.slot_id]
        mine = booking.staff_id == member or (pet is not None and booking.subject_id == pet)
        if mine and slot.starts_at < end and start < slot.ends_at:
            return False
    return True


def _visit(
    ctx: DemoContext,
    key: str,
    item_id: str,
    member: str,
    client: str,
    pet: str,
    start: datetime,
    created: datetime,
) -> Booking:
    item = ctx.get(Item, item_id)
    end = start + timedelta(minutes=item.duration_min or 60)
    done = end < ctx.now
    ctx.add(
        Slot(
            id=f"ses_{key}",
            business_id=ctx.business_id,
            item_id=item_id,
            staff_id=member,
            starts_at=start,
            ends_at=end,
            capacity=1,
            status="completed" if done else "scheduled",
            created_at=created,
            updated_at=min(end, ctx.now),
        )
    )
    booking = Booking(
        id=f"bk_{key}",
        business_id=ctx.business_id,
        slot_id=f"ses_{key}",
        starts_at=start,
        staff_id=member,
        client_id=client,
        subject_id=pet,
        status="completed" if done else "confirmed",
        source="manual",
        price_cents=item.price_cents,
        confirmed_at=created + timedelta(hours=1),
        completed_at=end if done else None,
        created_at=created,
        updated_at=min(end, ctx.now),
    )
    ctx.add(booking)
    return booking


def _tap_to_pay(ctx: DemoContext) -> None:
    """Willow's bath last week, checked out at the counter on Diego's phone with a tip."""
    bath = ctx.get(Item, "it_bath")
    minutes = timedelta(minutes=bath.duration_min or 45)
    start = next(
        when
        for day in range(-5, -30, -1)
        for hour in range(10, 16)
        for when in (ctx.at(day, hour),)
        if _works(ctx, "st_diego", when, when + minutes)
        and _free(ctx, "st_diego", "sj_willow", when, when + minutes)
    )
    booking = _visit(
        ctx,
        "tap_willow",
        "it_bath",
        "st_diego",
        "cl_ethan",
        "sj_willow",
        start,
        start - timedelta(days=6),
    )
    paid = start + minutes + timedelta(minutes=10)
    treats = ctx.get(Item, "it_treats")
    lines = [
        Line(
            id=f"ln_ord_tap_{position}",
            business_id=ctx.business_id,
            order_id="ord_tap",
            item_id=item.id,
            booking_id=booking.id if position == 0 else None,
            staff_id="st_diego" if position == 0 else None,
            description=item.name,
            quantity=1,
            unit_amount_cents=item.price_cents,
            amount_cents=item.price_cents,
            tax_class=item.tax_class,
            position=position,
            created_at=paid - timedelta(minutes=5),
            updated_at=paid,
        )
        for position, item in enumerate((bath, treats))
    ]
    totals = tax_on(ctx, lines)
    ctx.add(
        Order(
            id="ord_tap",
            business_id=ctx.business_id,
            number=6,
            client_id="cl_ethan",
            staff_id="st_diego",
            status="open",
            currency="CAD",
            source="pos",
            subtotal_cents=totals.subtotal_cents,
            tax_total_cents=totals.tax_total_cents,
            total_cents=totals.total_cents,
            paid_at=paid,
            receipt_token="demo_receipt_ord_tap",
            receipt_sent_at=paid + timedelta(minutes=1),
            created_at=paid - timedelta(minutes=5),
            updated_at=paid,
        ),
        *lines,
        Payment(
            id="pay_ord_tap",
            business_id=ctx.business_id,
            client_id="cl_ethan",
            kind="payment",
            order_id="ord_tap",
            amount_cents=totals.total_cents + TIP_CENTS,
            tip_cents=TIP_CENTS,
            tip_split=[{"staff_id": "st_diego", "cents": TIP_CENTS}],
            currency="CAD",
            method="card",
            provider="stripe",
            provider_ref="pi_demo_ord_tap",
            status="succeeded",
            paid_at=paid,
            created_at=paid - timedelta(minutes=2),
            updated_at=paid,
        ),
    )
    booking.order_id, booking.charged_at = "ord_tap", paid


def _today(ctx: DemoContext) -> None:
    """While the studio is open: Priya's bath under way, and a groomer off to a house call."""
    now = ctx.now.astimezone(ctx.zone)
    bath = timedelta(minutes=ctx.get(Item, "it_bath").duration_min or 45)
    half_hour = now.replace(minute=0 if now.minute < 30 else 30, second=0, microsecond=0)
    started = next(
        (
            when
            for when in (half_hour, half_hour - timedelta(minutes=30))
            if when + timedelta(minutes=2) <= now
            and when + bath >= now + timedelta(minutes=10)
            and _works(ctx, "st_priya", when, when + bath)
            and _free(ctx, "st_priya", "sj_cooper", when, when + bath)
        ),
        None,
    )
    if started is not None:
        visit = _visit(
            ctx,
            "today_cooper",
            "it_bath",
            "st_priya",
            "cl_noah",
            "sj_cooper",
            started,
            ctx.now - timedelta(days=4),
        )
        visit.checked_in_at = started + timedelta(minutes=2)
    nails = timedelta(minutes=ctx.get(Item, "it_nails").duration_min or 15)
    call = half_hour + timedelta(minutes=30)
    if call - now < timedelta(minutes=15):
        call += timedelta(minutes=30)
    groomer = next(
        (
            member
            for member in GROOMERS
            if _works(
                ctx, member, call - timedelta(minutes=30), call + nails + timedelta(minutes=15)
            )
            and _free(ctx, member, "sj_miso", call, call + nails)
        ),
        None,
    )
    if groomer is None:
        return
    house_call = _visit(
        ctx,
        "today_miso",
        "it_nails",
        groomer,
        "cl_yuki",
        "sj_miso",
        call,
        ctx.now - timedelta(days=9),
    )
    house_call.departed_at = ctx.now - timedelta(minutes=6)
    created = ctx.now - timedelta(days=9)
    ctx.add(
        Note(
            id="nt_bk_today_miso",
            business_id=ctx.business_id,
            created_by=ctx.owner_id,
            parent_type="booking",
            parent_id=house_call.id,
            body="House call: Miso gets carsick, so her nails are done at Yuki's apartment on "
            "Fort Street.",
            created_at=created,
            updated_at=created,
        )
    )


def add_visit_day(ctx: DemoContext) -> None:
    _tap_to_pay(ctx)
    _today(ctx)
