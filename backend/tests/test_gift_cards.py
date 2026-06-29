"""Gift-card issue + redeem command surface, against the seeded DB."""

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.catalog import GiftCard
from tests.conftest import Factory

BIZ = "bz_birchbark"


async def test_issue_then_redeem(as_owner: httpx.AsyncClient) -> None:
    issued = await as_owner.post("/v1/gift-cards", json={"initial_cents": 5000})
    assert issued.status_code == 201, issued.text
    card = issued.json()
    assert card["id"].startswith("gc_")
    assert len(card["code"]) == 12
    assert card["initial_cents"] == 5000
    assert card["balance_cents"] == 5000
    assert card["status"] == "active"

    redeemed = await as_owner.post(
        "/v1/gift-cards/redeem", json={"code": card["code"], "amount_cents": 2000}
    )
    assert redeemed.status_code == 200, redeemed.text
    assert redeemed.json()["balance_cents"] == 3000
    assert redeemed.json()["status"] == "active"


async def test_redeem_unknown_code_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
        "/v1/gift-cards/redeem", json={"code": "NOPENOPENOPE", "amount_cents": 100}
    )
    assert res.status_code == 404


async def test_redeem_over_balance_409(as_owner: httpx.AsyncClient) -> None:
    issued = await as_owner.post("/v1/gift-cards", json={"initial_cents": 5000})
    code = issued.json()["code"]
    res = await as_owner.post("/v1/gift-cards/redeem", json={"code": code, "amount_cents": 6000})
    assert res.status_code == 409


async def test_redeem_zero_amount_409(as_owner: httpx.AsyncClient) -> None:
    issued = await as_owner.post("/v1/gift-cards", json={"initial_cents": 5000})
    code = issued.json()["code"]
    res = await as_owner.post("/v1/gift-cards/redeem", json={"code": code, "amount_cents": 0})
    assert res.status_code == 409


async def test_redeem_to_zero_marks_redeemed(as_owner: httpx.AsyncClient) -> None:
    issued = await as_owner.post("/v1/gift-cards", json={"initial_cents": 5000})
    code = issued.json()["code"]
    full = await as_owner.post("/v1/gift-cards/redeem", json={"code": code, "amount_cents": 5000})
    assert full.status_code == 200
    assert full.json()["balance_cents"] == 0
    assert full.json()["status"] == "redeemed"
    again = await as_owner.post("/v1/gift-cards/redeem", json={"code": code, "amount_cents": 1})
    assert again.status_code == 409


async def test_issue_non_positive_amount_422(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/gift-cards", json={"initial_cents": -5})
    assert res.status_code == 422


async def test_staff_cannot_issue_403(as_staff: httpx.AsyncClient) -> None:
    res = await as_staff.post("/v1/gift-cards", json={"initial_cents": 5000})
    assert res.status_code == 403


async def test_staff_cannot_redeem_403(as_staff: httpx.AsyncClient) -> None:
    res = await as_staff.post(
        "/v1/gift-cards/redeem", json={"code": "WHATEVER1234", "amount_cents": 100}
    )
    assert res.status_code == 403


async def test_other_business_code_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    db.add(
        GiftCard(
            id=new_id("gift_card"),
            business_id=other.id,
            code="OTHERBIZCODE",
            initial_cents=5000,
            balance_cents=5000,
            status="active",
        )
    )
    await db.flush()
    res = await as_owner.post(
        "/v1/gift-cards/redeem", json={"code": "OTHERBIZCODE", "amount_cents": 100}
    )
    assert res.status_code == 404


async def test_code_collision_409(
    as_owner: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "clientbridge.services.gift_card_service._gift_code", lambda: "FIXEDCODE123"
    )
    first = await as_owner.post("/v1/gift-cards", json={"initial_cents": 1000})
    assert first.status_code == 201
    second = await as_owner.post("/v1/gift-cards", json={"initial_cents": 1000})
    assert second.status_code == 409


async def test_idempotent_issue_replays(as_owner: httpx.AsyncClient) -> None:
    headers = {"Idempotency-Key": "gc-issue-1"}
    first = await as_owner.post("/v1/gift-cards", json={"initial_cents": 4000}, headers=headers)
    second = await as_owner.post("/v1/gift-cards", json={"initial_cents": 4000}, headers=headers)
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
    assert first.json()["code"] == second.json()["code"]
