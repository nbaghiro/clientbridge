from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.errors import TooManyRequests
from clientbridge.core.ids import new_id
from clientbridge.core.ratelimit import RateLimiter, public_booking_rate_limit
from clientbridge.main import app
from clientbridge.models.catalog import Item
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Availability, Booking, Session
from tests.conftest import BIZ, Factory, FakeEmailSender

SLUG = "birchbark"
TZ = ZoneInfo("America/Vancouver")  # the seed business's timezone; hours are local wall-clock
ST_OWNER = "st_owner"  # seeded groomer, recurring Tue-Sat 09:00-17:00
ST_PRIYA = "st_priya"  # seeded staff with no availability rows → unconfigured
GROOM_SM = "it_groom_sm"  # 75-min service, 10-min after-buffer, no deposit
GROOM_LG = "it_groom_lg"  # 120-min service, 25% deposit (price ≥ $100)
SHAMPOO = "it_shampoo"  # product → not online_bookable


def _dt(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _client(name: str = "Web Booker", **kw: str) -> dict[str, str]:
    return {"name": name, **kw}


def _body(
    starts: str, *, item: str = GROOM_SM, staff: str = ST_OWNER, **client: str
) -> dict[str, object]:
    return {
        "item_id": item,
        "staff_id": staff,
        "starts_at": starts,
        "client": _client(**client) if client else _client(email="web@example.com"),
    }


async def _seed_session(db: AsyncSession, *, item: str, staff: str, starts: datetime) -> None:
    item_row = (await db.execute(select(Item).where(Item.id == item))).scalar_one()
    db.add(
        Session(
            id=new_id("session"),
            business_id=BIZ,
            item_id=item,
            staff_id=staff,
            starts_at=starts,
            ends_at=starts + timedelta(minutes=item_row.duration_min or 0),
            capacity=1,
            booked_count=1,
            status="scheduled",
        )
    )
    await db.flush()


async def _enable_payments(db: AsyncSession) -> None:
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_account_id="acct_test", stripe_charges_enabled=True)
    )
    await db.flush()


