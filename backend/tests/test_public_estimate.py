from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.billing import Estimate
from clientbridge.models.business import Business
from tests.conftest import BIZ, FakeEmailSender
from tests.helpers import client_id, ok


def _line(desc: str, unit: int, *, optional: bool = False) -> dict[str, object]:
    return {
        "description": desc,
        "quantity": 1,
        "unit_amount_cents": unit,
        "tax_class": "federal_only",
        "optional": optional,
    }


async def _owner_email(db: AsyncSession) -> None:
    await db.execute(
        update(Business).where(Business.id == BIZ).values(billing_email="owner@example.ca")
    )


async def _sent_estimate(api: httpx.AsyncClient, db: AsyncSession) -> dict[str, object]:
    cid = await client_id(db, email="client@example.ca")
    lines = [_line("De-shedding Treatment", 6000), _line("Nail trim", 2000, optional=True)]
    res = await api.post("/v1/estimates", json={"client_id": cid, "lines": lines, "send": True})
    body: dict[str, object] = ok(res, 201).json()
    return body


async def test_page_shows_lines_and_unticked_addons(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    est = await _sent_estimate(as_owner, db)
    page = ok(await as_owner.get(f"/estimate/{est['view_token']}")).json()
    assert page["status"] == "sent"
    assert page["total_cents"] == 6300
    assert [(ln["optional"], ln["selected"]) for ln in page["lines"]] == [
        (False, False),
        (True, False),
    ]
    assert page["lines"][1]["tax_by_code"] == {"GST": 100}
    assert page["taxes"] == [{"code": "GST", "rate_bps": 500, "base_cents": 6000, "cents": 300}]


async def test_accept_with_an_addon_ticked(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    await _owner_email(db)
    est = await _sent_estimate(as_owner, db)
    lines = ok(await as_owner.get(f"/estimate/{est['view_token']}")).json()["lines"]
    accepted = ok(
        await as_owner.post(
            f"/estimate/{est['view_token']}/accept", json={"line_ids": [lines[1]["id"]]}
        )
    ).json()
    assert accepted["status"] == "accepted"
    assert accepted["total_cents"] == 8400  # 6000 + 2000 + GST
    assert any("accepted" in m.subject for m in email.sent)
    invoice = ok(await as_owner.post(f"/v1/estimates/{est['id']}/convert"), 201).json()
    assert [ln["description"] for ln in invoice["lines"]] == ["De-shedding Treatment", "Nail trim"]
    assert invoice["total_cents"] == 8400


async def test_decline_with_a_reason_reaches_staff(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    await _owner_email(db)
    est = await _sent_estimate(as_owner, db)
    declined = ok(
        await as_owner.post(
            f"/estimate/{est['view_token']}/decline", json={"reason": "  Too far to drive  "}
        )
    ).json()
    assert declined["status"] == "declined"
    assert declined["decline_reason"] == "Too far to drive"
    assert any("Too far to drive" in m.body for m in email.sent)


async def test_answered_estimate_cannot_be_answered_again(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    est = await _sent_estimate(as_owner, db)
    ok(await as_owner.post(f"/estimate/{est['view_token']}/accept", json={}))
    again = await as_owner.post(f"/estimate/{est['view_token']}/decline", json={})
    assert again.status_code == 409


async def test_expired_estimate_cannot_be_accepted(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    est = await _sent_estimate(as_owner, db)
    past = (datetime.now(UTC) - timedelta(days=2)).date()
    await db.execute(update(Estimate).where(Estimate.id == est["id"]).values(valid_until=past))
    page = ok(await as_owner.get(f"/estimate/{est['view_token']}")).json()
    assert page["status"] == "expired"
    res = await as_owner.post(f"/estimate/{est['view_token']}/accept", json={})
    assert res.status_code == 409


async def test_only_offered_addons_can_be_ticked(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    est = await _sent_estimate(as_owner, db)
    lines = ok(await as_owner.get(f"/estimate/{est['view_token']}")).json()["lines"]
    res = await as_owner.post(
        f"/estimate/{est['view_token']}/accept", json={"line_ids": [lines[0]["id"]]}
    )
    assert res.status_code == 422


async def test_unknown_token_is_not_found(unauth: httpx.AsyncClient) -> None:
    assert (await unauth.get("/estimate/nope")).status_code == 404
    assert (await unauth.post("/estimate/nope/accept", json={})).status_code == 404


async def test_draft_has_no_public_link(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await client_id(db)
    draft = ok(
        await as_owner.post(
            "/v1/estimates", json={"client_id": cid, "lines": [_line("Quote", 5000)]}
        ),
        201,
    ).json()
    assert draft["view_token"] is None


async def test_reason_is_capped(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    est = await _sent_estimate(as_owner, db)
    res = await as_owner.post(f"/estimate/{est['view_token']}/decline", json={"reason": "x" * 501})
    assert res.status_code == 422
