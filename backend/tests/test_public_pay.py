import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business
from clientbridge.models.payments import Payment

BIZ = "bz_birchbark"


async def _client_id(db: AsyncSession) -> str:
    cid = (
        (await db.execute(select(Client.id).where(Client.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert cid
    return cid


async def _sent_invoice(db: AsyncSession, *, total: int = 8000) -> tuple[str, str]:
    token = f"pt_{new_id('invoice')[3:19]}"
    inv = Invoice(
        id=new_id("invoice"),
        business_id=BIZ,
        client_id=await _client_id(db),
        number=9400,
        status="sent",
        currency="CAD",
        subtotal_cents=total,
        tax_total_cents=0,
        total_cents=total,
        balance_cents=total,
        pay_token=token,
    )
    db.add(inv)
    await db.flush()
    return inv.id, token


async def test_send_sets_pay_token_then_public_fetch(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    inv = Invoice(
        id=new_id("invoice"),
        business_id=BIZ,
        client_id=await _client_id(db),
        status="draft",
        currency="CAD",
        subtotal_cents=8000,
        tax_total_cents=0,
        total_cents=8000,
        balance_cents=8000,
    )
    db.add(inv)
    await db.flush()
    sent = await as_owner.post(f"/v1/invoices/{inv.id}/send")
    assert sent.status_code == 200, sent.text
    token = sent.json()["pay_token"]
    assert token
    pub = await as_owner.get(f"/pay/{token}")
    assert pub.status_code == 200
    assert pub.json()["balance_cents"] == 8000


async def test_public_invoice_by_token(api: httpx.AsyncClient, db: AsyncSession) -> None:
    _, token = await _sent_invoice(db)
    body = (await api.get(f"/pay/{token}")).json()
    assert body["balance_cents"] == 8000
    assert body["business_name"]
    assert body["status"] == "sent"


async def test_unknown_token_404(api: httpx.AsyncClient) -> None:
    assert (await api.get("/pay/nope")).status_code == 404


async def test_public_pay_interac_creates_pending(api: httpx.AsyncClient, db: AsyncSession) -> None:
    _, token = await _sent_invoice(db)
    res = await api.post(f"/pay/{token}/interac")
    assert res.status_code == 200
    body = res.json()
    assert len(body["reference_code"]) == 8
    assert body["amount_cents"] == 8000
    pay = (await db.execute(select(Payment).where(Payment.id == body["payment_id"]))).scalar_one()
    assert pay.method == "interac" and pay.status == "pending" and pay.business_id == BIZ


async def test_public_pay_card_requires_charges_enabled(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    _, token = await _sent_invoice(db)  # seed business has no Stripe account
    assert (await api.post(f"/pay/{token}/card")).status_code == 409


async def test_public_pay_card_returns_client_secret(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_account_id="acct_pub", stripe_charges_enabled=True)
    )
    inv_id, token = await _sent_invoice(db)
    body = (await api.post(f"/pay/{token}/card")).json()
    assert body["client_secret"].endswith("_secret")
    assert body["stripe_account_id"] == "acct_pub"
    pay = (
        await db.execute(
            select(Payment).where(Payment.invoice_id == inv_id, Payment.method == "card")
        )
    ).scalar_one()
    assert pay.status == "pending"


async def test_cannot_pay_a_paid_invoice(api: httpx.AsyncClient, db: AsyncSession) -> None:
    inv_id, token = await _sent_invoice(db)
    await db.execute(
        update(Invoice).where(Invoice.id == inv_id).values(status="paid", balance_cents=0)
    )
    await db.flush()
    assert (await api.post(f"/pay/{token}/interac")).status_code == 409