async def test_services_expose_connected_account_when_onboarded(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    # the public booking page needs the connected account to mount the deposit Elements
    before = (await api.get(f"/book/{SLUG}/services")).json()
    assert before["stripe_account_id"] is None
    await _enable_payments(db)
    after = (await api.get(f"/book/{SLUG}/services")).json()
    assert after["stripe_account_id"] == "acct_test"


async def test_services_lists_only_online_bookable(api: httpx.AsyncClient) -> None:
    res = await api.get(f"/book/{SLUG}/services")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["business_name"] == "Birchbark Pet Studio"
    ids = {s["id"] for s in body["services"]}
    assert GROOM_SM in ids
    assert SHAMPOO not in ids  # a retail product is not online-bookable
    groom = next(s for s in body["services"] if s["id"] == GROOM_LG)
    assert groom["deposit_required"] is True
    assert groom["deposit_amount_cents"] == 2750  # 25% of $110
    assert body["staff"]  # active groomers are listed


async def test_services_bad_slug_404(api: httpx.AsyncClient) -> None:
    assert (await api.get("/book/nope/services")).status_code == 404


async def test_slots_inside_availability(api: httpx.AsyncClient) -> None:
    res = await api.get(
        f"/book/{SLUG}/slots",
        params={"item_id": GROOM_SM, "staff_id": ST_OWNER, "date": "2027-03-02"},
    )
    assert res.status_code == 200, res.text
    slots = res.json()["slots"]
    assert slots
    for slot in slots:
        # windows are local wall-clock, so slots fall in 09:00-17:00 in the business tz, not UTC
        start, end = _dt(slot["starts_at"]).astimezone(TZ), _dt(slot["ends_at"]).astimezone(TZ)
        assert start.time() >= time(9, 0)
        assert end.time() <= time(17, 0)
    # consecutive starts are spaced by duration + buffers (75 + 10), proving buffers fold in
    assert _dt(slots[1]["starts_at"]) - _dt(slots[0]["starts_at"]) == timedelta(minutes=85)


async def test_slots_exclude_overlapping_and_respect_buffer(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    params = {"item_id": GROOM_SM, "staff_id": ST_OWNER, "date": "2027-03-02"}
    before = (await api.get(f"/book/{SLUG}/slots", params=params)).json()["slots"]
    # the 09:00-local opening slot, in UTC via the business tz (robust to the tzdata's DST offset)
    nine = datetime.combine(date(2027, 3, 2), time(9, 0), tzinfo=TZ).astimezone(UTC)
    assert any(_dt(s["starts_at"]) == nine for s in before)
    await _seed_session(db, item=GROOM_SM, staff=ST_OWNER, starts=nine)
    after = (await api.get(f"/book/{SLUG}/slots", params=params)).json()["slots"]
    assert all(_dt(s["starts_at"]) != nine for s in after)  # the taken slot is gone
    assert len(after) == len(before) - 1


async def test_slots_fully_booked_day_is_empty(api: httpx.AsyncClient, db: AsyncSession) -> None:
    db.add(
        Availability(
            id=new_id("availability"),
            business_id=BIZ,
            staff_id=ST_PRIYA,
            type="date",
            date=date(2027, 3, 9),
            start_time=time(9, 0),
            end_time=time(10, 30),  # a single 75-min slot fits
            is_available=True,
        )
    )
    await db.flush()
    params = {"item_id": GROOM_SM, "staff_id": ST_PRIYA, "date": "2027-03-09"}
    assert len((await api.get(f"/book/{SLUG}/slots", params=params)).json()["slots"]) == 1
    await _seed_session(
        db,
        item=GROOM_SM,
        staff=ST_PRIYA,
        starts=datetime.combine(date(2027, 3, 9), time(9, 0), tzinfo=TZ).astimezone(UTC),
    )
    assert (await api.get(f"/book/{SLUG}/slots", params=params)).json()["slots"] == []


async def test_slots_unconfigured_day_is_empty(api: httpx.AsyncClient) -> None:
    # st_priya has no availability on this date → unconfigured → no enumerable slots
    res = await api.get(
        f"/book/{SLUG}/slots",
        params={"item_id": GROOM_SM, "staff_id": ST_PRIYA, "date": "2027-03-02"},
    )
    assert res.status_code == 200
    assert res.json()["slots"] == []


async def test_slots_bad_item_404(api: httpx.AsyncClient) -> None:
    res = await api.get(
        f"/book/{SLUG}/slots",
        params={"item_id": "it_nope", "staff_id": ST_OWNER, "date": "2027-03-02"},
    )
    assert res.status_code == 404


async def test_slots_bad_staff_404(api: httpx.AsyncClient) -> None:
    res = await api.get(
        f"/book/{SLUG}/slots",
        params={"item_id": GROOM_SM, "staff_id": "st_nope", "date": "2027-03-02"},
    )
    assert res.status_code == 404


async def test_slots_bad_date_422(api: httpx.AsyncClient) -> None:
    res = await api.get(
        f"/book/{SLUG}/slots",
        params={"item_id": GROOM_SM, "staff_id": ST_OWNER, "date": "not-a-date"},
    )
    assert res.status_code == 422


async def test_book_creates_online_booking_and_notifies(
    api: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    res = await api.post(
        f"/book/{SLUG}", json=_body("2027-03-02T18:00:00Z", email="lee@example.com")
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["deposit_client_secret"] is None
    booking = (
        await db.execute(select(Booking).where(Booking.id == body["booking_id"]))
    ).scalar_one()
    assert booking.source == "online"
    assert booking.business_id == BIZ
    created = (
        await db.execute(select(Client).where(Client.email == "lee@example.com"))
    ).scalar_one()
    assert created.business_id == BIZ
    assert len(email.sent) == 1  # booking-confirmed to the client


async def test_book_outside_availability_409(api: httpx.AsyncClient) -> None:
    res = await api.post(f"/book/{SLUG}", json=_body("2027-03-02T15:00:00Z"))
    assert res.status_code == 409


async def test_book_taken_slot_409(api: httpx.AsyncClient) -> None:
    body = _body("2027-03-02T18:00:00Z")
    assert (await api.post(f"/book/{SLUG}", json=body)).status_code == 200
    assert (await api.post(f"/book/{SLUG}", json=body)).status_code == 409


async def test_book_non_bookable_item_409(api: httpx.AsyncClient) -> None:
    res = await api.post(f"/book/{SLUG}", json=_body("2027-03-02T18:00:00Z", item=SHAMPOO))
    assert res.status_code == 409


async def test_book_unknown_item_404(api: httpx.AsyncClient) -> None:
    res = await api.post(f"/book/{SLUG}", json=_body("2027-03-02T18:00:00Z", item="it_nope"))
    assert res.status_code == 404


async def test_book_unknown_slug_404(api: httpx.AsyncClient) -> None:
    assert (await api.post("/book/nope", json=_body("2027-03-02T18:00:00Z"))).status_code == 404


async def test_book_requires_contact(api: httpx.AsyncClient) -> None:
    body = {
        "item_id": GROOM_SM,
        "staff_id": ST_OWNER,
        "starts_at": "2027-03-02T18:00:00Z",
        "client": {"name": "No Contact"},
    }
    assert (await api.post(f"/book/{SLUG}", json=body)).status_code == 422


async def test_book_deposit_required_returns_secret(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable_payments(db)
    res = await api.post(f"/book/{SLUG}", json=_body("2027-03-02T17:00:00Z", item=GROOM_LG))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["deposit_client_secret"].startswith("pi_fake")
    booking = (
        await db.execute(select(Booking).where(Booking.id == body["booking_id"]))
    ).scalar_one()
    assert booking.deposit_status == "pending"
    payment = (
        await db.execute(
            select(Payment).where(Payment.booking_id == booking.id, Payment.kind == "deposit")
        )
    ).scalar_one()
    assert payment.status == "pending"
    assert payment.amount_cents == 2750


async def test_book_find_or_create_reuses_client(api: httpx.AsyncClient, db: AsyncSession) -> None:
    first = await api.post(f"/book/{SLUG}", json=_body("2027-03-02T18:00:00Z", email="repeat@x.ca"))
    second = await api.post(
        f"/book/{SLUG}", json=_body("2027-03-02T20:00:00Z", email="repeat@x.ca")
    )
    assert first.status_code == 200 and second.status_code == 200
    b1 = (
        await db.execute(select(Booking).where(Booking.id == first.json()["booking_id"]))
    ).scalar_one()
    b2 = (
        await db.execute(select(Booking).where(Booking.id == second.json()["booking_id"]))
    ).scalar_one()
    assert b1.client_id == b2.client_id  # one client, reused by email
    count = len(
        (await db.execute(select(Client).where(Client.email == "repeat@x.ca"))).scalars().all()
    )
    assert count == 1


async def test_slug_scopes_to_one_business(
    api: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Rival Co")
    rival_item = Item(
        id=new_id("item"),
        business_id=other.id,
        kind="service",
        name="Rival Groom",
        price_cents=5000,
        currency="CAD",
        duration_min=60,
        online_bookable=True,
    )
    db.add(rival_item)
    await db.flush()
    # the rival's page shows only the rival's services, not Birchbark's
    page = (await api.get(f"/book/{other.slug}/services")).json()
    assert page["business_name"] == "Rival Co"
    assert {s["id"] for s in page["services"]} == {rival_item.id}
    # and a foreign item can't be booked through the Birchbark slug
    res = await api.post(f"/book/{SLUG}", json=_body("2027-03-02T18:00:00Z", item=rival_item.id))
    assert res.status_code == 404


async def test_public_booking_is_rate_limited(api: httpx.AsyncClient) -> None:
    rl = RateLimiter(limit=1, window_s=60.0)

    def limited() -> None:
        if not rl.check("x", 0.0):
            raise TooManyRequests("slow down")

    app.dependency_overrides[public_booking_rate_limit] = limited
    assert (await api.get(f"/book/{SLUG}/services")).status_code == 200
    assert (await api.get(f"/book/{SLUG}/services")).status_code == 429
