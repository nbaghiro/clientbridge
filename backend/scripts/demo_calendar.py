from datetime import timedelta

from clientbridge.models.billing import Line
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client, Subject
from clientbridge.models.scheduling import Booking, Hours, Resource, Slot
from scripts.demo_context import BUSINESS_TIMEZONE, DemoContext

FIRST_NAMES = ("Alex", "Jordan", "Taylor", "Casey", "Morgan", "Robin", "Jamie", "Avery")
LAST_NAMES = (
    "Chen",
    "Wilson",
    "Singh",
    "Martin",
    "Bennett",
    "Patel",
    "Roy",
    "Campbell",
    "Lee",
    "Park",
)
PET_NAMES = ("Hazel", "Oscar", "Poppy", "Finn", "Cleo", "Archie", "Ruby", "Theo")


def build_calendar(ctx: DemoContext) -> None:
    items = {item.id: item for item in ctx.all(Item)}
    for item in items.values():
        item.tax_class = (
            "standard"
            if item.kind == "product"
            else "exempt"
            if item.kind == "gift"
            else "federal_only"
        )
        if item.kind == "product":
            item.sku = item.sku or "BB-" + item.id.removeprefix("it_").upper()
    items["it_pkg5"].covers_item_id = "it_bath"
    for pet in ctx.all(Subject):
        pet.attributes = {
            **pet.attributes,
            "species": "cat" if pet.id == "sj_miso" else "dog",
            "birthday": pet.attributes.get("birthday", ctx.at(-365 * 4).date().isoformat()),
            "rabies_until": ctx.at(180).date().isoformat(),
        }
    ctx.get(Subject, "sj_bella").attributes = {
        **ctx.get(Subject, "sj_bella").attributes,
        "breed": "Mini Goldendoodle",
        "weight_kg": 10.5,
    }
    ctx.get(Subject, "sj_mochi").attributes = {
        **ctx.get(Subject, "sj_mochi").attributes,
        "birthday": ctx.at(-140).date().isoformat(),
    }
    for index in range(80):
        client_id, pet_id = f"cl_regular_{index:02}", f"sj_regular_{index:02}"
        cat = index % 8 == 0
        ctx.add(
            Client(
                id=client_id,
                business_id=ctx.business_id,
                created_by=ctx.owner_id,
                name=f"{FIRST_NAMES[index % 8]} {LAST_NAMES[index // 8]}",
                email=f"household.{index:02}@example.test",
                phone=f"+125055501{index:02}",
                tags=["regular"],
                status="active",
                preferred_channel="email",
                created_at=ctx.at(-220),
                updated_at=ctx.at(-220),
            ),
            Subject(
                id=pet_id,
                business_id=ctx.business_id,
                client_id=client_id,
                kind="pet",
                name=PET_NAMES[index % 8],
                attributes={
                    "species": "cat" if cat else "dog",
                    "breed": "Domestic Shorthair" if cat else "Miniature Poodle",
                    "weight_kg": 4.5 if cat else 9.0,
                    "birthday": ctx.at(-365 * (2 + index % 7)).date().isoformat(),
                    "vaccinated": True,
                    "rabies_until": ctx.at(90 + index).date().isoformat(),
                    "temperament": "Gentle; comfortable with the dryer",
                },
                created_at=ctx.at(-220),
                updated_at=ctx.at(-220),
            ),
        )
    ctx.add(
        Resource(
            id="rs_class",
            business_id=ctx.business_id,
            name="Training room",
            category="room",
            capacity=6,
        )
    )
    for weekday in range(1, 6):
        template = ctx.get(Hours, f"av_st_owner_{weekday}")
        ctx.add(
            Hours(
                id=f"av_st_priya_{weekday}",
                business_id=ctx.business_id,
                staff_id="st_priya",
                basis="recurring",
                weekday=weekday,
                start_time=template.start_time,
                end_time=template.end_time,
                available=True,
            )
        )
    closure = ctx.get(Hours, "av_holiday")
    closure.note = "Professional development day"
    extra = ctx.get(Hours, "av_extra")
    extra.date = (
        (ctx.at(7) + timedelta(days=(6 - ctx.at(7).weekday()) % 7))
        .astimezone(BUSINESS_TIMEZONE)
        .date()
    )
    extra.note = "Additional Sunday appointments"
    ctx.add(
        Hours(
            id="av_priya_timeoff",
            business_id=ctx.business_id,
            staff_id="st_priya",
            basis="exception",
            starts_at=ctx.at(8, 12),
            ends_at=ctx.at(8, 14),
            available=False,
            reason="Personal appointment",
        )
    )
    slots = {slot.id: slot for slot in ctx.all(Slot)}
    filler = sorted(
        (b for b in ctx.all(Booking) if b.id.startswith("bk_f") and b.id != "bk_refund"),
        key=lambda b: (slots[b.slot_id].starts_at, b.id),
    )
    for index, booking in enumerate(filler):
        household = index % 80
        booking.client_id, booking.subject_id = (
            f"cl_regular_{household:02}",
            f"sj_regular_{household:02}",
        )
        slot = slots[booking.slot_id]
        slot.item_id = (
            "it_cat"
            if household % 8 == 0
            else ("it_bath" if slot.staff_id == "st_priya" else "it_groom_sm")
        )
        if slot.item_id == "it_cat":
            slot.staff_id = booking.staff_id = "st_owner"
        if booking.invoice_id:
            for row in ctx.rows:
                if (
                    getattr(row, "invoice_id", None) == booking.invoice_id
                    or getattr(row, "id", None) == booking.invoice_id
                ) and hasattr(row, "client_id"):
                    row.client_id = booking.client_id
    for booking in ctx.all(Booking):
        slot = slots[booking.slot_id]
        if booking.subject_id in {"sj_kobe", "sj_bandit"} and slot.item_id == "it_groom_sm":
            slot.item_id = "it_bath"
        if booking.id == "bk_refund":
            slot.starts_at = ctx.at(-125, 14)
        if booking.id == "bk_003":
            slot.starts_at = ctx.at(-90, 11)
        if booking.id in {"bk_class_1", "bk_class_2"}:
            pet_id = f"sj_puppy_{booking.client_id}"
            ctx.add(
                Subject(
                    id=pet_id,
                    business_id=ctx.business_id,
                    client_id=booking.client_id,
                    kind="pet",
                    name="Scout" if booking.id == "bk_class_1" else "Juniper",
                    attributes={
                        "species": "dog",
                        "breed": "Labrador Retriever",
                        "weight_kg": 7,
                        "birthday": ctx.at(-120).date().isoformat(),
                        "vaccinated": True,
                        "rabies_until": ctx.at(270).date().isoformat(),
                    },
                )
            )
            booking.subject_id = pet_id
    _allocate(ctx, items)
    for line in ctx.all(Line):
        if line.booking_id:
            booking = ctx.get(Booking, line.booking_id)
            item = items[slots[booking.slot_id].item_id]
            line.item_id, line.description, line.staff_id = item.id, item.name, booking.staff_id
            line.unit_amount_cents = line.amount_cents = booking.price_cents


