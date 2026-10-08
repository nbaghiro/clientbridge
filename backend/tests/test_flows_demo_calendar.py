from datetime import datetime, timedelta

import pytest
from scripts.demo_context import BUSINESS_TIMEZONE
from scripts.seed_demo import build_demo

from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client, Subject
from clientbridge.models.scheduling import Booking, Hours, Recurrence, Slot


@pytest.mark.parametrize("anchor", ["2026-10-08T16:00:00-04:00", "2027-01-03T09:00:00+00:00"])
def test_demo_calendar_is_consistent_at_different_seed_dates(anchor: str) -> None:
    ctx = build_demo(datetime.fromisoformat(anchor))
    items = {r.id: r for r in ctx.all(Item)}
    pets = {r.id: r for r in ctx.all(Subject)}
    slots = {r.id: r for r in ctx.all(Slot)}
    recurrences = {r.id: r for r in ctx.all(Recurrence)}
    bookings = ctx.all(Booking)
    assert len(ctx.all(Client)) >= 90
    assert len(bookings) > 300
    for booking in bookings:
        slot = slots[booking.slot_id]
        if booking.subject_id:
            pet = pets[booking.subject_id]
            assert pet.client_id == booking.client_id
            if slot.item_id == "it_cat":
                assert pet.attributes["species"] == "cat"
            if slot.item_id == "it_groom_sm":
                assert float(str(pet.attributes["weight_kg"])) <= 11.34
        assert booking.created_at <= slot.starts_at
        assert booking.confirmed_at is None or booking.confirmed_at <= ctx.now
        if booking.status == "completed":
            assert booking.completed_at is not None
            assert booking.completed_at >= slot.ends_at
            assert slot.ends_at < ctx.now
        if booking.status in {"pending", "confirmed"}:
            assert slot.starts_at > ctx.now
    for slot in slots.values():
        local = slot.starts_at.astimezone(BUSINESS_TIMEZONE)
        end = slot.ends_at.astimezone(BUSINESS_TIMEZONE)
        dated = [
            h
            for h in ctx.all(Hours)
            if h.staff_id == slot.staff_id and h.basis == "date" and h.date == local.date()
        ]
        hours = dated or [
            h
            for h in ctx.all(Hours)
            if h.staff_id == slot.staff_id
            and h.basis == "recurring"
            and h.weekday == local.weekday()
        ]
        assert any(
            h.available
            and h.start_time is not None
            and h.end_time is not None
            and h.start_time <= local.time()
            and end.time() <= h.end_time
            for h in hours
        )
        if slot.recurrence_id:
            days = recurrences[slot.recurrence_id].byday
            assert days is not None
            assert ("MO", "TU", "WE", "TH", "FR", "SA", "SU")[local.weekday()] in days
    active = [s for s in slots.values() if s.status != "canceled"]
    pet_sets = {s.id: {b.subject_id for b in bookings if b.slot_id == s.id} for s in active}
    for index, left in enumerate(active):
        for right in active[index + 1 :]:
            if (
                left.staff_id != right.staff_id
                and left.resource_id != right.resource_id
                and not pet_sets[left.id] & pet_sets[right.id]
            ):
                continue
            li, ri = items[left.item_id], items[right.item_id]
            assert left.ends_at + timedelta(
                minutes=li.buffer_after_min or 0
            ) <= right.starts_at - timedelta(
                minutes=ri.buffer_before_min or 0
            ) or right.ends_at + timedelta(
                minutes=ri.buffer_after_min or 0
            ) <= left.starts_at - timedelta(minutes=li.buffer_before_min or 0), (left.id, right.id)
    assert (
        len([s for s in slots.values() if s.recurrence_id == "sch_mochi"])
        == recurrences["sch_mochi"].count
    )
    assert not any(b.client_id == "cl_fatima" for b in bookings)
    assert all(
        slots[b.slot_id].ends_at < ctx.at(-100)
        for b in bookings
        if b.client_id == "cl_olivia" and b.status == "completed"
    )
