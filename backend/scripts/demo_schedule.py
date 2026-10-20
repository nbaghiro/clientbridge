"""Birchbark's weekly class timetable and its clients' repeat visits, with their history."""

from datetime import UTC, date, datetime, time, timedelta
from typing import get_args

from clientbridge.models.billing import Invoice, Line
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Subject
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking, Hours, Recurrence, Slot, Weekday
from clientbridge.services.bookings import expand_occurrences
from clientbridge.services.catalog import deposit_cents
from scripts.demo_context import BUSINESS_TIMEZONE, DemoContext

WEEKDAYS: tuple[Weekday, ...] = get_args(Weekday)
PAST_WEEKS = 8
AHEAD_WEEKS = 5
Pair = tuple[str, str]

# id, name, price, minutes, seats, fixed deposit, colour, description
CLASSES = (
    (
        "it_nail_clinic",
        "Nail Trim Clinic",
        1500,
        60,
        8,
        0,
        "#7D5A82",
        "A weekly clinic hour for nail trims. Each dog gets a trim and a smooth file.",
    ),
    (
        "it_play_group",
        "Small-Dog Play Group",
        2500,
        60,
        8,
        0,
        "#5C6B3A",
        "Supervised off-leash play for dogs under 11 kg, in a small group matched by energy.",
    ),
    (
        "it_senior_groom",
        "Senior Dog Gentle Groom Workshop",
        4500,
        90,
        5,
        1500,
        "#3F5E50",
        "A hands-on session for owners of older dogs: brushing, nail care and gentle handling "
        "for stiff joints at home.",
    ),
)


def _household(index: int) -> Pair:
    return f"cl_regular_{index:02}", f"sj_regular_{index:02}"


# household, id, name, breed, kg, days old; the first six finished the course in late summer
PUPPIES = (
    (3, "sj_pup_waffles", "Waffles", "Cockapoo", 6.5, 190),
    (37, "sj_pup_clover", "Clover", "Beagle", 7.0, 185),
    (43, "sj_pup_pickles", "Pickles", "Pembroke Welsh Corgi", 8.0, 180),
    (50, "sj_pup_bean", "Bean", "French Bulldog", 7.5, 175),
    (59, "sj_pup_maisie", "Maisie", "Golden Retriever", 9.0, 170),
    (66, "sj_pup_rocket", "Rocket", "Shiba Inu", 6.0, 170),
    (70, "sj_pup_toast", "Toast", "Labradoodle", 6.0, 110),
    (74, "sj_pup_kiwi", "Kiwi", "Havanese", 3.5, 105),
    (77, "sj_pup_nova", "Nova", "Australian Shepherd", 7.0, 100),
)
GRADUATES = [(_household(h)[0], pet) for h, pet, *_ in PUPPIES[:6]]
NEW_PUPPIES = [(_household(h)[0], pet) for h, pet, *_ in PUPPIES[6:]]
# the course the full upcoming session (ses_class) belongs to
COHORT = [
    ("cl_sophie", "sj_mochi"),
    ("cl_noah", "sj_puppy_cl_noah"),
    ("cl_liam", "sj_puppy_cl_liam"),
    ("cl_class_0", "sj_class_0"),
    ("cl_class_1", "sj_class_1"),
    ("cl_class_2", "sj_class_2"),
]
SMALL_DOGS = [
    ("cl_ethan", "sj_willow"),
    ("cl_grace", "sj_pepper"),
    ("cl_amelie", "sj_bella"),
    *(_household(i) for i in (2, 4, 5, 6, 7, 9, 11, 12, 14, 15)),
]
NAIL_DOGS = [
    ("cl_noah", "sj_cooper"),
    ("cl_marcus", "sj_luna"),
    ("cl_david", "sj_zeus"),
    ("cl_priscilla", "sj_kobe"),
    *(_household(i) for i in (17, 18, 21, 22, 23, 25, 29, 30, 31, 35)),
]
SENIOR_DOGS = [_household(i) for i in (5, 6, 12, 13, 19, 20, 26, 27, 33, 34, 47, 48)]

