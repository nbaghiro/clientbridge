import json
from datetime import UTC, date, datetime, time

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.catalog import Item
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Availability, Booking, Session
from tests.conftest import BIZ, Factory, FakeEmailSender, FakePaymentGateway

ST_OWNER = "st_owner"
ST_PRIYA = "st_priya"  # seeded staff with no availability rows → unconfigured


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
    body = _body(client_id, item_id, "2027-03-02T10:00:00Z")
    assert (await as_owner.post("/v1/bookings", json=body)).status_code == 201
    assert (await as_owner.post("/v1/bookings", json=body)).status_code == 409


async def test_cancel_frees_the_slot(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, item_id = await _client_and_item(db)
    body = _body(client_id, item_id, "2027-03-03T10:00:00Z")
    bid = (await as_owner.post("/v1/bookings", json=body)).json()["id"]
    canceled = await as_owner.patch(f"/v1/bookings/{bid}", json={"status": "canceled"})
    assert canceled.status_code == 200
    assert canceled.json()["status"] == "canceled"
    assert (await as_owner.post("/v1/bookings", json=body)).status_code == 201


async def test_reschedule_moves_session(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, item_id = await _client_and_item(db)
    created = await as_owner.post(
        "/v1/bookings", json=_body(client_id, item_id, "2027-03-04T10:00:00Z")
    )
    bid = created.json()["id"]
    moved = await as_owner.patch(f"/v1/bookings/{bid}", json={"starts_at": "2027-03-04T14:00:00Z"})
    assert moved.status_code == 200
    assert moved.json()["starts_at"].startswith("2027-03-04T14:00")


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
        "/v1/bookings", json=_body(client_id, item_id, "2027-04-01T10:00:00Z")
    )
    await as_owner.post("/v1/bookings", json=_body(client_id, item_id, "2027-04-01T14:00:00Z"))
    moved = await as_owner.patch(
        f"/v1/bookings/{first.json()['id']}", json={"starts_at": "2027-04-01T14:00:00Z"}
    )
    assert moved.status_code == 409


async def test_double_cancel_is_idempotent(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, item_id = await _client_and_item(db)
    bid = (
        await as_owner.post("/v1/bookings", json=_body(client_id, item_id, "2027-04-02T10:00:00Z"))
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
        "/v1/bookings", json=_body(client_id, "it_groom_sm", "2027-03-02T10:00:00Z")
    )
    assert first.status_code == 201
    # 11:15 butts against the prior booking inside its 10-min after-buffer.
    second = await as_owner.post(
        "/v1/bookings", json=_body(client_id, "it_groom_sm", "2027-03-02T11:15:00Z")
    )
    assert second.status_code == 409


async def test_booking_outside_buffer_ok(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, _ = await _client_and_item(db)
    first = await as_owner.post(
        "/v1/bookings", json=_body(client_id, "it_groom_sm", "2027-03-02T10:00:00Z")
    )
    assert first.status_code == 201
    # 11:25 clears the 10-min buffer after the 11:15 end.
    second = await as_owner.post(
        "/v1/bookings", json=_body(client_id, "it_groom_sm", "2027-03-02T11:25:00Z")
    )
    assert second.status_code == 201


async def test_unconfigured_availability_allows_any_time(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    # st_priya has no availability rows → unconfigured → even an off-hours slot is allowed.
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
        Availability(
            id=new_id("availability"),
            business_id=BIZ,
            staff_id=ST_PRIYA,
            type="date",
            date=date(2027, 9, 15),
            start_time=time(9, 0),
            end_time=time(17, 0),
            is_available=True,
        )
    )
    await db.flush()
    inside = await as_owner.post(
        "/v1/bookings", json=_body(client_id, item_id, "2027-09-15T12:00:00Z", ST_PRIYA)
    )
    assert inside.status_code == 201
    outside = await as_owner.post(
        "/v1/bookings", json=_body(client_id, item_id, "2027-09-15T20:00:00Z", ST_PRIYA)
    )
    assert outside.status_code == 409


async def test_availability_closure_blocks_booking(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    client_id, item_id = await _client_and_item(db)
    db.add(
        Availability(
            id=new_id("availability"),
            business_id=BIZ,
            staff_id=ST_PRIYA,
            type="date",
            date=date(2027, 9, 16),
            is_available=False,  # all-day closure
        )
    )
    await db.flush()
    res = await as_owner.post(
        "/v1/bookings", json=_body(client_id, item_id, "2027-09-16T12:00:00Z", ST_PRIYA)
    )
    assert res.status_code == 409


async def test_class_bookings_share_session_until_full(
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
    body = _body(client_id, cls.id, "2027-03-02T10:00:00Z", ST_PRIYA)
    first = await as_owner.post("/v1/bookings", json=body)
    second = await as_owner.post("/v1/bookings", json=body)
    third = await as_owner.post("/v1/bookings", json=body)
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["session_id"] == second.json()["session_id"]  # one shared session
    assert third.status_code == 409  # capacity 2 exhausted
    sess = (
        await db.execute(select(Session).where(Session.id == first.json()["session_id"]))
    ).scalar_one()
    assert sess.capacity == 2
    assert sess.booked_count == 2


async def test_non_class_item_mints_single_capacity_session(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    client_id, item_id = await _client_and_item(db)
    res = await as_owner.post(
        "/v1/bookings", json=_body(client_id, item_id, "2027-03-02T09:00:00Z")
    )
    assert res.status_code == 201
    sess = (
        await db.execute(select(Session).where(Session.id == res.json()["session_id"]))
    ).scalar_one()
    assert sess.capacity == 1
    assert sess.booked_count == 1


async def test_foreign_business_session_does_not_block(
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
        Session(
            id=new_id("session"),
            business_id=other.id,
            item_id=other_item.id,
            staff_id=other_staff.id,
            starts_at=datetime(2027, 3, 2, 10, 0, tzinfo=UTC),
            ends_at=datetime(2027, 3, 2, 11, 15, tzinfo=UTC),
            capacity=1,
            booked_count=1,
            status="scheduled",
        )
    )
    await db.flush()
    # our owner books the same slot; the cross-tenant session must not block (scoped by business).
    res = await as_owner.post(
        "/v1/bookings", json=_body(client_id, "it_groom_sm", "2027-03-02T10:00:00Z")
    )
    assert res.status_code == 201


# ── deposits ──────────────────────────────────────────────────────────────────────────────────
CL_AMELIE = "cl_amelie"  # seeded client with email + phone + granted sms consent
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
    res = await api.post("/v1/bookings", json=_body(client_id, item.id, starts))
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


async def test_collect_deposit_foreign_booking_404(
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
    session = Session(
        id=new_id("session"),
        business_id=other.id,
        item_id=item.id,
        staff_id=other_staff.id,
        starts_at=datetime(2027, 6, 7, 10, 0, tzinfo=UTC),
        ends_at=datetime(2027, 6, 7, 11, 0, tzinfo=UTC),
        capacity=1,
        booked_count=1,
        status="scheduled",
    )
    db.add(session)
    await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=other.id,
        session_id=session.id,
        staff_id=other_staff.id,
        client_id=foreign_client.id,
        status="confirmed",
        source="manual",
        price_cents=12000,
        deposit_required=True,
        deposit_amount_cents=2000,
    )
    db.add(booking)
    await db.flush()
    res = await as_owner.post(f"/v1/bookings/{booking.id}/deposit")
    assert res.status_code == 404  # scoped to the caller's business


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
    assert res.json()["deposit_status"] == "forfeited"
    assert gateway.charged_methods.count(SEEDED_CARD) == 1
    charged = (
        await db.execute(
            select(Payment).where(Payment.booking_id == bid, Payment.kind == "deposit")
        )
    ).scalar_one()
    assert charged.amount_cents == 2000
    # idempotent — repeat no_show never double-charges
    await as_owner.patch(f"/v1/bookings/{bid}", json={"status": "no_show"})
    assert gateway.charged_methods.count(SEEDED_CARD) == 1


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
    # Deposit is required but the client has NO card on file → off-session capture is impossible,
    # so the no-show must NOT forfeit and must charge nothing (the pm_ref-None early return).
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
    assert res.json()["deposit_status"] != "forfeited"  # nothing to capture → left untouched
    assert res.json()["deposit_status"] == "none"
    assert gateway.charged_methods == []  # no card → no off-session charge


async def test_no_show_with_pending_interactive_deposit_does_not_charge(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    # An interactive deposit is still pending (an open deposit Payment exists, awaiting client
    # confirmation) → the no-show must early-return on the open deposit, not an off-session charge.
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
    # A redelivered deposit settle (same intent, a NEW event id so the WebhookEvent dedup doesn't
    # mask it) must hit the payment-already-settled guard: collected once, no second receipt.
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
    assert booking.deposit_status == "none"  # no longer collected
    refund_row = (
        await db.execute(
            select(Payment).where(
                Payment.parent_payment_id == pay["payment_id"], Payment.kind == "refund"
            )
        )
    ).scalar_one()
    assert refund_row.booking_id == bid
