import json
from datetime import UTC, date, datetime, time, timedelta

import httpx
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.business import Business
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client
from clientbridge.models.payments import Payment, PaymentMethod
from clientbridge.models.scheduling import Booking, Hours, Slot
from clientbridge.services import ledger
from clientbridge.services.bookings import booked_count
from clientbridge.services.notifications import Notifier
from clientbridge.tasks.bookings import run_reap_unpaid_bookings, run_reminders
from tests.conftest import (
    BIZ,
    Factory,
    FakeEmailSender,
    FakePaymentGateway,
    FakePushSender,
    FakeSmsSender,
)

ST_OWNER = "st_owner"
ST_PRIYA = "st_priya"  # seeded staff with no hours rows → unconfigured


async def _client_and_item(db: AsyncSession) -> tuple[str, str]:
    client_id = (await db.execute(select(Client.id).limit(1))).scalars().first()
    item_id = (
        (
            await db.execute(
                select(Item.id)
                .where(Item.kind == "service", Item.duration_min.isnot(None))
                .limit(1)
            )
        )
        .scalars()
        .first()
    )
    assert client_id and item_id
    return client_id, item_id


def _body(client_id: str, item_id: str, starts: str, staff: str = ST_OWNER) -> dict[str, str]:
    return {"client_id": client_id, "item_id": item_id, "staff_id": staff, "starts_at": starts}


