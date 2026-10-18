import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from tests.helpers import client_id, ok

GROOM = {"description": "Full Groom", "unit_amount_cents": 10000, "tax_class": "federal_only"}


def _sale(percent: int) -> dict[str, object]:
    return {
        "lines": [GROOM],
        "discount": {"kind": "percent", "value": percent, "reason": "Regular"},
    }


async def test_staff_apply_any_discount(as_staff: httpx.AsyncClient) -> None:
    sale = ok(await as_staff.post("/v1/orders", json=_sale(15)), 201).json()
    assert sale["discount_cents"] == 1500
    assert sale["subtotal_cents"] == 8500 and sale["tax_total_cents"] == 425
    deep = ok(
        await as_staff.patch(f"/v1/orders/{sale['id']}", json={"discount": _sale(80)["discount"]})
    ).json()
    assert (deep["discount_cents"], deep["subtotal_cents"]) == (8000, 2000)
    full = ok(await as_staff.post("/v1/orders", json=_sale(100)), 201).json()
    assert (full["discount_cents"], full["total_cents"]) == (10000, 0)


async def test_an_owner_discounts_a_sale(as_owner: httpx.AsyncClient) -> None:
    sale = ok(await as_owner.post("/v1/orders", json=_sale(50)), 201).json()
    assert sale["discount_cents"] == 5000


async def test_discount_validation(as_owner: httpx.AsyncClient) -> None:
    over = await as_owner.post(
        "/v1/orders", json={"lines": [GROOM], "discount": {"kind": "percent", "value": 120}}
    )
    assert over.status_code == 422
    huge = ok(
        await as_owner.post(
            "/v1/orders",
            json={"lines": [{**GROOM, "discount": {"kind": "amount", "value": 99999}}]},
        ),
        201,
    ).json()
    assert huge["lines"][0]["amount_cents"] == 0  # an amount never takes off more than the line


async def test_invoice_and_estimate_discounts_price_after_the_discount(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await client_id(db)
    body = {
        "client_id": cid,
        "lines": [
            {**GROOM, "discount": {"kind": "amount", "value": 1000, "reason": "Late start"}},
            {"description": "Brush", "unit_amount_cents": 3000, "tax_class": "standard"},
        ],
        "discount": {"kind": "percent", "value": 10, "reason": "Loyalty"},
    }
    inv = ok(await as_owner.post("/v1/invoices", json=body), 201).json()
    assert [ln["amount_cents"] for ln in inv["lines"]] == [8100, 2700]
    assert inv["discount_cents"] == 2200
    assert inv["discount"] == {"kind": "percent", "value": 10, "reason": "Loyalty"}
    assert inv["subtotal_cents"] == 10800
    assert inv["tax_total_cents"] == 405 + 135 + 189
    no_sale = ok(await as_owner.patch(f"/v1/invoices/{inv['id']}", json={"discount": None})).json()
    assert no_sale["subtotal_cents"] == 12000
    est = ok(await as_owner.post("/v1/estimates", json={**body, "send": True}), 201).json()
    assert est["subtotal_cents"] == 10800
    converted = ok(
        await as_owner.post(
            f"/v1/estimates/{est['id']}/convert", headers={"Idempotency-Key": "cv"}
        ),
        201,
    ).json()
    assert converted["subtotal_cents"] == 10800
    assert converted["discount"]["reason"] == "Loyalty"


async def test_the_pay_link_shows_discounts(
    as_owner: httpx.AsyncClient, unauth: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await client_id(db)
    inv = ok(
        await as_owner.post(
            "/v1/invoices",
            json={
                "client_id": cid,
                "lines": [{**GROOM, "discount": {"kind": "percent", "value": 10, "reason": "New"}}],
                "discount": {"kind": "amount", "value": 500, "reason": "Wait"},
                "send": True,
            },
        ),
        201,
    ).json()
    page = ok(await unauth.get(f"/pay/{inv['pay_token']}")).json()
    assert page["lines"][0]["amount_cents"] == 9000
    assert page["lines"][0]["discount_cents"] == 1000
    assert (page["discount_cents"], page["discount_reason"]) == (500, "Wait")
    assert page["subtotal_cents"] == 8500

