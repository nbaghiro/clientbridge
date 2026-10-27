import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.business import Business, Staff
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client
from clientbridge.models.platform import Audit
from clientbridge.models.scheduling import Booking, Recurrence, Slot
from clientbridge.services.deliveries import DELIVERIES_JOB, run_deliveries
from tests.conftest import BIZ, Factory, FakeEmailSender, FakeJobs, FakePushSender, FakeSmsSender
from tests.helpers import enable_payments, key, new_client, reachable, settle

CL_AMELIE = "cl_amelie"
FIRST = "2027-03-02T19:00:00Z"
SECOND = "2027-03-04T19:00:00Z"


async def _member(db: AsyncSession, factory: Factory, name: str) -> str:
    business = await db.get(Business, BIZ)
    assert business is not None
    user = await factory.user(name=name)
    member = await factory.staff(business=business, user=user, role="staff")
    return member.id


async def _item(db: AsyncSession, *, deposit: bool = False) -> str:
    item = Item(
        id=new_id("item"),
        business_id=BIZ,
        kind="service",
        name="Removal Groom",
        price_cents=6000,
        currency="CAD",
        duration_min=60,
        deposit_type="fixed" if deposit else "none",
        deposit_value=2000 if deposit else None,
    )
    db.add(item)
    await db.flush()
    return item.id


async def _visit(api: httpx.AsyncClient, item: str, staff: str, starts: str) -> str:
    res = await api.post(
        "/v1/bookings",
        json={
            "client_id": CL_AMELIE,
            "item_id": item,
            "staff_id": staff,
            "starts_at": starts,
            "notify": False,
        },
    )
    assert res.status_code == 201, res.text
    booking_id: str = res.json()["id"]
    return booking_id


async def _textable_client(db: AsyncSession) -> None:
    client = await db.get(Client, CL_AMELIE)
    assert client is not None
    client.phone = "+16045550223"
    await db.flush()


async def _series(api: httpx.AsyncClient, item: str, staff: str) -> str:
    res = await api.post(
        "/v1/recurrences",
        json={
            "client_id": CL_AMELIE,
            "item_id": item,
            "staff_id": staff,
            "starts_at": "2027-04-06T19:00:00Z",
            "frequency": "week",
            "interval": 1,
            "count": 2,
            "confirmation": "none",
        },
    )
    assert res.status_code == 201, res.text
    series_id: str = res.json()["id"]
    return series_id


async def _remove(api: httpx.AsyncClient, staff: str, **body: str) -> httpx.Response:
    return await api.post(f"/v1/staff/{staff}/remove", json=body)


async def _staff_of(db: AsyncSession, booking_id: str) -> tuple[str | None, str, str]:
    booking = await db.get(Booking, booking_id, populate_existing=True)
    assert booking is not None
    slot = await db.get(Slot, booking.slot_id, populate_existing=True)
    assert slot is not None
    return booking.staff_id, slot.staff_id, booking.status


async def _status(db: AsyncSession, staff_id: str) -> str:
    member = await db.get(Staff, staff_id, populate_existing=True)
    assert member is not None
    return member.status


