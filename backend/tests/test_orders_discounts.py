import httpx
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.security import hash_password
from clientbridge.models.business import Business, User
from tests.helpers import client_id, ok

BIZ = "bz_birchbark"
GROOM = {"description": "Full Groom", "unit_amount_cents": 10000, "tax_class": "federal_only"}


def _sale(percent: int, pin: str | None = None) -> dict[str, object]:
    body: dict[str, object] = {
        "lines": [GROOM],
        "discount": {"kind": "percent", "value": percent, "reason": "Regular"},
    }
    if pin is not None:
        body["approval_pin"] = pin
    return body


async def _owner_pin(db: AsyncSession, pin: str = "4321") -> None:
    await db.execute(update(User).where(User.id == "us_dev").values(pin_hash=hash_password(pin)))
    await db.flush()


async def test_staff_discount_within_the_limit_needs_no_approval(
    as_staff: httpx.AsyncClient,
) -> None:
    sale = ok(await as_staff.post("/v1/orders", json=_sale(15)), 201).json()
    assert (sale["discount_cents"], sale["approved_by"]) == (1500, None)
    assert sale["subtotal_cents"] == 8500 and sale["tax_total_cents"] == 425


async def test_staff_over_the_limit_needs_an_owner_pin(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    refused = await as_staff.post("/v1/orders", json=_sale(20))
    assert refused.status_code == 403
    assert refused.json()["error"] == "approval_required"
    await _owner_pin(db)
    sale = ok(await as_staff.post("/v1/orders", json=_sale(20, "4321")), 201).json()
    assert sale["approved_by"] == "us_dev"
    cleared = ok(await as_staff.patch(f"/v1/orders/{sale['id']}", json={"discount": None})).json()
    assert (cleared["discount"], cleared["approved_by"]) == (None, None)
    wrong = await as_staff.post("/v1/orders", json=_sale(20, "1111"))
    assert (wrong.status_code, wrong.json()["error"]) == (403, "approval_invalid")


async def test_the_limit_is_a_business_setting(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(
        update(Business).where(Business.id == BIZ).values(staff_discount_limit_bps=500)
    )
    await db.flush()
    assert (await as_staff.post("/v1/orders", json=_sale(10))).status_code == 403


async def test_an_owner_discounts_without_a_pin(as_owner: httpx.AsyncClient) -> None:
    sale = ok(await as_owner.post("/v1/orders", json=_sale(50)), 201).json()
    assert (sale["discount_cents"], sale["approved_by"]) == (5000, None)


async def test_pin_guessing_is_rate_limited(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    await _owner_pin(db)
    codes = [
        (await as_staff.post("/v1/orders", json=_sale(30, f"{n:04d}"))).status_code
        for n in range(7)
    ]
    assert 429 in codes


async def test_staff_cannot_set_an_approval_pin(as_staff: httpx.AsyncClient) -> None:
    res = await as_staff.post("/v1/orders/approval-pin", json={"pin": "1234"})
    assert res.status_code == 403


async def test_an_owner_sets_an_approval_pin(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    bad = await as_owner.post("/v1/orders/approval-pin", json={"pin": "12a4"})
    assert bad.status_code == 422
    ok(await as_owner.post("/v1/orders/approval-pin", json={"pin": "2468"}), 204)
    user = await db.get(User, "us_dev", populate_existing=True)
    assert user is not None and user.pin_hash is not None and "2468" not in user.pin_hash


async def test_an_approval_pin_needs_a_login(unauth: httpx.AsyncClient) -> None:
    res = await unauth.post("/v1/orders/approval-pin", json={"pin": "1234"})
    assert res.status_code == 401


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