# signups per session in date order, past then ahead; a tuple adds that many waiting
PAST_FILL: dict[str, list[int | tuple[int, int]]] = {
    "it_puppy": [5, 6, 6, 5, 4, 5, 6, 5],
    "it_play_group": [6, 7, 5, (8, 2), 3, 6, 7, 8],
    "it_nail_clinic": [5, 7, 4, 6, 8, 5, 6, 7],
    "it_senior_groom": [4, 5, 3, 5],
}
AHEAD_FILL: dict[str, list[int | tuple[int, int]]] = {
    "it_puppy": [5, 3, 2, 1],
    "it_play_group": [(8, 2), 5, 3, 1, 2],
    "it_nail_clinic": [4, (8, 1), 2, 1, 1],
    "it_senior_groom": [(5, 1), 2, 1],
}
# item, member, weekday (Monday is 0), start, every n weeks
TIMETABLE = (
    ("it_puppy", "st_owner", 5, time(11), 1),
    ("it_play_group", "st_diego", 4, time(9, 30), 1),
    ("it_nail_clinic", "st_priya", 2, time(16), 1),
    ("it_senior_groom", "st_owner", 3, time(13), 2),
)
CANCELED_SESSION = ("it_play_group", 4)
CLOSED = "_closed"  # a seat on a full class's waitlist that never opened

# id, client, pet, item, member, weekday, start, every n weeks, visits, visits before today
SERIES = (
    ("sch_bella", "cl_amelie", "sj_bella", "it_groom_sm", "st_owner", 3, time(10), 6, 6, 3),
    ("sch_rex", "cl_marcus", "sj_rex", "it_groom_lg", "st_diego", 5, time(9), 8, 5, 2),
    ("sch_kobe", "cl_priscilla", "sj_kobe", "it_bath", "st_priya", 4, time(9), 1, 16, 8),
    ("sch_pepper", "cl_grace", "sj_pepper", "it_nails", "st_priya", 1, time(14), 2, 10, 5),
    ("sch_maple", "cl_liam", "sj_maple", "it_deshed", "st_diego", 1, time(13), 4, 6, 3),
    ("sch_willow", "cl_ethan", "sj_willow", "it_bath", "st_priya", 3, time(11), 2, 8, 3),
    ("sch_cooper", "cl_noah", "sj_cooper", "it_bath", "st_priya", 5, time(10), 4, 4, 3),
    ("sch_oscar", *_household(1), "it_groom_sm", "st_diego", 4, time(14), 6, 5, 2),
    ("sch_poppy", *_household(10), "it_bath", "st_priya", 5, time(13), 2, 10, 4),
)
MISSED = ("sch_pepper", 2)
SKIPPED = ("sch_willow", 1)  # the client is away that week, so this one visit is canceled
MOVED = ("sch_oscar", 0, time(15, 30))
STOPPED = ("sch_poppy", 2)  # the household is moving; the series ends before this visit
AWAY = ("sch_maple", 1)  # time off added after booking leaves this visit to be decided
DEPOSIT_PAID = ("sch_rex", 0)


def _local(day: date, at: time) -> datetime:
    return datetime.combine(day, at, tzinfo=BUSINESS_TIMEZONE).astimezone(UTC)


def _today(ctx: DemoContext) -> date:
    return ctx.now.astimezone(BUSINESS_TIMEZONE).date()


def _next_on(ctx: DemoContext, weekday: int) -> date:
    today = _today(ctx)
    return today + timedelta(days=(weekday - today.weekday() - 1) % 7 + 1)


def _closed(ctx: DemoContext, member: str, start: datetime, end: datetime) -> bool:
    """A day off the member's usual week, a closure or time off; weekly hours come later."""
    day = start.astimezone(BUSINESS_TIMEZONE).date()
    return any(
        (h.basis == "date" and h.staff_id == member and h.date == day and not h.available)
        or (
            h.basis == "exception"
            and h.staff_id in {member, None}
            and h.starts_at is not None
            and h.ends_at is not None
            and h.starts_at < end
            and h.ends_at > start
        )
        for h in ctx.all(Hours)
    )


