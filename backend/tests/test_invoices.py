import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.crm import Client
from clientbridge.models.identity import Business
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
        await db.execute(update(Client).where(Client.id == cid).values(email="pay@example.ca"))
        await db.flush()
    return cid


def _line(desc: str = "Consultation", qty: float = 1.0, unit: int = 10000) -> dict[str, object]:
    return {"description": desc, "quantity": qty, "unit_amount_cents": unit}


async def test_create_invoice_computes_tax(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client_id(db)
    res = await as_owner.post("/v1/invoices", json={"client_id": cid, "lines": [_line()]})
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "draft"
    assert body["number"] is None
    assert body["subtotal_cents"] == 10000
    assert body["tax_total_cents"] == 1200  # BC: GST 5% + PST 7%
    assert body["total_cents"] == 11200
    assert body["balance_cents"] == 11200
    assert body["lines"][0]["amount_cents"] == 10000
    assert body["lines"][0]["tax_amount_cents"] == 1200


async def test_send_assigns_number_and_emails(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    cid = await _client_id(db, with_email=True)
    inv = (await as_owner.post("/v1/invoices", json={"client_id": cid, "lines": [_line()]})).json()
    sent = await as_owner.post(f"/v1/invoices/{inv['id']}/send")
    assert sent.status_code == 200
    body = sent.json()
    assert body["status"] == "sent"
    assert body["number"] is not None
    assert body["issued_at"] is not None
    assert body["due_at"] is not None
    assert len(email.sent) == 1


async def test_not_registered_collects_no_tax(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(update(Business).where(Business.id == BIZ).values(is_tax_registered=False))
    await db.flush()
    cid = await _client_id(db)
    body = (await as_owner.post("/v1/invoices", json={"client_id": cid, "lines": [_line()]})).json()
    assert body["tax_total_cents"] == 0
    assert body["total_cents"] == 10000


async def test_only_draft_is_editable(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client_id(db, with_email=True)
    inv = (await as_owner.post("/v1/invoices", json={"client_id": cid, "lines": [_line()]})).json()
    await as_owner.post(f"/v1/invoices/{inv['id']}/send")
    patched = await as_owner.patch(f"/v1/invoices/{inv['id']}", json={"notes": "late edit"})
    assert patched.status_code == 409


async def test_void_invoice(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client_id(db)
    inv = (await as_owner.post("/v1/invoices", json={"client_id": cid, "lines": [_line()]})).json()
    voided = await as_owner.post(f"/v1/invoices/{inv['id']}/void")
    assert voided.status_code == 200
    assert voided.json()["status"] == "void"


async def test_unknown_client_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/invoices", json={"client_id": "cl_nope", "lines": [_line()]})
    assert res.status_code == 404


async def test_staff_cannot_create_invoice(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client_id(db)
    res = await as_staff.post("/v1/invoices", json={"client_id": cid, "lines": [_line()]})
    assert res.status_code == 403


async def test_unauth_cannot_create(unauth: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client_id(db)
    res = await unauth.post("/v1/invoices", json={"client_id": cid, "lines": [_line()]})
    assert res.status_code == 401


async def test_cannot_invoice_another_business_client(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Rival Co")
    foreign = await factory.client(business=other)
    await db.flush()
    res = await as_owner.post("/v1/invoices", json={"client_id": foreign.id, "lines": [_line()]})
    assert res.status_code == 404


async def test_unknown_invoice_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/invoices/inv_nope/void")
    assert res.status_code == 404


async def test_idempotent_create_replays(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client_id(db)
    body = {"client_id": cid, "lines": [_line()]}
    headers = {"Idempotency-Key": "inv-test-1"}
    first = await as_owner.post("/v1/invoices", json=body, headers=headers)
    second = await as_owner.post("/v1/invoices", json=body, headers=headers)
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
