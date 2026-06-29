"""Catalog (items) endpoints + the business tax-rates list, against the seeded DB."""

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.catalog import Item
from tests.conftest import Factory

BIZ = "bz_birchbark"


async def test_list_items_is_business_scoped(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.get("/v1/items", params={"limit": 5})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] > 0
    assert all(i["business_id"] == BIZ for i in body["items"])


async def test_create_get_update_deactivate(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
        "/v1/items",
        json={"kind": "service", "name": "Nail trim", "price_cents": 2500, "duration_min": 20},
    )
    assert res.status_code == 201, res.text
    item = res.json()
    iid = item["id"]
    assert iid.startswith("it_")
    assert item["business_id"] == BIZ
    assert item["price_cents"] == 2500
    assert item["active"] is True

    res = await as_owner.get(f"/v1/items/{iid}")
    assert res.status_code == 200
    assert res.json()["name"] == "Nail trim"

    res = await as_owner.patch(f"/v1/items/{iid}", json={"price_cents": 3000})
    assert res.status_code == 200
    assert res.json()["price_cents"] == 3000

    # delete = deactivate (items are referenced; not hard-removed)
    res = await as_owner.delete(f"/v1/items/{iid}")
    assert res.status_code == 204
    res = await as_owner.get(f"/v1/items/{iid}")
    assert res.status_code == 200
    assert res.json()["active"] is False


async def test_get_unknown_item_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.get("/v1/items/it_nope")
    assert res.status_code == 404


async def test_foreign_item_404_by_scoping(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    # a REAL item in another tenant — every read/write 404s by scoping, and the row stays untouched
    other = await factory.business()
    item = Item(
        id=new_id("item"),
        business_id=other.id,
        kind="service",
        name="Foreign Svc",
        price_cents=1000,
    )
    db.add(item)
    await db.flush()

    assert (await as_owner.get(f"/v1/items/{item.id}")).status_code == 404
    assert (
        await as_owner.patch(f"/v1/items/{item.id}", json={"price_cents": 9999})
    ).status_code == 404
    assert (await as_owner.delete(f"/v1/items/{item.id}")).status_code == 404

    after = await db.get(Item, item.id)
    assert after is not None
    assert after.price_cents == 1000 and after.active is True  # no cross-tenant mutation leaked


async def test_tax_rates_list(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.get("/v1/tax-rates")
    assert res.status_code == 200, res.text
    rates = res.json()
    assert len(rates) >= 1
    assert {r["jurisdiction"] for r in rates} <= {"GST", "HST", "PST", "QST"}
    assert all(r["rate_bps"] > 0 for r in rates)


async def test_staff_cannot_write_catalog(as_staff: httpx.AsyncClient) -> None:
    res = await as_staff.post(
        "/v1/items", json={"kind": "service", "name": "x", "price_cents": 100}
    )
    assert res.status_code == 403


async def test_unauth_cannot_list_items(unauth: httpx.AsyncClient) -> None:
    res = await unauth.get("/v1/items")
    assert res.status_code == 401


async def test_invalid_kind_is_422(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/items", json={"kind": "widget", "name": "x"})
    assert res.status_code == 422


async def test_negative_price_is_422(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
        "/v1/items", json={"kind": "service", "name": "x", "price_cents": -100}
    )
    assert res.status_code == 422


async def test_empty_name_is_422(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/items", json={"kind": "service", "name": "", "price_cents": 0})
    assert res.status_code == 422