def _settle(ctx: DemoContext, booking: Booking, item: Item, index: int) -> None:
    """Invoice a finished visit and record its payment, the way checkout leaves it."""
    number = max((i.number or 0 for i in ctx.all(Invoice)), default=1000) + 1
    tax = (item.price_cents * 5 + 50) // 100
    invoice_id = f"inv_{number}"
    card = index % 4 != 3
    ctx.add(
        Invoice(
            id=invoice_id,
            business_id=ctx.business_id,
            client_id=booking.client_id,
            number=number,
            status="sent",
            currency="CAD",
            subtotal_cents=item.price_cents,
            tax_total_cents=tax,
            total_cents=item.price_cents + tax,
        ),
        Line(
            id=f"ln_{number}_1",
            business_id=ctx.business_id,
            invoice_id=invoice_id,
            description=item.name,
            item_id=item.id,
            booking_id=booking.id,
            quantity=1,
            unit_amount_cents=item.price_cents,
            amount_cents=item.price_cents,
            tax_amount_cents=tax,
            position=0,
        ),
        Payment(
            id=f"pay_{number}",
            business_id=ctx.business_id,
            client_id=booking.client_id,
            kind="payment",
            invoice_id=invoice_id,
            booking_id=booking.id,
            amount_cents=item.price_cents + tax,
            currency="CAD",
            method="card" if card else "etransfer",
            provider="stripe" if card else "manual",
            provider_ref=f"pi_demo_{number}" if card else None,
            reference=None if card else f"CA{number}ET",
            status="succeeded",
        ),
    )
    booking.invoice_id = invoice_id


def _deposit(ctx: DemoContext, booking: Booking, item: Item) -> None:
    booking.deposit_status = "collected"
    ctx.add(
        Payment(
            id=f"pay_dep_{booking.id}",
            business_id=ctx.business_id,
            client_id=booking.client_id,
            kind="deposit",
            booking_id=booking.id,
            amount_cents=deposit_cents(item),
            currency="CAD",
            method="card",
            provider="stripe",
            provider_ref=f"pi_demo_dep_{booking.id}",
            status="succeeded",
            paid_at=ctx.at(-1, 15),
        )
    )


def _add_classes(ctx: DemoContext) -> None:
    for item_id, name, price, minutes, seats, deposit, color, description in CLASSES:
        ctx.add(
            Item(
                id=item_id,
                business_id=ctx.business_id,
                created_by=ctx.owner_id,
                kind="class",
                name=name,
                description=description,
                price_cents=price,
                currency="CAD",
                duration_min=minutes,
                capacity=seats,
                category="Classes",
                color=color,
                online_bookable=True,
                deposit_type="fixed" if deposit else "none",
                deposit_value=deposit or None,
                active=True,
            )
        )
    today = _today(ctx)
    for household, pet_id, pet_name, breed, kg, days_old in PUPPIES:
        born = today - timedelta(days=days_old)
        ctx.add(
            Subject(
                id=pet_id,
                business_id=ctx.business_id,
                client_id=_household(household)[0],
                name=pet_name,
                attributes={
                    "species": "dog",
                    "breed": breed,
                    "weight_kg": kg,
                    "birthday": born.isoformat(),
                    "rabies_until": (born + timedelta(days=480)).isoformat(),
                    "temperament": "energetic" if household % 2 else "friendly",
                },
                created_at=_local(born + timedelta(days=60), time(12)),
            )
        )


def _session_days(ctx: DemoContext, weekday: int, every: int) -> list[date]:
    first = _next_on(ctx, weekday) - timedelta(weeks=PAST_WEEKS)
    end = _today(ctx) + timedelta(weeks=AHEAD_WEEKS)
    return [
        first + timedelta(weeks=week)
        for week in range(0, PAST_WEEKS + AHEAD_WEEKS + 1, every)
        if first + timedelta(weeks=week) <= end
    ]


def _roster(item_id: str, past_index: int, ahead_index: int) -> list[Pair]:
    if item_id == "it_puppy":
        if past_index >= 0:
            return GRADUATES if past_index < 4 else COHORT
        return [*COHORT[:5], *NEW_PUPPIES] if ahead_index == 0 else [*NEW_PUPPIES, *COHORT]
    pool = {"it_play_group": SMALL_DOGS, "it_nail_clinic": NAIL_DOGS}.get(item_id, SENIOR_DOGS)
    shift = 3 * max(past_index, 0) + 5 * max(ahead_index, 0)
    return pool[shift % len(pool) :] + pool[: shift % len(pool)]


