import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice
from clientbridge.models.crm import Client
from clientbridge.models.payments import Payment

BIZ = "bz_birchbark"
GOOD = {"X-Interac-Secret": "testsecret"}


async def _invoice(db: AsyncSession, *, total: int = 5000) -> str:
    cid = (
        (await db.execute(select(Client.id).where(Client.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert cid
    inv = Invoice(
        id=new_id("invoice"),
        business_id=BIZ,
        client_id=cid,
        number=9100,
        status="sent",
        currency="CAD",
        subtotal_cents=total,
        tax_total_cents=0,
        total_cents=total,
        balance_cents=total,
    )
    db.add(inv)
    await db.flush()
    return inv.id


def _etransfer(reference_code: str, amount_cents: int) -> dict[str, str | int]:
    return {"reference_code": reference_code, "amount_cents": amount_cents}


async def test_request_interac_creates_pending(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    inv_id = await _invoice(db)
    res = await as_owner.post(f"/v1/payments/invoice/{inv_id}/interac")
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body["reference_code"]) == 8
    assert body["amount_cents"] == 5000
    pay = (await db.execute(select(Payment).where(Payment.id == body["payment_id"]))).scalar_one()
    assert pay.method == "interac" and pay.provider == "interac" and pay.status == "pending"
    assert pay.reference_code == body["reference_code"]


async def test_webhook_automatches_and_pays_invoice(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    inv_id = await _invoice(db)
    req = (await as_owner.post(f"/v1/payments/invoice/{inv_id}/interac")).json()
    res = await as_owner.post(
        "/webhooks/interac", json=_etransfer(req["reference_code"], 5000), headers=GOOD
    )
    assert res.status_code == 200
    pay = (await db.execute(select(Payment).where(Payment.id == req["payment_id"]))).scalar_one()
    assert pay.status == "succeeded" and pay.net_cents == 5000  # no fee — the wedge
    inv = (await db.execute(select(Invoice).where(Invoice.id == inv_id))).scalar_one()
    assert inv.status == "paid" and inv.balance_cents == 0


async def test_underpaid_etransfer_does_not_match(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    inv_id = await _invoice(db)
    req = (await as_owner.post(f"/v1/payments/invoice/{inv_id}/interac")).json()
    res = await as_owner.post(
        "/webhooks/interac", json=_etransfer(req["reference_code"], 4000), headers=GOOD
    )
    assert res.status_code == 200
    pay = (await db.execute(select(Payment).where(Payment.id == req["payment_id"]))).scalar_one()
    assert pay.status == "pending"  # underpaid → unmatched


async def test_unknown_reference_is_noop(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/webhooks/interac", json=_etransfer("DEADBEEF", 5000), headers=GOOD)
    assert res.status_code == 200  # accepted, unmatched


async def test_bad_secret_rejected(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
        "/webhooks/interac",
        json=_etransfer("DEADBEEF", 5000),
        headers={"X-Interac-Secret": "wrong"},
    )
    assert res.status_code == 401


async def test_staff_cannot_request_interac(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    inv_id = await _invoice(db)
    res = await as_staff.post(f"/v1/payments/invoice/{inv_id}/interac")
    assert res.status_code == 403
