import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice
from clientbridge.models.crm import Client
from clientbridge.models.payments import Payment
from clientbridge.services import ledger
from tests.conftest import book_invoice

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
    )
    db.add(inv)
    await db.flush()
    await book_invoice(db, inv)
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
    assert pay.status == "succeeded"
    assert await ledger.journal_for(db, BIZ, f"fee:{pay.id}") is None  # no fee — the wedge
    inv = (await db.execute(select(Invoice).where(Invoice.id == inv_id))).scalar_one()
    assert (await ledger.invoice_state(db, inv))[0] == "paid" and await ledger.invoice_balance(
        db, inv
    ) == 0


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


async def test_duplicate_webhook_settles_once(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    inv_id = await _invoice(db)
    req = (await as_owner.post(f"/v1/payments/invoice/{inv_id}/interac")).json()
    first = await as_owner.post(
        "/webhooks/interac", json=_etransfer(req["reference_code"], 5000), headers=GOOD
    )
    # the SAME e-transfer is delivered again (provider re-fire) — deduped by reference code
    second = await as_owner.post(
        "/webhooks/interac", json=_etransfer(req["reference_code"], 5000), headers=GOOD
    )
    assert first.status_code == 200 and second.status_code == 200
    pay = (await db.execute(select(Payment).where(Payment.id == req["payment_id"]))).scalar_one()
    assert pay.status == "succeeded"
    inv = (await db.execute(select(Invoice).where(Invoice.id == inv_id))).scalar_one()
    assert (await ledger.invoice_state(db, inv))[0] == "paid"
    assert await ledger.collected(db, BIZ, "invoice", inv.id) == (5000, False)  # settled once
    settled = (
        await db.execute(
            select(func.count())
            .select_from(Payment)
            .where(Payment.reference_code == req["reference_code"], Payment.status == "succeeded")
        )
    ).scalar_one()
    assert settled == 1


async def test_overpaid_etransfer_matches_at_requested_amount(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    inv_id = await _invoice(db, total=5000)
    req = (await as_owner.post(f"/v1/payments/invoice/{inv_id}/interac")).json()
    # the client sends MORE than the balance — still matches; net is the requested amount, no fee
    res = await as_owner.post(
        "/webhooks/interac", json=_etransfer(req["reference_code"], 6000), headers=GOOD
    )
    assert res.status_code == 200
    pay = (await db.execute(select(Payment).where(Payment.id == req["payment_id"]))).scalar_one()
    assert pay.status == "succeeded"
    assert pay.amount_cents == 5000  # recorded at the requested amount
    assert await ledger.journal_for(db, BIZ, f"fee:{pay.id}") is None
    inv = (await db.execute(select(Invoice).where(Invoice.id == inv_id))).scalar_one()
    assert (await ledger.invoice_state(db, inv))[0] == "paid" and await ledger.invoice_balance(
        db, inv
    ) == 0
