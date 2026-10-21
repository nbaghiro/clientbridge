import httpx
import pytest
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.ids import new_id
from clientbridge.models.billing import Estimate, Invoice, Line
from clientbridge.models.catalog import Item
from clientbridge.models.scheduling import Addon, Booking
from tests.conftest import BIZ, STAFF_USER, Factory, FakeIdentityProvider, session_token
from tests.helpers import client_id, key, new_client, ok

ST_OWNER = "st_owner"


async def _service(db: AsyncSession) -> str:
    item = await db.scalar(
        select(Item.id)
        .where(Item.business_id == BIZ, Item.kind == "service", Item.duration_min.isnot(None))
        .order_by(Item.id)
        .limit(1)
    )
    assert item is not None
    return item


async def _accepted(api: httpx.AsyncClient, cid: str) -> str:
    lines = [
        {
            "description": "Shampoo, 2 bottles",
            "quantity": 2,
            "unit_amount_cents": 1800,
            "item_id": "it_shampoo",
        },
        {"description": "Labour", "quantity": 3.5, "unit_amount_cents": 9000},
        {
            "description": "Brush upgrade",
            "quantity": 1,
            "unit_amount_cents": 2400,
            "item_id": "it_brush",
            "optional": True,
        },
        {
            "description": "Groom",
            "quantity": 1,
            "unit_amount_cents": 6000,
            "item_id": "it_groom_sm",
        },
    ]
    est = await api.post("/v1/estimates", json={"client_id": cid, "lines": lines, "send": True})
    assert est.status_code == 201, est.text
    eid = str(est.json()["id"])
    assert (await api.post(f"/v1/estimates/{eid}/accept")).status_code == 200
    return eid


def _body(cid: str, iid: str, starts: str, **extra: object) -> dict[str, object]:
    return {"client_id": cid, "item_id": iid, "staff_id": ST_OWNER, "starts_at": starts, **extra}


async def _addons(db: AsyncSession, booking_id: str) -> list[tuple[str, int, int]]:
    rows = await db.scalars(select(Addon).where(Addon.booking_id == booking_id))
    return sorted((a.item_id, a.quantity, a.unit_amount_cents) for a in rows.all())