def add_class_timetable(ctx: DemoContext) -> None:
    """Weekly class sessions from two months back to five weeks out, filled the way they sell."""
    _add_classes(ctx)
    items = {item.id: item for item in ctx.all(Item)}
    taken = ctx.get(Slot, "ses_class").starts_at.astimezone(BUSINESS_TIMEZONE).date()
    taken += timedelta(days=(5 - taken.weekday()) % 7)
    for item_id, member, weekday, start_time, every in TIMETABLE:
        item = items[item_id]
        past, ahead = list(PAST_FILL[item_id]), list(AHEAD_FILL[item_id])
        past_index = ahead_index = 0
        for day in _session_days(ctx, weekday, every):
            start = _local(day, start_time)
            end = start + timedelta(minutes=item.duration_min or 60)
            done = end < ctx.now
            if (item_id == "it_puppy" and day == taken) or _closed(ctx, member, start, end):
                continue
            fill = past.pop(0) if done and past else ahead.pop(0) if not done and ahead else 0
            seats, waiting = fill if isinstance(fill, tuple) else (fill, 0)
            if seats == 0:
                continue
            roster = _roster(item_id, past_index if done else -1, -1 if done else ahead_index)
            canceled = done and (item_id, past_index) == CANCELED_SESSION
            slot_id = f"ses_{item_id.removeprefix('it_')}_{day:%Y%m%d}"
            ctx.add(
                Slot(
                    id=slot_id,
                    business_id=ctx.business_id,
                    item_id=item_id,
                    staff_id=member,
                    starts_at=start,
                    ends_at=end,
                    capacity=item.capacity or 1,
                    status="canceled" if canceled else "completed" if done else "scheduled",
                )
            )
            for seat, (client_id, pet_id) in enumerate(roster[: seats + waiting]):
                online = seat % 2 == 0
                status = (
                    "canceled"
                    if canceled or (done and seat >= seats)
                    else "waitlisted"
                    if seat >= seats
                    else "no_show"
                    if done and seat == seats - 1 and past_index % 3 == 1
                    else "completed"
                    if done
                    else "confirmed"
                )
                closed = done and seat >= seats
                booking = Booking(
                    id=f"bk_{slot_id.removeprefix('ses_')}_{seat}{CLOSED if closed else ''}",
                    business_id=ctx.business_id,
                    slot_id=slot_id,
                    starts_at=start,
                    staff_id=member,
                    client_id=client_id,
                    subject_id=pet_id,
                    status=status,
                    source="online" if online else "manual",
                    manage_token=f"manage_{slot_id}_{seat}" if online else None,
                    price_cents=item.price_cents,
                )
                ctx.add(booking)
                if status == "completed":
                    _settle(ctx, booking, item, seat)
                elif status == "confirmed" and online and item.deposit_type != "none":
                    _deposit(ctx, booking, item)
            if done:
                past_index += 1
            else:
                ahead_index += 1


def _weekly(ctx: DemoContext, weekday: int, every: int, visits: int, before: int) -> list[date]:
    first = _next_on(ctx, weekday) - timedelta(weeks=every * before)
    return expand_occurrences(
        start_date=first,
        frequency="week",
        interval=every,
        byday=[WEEKDAYS[weekday]],
        count=visits,
        until=None,
    )


def _book_series(
    ctx: DemoContext,
    recurrence: Recurrence,
    pet_id: str,
    days: list[date],
    start_time: time,
) -> None:
    item = ctx.get(Item, recurrence.item_id)
    assert recurrence.client_id is not None and recurrence.staff_id is not None
    first = _local(days[0], start_time)
    recurrence.created_at = recurrence.updated_at = first - timedelta(days=14)
    upcoming = 0
    for index, day in enumerate(days):
        moved = (recurrence.id, upcoming) == MOVED[:2] and day > _today(ctx)
        start = _local(day, MOVED[2] if moved else start_time)
        end = start + timedelta(minutes=item.duration_min or 60)
        ahead = end >= ctx.now
        status = "confirmed" if ahead else "completed"
        if (recurrence.id, index) == MISSED:
            status = "no_show"
        if ahead and (recurrence.id, upcoming) == SKIPPED:
            status = "canceled"
        if ahead and recurrence.id == STOPPED[0] and upcoming >= STOPPED[1]:
            status = "canceled"
            if upcoming == STOPPED[1]:
                recurrence.status, recurrence.until = "ended", day - timedelta(days=1)
                recurrence.updated_at = ctx.at(-3, 16)
        slot_id = f"ses_{recurrence.id.removeprefix('sch_')}_{index}"
        ctx.add(
            Slot(
                id=slot_id,
                business_id=ctx.business_id,
                item_id=item.id,
                staff_id=recurrence.staff_id,
                recurrence_id=recurrence.id,
                starts_at=start,
                ends_at=end,
                capacity=1,
                status="completed"
                if status == "completed"
                else "canceled"
                if status == "canceled"
                else "scheduled",
            )
        )
        booking = Booking(
            id=f"bk_{recurrence.id.removeprefix('sch_')}_{index}",
            business_id=ctx.business_id,
            slot_id=slot_id,
            starts_at=start,
            staff_id=recurrence.staff_id,
            client_id=recurrence.client_id,
            subject_id=pet_id,
            status=status,
            source="manual",
            manage_token=f"manage_{recurrence.id}_{index}",
            price_cents=item.price_cents,
        )
        ctx.add(booking)
        if status == "completed":
            _settle(ctx, booking, item, index)
        if ahead and (recurrence.id, upcoming) == DEPOSIT_PAID:
            _deposit(ctx, booking, item)
        if ahead:
            upcoming += 1


