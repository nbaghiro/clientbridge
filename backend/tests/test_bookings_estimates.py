import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.billing import Estimate, Line
from clientbridge.models.catalog import Item
from clientbridge.models.scheduling import Addon
from tests.conftest import BIZ
from tests.helpers import client_id, new_client

ST_OWNER = "st_owner"


async def _service(db: AsyncSession) -> str:
    item = await db.scalar(
        select(Item.id).where(Item.kind == "service", Item.duration_min.isnot(None)).limit(1)
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
    assert first.status_code == 201 and again.json()["id"] == first.json()["id"]
    assert await _addons(db, first.json()["id"]) == [("it_shampoo", 2, 1800)]


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
