"""Approving and paying several staff earnings in one command, all or none."""

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.services import ledger
from clientbridge.services.earnings import load_earning
from clientbridge.services.ledger import Leg
from tests.conftest import BIZ, Factory


async def _earning(
    db: AsyncSession, *, business_id: str = BIZ, staff_id: str = "st_diego", cents: int = 4000
) -> str:
    journal = await ledger.post(
        db,
        business_id,
        event="earning",
        ref=f"earning:{new_id('booking')}:0",
        legs=[
            Leg("business", business_id, "staff_cost", cents),
            Leg("staff", staff_id, "payable", -cents, "pending"),
        ],
        subject=("booking", new_id("booking")),
    )
    assert journal is not None
    return journal


async def _status(db: AsyncSession, journal: str, business_id: str = BIZ) -> str:
    earning = await load_earning(db, business_id, journal)
    assert earning is not None
    return earning.status


async def test_approve_then_pay_several(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    ids = [await _earning(db), await _earning(db, cents=2500)]
    approved = await as_owner.post("/v1/earnings/approve", json={"ids": ids})
    assert approved.status_code == 200, approved.text
    assert [e["status"] for e in approved.json()["earnings"]] == ["approved", "approved"]
    paid = await as_owner.post("/v1/earnings/pay", json={"ids": ids})
    assert paid.status_code == 200, paid.text
    assert {e["amount_cents"] for e in paid.json()["earnings"]} == {4000, 2500}
    assert [await _status(db, i) for i in ids] == ["paid", "paid"]


async def test_one_not_ready_moves_none_409(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    ready, early = await _earning(db), await _earning(db)
    assert (await as_owner.post("/v1/earnings/approve", json={"ids": [ready]})).status_code == 200
    res = await as_owner.post("/v1/earnings/pay", json={"ids": [ready, early]})
    assert res.status_code == 409
    assert await _status(db, ready) == "approved"
    assert await _status(db, early) == "pending"


async def test_empty_list_422(as_owner: httpx.AsyncClient) -> None:
    assert (await as_owner.post("/v1/earnings/approve", json={"ids": []})).status_code == 422


async def test_unknown_earning_404(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    journal = await _earning(db)
    res = await as_owner.post("/v1/earnings/approve", json={"ids": [journal, "jrn_missing"]})
    assert res.status_code == 404
    assert await _status(db, journal) == "pending"


async def test_other_business_earning_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    staff = await factory.staff(business=other)
    journal = await _earning(db, business_id=other.id, staff_id=staff.id)
    assert (await as_owner.post("/v1/earnings/approve", json={"ids": [journal]})).status_code == 404
    assert await _status(db, journal, other.id) == "pending"


async def test_staff_cannot_approve_403(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    journal = await _earning(db)
    assert (await as_staff.post("/v1/earnings/approve", json={"ids": [journal]})).status_code == 403
    assert await _status(db, journal) == "pending"


async def test_unauthenticated_401(unauth: httpx.AsyncClient) -> None:
    assert (await unauth.post("/v1/earnings/pay", json={"ids": ["jrn_x"]})).status_code == 401


async def test_replayed_approval_posts_once(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    ids = [await _earning(db), await _earning(db)]
    headers = {"Idempotency-Key": "bulk-approve-1"}
    first = await as_owner.post("/v1/earnings/approve", json={"ids": ids}, headers=headers)
    again = await as_owner.post("/v1/earnings/approve", json={"ids": ids}, headers=headers)
    assert first.status_code == again.status_code == 200
    assert first.json() == again.json()
    assert await ledger.journal_for(db, BIZ, f"approval:{ids[0]}") is not None


async def test_repeated_ids_count_once(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    journal = await _earning(db)
    res = await as_owner.post("/v1/earnings/approve", json={"ids": [journal, journal]})
    assert res.status_code == 200
    assert len(res.json()["earnings"]) == 1
