import asyncio
from datetime import UTC, date, datetime, timedelta

import httpx
import pytest
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.db import SessionLocal
from clientbridge.core.errors import Conflict
from clientbridge.models.business import Business
from clientbridge.models.clients import Client
from clientbridge.models.platform import Device
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.schemas.public import (
    ManageReschedule,
    PublicBookingClient,
    PublicBookingCreate,
)
from clientbridge.services.public import PublicBookingService, PublicManageService
from tests.conftest import BIZ, FakeEmailSender, FakePaymentGateway, FakePushSender
from tests.helpers import deposit_payment, enable_payments, key, settle

SLUG = "birchbark"


OPENING = "2026-12-01T16:00:00Z"


async def test_one_class_attendee_cannot_move_the_shared_session(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    token = await _book(api, item="it_puppy")
    second = await api.post(
        f"/book/{SLUG}",
        json={
            "item_id": "it_puppy",
            "staff_id": "st_owner",
            "starts_at": OPENING,
            "client": {"name": "Other Attendee", "email": "attendee@example.com"},
        },
    )
    assert second.status_code == 200, second.text
    other_token = second.json()["manage_token"]
    original = await _slot(db, token)
    original_start = original.starts_at
    assert (await _slot(db, other_token)).id == original.id
    moved = await api.post(
        f"/manage/{token}/reschedule", json={"starts_at": "2026-12-02T17:00:00Z"}
    )
    assert moved.status_code == 409, moved.text
    assert moved.json()["error"] == "change_blocked"
    view = (await api.get(f"/manage/{token}")).json()
    assert view["can_move"] is False and view["can_cancel"] is True
    assert view["blocked"] == "class_session" and view["blocked_hours"] is None
    assert (await _slot(db, other_token)).starts_at == original_start


async def _book(api: httpx.AsyncClient, starts: str = OPENING, item: str = "it_groom_sm") -> str:
    res = await api.post(
        f"/book/{SLUG}",
        json={
            "item_id": item,
            "staff_id": "st_owner",
            "starts_at": starts,
            "client": {"name": "Web Booker", "email": "web@example.com"},
        },
    )
    assert res.status_code == 200, res.text
    return str(res.json()["manage_token"])


async def _slot(db: AsyncSession, token: str) -> Slot:
    booking = (await db.execute(select(Booking).where(Booking.manage_token == token))).scalar_one()
    slot = await db.get(Slot, booking.slot_id, populate_existing=True)
    assert slot is not None
    return slot


async def test_view_shows_the_visit_and_what_can_change(api: httpx.AsyncClient) -> None:
    token = await _book(api)
    res = await api.get(f"/manage/{token}")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["service"]["id"] == "it_groom_sm"
    assert body["can_move"] and body["can_cancel"] and body["blocked"] is None
    assert body["policy"]["max_reschedules"] == 2
    assert body["booking_id"].startswith("bk_")


async def test_client_moves_their_visit(
    api: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    token = await _book(api)
    slots = (await api.get(f"/manage/{token}/slots", params={"date": "2026-12-02"})).json()
    target = slots["slots"][0]["starts_at"]
    days = await api.get(f"/manage/{token}/days", params={"from": "2026-12-01", "days": 2})
    assert days.status_code == 200 and len(days.json()["days"]) == 2
    sent = len(email.sent)
    res = await api.post(f"/manage/{token}/reschedule", json={"starts_at": target}, headers=key())
    assert res.status_code == 200, res.text
    assert res.json()["reschedules_used"] == 1
    assert (await _slot(db, token)).starts_at == datetime.fromisoformat(target)
    assert len(email.sent) == sent + 1


async def test_moves_stop_at_the_policy_limit(api: httpx.AsyncClient, db: AsyncSession) -> None:
    await db.execute(
        update(Business).where(Business.id == BIZ).values(booking_policy={"max_reschedules": 1})
    )
    await db.flush()
    token = await _book(api)
    first = await api.post(
        f"/manage/{token}/reschedule", json={"starts_at": "2026-12-01T21:40:00Z"}
    )
    assert first.status_code == 200, first.text
    again = await api.post(
        f"/manage/{token}/reschedule", json={"starts_at": "2026-12-01T18:50:00Z"}
    )
    assert again.status_code == 409
    view = (await api.get(f"/manage/{token}")).json()
    assert view["can_move"] is False and view["can_cancel"] is True


async def test_inside_the_cutoff_nothing_changes_online(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    token = await _book(api)
    soon = clock.now() + timedelta(hours=3)
    slot = await _slot(db, token)
    # the demo seed books the owner around now, so clear the window the visit moves into
    await db.execute(
        update(Slot)
        .where(
            Slot.staff_id == "st_owner",
            Slot.id != slot.id,
            Slot.starts_at < soon + timedelta(minutes=75),
            Slot.ends_at > soon,
        )
        .values(status="canceled")
    )
    slot.starts_at, slot.ends_at = soon, soon + timedelta(minutes=75)
    await db.commit()
    view = (await api.get(f"/manage/{token}")).json()
    assert view["can_cancel"] is False and view["can_move"] is False
    assert view["blocked"] == "cutoff"
    canceled = await api.post(f"/manage/{token}/cancel")
    assert canceled.status_code == 409 and canceled.json()["error"] == "change_blocked"
    moved = await api.post(f"/manage/{token}/reschedule", json={"starts_at": OPENING})
    assert moved.status_code == 409


async def test_blocked_reason_is_a_code_with_the_cutoff(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    token = await _book(api)
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(booking_policy={"cancel_cutoff_hours": 1, "reschedule_cutoff_hours": 1})
    )
    soon = clock.now() + timedelta(minutes=30)
    slot = await _slot(db, token)
    await db.execute(
        update(Slot)
        .where(
            Slot.staff_id == "st_owner",
            Slot.id != slot.id,
            Slot.starts_at < soon + timedelta(minutes=75),
            Slot.ends_at > soon,
        )
        .values(status="canceled")
    )
    slot.starts_at, slot.ends_at = soon, soon + timedelta(minutes=75)
    await db.commit()
    view = (await api.get(f"/manage/{token}")).json()
    assert view["blocked"] == "cutoff" and view["blocked_hours"] == 1


async def test_moving_onto_a_taken_time_is_refused(api: httpx.AsyncClient) -> None:
    token = await _book(api)
    await _book(api, "2026-12-01T20:15:00Z")
    res = await api.post(f"/manage/{token}/reschedule", json={"starts_at": "2026-12-01T20:15:00Z"})
    assert res.status_code == 409


async def test_self_service_off_refuses_changes(api: httpx.AsyncClient, db: AsyncSession) -> None:
    token = await _book(api)
    await db.execute(
        update(Business).where(Business.id == BIZ).values(booking_policy={"self_service": False})
    )
    await db.flush()
    assert (await api.post(f"/manage/{token}/cancel")).status_code == 409


async def test_cancel_refunds_a_paid_deposit_once(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    res = await api.post(
        f"/book/{SLUG}",
        json={
            "item_id": "it_groom_lg",
            "staff_id": "st_owner",
            "starts_at": OPENING,
            "client": {"name": "Web Booker", "email": "web@example.com"},
        },
    )
    body = res.json()
    deposit = await db.get(Booking, body["booking_id"])
    assert deposit is not None
    assert deposit.deposit_amount_cents > 0
    await settle(api, db, await deposit_payment(db, body["booking_id"]))
    headers = key()
    first = await api.post(f"/manage/{body['manage_token']}/cancel", headers=headers)
    assert first.status_code == 200, first.text
    assert first.json() == {"deposit": "refunded", "refund_cents": deposit.deposit_amount_cents}
    again = await api.post(f"/manage/{body['manage_token']}/cancel", headers=headers)
    assert again.json() == first.json()
    view = (await api.get(f"/manage/{body['manage_token']}")).json()
    assert view["status"] == "canceled"
    assert view["deposit_status"] == "refunded"


async def test_cancel_without_a_deposit(api: httpx.AsyncClient) -> None:
    token = await _book(api)
    res = await api.post(f"/manage/{token}/cancel")
    assert res.json() == {"deposit": "none", "refund_cents": 0}
    assert (await api.post(f"/manage/{token}/cancel")).status_code == 409


async def test_unknown_token_404(api: httpx.AsyncClient) -> None:
    assert (await api.get("/manage/not-a-token")).status_code == 404
    assert (await api.post("/manage/not-a-token/cancel")).status_code == 404
    assert (
        await api.get("/manage/not-a-token/slots", params={"date": "2026-12-02"})
    ).status_code == 404


async def test_unknown_token_404_for_days_and_reschedule(api: httpx.AsyncClient) -> None:
    days = await api.get("/manage/not-a-token/days", params={"from": "2026-12-01"})
    assert days.status_code == 404
    moved = await api.post("/manage/not-a-token/reschedule", json={"starts_at": OPENING})
    assert moved.status_code == 404


async def test_reschedule_replays_on_the_same_key(
    api: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    token = await _book(api)
    headers = key()
    target = "2026-12-01T21:40:00Z"
    first = await api.post(
        f"/manage/{token}/reschedule", json={"starts_at": target}, headers=headers
    )
    assert first.status_code == 200, first.text
    sent = len(email.sent)
    again = await api.post(
        f"/manage/{token}/reschedule", json={"starts_at": target}, headers=headers
    )
    assert again.status_code == 200, again.text
    assert again.json()["starts_at"] == first.json()["starts_at"]
    assert again.json()["reschedules_used"] == 1
    assert len(email.sent) == sent
    assert (await _slot(db, token)).starts_at == datetime.fromisoformat(target)


async def test_reschedule_refuses_a_key_reused_for_another_time(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    token = await _book(api)
    headers = key()
    target = "2026-12-01T21:40:00Z"
    first = await api.post(
        f"/manage/{token}/reschedule", json={"starts_at": target}, headers=headers
    )
    assert first.status_code == 200, first.text
    changed = await api.post(
        f"/manage/{token}/reschedule",
        json={"starts_at": "2026-12-02T17:00:00Z"},
        headers=headers,
    )
    assert changed.status_code == 422, changed.text
    assert changed.json()["error"] == "idempotency_key_reused"
    assert (await _slot(db, token)).starts_at == datetime.fromisoformat(target)


async def test_cancel_refuses_a_key_reused_for_another_visit(api: httpx.AsyncClient) -> None:
    first = await _book(api)
    second = await _book(api, starts="2026-12-01T21:40:00Z")
    headers = key()
    done = await api.post(f"/manage/{first}/cancel", headers=headers)
    assert done.status_code == 200, done.text
    again = await api.post(f"/manage/{first}/cancel", headers=headers)
    assert again.json() == done.json()
    other = await api.post(f"/manage/{second}/cancel", headers=headers)
    assert other.status_code == 422, other.text
    assert other.json()["error"] == "idempotency_key_reused"
    assert (await api.get(f"/manage/{second}")).json()["status"] == "confirmed"


async def test_reschedule_outside_lead_time_or_horizon_is_refused(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    token = await _book(api)
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(booking_policy={"lead_hours": 48, "horizon_days": 90})
    )
    await db.flush()
    soon = (clock.now() + timedelta(hours=2)).isoformat()
    assert (
        await api.post(f"/manage/{token}/reschedule", json={"starts_at": soon})
    ).status_code == 409
    far = (clock.now() + timedelta(days=120)).isoformat()
    assert (
        await api.post(f"/manage/{token}/reschedule", json={"starts_at": far})
    ).status_code == 409
    assert (await _slot(db, token)).starts_at == datetime.fromisoformat(OPENING)


async def test_a_canceled_booking_cannot_be_rescheduled(api: httpx.AsyncClient) -> None:
    token = await _book(api)
    assert (await api.post(f"/manage/{token}/cancel")).status_code == 200
    res = await api.post(f"/manage/{token}/reschedule", json={"starts_at": "2026-12-01T21:40:00Z"})
    assert res.status_code == 409


async def test_a_deleted_bookings_token_is_not_found(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    token = await _book(api)
    await db.execute(
        update(Booking).where(Booking.manage_token == token).values(deleted_at=clock.now())
    )
    await db.flush()
    assert (await api.get(f"/manage/{token}")).status_code == 404
    assert (await api.post(f"/manage/{token}/cancel")).status_code == 404


async def test_manage_message_is_token_scoped_and_idempotent(
    api: httpx.AsyncClient, db: AsyncSession, push: FakePushSender
) -> None:
    from clientbridge.models.messaging import Message, Thread

    token = await _book(api)
    db.add(Device(id="dvt_manage", business_id=BIZ, user_id="us_dev", token="Tok", platform="ios"))
    await db.flush()
    push.sent.clear()
    headers = key()
    response = await api.post(
        f"/manage/{token}/message", json={"body": "Running five minutes late"}, headers=headers
    )
    assert response.status_code == 200, response.text
    again = await api.post(
        f"/manage/{token}/message", json={"body": "Running five minutes late"}, headers=headers
    )
    assert again.json() == response.json()
    message = await db.get(Message, response.json()["id"])
    assert message is not None and message.direction == "in" and message.status == "delivered"
    thread = await db.get(Thread, message.thread_id)
    assert len(push.sent) == 1  # the replay does not alert staff again
    assert push.sent[0].tokens == ["Tok"] and "Running five minutes late" in push.sent[0].body
    assert push.sent[0].data == {
        "type": "message",
        "thread_id": message.thread_id,
        "client_id": thread.client_id if thread is not None else "",
    }
    booking = (await db.execute(select(Booking).where(Booking.manage_token == token))).scalar_one()
    assert (
        thread is not None
        and thread.client_id == booking.client_id
        and thread.business_id == booking.business_id
    )
    assert (
        await api.post("/manage/unknown/message", json={"body": "Hi"}, headers=key())
    ).status_code == 404
    assert (
        await api.post(f"/manage/{token}/message", json={"body": "   "}, headers=key())
    ).status_code == 422


@pytest.mark.parametrize("refund_status", ["pending", "failed"])
async def test_cancel_does_not_claim_an_unsettled_deposit_refund(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway, refund_status: str
) -> None:
    await enable_payments(db)
    response = await api.post(
        f"/book/{SLUG}",
        json={
            "item_id": "it_groom_lg",
            "staff_id": "st_owner",
            "starts_at": OPENING,
            "client": {"name": "Refund Client", "email": "refund@example.com"},
        },
    )
    booking = response.json()
    await settle(api, db, await deposit_payment(db, booking["booking_id"]))
    gateway.refund_status = refund_status
    headers = key()
    url = f"/manage/{booking['manage_token']}"
    response = await api.post(url + "/cancel", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json() == {"deposit": refund_status, "refund_cents": 0}
    assert (await api.post(url + "/cancel", headers=headers)).json() == response.json()
    view = (await api.get(url)).json()
    assert view["status"] == "canceled"
    assert view["deposit_status"] == "collected"
    assert view["refund_status"] == refund_status
    assert (
        await api.post(url + "/message", headers=key(), json={"body": "Please check my refund."})
    ).status_code == 200


async def test_reschedule_refuses_a_start_the_listing_does_not_offer(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    token = await _book(api)
    for target in ("2026-12-01T17:07:00Z", "2026-11-30T19:00:00Z"):
        res = await api.post(f"/manage/{token}/reschedule", json={"starts_at": target})
        assert res.status_code == 409, res.text
        assert res.json()["error"] == "slot_unavailable"
    assert (await _slot(db, token)).starts_at == datetime.fromisoformat(OPENING)


async def test_manage_times_include_moves_overlapping_the_visit_and_stop_at_the_horizon(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    token = await _book(api)
    await db.execute(
        update(Business).where(Business.id == BIZ).values(booking_policy={"step_min": 30})
    )
    offered = (await api.get(f"/manage/{token}/slots", params={"date": "2026-12-01"})).json()
    starts = [s["starts_at"] for s in offered["slots"]]
    assert "2026-12-01T16:30:00Z" in starts and "2026-12-01T16:00:00Z" not in starts
    moved = await api.post(
        f"/manage/{token}/reschedule", json={"starts_at": "2026-12-01T16:30:00Z"}
    )
    assert moved.status_code == 200, moved.text
    await db.execute(
        update(Business).where(Business.id == BIZ).values(booking_policy={"horizon_days": 30})
    )
    far = (clock.now() + timedelta(days=60)).date().isoformat()
    assert (await api.get(f"/manage/{token}/slots", params={"date": far})).json()["slots"] == []


async def test_two_connections_rescheduling_at_the_limit_move_the_visit_once(
    db: AsyncSession,
) -> None:
    email = "limit-race@example.com"
    async with SessionLocal() as setup:
        booked = await PublicBookingService(setup, FakePaymentGateway()).book(
            SLUG,
            PublicBookingCreate(
                item_id="it_groom_sm",
                staff_id="st_owner",
                starts_at=datetime(2027, 5, 4, 16, tzinfo=UTC),
                client=PublicBookingClient(name="Limit Racer", email=email),
            ),
        )
        token = booked.manage_token
        assert token is not None
        await setup.execute(
            update(Booking).where(Booking.id == booked.booking_id).values(reschedule_count=1)
        )
        await setup.commit()
        offered = await PublicManageService(setup, FakePaymentGateway()).slots(
            token, date(2027, 5, 5)
        )
    targets = [offered.slots[0].starts_at, offered.slots[-1].starts_at]
    assert targets[0] != targets[1]
    ready = asyncio.Barrier(2)

    async def move(starts_at: datetime) -> int | Conflict:
        async with SessionLocal() as session:
            service = PublicManageService(session, FakePaymentGateway())
            await ready.wait()
            try:
                moved = await service.reschedule(token, ManageReschedule(starts_at=starts_at), None)
            except Conflict as exc:
                return exc
            return moved.reschedules_used

    try:
        results = await asyncio.gather(*(move(t) for t in targets))
        assert sorted(r for r in results if isinstance(r, int)) == [2]
        assert sum(isinstance(r, Conflict) for r in results) == 1
        async with SessionLocal() as check:
            count = await check.scalar(
                select(Booking.reschedule_count).where(Booking.id == booked.booking_id)
            )
            assert count == 2
    finally:
        async with SessionLocal() as cleanup:
            clients = list(await cleanup.scalars(select(Client.id).where(Client.email == email)))
            slots = list(
                await cleanup.scalars(select(Booking.slot_id).where(Booking.client_id.in_(clients)))
            )
            await cleanup.execute(delete(Booking).where(Booking.client_id.in_(clients)))
            await cleanup.execute(delete(Slot).where(Slot.id.in_(slots)))
            await cleanup.execute(delete(Client).where(Client.id.in_(clients)))
            await cleanup.commit()


async def test_a_lapsed_business_takes_no_rescheduled_visits(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    token = await _book(api)
    slots = (await api.get(f"/manage/{token}/slots", params={"date": "2026-12-02"})).json()
    await db.execute(
        update(Business).where(Business.id == BIZ).values(plan=None, plan_status="lapsed")
    )
    await db.flush()
    target = slots["slots"][0]["starts_at"]
    res = await api.post(f"/manage/{token}/reschedule", json={"starts_at": target}, headers=key())
    assert res.status_code == 409 and res.json()["error"] == "business_unavailable"