def add_repeat_visits(ctx: DemoContext) -> None:
    """Clients' repeat visits at mixed cadences, each with its history and one with each change."""
    for row in SERIES:
        rid, client_id, pet_id, item_id, member, weekday, start_time, every, visits, before = row
        recurrence = Recurrence(
            id=rid,
            business_id=ctx.business_id,
            item_id=item_id,
            staff_id=member,
            client_id=client_id,
            frequency="week",
            interval=every,
            byday=[WEEKDAYS[weekday]],
            count=visits,
            status="active",
        )
        ctx.add(recurrence)
        days = _weekly(ctx, weekday, every, visits, before)
        _book_series(ctx, recurrence, pet_id, days, start_time)
    today = _today(ctx)
    month = (today.replace(day=1) - timedelta(days=140)).replace(day=1)
    second_wednesday = month + timedelta(days=(2 - month.weekday()) % 7 + 7)
    miso = Recurrence(
        id="sch_miso",
        business_id=ctx.business_id,
        item_id="it_cat",
        staff_id="st_owner",
        client_id="cl_yuki",
        frequency="month",
        interval=3,
        byday=["WE"],
        monthly_by="weekday",
        count=4,
        status="active",
    )
    ctx.add(miso)
    days = expand_occurrences(
        start_date=second_wednesday,
        frequency="month",
        interval=3,
        byday=None,
        count=4,
        until=None,
        monthly_by="weekday",
    )
    _book_series(ctx, miso, "sj_miso", days, time(10))


def finish_schedule(ctx: DemoContext) -> None:
    """Once the calendar is placed: check-ins, sign-up order and the time off a visit now meets."""
    slots = {slot.id: slot for slot in ctx.all(Slot)}
    for booking in ctx.all(Booking):
        slot = slots[booking.slot_id]
        if slot.capacity <= 1:
            continue
        if booking.status == "completed":
            booking.checked_in_at = slot.starts_at - timedelta(minutes=5)
        if booking.id.endswith(CLOSED):
            # the overnight job took them off the waitlist once the class was over
            day = slot.ends_at.astimezone(BUSINESS_TIMEZONE).date() + timedelta(days=1)
            closed_at = _local(day, time(0, 2))
            booking.confirmed_at = None
            booking.canceled_at = booking.updated_at = closed_at
    for slot in slots.values():
        if slot.capacity <= 1 or slot.ends_at < ctx.now:
            continue
        signups = sorted(
            (b for b in ctx.all(Booking) if b.slot_id == slot.id),
            key=lambda b: (b.status == "waitlisted", b.id),
        )
        for order, booking in enumerate(signups):
            booking.created_at = booking.created_at + timedelta(minutes=20 * order)
            booking.updated_at = max(booking.updated_at, booking.created_at)
            if booking.confirmed_at is not None:
                booking.confirmed_at = booking.created_at + timedelta(minutes=5)
    series, visit = AWAY
    ahead = sorted(
        (s for s in slots.values() if s.recurrence_id == series and s.starts_at > ctx.now),
        key=lambda s: s.starts_at,
    )
    if len(ahead) > visit:
        slot = ahead[visit]
        ctx.add(
            Hours(
                id="av_diego_away",
                business_id=ctx.business_id,
                staff_id=slot.staff_id,
                basis="exception",
                starts_at=slot.starts_at,
                ends_at=slot.ends_at,
                available=False,
                reason="Personal appointment",
                created_at=ctx.at(-2, 15),
            )
        )
