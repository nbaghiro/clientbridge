import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.billing import Estimate
from clientbridge.models.crm import Client
from tests.conftest import Factory, FakeEmailSender

BIZ = "bz_birchbark"


async def _client_id(db: AsyncSession, *, with_email: bool = False) -> str:
    cid = (
        (await db.execute(select(Client.id).where(Client.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert cid
    if with_email:
        await db.execute(update(Client).where(Client.id == cid).values(email="quote@example.ca"))
        await db.flush()
    return cid


def _line(desc: str = "Project quote", qty: float = 2.0, unit: int = 5000) -> dict[str, object]:
    return {"description": desc, "quantity": qty, "unit_amount_cents": unit}


async def test_create_estimate(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client_id(db)
    res = await as_owner.post("/v1/estimates", json={"client_id": cid, "lines": [_line()]})
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "draft"
    assert body["number"] is None
    assert body["subtotal_cents"] == 10000  # 2 x 5000
    assert body["tax_total_cents"] == 1200  # BC 12%
    assert body["total_cents"] == 11200


async def test_send_estimate_assigns_number(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    cid = await _client_id(db, with_email=True)
    est = (await as_owner.post("/v1/estimates", json={"client_id": cid, "lines": [_line()]})).json()
    sent = await as_owner.post(f"/v1/estimates/{est['id']}/send")
    assert sent.status_code == 200
    assert sent.json()["status"] == "sent"
    assert sent.json()["number"] is not None
    assert len(email.sent) == 1


async def test_accept_then_convert(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    cid = await _client_id(db, with_email=True)
    est = (await as_owner.post("/v1/estimates", json={"client_id": cid, "lines": [_line()]})).json()
    await as_owner.post(f"/v1/estimates/{est['id']}/send")
    accepted = await as_owner.post(f"/v1/estimates/{est['id']}/accept")
    assert accepted.status_code == 200
    assert accepted.json()["status"] == "accepted"

    converted = await as_owner.post(f"/v1/estimates/{est['id']}/convert")
    assert converted.status_code == 201
    invoice = converted.json()
    assert invoice["status"] == "draft"
    assert invoice["total_cents"] == 11200
    assert len(invoice["lines"]) == 1
    link = (
        await db.execute(select(Estimate.converted_invoice_id).where(Estimate.id == est["id"]))
    ).scalar_one()
    assert link == invoice["id"]


async def test_cannot_convert_twice(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    cid = await _client_id(db, with_email=True)
    est = (await as_owner.post("/v1/estimates", json={"client_id": cid, "lines": [_line()]})).json()
    await as_owner.post(f"/v1/estimates/{est['id']}/send")
    assert (await as_owner.post(f"/v1/estimates/{est['id']}/convert")).status_code == 201
    assert (await as_owner.post(f"/v1/estimates/{est['id']}/convert")).status_code == 409


async def test_cannot_convert_draft(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client_id(db)
    est = (await as_owner.post("/v1/estimates", json={"client_id": cid, "lines": [_line()]})).json()
    res = await as_owner.post(f"/v1/estimates/{est['id']}/convert")
    assert res.status_code == 409


async def test_decline_estimate(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    cid = await _client_id(db, with_email=True)
    est = (await as_owner.post("/v1/estimates", json={"client_id": cid, "lines": [_line()]})).json()
    await as_owner.post(f"/v1/estimates/{est['id']}/send")
    declined = await as_owner.post(f"/v1/estimates/{est['id']}/decline")
    assert declined.status_code == 200
    assert declined.json()["status"] == "declined"


async def test_staff_cannot_create_estimate(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client_id(db)
    res = await as_staff.post("/v1/estimates", json={"client_id": cid, "lines": [_line()]})
    assert res.status_code == 403


async def test_unknown_client_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/estimates", json={"client_id": "cl_nope", "lines": [_line()]})
    assert res.status_code == 404


async def test_cannot_estimate_another_business_client(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Rival Co")
    foreign = await factory.client(business=other)
    await db.flush()
    res = await as_owner.post("/v1/estimates", json={"client_id": foreign.id, "lines": [_line()]})
    assert res.status_code == 404


async def test_idempotent_create_replays(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client_id(db)
    body = {"client_id": cid, "lines": [_line()]}
    headers = {"Idempotency-Key": "est-test-1"}
    first = await as_owner.post("/v1/estimates", json=body, headers=headers)
    second = await as_owner.post("/v1/estimates", json=body, headers=headers)
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]


async def test_unknown_estimate_404(as_owner: httpx.AsyncClient) -> None:
    assert (await as_owner.post("/v1/estimates/est_nope/accept")).status_code == 404
    assert (await as_owner.post("/v1/estimates/est_nope/convert")).status_code == 404


async def test_cannot_send_accepted_estimate(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    cid = await _client_id(db, with_email=True)
    est = (await as_owner.post("/v1/estimates", json={"client_id": cid, "lines": [_line()]})).json()
    await as_owner.post(f"/v1/estimates/{est['id']}/send")
    await as_owner.post(f"/v1/estimates/{est['id']}/accept")
    res = await as_owner.post(f"/v1/estimates/{est['id']}/send")
    assert res.status_code == 409


async def test_staff_cannot_convert(as_staff: httpx.AsyncClient) -> None:
    # _assert_admin gates before any lookup, so a bogus id still 403s for staff
    res = await as_staff.post("/v1/estimates/est_x/convert")
    assert res.status_code == 403