def _allocate(ctx: DemoContext, items: dict[str, Item]) -> None:
    occupied: list[tuple[Slot, set[str], int, int]] = []
    bookings = ctx.all(Booking)
    hours = ctx.all(Hours)
    slots = sorted(ctx.all(Slot), key=lambda s: (s.recurrence_id is None, s.starts_at, s.id))
    for slot in slots:
        linked = [b for b in bookings if b.slot_id == slot.id]
        pets = {b.subject_id for b in linked if b.subject_id}
        item = items[slot.item_id]
        duration, before, after = (
            item.duration_min or 60,
            item.buffer_before_min or 0,
            item.buffer_after_min or 0,
        )
        slot.resource_id = (
            "rs_class"
            if slot.capacity > 1
            else "rs_bath"
            if slot.staff_id == "st_priya"
            else "rs_station_b"
            if slot.staff_id == "st_diego"
            else "rs_station_a"
        )
        past = any(b.status in {"completed", "no_show"} for b in linked)
        candidate = slot.starts_at.astimezone(BUSINESS_TIMEZONE)
        if not past and candidate <= ctx.now:
            candidate = ctx.at(1, candidate.hour, candidate.minute).astimezone(BUSINESS_TIMEZONE)
        weekday = (
            5
            if slot.recurrence_id == "sch_puppy"
            else 2
            if slot.recurrence_id == "sch_mochi"
            else None
        )
        if weekday is not None:
            candidate += timedelta(days=(weekday - candidate.weekday()) % 7)
        for _attempt in range(2000):
            start, end = candidate, candidate + timedelta(minutes=duration)
            dated = [
                h
                for h in hours
                if h.staff_id == slot.staff_id and h.basis == "date" and h.date == candidate.date()
            ]
            windows = dated or [
                h
                for h in hours
                if h.staff_id == slot.staff_id
                and h.basis == "recurring"
                and h.weekday == candidate.weekday()
            ]
            fits = any(
                h.available
                and h.start_time
                and h.end_time
                and (start - timedelta(minutes=before)).time() >= h.start_time
                and (end + timedelta(minutes=after)).time() <= h.end_time
                for h in windows
            )
            blocked = any(
                h.basis == "exception"
                and h.staff_id in {None, slot.staff_id}
                and h.starts_at
                and h.ends_at
                and start < h.ends_at
                and end > h.starts_at
                for h in hours
            )
            conflict = any(
                (
                    other.staff_id == slot.staff_id
                    or other.resource_id == slot.resource_id
                    or pets & other_pets
                )
                and start - timedelta(minutes=before) < other.ends_at + timedelta(minutes=oa)
                and end + timedelta(minutes=after) > other.starts_at - timedelta(minutes=ob)
                for other, other_pets, ob, oa in occupied
            )
            if (
                fits
                and not blocked
                and not conflict
                and (end < ctx.now if past else start > ctx.now)
            ):
                break
            candidate += timedelta(minutes=15)
            if candidate.hour >= 17 or (past and candidate >= ctx.now):
                candidate = (candidate + timedelta(days=-1 if past else 1)).replace(
                    hour=9, minute=0
                )
                if weekday is not None:
                    candidate += timedelta(days=(weekday - candidate.weekday()) % 7)
        else:
            raise ValueError(f"Cannot allocate demo slot {slot.id}")
        slot.starts_at, slot.ends_at = start, end
        slot.created_at = min(start - timedelta(days=14), ctx.at(-1))
        slot.updated_at = min(end, ctx.now)
        if slot.status != "canceled":
            occupied.append((slot, pets, before, after))
        for booking in linked:
            booking.price_cents = item.price_cents
            booking.created_at = slot.created_at
            booking.updated_at = min(end, ctx.now)
            booking.confirmed_at = (
                slot.created_at + timedelta(hours=1)
                if booking.status in {"confirmed", "completed"}
                else None
            )
            booking.completed_at = end if booking.status == "completed" else None
            booking.canceled_at = (
                min(start - timedelta(days=1), ctx.at(-1)) if booking.status == "canceled" else None
            )
            if booking.deposit_status in {"pending", "collected"}:
                booking.deposit_amount_cents = (
                    round(item.price_cents * float(item.deposit_value or 0) / 100)
                    if item.deposit_type == "percent"
                    else int(item.deposit_value or 0)
                )