async def test_booking_an_accepted_estimate_adds_its_chosen_products(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await client_id(db)
    eid = await _accepted(as_owner, cid)
    await db.execute(
        update(Line)
        .where(Line.estimate_id == eid, Line.item_id == "it_brush")
        .values(selected=True)
    )
    await db.flush()
    res = await as_owner.post(
        "/v1/bookings", json=_body(cid, await _service(db), "2027-03-01T17:00:00Z", estimate_id=eid)
    )
    assert res.status_code == 201, res.text
    assert await _addons(db, res.json()["id"]) == [("it_brush", 1, 2400), ("it_shampoo", 2, 1800)]


async def test_an_unticked_optional_line_stays_off_the_visit(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await client_id(db)
    eid = await _accepted(as_owner, cid)
    res = await as_owner.post(
        "/v1/bookings", json=_body(cid, await _service(db), "2027-03-02T17:00:00Z", estimate_id=eid)
    )
    assert res.status_code == 201, res.text
    assert await _addons(db, res.json()["id"]) == [("it_shampoo", 2, 1800)]


async def test_replaying_the_booking_adds_the_products_once(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await client_id(db)
    eid = await _accepted(as_owner, cid)
    body = _body(cid, await _service(db), "2027-03-03T17:00:00Z", estimate_id=eid)
    headers = {"Idempotency-Key": "book-the-install"}
    first = await as_owner.post("/v1/bookings", json=body, headers=headers)
    again = await as_owner.post("/v1/bookings", json=body, headers=headers)
    assert first.status_code == 201 and again.status_code == 201
    assert again.json()["id"] == first.json()["id"]
    assert again.json()["estimate_id"] == eid
    assert await _addons(db, first.json()["id"]) == [("it_shampoo", 2, 1800)]
    other = await as_owner.post("/v1/bookings", json=body, headers={"Idempotency-Key": "twice"})
    assert other.status_code == 409 and other.json()["error"] == "estimate_booked"


async def test_staff_cannot_book_from_an_estimate_403(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await client_id(db)
    db.add(Estimate(id="es_staff", business_id=BIZ, client_id=cid, status="accepted"))
    await db.flush()
    body = _body(cid, await _service(db), "2027-03-04T17:00:00Z", estimate_id="es_staff")
    res = await as_staff.post("/v1/bookings", json={**body, "staff_id": "st_diego"})
    assert res.status_code == 403


async def test_an_estimate_for_another_client_422_or_unknown_404(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await client_id(db)
    eid = await _accepted(as_owner, cid)
    other = await new_client(db)
    iid = await _service(db)
    res = await as_owner.post(
        "/v1/bookings", json=_body(other, iid, "2027-03-05T17:00:00Z", estimate_id=eid)
    )
    assert res.status_code == 422
    missing = await as_owner.post(
        "/v1/bookings", json=_body(cid, iid, "2027-03-05T17:00:00Z", estimate_id="es_missing")
    )
    assert missing.status_code == 404


@pytest.mark.parametrize("state", ["draft", "converted"])
async def test_an_estimate_not_accepted_or_already_invoiced_409(
    as_owner: httpx.AsyncClient, db: AsyncSession, state: str
) -> None:
    cid = await client_id(db)
    eid = await _accepted(as_owner, cid)
    if state == "draft":
        await db.execute(update(Estimate).where(Estimate.id == eid).values(status="draft"))
        await db.flush()
    else:
        assert (await as_owner.post(f"/v1/estimates/{eid}/convert")).status_code == 201
    res = await as_owner.post(
        "/v1/bookings", json=_body(cid, await _service(db), "2027-03-08T17:00:00Z", estimate_id=eid)
    )
    assert res.status_code == 409


async def test_the_booking_records_its_estimate(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await client_id(db)
    eid = await _accepted(as_owner, cid)
    res = await as_owner.post(
        "/v1/bookings", json=_body(cid, await _service(db), "2027-03-09T17:00:00Z", estimate_id=eid)
    )
    assert res.status_code == 201, res.text
    assert res.json()["estimate_id"] == eid
    stored = await db.scalar(select(Booking.estimate_id).where(Booking.id == res.json()["id"]))
    assert stored == eid


async def test_a_plain_booking_has_no_estimate(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await client_id(db)
    res = await as_owner.post(
        "/v1/bookings", json=_body(cid, await _service(db), "2027-03-10T17:00:00Z")
    )
    assert res.status_code == 201, res.text
    assert res.json()["estimate_id"] is None


async def test_a_booked_estimate_cannot_be_booked_again_409(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await client_id(db)
    eid = await _accepted(as_owner, cid)
    iid = await _service(db)
    first = await as_owner.post(
        "/v1/bookings", json=_body(cid, iid, "2027-03-11T17:00:00Z", estimate_id=eid)
    )
    assert first.status_code == 201, first.text
    second = await as_owner.post(
        "/v1/bookings", json=_body(cid, iid, "2027-03-12T17:00:00Z", estimate_id=eid)
    )
    assert second.status_code == 409
    assert second.json()["error"] == "estimate_booked"
    booked = await db.scalars(select(Booking.id).where(Booking.estimate_id == eid))
    assert booked.all() == [first.json()["id"]]


async def test_a_canceled_booking_frees_the_estimate(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await client_id(db)
    eid = await _accepted(as_owner, cid)
    iid = await _service(db)
    first = await as_owner.post(
        "/v1/bookings", json=_body(cid, iid, "2027-03-15T17:00:00Z", estimate_id=eid)
    )
    bid = first.json()["id"]
    canceled = await as_owner.patch(f"/v1/bookings/{bid}", json={"status": "canceled"})
    assert canceled.status_code == 200, canceled.text
    again = await as_owner.post(
        "/v1/bookings", json=_body(cid, iid, "2027-03-16T17:00:00Z", estimate_id=eid)
    )
    assert again.status_code == 201, again.text
    assert again.json()["estimate_id"] == eid
    assert await _addons(db, again.json()["id"]) == [("it_shampoo", 2, 1800)]


async def test_a_deleted_booking_frees_the_estimate(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await client_id(db)
    eid = await _accepted(as_owner, cid)
    iid = await _service(db)
    first = await as_owner.post(
        "/v1/bookings", json=_body(cid, iid, "2027-03-17T17:00:00Z", estimate_id=eid)
    )
    await db.execute(
        update(Booking).where(Booking.id == first.json()["id"]).values(deleted_at=clock.now())
    )
    await db.flush()
    again = await as_owner.post(
        "/v1/bookings", json=_body(cid, iid, "2027-03-18T17:00:00Z", estimate_id=eid)
    )
    assert again.status_code == 201, again.text


async def test_another_business_estimate_404_and_its_bookings_do_not_count(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    cid = await client_id(db)
    iid = await _service(db)
    other = await factory.business(name="Rival Co")
    foreign = await factory.client(business=other)
    db.add(Estimate(id="es_rival", business_id=other.id, client_id=foreign.id, status="accepted"))
    await db.flush()
    res = await as_owner.post(
        "/v1/bookings", json=_body(cid, iid, "2027-03-19T17:00:00Z", estimate_id="es_rival")
    )
    assert res.status_code == 404
    eid = await _accepted(as_owner, cid)
    slot = await db.scalar(
        select(Booking.slot_id).where(Booking.business_id == BIZ).order_by(Booking.id).limit(1)
    )
    assert slot is not None
    db.add(
        Booking(
            id="bk_rival",
            business_id=other.id,
            slot_id=slot,
            starts_at=clock.now(),
            client_id=foreign.id,
            estimate_id=eid,
            status="confirmed",
        )
    )
    await db.flush()
    mine = await as_owner.post(
        "/v1/bookings", json=_body(cid, iid, "2027-03-22T17:00:00Z", estimate_id=eid)
    )
    assert mine.status_code == 201, mine.text


async def _booked(as_owner: httpx.AsyncClient, db: AsyncSession, starts: str) -> tuple[str, str]:
    cid = await client_id(db)
    eid = await _accepted(as_owner, cid)
    res = await as_owner.post(
        "/v1/bookings", json=_body(cid, await _service(db), starts, estimate_id=eid)
    )
    assert res.status_code == 201, res.text
    return eid, str(res.json()["id"])


async def _invoices(db: AsyncSession) -> int:
    return int(await db.scalar(select(func.count(Invoice.id))) or 0)


async def test_an_estimate_with_a_booked_visit_is_not_converted(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    eid, _ = await _booked(as_owner, db, "2027-03-15T17:00:00Z")
    before = await _invoices(db)
    res = await as_owner.post(f"/v1/estimates/{eid}/convert", headers=key())
    assert res.status_code == 409 and res.json()["error"] == "estimate_on_visit"
    assert await _invoices(db) == before
    estimate = await db.get(Estimate, eid, populate_existing=True)
    assert estimate is not None and estimate.converted_invoice_id is None


async def test_cancelling_the_visit_lets_the_estimate_convert(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    eid, bid = await _booked(as_owner, db, "2027-03-16T17:00:00Z")
    headers = key()
    refused = await as_owner.post(f"/v1/estimates/{eid}/convert", headers=headers)
    assert refused.status_code == 409
    ok(await as_owner.patch(f"/v1/bookings/{bid}", json={"status": "canceled"}))
    converted = ok(await as_owner.post(f"/v1/estimates/{eid}/convert", headers=headers), 201)
    again = ok(await as_owner.post(f"/v1/estimates/{eid}/convert", headers=headers), 201)
    assert again.json()["id"] == converted.json()["id"]
    rebook = await as_owner.post(
        "/v1/bookings",
        json=_body(
            await client_id(db), await _service(db), "2027-03-17T17:00:00Z", estimate_id=eid
        ),
    )
    assert rebook.status_code == 409


async def test_a_completed_visit_still_holds_the_estimate(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    eid, bid = await _booked(as_owner, db, "2027-03-18T17:00:00Z")
    await db.execute(
        update(Booking)
        .where(Booking.id == bid)
        .values(status="completed", completed_at=clock.now())
    )
    res = await as_owner.post(f"/v1/estimates/{eid}/convert")
    assert res.status_code == 409 and res.json()["error"] == "estimate_on_visit"


async def test_a_deleted_visit_no_longer_holds_the_estimate(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    eid, bid = await _booked(as_owner, db, "2027-03-19T17:00:00Z")
    await db.execute(update(Booking).where(Booking.id == bid).values(deleted_at=clock.now()))
    ok(await as_owner.post(f"/v1/estimates/{eid}/convert"), 201)


async def test_another_business_booking_does_not_hold_the_estimate(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    eid, bid = await _booked(as_owner, db, "2027-03-20T17:00:00Z")
    other = await factory.business(name="Other Studio")
    await db.execute(update(Booking).where(Booking.id == bid).values(business_id=other.id))
    ok(await as_owner.post(f"/v1/estimates/{eid}/convert"), 201)


async def test_staff_and_strangers_cannot_convert_a_booked_estimate(
    as_owner: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    eid, _ = await _booked(as_owner, db, "2027-03-21T17:00:00Z")
    missing = await as_owner.post(f"/v1/estimates/{new_id('estimate')}/convert")
    assert missing.status_code == 404
    as_owner.headers["X-Session-Token"] = await session_token(identities, db, STAFF_USER)
    assert (await as_owner.post(f"/v1/estimates/{eid}/convert")).status_code == 403
    del as_owner.headers["X-Session-Token"]
    assert (await as_owner.post(f"/v1/estimates/{eid}/convert")).status_code == 401