async def test_create_booking(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, item_id = await _client_and_item(db)
    res = await as_owner.post(
        "/v1/bookings", json=_body(client_id, item_id, "2027-03-01T10:00:00Z")
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "confirmed"
    assert body["staff_id"] == ST_OWNER
    assert body["ends_at"] > body["starts_at"]


async def test_double_book_conflicts(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, item_id = await _client_and_item(db)
    body = _body(client_id, item_id, "2027-03-02T18:00:00Z")
    assert (await as_owner.post("/v1/bookings", json=body)).status_code == 201
    dup = await as_owner.post("/v1/bookings", json=body)
    assert dup.status_code == 409
    assert "already booked" in dup.text.lower()  # the overlap check, not some other 409
    # the first booking persisted; the clash created no second slot at that time
    n = (
        await db.execute(
            select(func.count())
            .select_from(Slot)
            .where(
                Slot.staff_id == ST_OWNER,
                Slot.starts_at == datetime(2027, 3, 2, 18, tzinfo=UTC),
            )
        )
    ).scalar_one()
    assert n == 1


async def test_resource_double_book_conflicts(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    # a resource (room/equipment) can't be held by two overlapping slots, even across staff
    client_id, item_id = await _client_and_item(db)
    held = Slot(
        id=new_id("slot"),
        business_id=BIZ,
        item_id=item_id,
        staff_id="st_diego",
        resource_id="rs_station_a",
        starts_at=datetime(2027, 3, 1, 9, tzinfo=UTC),
        ends_at=datetime(2027, 3, 1, 12, tzinfo=UTC),
        capacity=1,
        status="scheduled",
    )
    db.add(held)
    await db.flush()
    # st_owner is free + available at 10:00, but Station A is taken → a resource conflict, not staff
    clash = _body(client_id, item_id, "2027-03-01T10:00:00Z") | {"resource_id": "rs_station_a"}
    res = await as_owner.post("/v1/bookings", json=clash)
    assert res.status_code == 409, res.text
    assert "resource" in res.text.lower()  # the resource message, not the staff-overlap one
    # same resource at a non-overlapping time, and a free resource at the clash time, both succeed
    later = _body(client_id, item_id, "2027-03-01T14:00:00Z") | {"resource_id": "rs_station_a"}
    assert (await as_owner.post("/v1/bookings", json=later)).status_code == 201, "non-overlap ok"
    other = _body(client_id, item_id, "2027-03-01T10:00:00Z") | {"resource_id": "rs_station_b"}
    assert (await as_owner.post("/v1/bookings", json=other)).status_code == 201, "free resource ok"


async def test_cancel_frees_the_slot(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, item_id = await _client_and_item(db)
    body = _body(client_id, item_id, "2027-03-03T18:00:00Z")
    bid = (await as_owner.post("/v1/bookings", json=body)).json()["id"]
    canceled = await as_owner.patch(f"/v1/bookings/{bid}", json={"status": "canceled"})
    assert canceled.status_code == 200
    assert canceled.json()["status"] == "canceled"
    assert (await as_owner.post("/v1/bookings", json=body)).status_code == 201


async def test_reschedule_moves_slot(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, item_id = await _client_and_item(db)
    created = await as_owner.post(
        "/v1/bookings", json=_body(client_id, item_id, "2027-03-04T18:00:00Z")
    )
    bid = created.json()["id"]
    moved = await as_owner.patch(f"/v1/bookings/{bid}", json={"starts_at": "2027-03-04T22:00:00Z"})
    assert moved.status_code == 200
    assert moved.json()["starts_at"].startswith("2027-03-04T22:00")
    # the move persisted on the slot, not just echoed in the response
    slot = (
        await db.execute(
            select(Slot).join(Booking, Booking.slot_id == Slot.id).where(Booking.id == bid)
        )
    ).scalar_one()
    assert slot.starts_at == datetime(2027, 3, 4, 22, tzinfo=UTC)


async def test_staff_cannot_book_another_staff(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    client_id, item_id = await _client_and_item(db)
    res = await as_staff.post(
        "/v1/bookings", json=_body(client_id, item_id, "2027-03-05T10:00:00Z", ST_OWNER)
    )
    assert res.status_code == 403


async def test_unauth_cannot_book(unauth: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, item_id = await _client_and_item(db)
    res = await unauth.post("/v1/bookings", json=_body(client_id, item_id, "2027-03-06T10:00:00Z"))
    assert res.status_code == 401


async def test_unknown_client_404(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    _, item_id = await _client_and_item(db)
    res = await as_owner.post(
        "/v1/bookings", json=_body("cl_nope", item_id, "2027-03-07T10:00:00Z")
    )
    assert res.status_code == 404


async def test_idempotent_create_replays(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, item_id = await _client_and_item(db)
    body = _body(client_id, item_id, "2027-03-08T10:00:00Z")
    headers = {"Idempotency-Key": "bk-test-1"}
    first = await as_owner.post("/v1/bookings", json=body, headers=headers)
    second = await as_owner.post("/v1/bookings", json=body, headers=headers)
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]


async def test_unknown_item_404(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, _ = await _client_and_item(db)
    res = await as_owner.post(
        "/v1/bookings", json=_body(client_id, "it_nope", "2027-04-04T10:00:00Z")
    )
    assert res.status_code == 404


async def test_unknown_staff_404(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, item_id = await _client_and_item(db)
    res = await as_owner.post(
        "/v1/bookings", json=_body(client_id, item_id, "2027-04-05T10:00:00Z", "st_nope")
    )
    assert res.status_code == 404


async def test_cannot_book_another_business_client(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Rival Co")
    foreign = await factory.client(business=other)
    await db.flush()
    _, item_id = await _client_and_item(db)
    res = await as_owner.post(
        "/v1/bookings", json=_body(foreign.id, item_id, "2027-04-03T10:00:00Z")
    )
    assert res.status_code == 404


async def test_reschedule_into_conflict_409(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, item_id = await _client_and_item(db)
    first = await as_owner.post(
        "/v1/bookings", json=_body(client_id, item_id, "2027-04-01T17:00:00Z")
    )
    await as_owner.post("/v1/bookings", json=_body(client_id, item_id, "2027-04-01T21:00:00Z"))
    moved = await as_owner.patch(
        f"/v1/bookings/{first.json()['id']}", json={"starts_at": "2027-04-01T21:00:00Z"}
    )
    assert moved.status_code == 409


async def test_double_cancel_is_idempotent(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, item_id = await _client_and_item(db)
    bid = (
        await as_owner.post("/v1/bookings", json=_body(client_id, item_id, "2027-04-02T17:00:00Z"))
    ).json()["id"]
    first = await as_owner.patch(f"/v1/bookings/{bid}", json={"status": "canceled"})
    second = await as_owner.patch(f"/v1/bookings/{bid}", json={"status": "canceled"})
    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["status"] == "canceled"


async def test_zero_duration_item_is_422(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, _ = await _client_and_item(db)
    product = Item(
        id=new_id("item"),
        business_id="bz_birchbark",
        kind="product",
        name="Shampoo",
        price_cents=1500,
        currency="CAD",
        duration_min=None,
    )
    db.add(product)
    await db.flush()
    res = await as_owner.post(
        "/v1/bookings", json=_body(client_id, product.id, "2027-04-06T10:00:00Z")
    )
    assert res.status_code == 422


async def test_inactive_item_404(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, _ = await _client_and_item(db)
    retired = Item(
        id=new_id("item"),
        business_id="bz_birchbark",
        kind="service",
        name="Retired Service",
        price_cents=5000,
        currency="CAD",
        duration_min=60,
        active=False,
    )
    db.add(retired)
    await db.flush()
    res = await as_owner.post(
        "/v1/bookings", json=_body(client_id, retired.id, "2027-05-01T10:00:00Z")
    )
    assert res.status_code == 404


async def test_cannot_modify_terminal_booking(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    client_id, item_id = await _client_and_item(db)
    bid = (
        await as_owner.post("/v1/bookings", json=_body(client_id, item_id, "2027-05-02T10:00:00Z"))
    ).json()["id"]
    await as_owner.patch(f"/v1/bookings/{bid}", json={"status": "canceled"})
    moved = await as_owner.patch(f"/v1/bookings/{bid}", json={"starts_at": "2027-05-02T14:00:00Z"})
    assert moved.status_code == 409


async def test_patch_unknown_booking_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.patch("/v1/bookings/bk_nope", json={"status": "canceled"})
    assert res.status_code == 404


async def test_booking_within_buffer_conflicts(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    # it_groom_sm is a 75-min service with a seeded 10-min after-buffer.
    client_id, _ = await _client_and_item(db)
    first = await as_owner.post(
        "/v1/bookings", json=_body(client_id, "it_groom_sm", "2027-03-02T18:00:00Z")
    )
    assert first.status_code == 201
    # 11:15 butts against the prior booking inside its 10-min after-buffer.
    second = await as_owner.post(
        "/v1/bookings", json=_body(client_id, "it_groom_sm", "2027-03-02T19:15:00Z")
    )
    assert second.status_code == 409


async def test_booking_outside_buffer_ok(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, _ = await _client_and_item(db)
    first = await as_owner.post(
        "/v1/bookings", json=_body(client_id, "it_groom_sm", "2027-03-02T18:00:00Z")
    )
    assert first.status_code == 201
    # 11:25 clears the 10-min buffer after the 11:15 end.
    second = await as_owner.post(
        "/v1/bookings", json=_body(client_id, "it_groom_sm", "2027-03-02T19:25:00Z")
    )
    assert second.status_code == 201


async def test_unconfigured_hours_allow_any_time(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    # st_priya has no hours rows → unconfigured → even an off-hours slot is allowed.
    client_id, item_id = await _client_and_item(db)
    res = await as_owner.post(
        "/v1/bookings", json=_body(client_id, item_id, "2027-03-02T20:00:00Z", ST_PRIYA)
    )
    assert res.status_code == 201


async def test_booking_within_window_ok_outside_409(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    client_id, item_id = await _client_and_item(db)
    db.add(
        Hours(
            id=new_id("hours"),
            business_id=BIZ,
            staff_id=ST_PRIYA,
            basis="date",
            date=date(2027, 9, 15),
            start_time=time(9, 0),
            end_time=time(17, 0),
            available=True,
        )
    )
    await db.flush()
    inside = await as_owner.post(
        "/v1/bookings", json=_body(client_id, item_id, "2027-09-15T18:00:00Z", ST_PRIYA)
    )
    assert inside.status_code == 201
    outside = await as_owner.post(
        "/v1/bookings", json=_body(client_id, item_id, "2027-09-15T15:00:00Z", ST_PRIYA)
    )
    assert outside.status_code == 409


async def test_hours_windows_are_business_local_not_utc(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    # 12:00 UTC is inside 09:00-17:00 only if read as UTC; in Vancouver it's early morning
    client_id, item_id = await _client_and_item(db)
    res = await as_owner.post(
        "/v1/bookings", json=_body(client_id, item_id, "2027-03-02T12:00:00Z")
    )
    assert res.status_code == 409, res.text


async def test_hours_closure_blocks_booking(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, item_id = await _client_and_item(db)
    db.add(
        Hours(
            id=new_id("hours"),
            business_id=BIZ,
            staff_id=ST_PRIYA,
            basis="date",
            date=date(2027, 9, 16),
            available=False,  # all-day closure
        )
    )
    await db.flush()
    res = await as_owner.post(
        "/v1/bookings", json=_body(client_id, item_id, "2027-09-16T12:00:00Z", ST_PRIYA)
    )
    assert res.status_code == 409


async def test_class_bookings_share_slot_until_full(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    client_id, _ = await _client_and_item(db)
    cls = Item(
        id=new_id("item"),
        business_id=BIZ,
        kind="class",
        name="Puppy Playgroup",
        price_cents=3000,
        currency="CAD",
        duration_min=60,
        capacity=2,
    )
    db.add(cls)
    await db.flush()
    body = _body(client_id, cls.id, "2027-03-02T18:00:00Z", ST_PRIYA)
    first = await as_owner.post("/v1/bookings", json=body)
    second = await as_owner.post("/v1/bookings", json=body)
    third = await as_owner.post("/v1/bookings", json=body)
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["slot_id"] == second.json()["slot_id"]  # one shared slot
    assert third.status_code == 409  # capacity 2 exhausted
    sess = (await db.execute(select(Slot).where(Slot.id == first.json()["slot_id"]))).scalar_one()
    assert sess.capacity == 2
    assert await booked_count(db, sess.id) == 2


async def test_non_class_item_mints_single_capacity_slot(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    client_id, item_id = await _client_and_item(db)
    res = await as_owner.post(
        "/v1/bookings", json=_body(client_id, item_id, "2027-03-02T17:00:00Z")
    )
    assert res.status_code == 201
    sess = (await db.execute(select(Slot).where(Slot.id == res.json()["slot_id"]))).scalar_one()
    assert sess.capacity == 1
    assert await booked_count(db, sess.id) == 1


async def test_foreign_business_slot_does_not_block(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    client_id, _ = await _client_and_item(db)
    other = await factory.business(name="Rival Co")
    other_user = await factory.user()
    other_staff = await factory.staff(business=other, user=other_user, role="owner")
    other_item = Item(
        id=new_id("item"),
        business_id=other.id,
        kind="service",
        name="Rival Groom",
        price_cents=5000,
        currency="CAD",
        duration_min=75,
    )
    db.add(other_item)
    await db.flush()
    db.add(
        Slot(
            id=new_id("slot"),
            business_id=other.id,
            item_id=other_item.id,
            staff_id=other_staff.id,
            starts_at=datetime(2027, 3, 2, 18, 0, tzinfo=UTC),
            ends_at=datetime(2027, 3, 2, 19, 15, tzinfo=UTC),
            capacity=1,
            status="scheduled",
        )
    )
    await db.flush()
    # our owner books the same slot; the cross-tenant slot must not block (scoped by business).
    res = await as_owner.post(
        "/v1/bookings", json=_body(client_id, "it_groom_sm", "2027-03-02T18:00:00Z")
    )
    assert res.status_code == 201


CL_AMELIE = "cl_amelie"  # seeded client with email + phone
SEEDED_CARD = "pm_demo_4242"  # cl_amelie's seeded default-card provider ref


async def _enable_payments(db: AsyncSession) -> None:
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_account_id="acct_test", stripe_charges_enabled=True)
    )
    await db.flush()


async def _deposit_booking(
    api: httpx.AsyncClient,
    db: AsyncSession,
    *,
    starts: str,
    deposit: bool = True,
    client_id: str = CL_AMELIE,
) -> str:
    item = Item(
        id=new_id("item"),
        business_id=BIZ,
        kind="service",
        name="Deluxe Groom",
        price_cents=12000,
        currency="CAD",
        duration_min=60,
        deposit_type="fixed" if deposit else "none",
        deposit_value=2000 if deposit else None,
    )
    db.add(item)
    await db.flush()
    # ST_PRIYA has no hours rows, so these tests don't depend on the business's working hours
    res = await api.post("/v1/bookings", json=_body(client_id, item.id, starts, ST_PRIYA))
    assert res.status_code == 201, res.text
    return str(res.json()["id"])


def _pi_succeeded(event_id: str, pi_id: str) -> str:
    return json.dumps(
        {
            "id": event_id,
            "type": "payment_intent.succeeded",
            "data": {"object": {"id": pi_id, "application_fee_amount": 0}},
        }
    )


async def _provider_ref(db: AsyncSession, payment_id: str) -> str:
    ref = (
        await db.execute(select(Payment.provider_ref).where(Payment.id == payment_id))
    ).scalar_one()
    assert ref
    return str(ref)


async def test_collect_deposit_default_card_settles_and_receipts(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
    email: FakeEmailSender,
) -> None:
    await _enable_payments(db)
    bid = await _deposit_booking(as_owner, db, starts="2027-06-01T10:00:00Z")
    res = await as_owner.post(f"/v1/bookings/{bid}/deposit?payment_method_id=default")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["booking_id"] == bid
    pay = (await db.execute(select(Payment).where(Payment.id == body["payment_id"]))).scalar_one()
    assert pay.kind == "deposit"
    assert pay.booking_id == bid
    assert pay.status == "pending"
    assert pay.amount_cents == 2000
    assert SEEDED_CARD in gateway.charged_methods  # charged off-session

    pi_id = await _provider_ref(db, body["payment_id"])
    webhook = await as_owner.post(
        "/webhooks/stripe",
        content=_pi_succeeded("evt_d1", pi_id),
        headers={"Stripe-Signature": "good"},
    )
    assert webhook.status_code == 200
    booking = (await db.execute(select(Booking).where(Booking.id == bid))).scalar_one()
    assert booking.deposit_status == "collected"
    assert len(email.sent) >= 1  # deposit receipt to the client


async def test_collect_deposit_interactive_returns_secret(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _enable_payments(db)
    bid = await _deposit_booking(as_owner, db, starts="2027-06-02T10:00:00Z")
    res = await as_owner.post(f"/v1/bookings/{bid}/deposit")
    assert res.status_code == 200, res.text
    assert res.json()["client_secret"].startswith("pi_fake")
    assert gateway.charged_methods == []  # nothing charged — awaiting client confirmation
    booking = (await db.execute(select(Booking).where(Booking.id == bid))).scalar_one()
    assert booking.deposit_status == "pending"


async def test_collect_deposit_no_deposit_due_409(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable_payments(db)
    bid = await _deposit_booking(as_owner, db, starts="2027-06-03T10:00:00Z", deposit=False)
    res = await as_owner.post(f"/v1/bookings/{bid}/deposit")
    assert res.status_code == 409


async def test_collect_deposit_double_collect_409(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable_payments(db)
    bid = await _deposit_booking(as_owner, db, starts="2027-06-04T10:00:00Z")
    first = await as_owner.post(f"/v1/bookings/{bid}/deposit?payment_method_id=default")
    assert first.status_code == 200
    second = await as_owner.post(f"/v1/bookings/{bid}/deposit?payment_method_id=default")
    assert second.status_code == 409


async def test_collect_deposit_idempotent_replays(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _enable_payments(db)
    bid = await _deposit_booking(as_owner, db, starts="2027-06-05T10:00:00Z")
    headers = {"Idempotency-Key": "dep-1"}
    first = await as_owner.post(
        f"/v1/bookings/{bid}/deposit?payment_method_id=default", headers=headers
    )
    second = await as_owner.post(
        f"/v1/bookings/{bid}/deposit?payment_method_id=default", headers=headers
    )
    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["payment_id"] == second.json()["payment_id"]  # one charge for a true retry
    assert gateway.charged_methods.count(SEEDED_CARD) == 1


async def test_collect_deposit_not_onboarded_409(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid = await _deposit_booking(as_owner, db, starts="2027-06-06T10:00:00Z")  # no _enable_payments
    res = await as_owner.post(f"/v1/bookings/{bid}/deposit")
    assert res.status_code == 409


async def test_foreign_booking_404_by_scoping(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Rival Co")
    other_user = await factory.user()
    other_staff = await factory.staff(business=other, user=other_user, role="owner")
    foreign_client = await factory.client(business=other)
    item = Item(
        id=new_id("item"),
        business_id=other.id,
        kind="service",
        name="Rival Deposit Groom",
        price_cents=12000,
        currency="CAD",
        duration_min=60,
        deposit_type="fixed",
        deposit_value=2000,
    )
    db.add(item)
    await db.flush()
    slot = Slot(
        id=new_id("slot"),
        business_id=other.id,
        item_id=item.id,
        staff_id=other_staff.id,
        starts_at=datetime(2027, 6, 7, 10, 0, tzinfo=UTC),
        ends_at=datetime(2027, 6, 7, 11, 0, tzinfo=UTC),
        capacity=1,
        status="scheduled",
    )
    db.add(slot)
    await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=other.id,
        slot_id=slot.id,
        staff_id=other_staff.id,
        client_id=foreign_client.id,
        status="confirmed",
        source="manual",
        price_cents=12000,
        deposit_amount_cents=2000,
    )
    db.add(booking)
    await db.flush()
    res = await as_owner.post(f"/v1/bookings/{booking.id}/deposit")
    assert res.status_code == 404  # scoped to the caller's business
    moved = await as_owner.patch(f"/v1/bookings/{booking.id}", json={"status": "canceled"})
    assert moved.status_code == 404
    addon = await as_owner.delete(f"/v1/bookings/{booking.id}/addons/bka_any")
    assert addon.status_code == 404
    after = await db.get(Booking, booking.id, populate_existing=True)
    assert after is not None and after.status == "confirmed"


async def test_no_show_forfeits_collected_deposit(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _enable_payments(db)
    bid = await _deposit_booking(as_owner, db, starts="2027-06-08T10:00:00Z")
    pay = (await as_owner.post(f"/v1/bookings/{bid}/deposit?payment_method_id=default")).json()
    pi_id = await _provider_ref(db, pay["payment_id"])
    await as_owner.post(
        "/webhooks/stripe",
        content=_pi_succeeded("evt_d2", pi_id),
        headers={"Stripe-Signature": "good"},
    )
    res = await as_owner.patch(f"/v1/bookings/{bid}", json={"status": "no_show"})
    assert res.status_code == 200
    assert res.json()["deposit_status"] == "forfeited"
    assert gateway.charged_methods.count(SEEDED_CARD) == 1  # not re-charged
    # idempotent — re-setting no_show keeps it forfeited, no new charge
    again = await as_owner.patch(f"/v1/bookings/{bid}", json={"status": "no_show"})
    assert again.json()["deposit_status"] == "forfeited"
    assert gateway.charged_methods.count(SEEDED_CARD) == 1


async def test_no_show_charges_default_card(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _enable_payments(db)
    bid = await _deposit_booking(as_owner, db, starts="2027-06-09T10:00:00Z")  # deposit uncollected
    res = await as_owner.patch(f"/v1/bookings/{bid}", json={"status": "no_show"})
    assert res.status_code == 200
    assert res.json()["deposit_status"] == "pending"  # captured, not yet settled
    assert gateway.charged_methods.count(SEEDED_CARD) == 1
    charged = (
        await db.execute(
            select(Payment).where(Payment.booking_id == bid, Payment.kind == "deposit")
        )
    ).scalar_one()
    assert charged.amount_cents == 2000
    await as_owner.post(
        "/webhooks/stripe",
        content=_pi_succeeded("evt_ns", charged.provider_ref or ""),
        headers={"Stripe-Signature": "good"},
    )
    booking = (await db.execute(select(Booking).where(Booking.id == bid))).scalar_one()
    assert booking.deposit_status == "forfeited"
    assert await ledger.deposit_held(db, booking) == 0
    # idempotent — repeat no_show never double-charges
    await as_owner.patch(f"/v1/bookings/{bid}", json={"status": "no_show"})
    assert gateway.charged_methods.count(SEEDED_CARD) == 1


async def test_no_show_stands_when_the_default_card_declines(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable_payments(db)
    await db.execute(
        update(PaymentMethod)
        .where(PaymentMethod.provider_ref == SEEDED_CARD)
        .values(provider_ref="pm_card_declined")
    )
    bid = await _deposit_booking(as_owner, db, starts="2027-06-10T10:00:00Z")
    res = await as_owner.patch(f"/v1/bookings/{bid}", json={"status": "no_show"})
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "no_show"
    assert res.json()["deposit_status"] == "pending"


async def test_no_show_without_deposit_is_noop(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    bid = await _deposit_booking(as_owner, db, starts="2027-06-10T10:00:00Z", deposit=False)
    res = await as_owner.patch(f"/v1/bookings/{bid}", json={"status": "no_show"})
    assert res.status_code == 200
    assert res.json()["deposit_status"] == "none"
    assert gateway.charged_methods == []


async def test_no_show_required_deposit_no_default_card_does_not_forfeit(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    # No card on file, so a no-show can't capture the deposit: nothing forfeits, nothing is charged
    await _enable_payments(db)
    nocard = Client(
        id=new_id("client"), business_id=BIZ, name="No Card Nora", tags=[], custom_fields={}
    )
    db.add(nocard)
    await db.flush()
    bid = await _deposit_booking(as_owner, db, starts="2027-06-12T10:00:00Z", client_id=nocard.id)
    res = await as_owner.patch(f"/v1/bookings/{bid}", json={"status": "no_show"})
    assert res.status_code == 200
    assert res.json()["status"] == "no_show"
    assert res.json()["deposit_status"] == "pending"  # nothing to capture → still due
    assert gateway.charged_methods == []  # no card → no off-session charge


async def test_no_show_with_pending_interactive_deposit_does_not_charge(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    # An open interactive deposit means the no-show returns early instead of charging off-session
    await _enable_payments(db)
    bid = await _deposit_booking(as_owner, db, starts="2027-06-13T10:00:00Z")
    opened = await as_owner.post(f"/v1/bookings/{bid}/deposit")  # interactive — no payment_method
    assert opened.status_code == 200
    assert gateway.charged_methods == []  # awaiting client confirmation; nothing charged yet
    pending = (
        await db.execute(
            select(Payment).where(Payment.booking_id == bid, Payment.kind == "deposit")
        )
    ).scalar_one()
    assert pending.status == "pending"  # the open deposit that must short-circuit the forfeit

    res = await as_owner.patch(f"/v1/bookings/{bid}", json={"status": "no_show"})
    assert res.status_code == 200
    assert res.json()["status"] == "no_show"
    assert res.json()["deposit_status"] == "pending"  # left as-is — the open deposit blocks forfeit
    assert gateway.charged_methods == []  # no second, off-session charge


async def test_deposit_settle_redelivery_collects_once_no_second_receipt(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
    email: FakeEmailSender,
) -> None:
    # A new event id for the same intent gets past webhook dedup and must hit the settled guard
    await _enable_payments(db)
    bid = await _deposit_booking(as_owner, db, starts="2027-06-14T10:00:00Z")
    pay = (await as_owner.post(f"/v1/bookings/{bid}/deposit?payment_method_id=default")).json()
    pi_id = await _provider_ref(db, pay["payment_id"])
    await as_owner.post(
        "/webhooks/stripe",
        content=_pi_succeeded("evt_dr1", pi_id),
        headers={"Stripe-Signature": "good"},
    )
    booking = (await db.execute(select(Booking).where(Booking.id == bid))).scalar_one()
    assert booking.deposit_status == "collected"
    receipts = len(email.sent)
    assert receipts >= 1  # the deposit receipt fired on the first settle

    await as_owner.post(
        "/webhooks/stripe",
        content=_pi_succeeded("evt_dr2", pi_id),  # second event id, same payment intent
        headers={"Stripe-Signature": "good"},
    )
    booking = (await db.execute(select(Booking).where(Booking.id == bid))).scalar_one()
    assert booking.deposit_status == "collected"  # still collected, not re-collected
    assert len(email.sent) == receipts  # no second receipt — the settle no-oped
    assert gateway.charged_methods.count(SEEDED_CARD) == 1  # never re-charged


async def test_refund_reverses_collected_deposit(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable_payments(db)
    bid = await _deposit_booking(as_owner, db, starts="2027-06-11T10:00:00Z")
    pay = (await as_owner.post(f"/v1/bookings/{bid}/deposit?payment_method_id=default")).json()
    pi_id = await _provider_ref(db, pay["payment_id"])
    await as_owner.post(
        "/webhooks/stripe",
        content=_pi_succeeded("evt_d3", pi_id),
        headers={"Stripe-Signature": "good"},
    )
    booking = (await db.execute(select(Booking).where(Booking.id == bid))).scalar_one()
    assert booking.deposit_status == "collected"

    refunded = await as_owner.post(f"/v1/payments/{pay['payment_id']}/refund")
    assert refunded.status_code == 200, refunded.text
    booking = (await db.execute(select(Booking).where(Booking.id == bid))).scalar_one()
    assert booking.deposit_status == "refunded"
    refund_row = (
        await db.execute(
            select(Payment).where(
                Payment.parent_payment_id == pay["payment_id"], Payment.kind == "refund"
            )
        )
    ).scalar_one()
    assert refund_row.booking_id == bid


async def _deposit_status(db: AsyncSession, bid: str) -> str:
    return (await db.execute(select(Booking.deposit_status).where(Booking.id == bid))).scalar_one()


async def _collected_deposit(
    api: httpx.AsyncClient, db: AsyncSession, *, starts: str
) -> tuple[str, str]:
    await _enable_payments(db)
    bid = await _deposit_booking(api, db, starts=starts)
    pay = (await api.post(f"/v1/bookings/{bid}/deposit?payment_method_id=default")).json()
    pi_id = await _provider_ref(db, pay["payment_id"])
    await api.post(
        "/webhooks/stripe",
        content=_pi_succeeded(f"evt_{bid}", pi_id),
        headers={"Stripe-Signature": "good"},
    )
    assert await _deposit_status(db, bid) == "collected"
    return bid, str(pay["payment_id"])


async def test_deposit_status_none_when_nothing_is_owed(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid = await _deposit_booking(as_owner, db, starts="2027-07-01T10:00:00Z", deposit=False)
    assert await _deposit_status(db, bid) == "none"


async def test_closing_a_booking_with_a_pending_deposit_clears_it(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    for starts, status in (
        ("2027-07-02T10:00:00Z", "canceled"),
        ("2027-07-03T10:00:00Z", "completed"),
    ):
        bid = await _deposit_booking(as_owner, db, starts=starts)
        assert await _deposit_status(db, bid) == "pending"
        res = await as_owner.patch(f"/v1/bookings/{bid}", json={"status": status})
        assert res.status_code == 200, res.text
        assert res.json()["deposit_status"] == "none"


async def test_canceling_keeps_a_collected_deposit(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid, _ = await _collected_deposit(as_owner, db, starts="2027-07-04T10:00:00Z")
    res = await as_owner.patch(f"/v1/bookings/{bid}", json={"status": "canceled"})
    assert res.json()["deposit_status"] == "collected"  # held until refunded or kept


async def test_partial_deposit_refund_stays_collected_until_the_rest(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid, pay_id = await _collected_deposit(as_owner, db, starts="2027-07-05T10:00:00Z")
    part = await as_owner.post(f"/v1/payments/{pay_id}/refund?amount_cents=500")
    assert part.status_code == 200, part.text
    assert await _deposit_status(db, bid) == "collected"
    booking = (await db.execute(select(Booking).where(Booking.id == bid))).scalar_one()
    assert await ledger.deposit_held(db, booking) == 1500
    assert (await as_owner.post(f"/v1/payments/{pay_id}/refund")).status_code == 200
    assert await _deposit_status(db, bid) == "refunded"
    assert await ledger.deposit_held(db, booking) == 0


async def test_refunding_a_forfeited_deposit_in_full_unforfeits_it(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid, pay_id = await _collected_deposit(as_owner, db, starts="2027-07-06T10:00:00Z")
    await as_owner.patch(f"/v1/bookings/{bid}", json={"status": "no_show"})
    assert await _deposit_status(db, bid) == "forfeited"
    revenue = await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category="revenue")
    res = await as_owner.post(f"/v1/payments/{pay_id}/refund")
    assert res.status_code == 200, res.text
    assert await _deposit_status(db, bid) == "refunded"
    after = await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category="revenue")
    assert after == revenue + 2000  # the forfeited deposit no longer counts as revenue


# far-future so the global scan can't collide with seeded data
NOW = datetime(2030, 1, 1, 0, 0, tzinfo=UTC)


async def _online_booking(
    db: AsyncSession,
    *,
    created_at: datetime,
    deposit_required: bool = True,
    status: str = "confirmed",
    source: str = "online",
) -> tuple[str, str]:
    cid = (
        (await db.execute(select(Client.id).where(Client.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    iid = (
        (await db.execute(select(Item.id).where(Item.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    starts = NOW + timedelta(days=2)
    slot = Slot(
        id=new_id("slot"),
        business_id=BIZ,
        item_id=iid,
        staff_id=ST_OWNER,
        starts_at=starts,
        ends_at=starts + timedelta(hours=1),
        capacity=1,
        status="scheduled",
    )
    db.add(slot)
    await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=BIZ,
        slot_id=slot.id,
        staff_id=ST_OWNER,
        client_id=cid,
        status=status,
        source=source,
        price_cents=11000,
        deposit_amount_cents=2750 if deposit_required else 0,
        created_at=created_at,
    )
    db.add(booking)
    await db.flush()
    db.add(
        Payment(
            id=new_id("payment"),
            business_id=BIZ,
            booking_id=booking.id,
            kind="deposit",
            amount_cents=2750,
            method="card",
            provider="stripe",
            status="pending",
        )
    )
    await db.flush()
    return booking.id, slot.id


async def test_reaps_stale_unpaid_online_booking(db: AsyncSession) -> None:
    bid, sid = await _online_booking(db, created_at=NOW - timedelta(hours=1))
    assert await run_reap_unpaid_bookings(db, NOW) == 1
    booking = (await db.execute(select(Booking).where(Booking.id == bid))).scalar_one()
    assert booking.status == "canceled" and booking.canceled_at == NOW
    slot = (await db.execute(select(Slot).where(Slot.id == sid))).scalar_one()
    assert slot.status == "canceled"  # slot freed
    assert await booked_count(db, sid) == 0


async def test_fresh_unpaid_booking_is_untouched(db: AsyncSession) -> None:
    bid, _ = await _online_booking(db, created_at=NOW - timedelta(minutes=5))  # inside the TTL
    assert await run_reap_unpaid_bookings(db, NOW) == 0
    booking = (await db.execute(select(Booking).where(Booking.id == bid))).scalar_one()
    assert booking.status == "confirmed"


async def test_settled_deposit_is_untouched(db: AsyncSession) -> None:
    bid, _ = await _online_booking(db, created_at=NOW - timedelta(hours=1))
    db.add(
        Payment(
            id=new_id("payment"),
            business_id=BIZ,
            booking_id=bid,
            kind="deposit",
            amount_cents=2750,
            method="card",
            provider="stripe",
            status="succeeded",
        )
    )
    await db.flush()
    assert await run_reap_unpaid_bookings(db, NOW) == 0
    booking = (await db.execute(select(Booking).where(Booking.id == bid))).scalar_one()
    assert booking.status == "confirmed"


async def test_manual_booking_is_untouched(db: AsyncSession) -> None:
    # only online bookings auto-cancel on non-payment; a staff-made booking is left to the provider.
    bid, _ = await _online_booking(db, created_at=NOW - timedelta(hours=1), source="manual")
    assert await run_reap_unpaid_bookings(db, NOW) == 0
    booking = (await db.execute(select(Booking).where(Booking.id == bid))).scalar_one()
    assert booking.status == "confirmed"


async def _booking_at(db: AsyncSession, starts_at: datetime, *, status: str = "confirmed") -> str:
    cid = (
        (await db.execute(select(Client.id).where(Client.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert cid
    await db.execute(update(Client).where(Client.id == cid).values(email="rem@example.ca"))
    iid = (
        (await db.execute(select(Item.id).where(Item.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert iid
    sess = Slot(
        id=new_id("slot"),
        business_id=BIZ,
        item_id=iid,
        staff_id=ST_OWNER,
        starts_at=starts_at,
        ends_at=starts_at + timedelta(hours=1),
        capacity=1,
        status="scheduled",
    )
    db.add(sess)
    await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=BIZ,
        slot_id=sess.id,
        staff_id=ST_OWNER,
        client_id=cid,
        status=status,
        source="manual",
        price_cents=5000,
    )
    db.add(booking)
    await db.flush()
    return booking.id


def _notifier(email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender) -> Notifier:
    return Notifier(email, sms, push)


async def test_reminds_upcoming_booking(
    db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender
) -> None:
    bid = await _booking_at(db, NOW + timedelta(hours=12))
    sent = await run_reminders(db, _notifier(email, sms, push), NOW)
    assert sent == 1
    assert len(email.sent) == 1 and email.sent[0].to == "rem@example.ca"
    bk = (await db.execute(select(Booking).where(Booking.id == bid))).scalar_one()
    assert bk.reminded_at is not None


async def test_skips_booking_outside_window(
    db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender
) -> None:
    await _booking_at(db, NOW + timedelta(hours=48))  # beyond 24h
    assert await run_reminders(db, _notifier(email, sms, push), NOW) == 0
    assert email.sent == []


async def test_reminder_is_deduped(
    db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender
) -> None:
    await _booking_at(db, NOW + timedelta(hours=12))
    notifier = _notifier(email, sms, push)
    assert await run_reminders(db, notifier, NOW) == 1
    assert await run_reminders(db, notifier, NOW) == 0  # reminded_at dedups


async def test_skips_canceled_booking(
    db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender
) -> None:
    await _booking_at(db, NOW + timedelta(hours=12), status="canceled")
    assert await run_reminders(db, _notifier(email, sms, push), NOW) == 0


async def _booking_for(
    db: AsyncSession,
    *,
    business_id: str,
    staff_id: str,
    client_id: str,
    starts_at: datetime,
) -> str:
    item = Item(
        id=new_id("item"),
        business_id=business_id,
        kind="service",
        name="Svc",
        duration_min=30,
    )
    db.add(item)
    await db.flush()
    sess = Slot(
        id=new_id("slot"),
        business_id=business_id,
        item_id=item.id,
        staff_id=staff_id,
        starts_at=starts_at,
        ends_at=starts_at + timedelta(hours=1),
        capacity=1,
        status="scheduled",
    )
    db.add(sess)
    await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=business_id,
        slot_id=sess.id,
        staff_id=staff_id,
        client_id=client_id,
        status="confirmed",
        source="manual",
        price_cents=5000,
    )
    db.add(booking)
    await db.flush()
    return booking.id


async def test_reminder_reaches_client_email_and_sms(
    db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender
) -> None:
    bid = await _booking_at(db, NOW + timedelta(hours=12))
    cid = (await db.execute(select(Booking.client_id).where(Booking.id == bid))).scalar_one()
    await db.execute(update(Client).where(Client.id == cid).values(phone="+15145550000"))
    await db.flush()
    assert await run_reminders(db, _notifier(email, sms, push), NOW) == 1
    assert len(email.sent) == 1 and email.sent[0].to == "rem@example.ca"
    assert len(sms.sent) == 1 and sms.sent[0].to == "+15145550000"
    # a reminder is a client-facing notice (email + SMS) — it does not fan out to staff push
    assert push.sent == []


async def test_global_scan_is_multi_tenant_and_deduped(
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
    factory: Factory,
) -> None:
    await _booking_at(db, NOW + timedelta(hours=12))  # a booking in the seeded business
    other = await factory.business(name="Second Studio")
    staff = await factory.staff(business=other)
    client = await factory.client(business=other)
    client.email = "second@example.ca"
    await db.flush()
    await _booking_for(
        db,
        business_id=other.id,
        staff_id=staff.id,
        client_id=client.id,
        starts_at=NOW + timedelta(hours=12),
    )
    notifier = _notifier(email, sms, push)
    # the cron scan is global (not tenant-scoped): both businesses' bookings are reminded
    assert await run_reminders(db, notifier, NOW) == 2
    assert {m.to for m in email.sent} >= {"rem@example.ca", "second@example.ca"}
    # per-booking dedup (reminded_at) holds across tenants — a second pass reminds nobody
    assert await run_reminders(db, notifier, NOW) == 0