async def test_removal_with_future_work_and_no_choice_lists_it_409(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    item = await _item(db)
    leaving = await _member(db, factory, "Leaving Lee")
    visit = await _visit(as_owner, item, leaving, FIRST)
    series = await _series(as_owner, item, leaving)
    res = await _remove(as_owner, leaving)
    assert res.status_code == 409, res.text
    body = res.json()
    assert body["error"] == "staff_has_future_work"
    visits = body["detail"]["visits"]
    assert visits[0]["booking_id"] == visit and len(visits) == 3
    assert body["detail"]["series"] == [series]
    assert await _status(db, leaving) == "active"


async def test_removal_without_future_work_needs_no_choice(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    leaving = await _member(db, factory, "Idle Ida")
    res = await _remove(as_owner, leaving)
    assert res.status_code == 200, res.text
    assert res.json() == {
        "moved": [],
        "canceled": [],
        "left": [],
        "series_moved": [],
        "series_ended": [],
    }
    assert await _status(db, leaving) == "removed"


async def test_removal_reassigns_visits_and_series_to_a_named_member(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory, sms: FakeSmsSender
) -> None:
    await _textable_client(db)
    item = await _item(db)
    leaving = await _member(db, factory, "Leaving Lee")
    taking = await _member(db, factory, "Taking Tam")
    visit = await _visit(as_owner, item, leaving, FIRST)
    series = await _series(as_owner, item, leaving)
    res = await _remove(as_owner, leaving, future="reassign", reassign_to=taking)
    assert res.status_code == 200, res.text
    out = res.json()
    assert visit in out["moved"] and len(out["moved"]) == 3
    assert out["left"] == [] and out["series_ended"] == []
    assert out["series_moved"] == [{"recurrence_id": series, "staff_id": taking}]
    assert await _staff_of(db, visit) == (taking, taking, "confirmed")
    recurrence = await db.get(Recurrence, series, populate_existing=True)
    assert recurrence is not None and recurrence.staff_id == taking
    assert await _status(db, leaving) == "removed"
    notices = [m for m in sms.sent if "Taking Tam" in m.body]
    assert len(notices) == 1 and "now with Taking Tam" in notices[0].body
    actions = await db.scalars(select(Audit.action).where(Audit.entity_id.in_([visit, leaving])))
    assert {"booking.reassign", "staff.remove"} <= set(actions)


async def test_removal_reassigns_to_any_free_member(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    item = await _item(db)
    leaving = await _member(db, factory, "Leaving Lee")
    visit = await _visit(as_owner, item, leaving, FIRST)
    series = await _series(as_owner, item, leaving)
    res = await _remove(as_owner, leaving, future="reassign", reassign_to="any")
    assert res.status_code == 200, res.text
    out = res.json()
    assert visit in out["moved"]
    booking_staff, slot_staff, _ = await _staff_of(db, visit)
    assert booking_staff == slot_staff
    assert slot_staff is not None and slot_staff != leaving
    assert await _status(db, slot_staff) == "active"
    recurrence = await db.get(Recurrence, series, populate_existing=True)
    assert recurrence is not None and recurrence.staff_id not in (None, leaving)
    assert out["series_moved"] == [{"recurrence_id": series, "staff_id": recurrence.staff_id}]


async def test_removal_cancels_visits_and_series_and_tells_the_client(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory, sms: FakeSmsSender
) -> None:
    await _textable_client(db)
    item = await _item(db)
    leaving = await _member(db, factory, "Leaving Lee")
    visit = await _visit(as_owner, item, leaving, FIRST)
    series = await _series(as_owner, item, leaving)
    res = await _remove(as_owner, leaving, future="cancel")
    assert res.status_code == 200, res.text
    out = res.json()
    assert visit in out["canceled"] and len(out["canceled"]) == 3
    assert out["series_ended"] == [series] and out["series_moved"] == []
    assert out["moved"] == []
    assert (await _staff_of(db, visit))[2] == "canceled"
    booking = await db.get(Booking, visit)
    assert booking is not None
    slot = await db.get(Slot, booking.slot_id, populate_existing=True)
    assert slot is not None and slot.status == "canceled"
    recurrence = await db.get(Recurrence, series, populate_existing=True)
    assert recurrence is not None and recurrence.status == "canceled"
    canceled = [m for m in sms.sent if "canceled" in m.body]
    assert len(canceled) == 1 and "These visits" in canceled[0].body


async def test_removing_a_member_with_many_clients_sends_one_notice_before_answering(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    factory: Factory,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
    jobs: FakeJobs,
) -> None:
    item = await _item(db)
    leaving = await _member(db, factory, "Busy Bea")
    clients = [await new_client(db, name=f"Bulk {each}") for each in range(3)]
    for each, client in enumerate(clients):
        await reachable(db, client, phone=f"+1250555123{each}")
        res = await as_owner.post(
            "/v1/bookings",
            json={
                "client_id": client,
                "item_id": item,
                "staff_id": leaving,
                "starts_at": f"2027-03-0{each + 2}T19:00:00Z",
                "notify": False,
            },
        )
        assert res.status_code == 201, res.text
    jobs.work, jobs.enqueued = False, []
    sms.sent.clear()
    assert (await _remove(as_owner, leaving, future="cancel")).status_code == 200
    assert len(sms.sent) == 1 and jobs.enqueued == [DELIVERIES_JOB]
    await run_deliveries(db, email, sms, push)
    told = {m.to for m in sms.sent if "canceled" in m.body}
    assert told == {f"+1250555123{each}" for each in range(3)}


async def test_canceling_a_removed_members_visits_refunds_their_deposits(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    await enable_payments(db)
    item = await _item(db, deposit=True)
    leaving = await _member(db, factory, "Leaving Lee")
    paid_visit = await _visit(as_owner, item, leaving, FIRST)
    unpaid_visit = await _visit(as_owner, item, leaving, SECOND)
    paid = await as_owner.post(f"/v1/bookings/{paid_visit}/deposit?payment_method_id=default")
    assert paid.status_code == 200, paid.text
    await settle(as_owner, db, paid.json()["payment_id"])
    res = await _remove(as_owner, leaving, future="cancel")
    assert res.status_code == 200, res.text
    refunded = await db.get(Booking, paid_visit, populate_existing=True)
    assert refunded is not None and refunded.deposit_status == "refunded"
    unpaid = await db.get(Booking, unpaid_visit, populate_existing=True)
    assert unpaid is not None and unpaid.deposit_status == "none"


async def test_a_visit_that_clashes_is_left_in_place_and_listed(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    item = await _item(db)
    leaving = await _member(db, factory, "Leaving Lee")
    taking = await _member(db, factory, "Taking Tam")
    clashing = await _visit(as_owner, item, leaving, FIRST)
    free = await _visit(as_owner, item, leaving, SECOND)
    await _visit(as_owner, item, taking, FIRST)
    res = await _remove(as_owner, leaving, future="reassign", reassign_to=taking)
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["moved"] == [free]
    assert [(v["booking_id"], v["problem"]) for v in out["left"]] == [(clashing, "overlap")]
    assert await _staff_of(db, clashing) == (leaving, leaving, "confirmed")
    assert await _status(db, leaving) == "removed"


async def test_a_series_whose_visits_all_clash_ends_instead_of_moving(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    item = await _item(db)
    leaving = await _member(db, factory, "Leaving Lee")
    taking = await _member(db, factory, "Taking Tam")
    series = await _series(as_owner, item, leaving)
    await _series(as_owner, item, taking)
    res = await _remove(as_owner, leaving, future="reassign", reassign_to=taking)
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["series_moved"] == [] and out["series_ended"] == [series]
    assert out["moved"] == [] and len(out["left"]) == 2
    recurrence = await db.get(Recurrence, series, populate_existing=True)
    assert recurrence is not None
    assert recurrence.status == "ended" and recurrence.staff_id == leaving


async def test_removal_choices_are_validated_422_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    item = await _item(db)
    leaving = await _member(db, factory, "Leaving Lee")
    gone = await _member(db, factory, "Gone Gus")
    await _visit(as_owner, item, leaving, FIRST)
    assert (await _remove(as_owner, gone, future="cancel")).status_code == 200
    cases = [
        ({"future": "reassign"}, 422),
        ({"future": "reassign", "reassign_to": leaving}, 422),
        ({"future": "cancel", "reassign_to": "any"}, 422),
        ({"reassign_to": "any"}, 422),
        ({"future": "reassign", "reassign_to": gone}, 404),
        ({"future": "reassign", "reassign_to": "st_nope"}, 404),
        ({"future": "move"}, 422),
    ]
    for body, status in cases:
        res = await _remove(as_owner, leaving, **body)
        assert res.status_code == status, (body, res.text)
    assert await _status(db, leaving) == "active"


async def test_staff_cannot_remove_members_403(as_staff: httpx.AsyncClient) -> None:
    res = await _remove(as_staff, "st_priya", future="cancel")
    assert res.status_code == 403


async def test_another_business_member_cannot_take_the_visits_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    item = await _item(db)
    leaving = await _member(db, factory, "Leaving Lee")
    visit = await _visit(as_owner, item, leaving, FIRST)
    other = await factory.business()
    outsider = await factory.staff(business=other, role="staff")
    res = await _remove(as_owner, leaving, future="reassign", reassign_to=outsider.id)
    assert res.status_code == 404, res.text
    assert await _staff_of(db, visit) == (leaving, leaving, "confirmed")


async def test_removal_leaves_other_members_and_businesses_untouched(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    item = await _item(db)
    leaving = await _member(db, factory, "Leaving Lee")
    staying = await _member(db, factory, "Staying Sam")
    theirs = await _visit(as_owner, item, staying, FIRST)
    await _visit(as_owner, item, leaving, SECOND)
    other_visits = await db.scalar(
        select(Booking.id).where(Booking.business_id != BIZ, Booking.status != "canceled").limit(1)
    )
    res = await _remove(as_owner, leaving, future="cancel")
    assert res.status_code == 200, res.text
    assert theirs not in res.json()["canceled"]
    assert await _staff_of(db, theirs) == (staying, staying, "confirmed")
    if other_visits is not None:
        untouched = await db.get(Booking, other_visits, populate_existing=True)
        assert untouched is not None and untouched.status != "canceled"


async def test_a_repeated_removal_replays_without_notifying_again(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory, sms: FakeSmsSender
) -> None:
    await _textable_client(db)
    item = await _item(db)
    leaving = await _member(db, factory, "Leaving Lee")
    await _visit(as_owner, item, leaving, FIRST)
    headers = key()
    body = {"future": "cancel"}
    first = await as_owner.post(f"/v1/staff/{leaving}/remove", json=body, headers=headers)
    assert first.status_code == 200, first.text
    sent = len(sms.sent)
    again = await as_owner.post(f"/v1/staff/{leaving}/remove", json=body, headers=headers)
    assert again.status_code == 200 and again.json() == first.json()
    assert len(sms.sent) == sent
    changed = await as_owner.post(
        f"/v1/staff/{leaving}/remove",
        json={"future": "reassign", "reassign_to": "any"},
        headers=headers,
    )
    assert changed.status_code == 422 and changed.json()["error"] == "idempotency_key_reused"
    assert (await _remove(as_owner, leaving, future="cancel")).status_code == 404


async def test_the_manage_link_of_a_removed_members_visit_cannot_move_it(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    item = await _item(db)
    leaving = await _member(db, factory, "Leaving Lee")
    taking = await _member(db, factory, "Taking Tam")
    visit = await _visit(as_owner, item, leaving, FIRST)
    await _visit(as_owner, item, taking, FIRST)
    res = await _remove(as_owner, leaving, future="reassign", reassign_to=taking)
    assert res.json()["left"][0]["booking_id"] == visit
    booking = await db.get(Booking, visit)
    assert booking is not None and booking.manage_token is not None
    token = booking.manage_token
    view = (await as_owner.get(f"/manage/{token}")).json()
    assert view["can_move"] is False and view["can_cancel"] is True
    assert view["blocked"] == "member_unavailable"
    moved = await as_owner.post(
        f"/manage/{token}/reschedule", json={"starts_at": "2027-03-03T19:00:00Z"}
    )
    assert moved.status_code == 409 and moved.json()["error"] == "change_blocked"
    slots = await as_owner.get(f"/manage/{token}/slots", params={"date": "2027-03-03"})
    assert slots.status_code == 409
    days = await as_owner.get(f"/manage/{token}/days", params={"from": "2027-03-01"})
    assert days.status_code == 409
    assert (await as_owner.post(f"/manage/{token}/cancel")).status_code == 200
