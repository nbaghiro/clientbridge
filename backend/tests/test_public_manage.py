from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.business import Business
from clientbridge.models.scheduling import Booking, Slot
from tests.conftest import BIZ, FakeEmailSender, FakePaymentGateway
from tests.helpers import deposit_payment, enable_payments, key, settle

SLUG = "birchbark"
TEN_LOCAL = "2026-12-01T17:00:00Z"


async def _book(api: httpx.AsyncClient, starts: str = TEN_LOCAL, item: str = "it_groom_sm") -> str:
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
        f"/manage/{token}/reschedule", json={"starts_at": "2026-12-01T21:00:00Z"}
    )
    assert first.status_code == 200, first.text
    again = await api.post(
        f"/manage/{token}/reschedule", json={"starts_at": "2026-12-01T18:30:00Z"}
    )
    assert again.status_code == 409
    view = (await api.get(f"/manage/{token}")).json()
    assert view["can_move"] is False and view["can_cancel"] is True


async def test_inside_the_cutoff_nothing_changes_online(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    token = await _book(api)
    soon = datetime.now(UTC) + timedelta(hours=3)
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
    await db.flush()
    view = (await api.get(f"/manage/{token}")).json()
    assert view["can_cancel"] is False and view["can_move"] is False
    assert "call the studio" in view["blocked"]
    assert (await api.post(f"/manage/{token}/cancel")).status_code == 409
    moved = await api.post(f"/manage/{token}/reschedule", json={"starts_at": TEN_LOCAL})
    assert moved.status_code == 409


async def test_moving_onto_a_taken_time_is_refused(api: httpx.AsyncClient) -> None:
    token = await _book(api)
    await _book(api, "2026-12-01T20:00:00Z")
    res = await api.post(f"/manage/{token}/reschedule", json={"starts_at": "2026-12-01T20:00:00Z"})
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
            "starts_at": TEN_LOCAL,
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
    moved = await api.post("/manage/not-a-token/reschedule", json={"starts_at": TEN_LOCAL})
    assert moved.status_code == 404


async def test_reschedule_replays_on_the_same_key(
    api: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    token = await _book(api)
    headers = key()
    target = "2026-12-01T21:00:00Z"
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
    soon = (datetime.now(UTC) + timedelta(hours=2)).isoformat()
    assert (
        await api.post(f"/manage/{token}/reschedule", json={"starts_at": soon})
    ).status_code == 409
    far = (datetime.now(UTC) + timedelta(days=120)).isoformat()
    assert (
        await api.post(f"/manage/{token}/reschedule", json={"starts_at": far})
    ).status_code == 409
    assert (await _slot(db, token)).starts_at == datetime.fromisoformat(TEN_LOCAL)


async def test_a_canceled_booking_cannot_be_rescheduled(api: httpx.AsyncClient) -> None:
    token = await _book(api)
    assert (await api.post(f"/manage/{token}/cancel")).status_code == 200
    res = await api.post(f"/manage/{token}/reschedule", json={"starts_at": "2026-12-01T21:00:00Z"})
    assert res.status_code == 409


async def test_a_deleted_bookings_token_is_not_found(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    token = await _book(api)
    await db.execute(
        update(Booking).where(Booking.manage_token == token).values(deleted_at=datetime.now(UTC))
    )
    await db.flush()
    assert (await api.get(f"/manage/{token}")).status_code == 404
    assert (await api.post(f"/manage/{token}/cancel")).status_code == 404
