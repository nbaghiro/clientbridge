"""Catalog (items) endpoints + the business tax-rates list, against the seeded DB."""

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.catalog import Item
from tests.conftest import Factory

BIZ = "bz_birchbark"


async def test_create_update_deactivate(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
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

    res = await as_owner.patch(f"/v1/items/{iid}", json={"price_cents": 3000})
    assert res.status_code == 200
    assert res.json()["price_cents"] == 3000

    # items are referenced by lines, so they are deactivated rather than removed
    res = await as_owner.patch(f"/v1/items/{iid}", json={"active": False})
    assert res.status_code == 200
    row = await db.get(Item, iid, populate_existing=True)
    assert row is not None and row.active is False and row.name == "Nail trim"


async def test_update_unknown_item_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.patch("/v1/items/it_nope", json={"price_cents": 100})
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

    assert (
        await as_owner.patch(f"/v1/items/{item.id}", json={"price_cents": 9999})
    ).status_code == 404
    assert (await as_owner.patch(f"/v1/items/{item.id}", json={"active": False})).status_code == 404

    after = await db.get(Item, item.id)
    assert after is not None
    assert after.price_cents == 1000 and after.active is True  # no cross-tenant mutation leaked
    restock = await as_owner.post(f"/v1/items/{item.id}/restock", json={"quantity": 5})
    assert restock.status_code == 404


async def test_tax_rates_list(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.get("/v1/tax-rates")
    assert res.status_code == 200, res.text
    rates = res.json()
    assert len(rates) >= 1
    assert {r["jurisdiction"] for r in rates} <= {"GST", "HST", "PST", "QST"}
    assert all(r["rate_bps"] > 0 for r in rates)
    # the derived rate carries a populated synthetic id (province_jurisdiction) + province
    assert all(r["id"] == f"{r['province']}_{r['jurisdiction']}" for r in rates)


async def test_staff_cannot_write_catalog(as_staff: httpx.AsyncClient) -> None:
    res = await as_staff.post(
        "/v1/items", json={"kind": "service", "name": "x", "price_cents": 100}
    )
    assert res.status_code == 403


async def test_staff_cannot_deactivate_an_item_403(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    res = await as_staff.patch("/v1/items/it_shampoo", json={"active": False})
    assert res.status_code == 403
    row = await db.get(Item, "it_shampoo", populate_existing=True)
    assert row is not None and row.active is True


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("POST", "/v1/items", {"kind": "service", "name": "x", "price_cents": 100}),
        ("PATCH", "/v1/items/it_shampoo", {"active": False}),
        ("POST", "/v1/items/tax-class", {"item_ids": ["it_shampoo"], "tax_class": "exempt"}),
        ("POST", "/v1/items/it_shampoo/restock", {"quantity": 5}),
    ],
)
async def test_unauth_401(
    unauth: httpx.AsyncClient, method: str, path: str, body: dict[str, object]
) -> None:
    assert (await unauth.request(method, path, json=body)).status_code == 401


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


async def _item(api: httpx.AsyncClient, name: str) -> str:
    res = await api.post("/v1/items", json={"kind": "service", "name": name, "price_cents": 1000})
    return str(res.json()["id"])


async def test_bulk_tax_class_is_audited_and_idempotent(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    ids = [await _item(as_owner, "A"), await _item(as_owner, "B")]
    body = {"item_ids": ids, "tax_class": "federal_only"}
    headers = {"Idempotency-Key": "tax-class-1"}
    first = await as_owner.post("/v1/items/tax-class", json=body, headers=headers)
    assert first.status_code == 200, first.text
    assert first.json() == {"count": 2}
    again = await as_owner.post("/v1/items/tax-class", json=body, headers=headers)
    assert again.json() == {"count": 2}
    classes = (
        await db.execute(
            text("SELECT DISTINCT tax_class FROM items WHERE id = ANY(:i)"), {"i": ids}
        )
    ).scalars()
    assert list(classes) == ["federal_only"]
    audits = await db.scalar(
        text("SELECT count(*) FROM audits WHERE action = 'item.tax_class' AND entity_id = ANY(:i)"),
        {"i": ids},
    )
    assert audits == 2


async def test_bulk_tax_class_guards(
    as_owner: httpx.AsyncClient, factory: Factory, db: AsyncSession
) -> None:
    other = await factory.business()
    foreign = Item(id=new_id("item"), business_id=other.id, kind="service", name="Theirs")
    db.add(foreign)
    await db.flush()
    for ids, status in (([foreign.id], 404), (["it_nope"], 404), ([], 422)):
        res = await as_owner.post(
            "/v1/items/tax-class", json={"item_ids": ids, "tax_class": "exempt"}
        )
        assert res.status_code == status, ids


async def test_staff_cannot_bulk_change_tax_class_403(as_staff: httpx.AsyncClient) -> None:
    res = await as_staff.post(
        "/v1/items/tax-class", json={"item_ids": ["it_nope"], "tax_class": "exempt"}
    )
    assert res.status_code == 403
