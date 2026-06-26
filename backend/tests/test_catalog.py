"""Catalog (items) endpoints + the business tax-rates list, against the seeded DB."""

import httpx

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


async def test_tax_rates_list(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.get("/v1/tax-rates")
    assert res.status_code == 200, res.text
    rates = res.json()
    assert len(rates) >= 1
    assert {r["jurisdiction"] for r in rates} <= {"GST", "HST", "PST", "QST"}
    assert all(r["rate_bps"] > 0 for r in rates)
