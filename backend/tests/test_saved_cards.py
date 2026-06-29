import json

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business
from clientbridge.models.payments import Payment, PaymentMethod
from tests.conftest import Factory, FakePaymentGateway

BIZ = "bz_birchbark"
GOOD = {"Stripe-Signature": "good"}


async def _enable(db: AsyncSession, *, account: str = "acct_test") -> None:
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_account_id=account, stripe_charges_enabled=True)
    )
    await db.flush()


async def _client_id(db: AsyncSession) -> str:
    cid = (
        (await db.execute(select(Client.id).where(Client.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert cid
    return cid


async def test_setup_intent_returns_client_secret(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
    cid = await _client_id(db)
    res = await as_owner.post(f"/v1/payments/setup-intent/{cid}")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["client_secret"].endswith("_secret")
    assert body["stripe_account_id"] == "acct_test"
    customer = (
        await db.execute(select(Client.stripe_customer_id).where(Client.id == cid))
    ).scalar_one()
    assert customer is not None and customer.startswith("cus_fake")


async def test_setup_requires_onboarding(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await db.execute(update(Business).where(Business.id == BIZ).values(stripe_account_id=None))
    await db.flush()
    cid = await _client_id(db)
    assert (await as_owner.post(f"/v1/payments/setup-intent/{cid}")).status_code == 409


async def test_staff_cannot_setup(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client_id(db)
    assert (await as_staff.post(f"/v1/payments/setup-intent/{cid}")).status_code == 403


async def test_payment_method_attached_records_card(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db, account="acct_pm")
    cid = await _client_id(db)
    await db.execute(update(Client).where(Client.id == cid).values(stripe_customer_id="cus_pm"))
    await db.flush()
    event = json.dumps(
        {
            "id": "evt_pm1",
            "type": "payment_method.attached",
            "account": "acct_pm",
            "data": {
                "object": {
                    "id": "pm_visa",
                    "customer": "cus_pm",
                    "card": {"brand": "visa", "last4": "4242"},
                }
            },
        }
    )
    res = await api.post("/webhooks/stripe", content=event, headers=GOOD)
    assert res.status_code == 200
    pm = (
        await db.execute(select(PaymentMethod).where(PaymentMethod.provider_ref == "pm_visa"))
    ).scalar_one()
    assert pm.client_id == cid
    assert pm.brand == "visa" and pm.last4 == "4242" and pm.status == "active"


async def test_pay_with_saved_card(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _enable(db)
    cid = await _client_id(db)
    await db.execute(update(Client).where(Client.id == cid).values(stripe_customer_id="cus_saved"))
    pm = PaymentMethod(
        id=new_id("payment_method"),
        business_id=BIZ,
        client_id=cid,
        type="card",
        brand="visa",
        last4="4242",
        provider="stripe",
        provider_ref="pm_saved",
        status="active",
    )
    db.add(pm)
    inv = Invoice(
        id=new_id("invoice"),
        business_id=BIZ,
        client_id=cid,
        number=9700,
        status="sent",
        currency="CAD",
        subtotal_cents=4000,
        tax_total_cents=0,
        total_cents=4000,
        balance_cents=4000,
    )
    db.add(inv)
    await db.flush()
    res = await as_owner.post(f"/v1/payments/invoice/{inv.id}?payment_method_id={pm.id}")
    assert res.status_code == 200, res.text
    payment = (
        await db.execute(select(Payment).where(Payment.id == res.json()["payment_id"]))
    ).scalar_one()
    assert payment.method == "card" and payment.status == "pending"


async def test_pay_with_unknown_saved_card_404(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
    cid = await _client_id(db)
    inv = Invoice(
        id=new_id("invoice"),
        business_id=BIZ,
        client_id=cid,
        number=9701,
        status="sent",
        currency="CAD",
        subtotal_cents=4000,
        tax_total_cents=0,
        total_cents=4000,
        balance_cents=4000,
    )
    db.add(inv)
    await db.flush()
    res = await as_owner.post(f"/v1/payments/invoice/{inv.id}?payment_method_id=pm_nope")
    assert res.status_code == 404


async def test_cannot_use_another_clients_saved_card(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
    two = (
        (await db.execute(select(Client.id).where(Client.business_id == BIZ).limit(2)))
        .scalars()
        .all()
    )
    assert len(two) == 2
    invoice_client, other_client = two[0], two[1]
    other_pm = PaymentMethod(
        id=new_id("payment_method"),
        business_id=BIZ,
        client_id=other_client,
        type="card",
        provider="stripe",
        provider_ref="pm_other",
        status="active",
    )
    db.add(other_pm)
    inv = Invoice(
        id=new_id("invoice"),
        business_id=BIZ,
        client_id=invoice_client,
        number=9750,
        status="sent",
        currency="CAD",
        subtotal_cents=4000,
        tax_total_cents=0,
        total_cents=4000,
        balance_cents=4000,
    )
    db.add(inv)
    await db.flush()
    res = await as_owner.post(f"/v1/payments/invoice/{inv.id}?payment_method_id={other_pm.id}")
    assert res.status_code == 404  # the saved card belongs to a different client


def _pm_attached(event_id: str, account: str, customer: str, pm_id: str) -> str:
    return json.dumps(
        {
            "id": event_id,
            "type": "payment_method.attached",
            "account": account,
            "data": {"object": {"id": pm_id, "customer": customer, "card": {}}},
        }
    )


async def test_payment_method_attached_is_deduped(api: httpx.AsyncClient, db: AsyncSession) -> None:
    await _enable(db, account="acct_dedup")
    cid = await _client_id(db)
    await db.execute(update(Client).where(Client.id == cid).values(stripe_customer_id="cus_dd"))
    await db.flush()
    for evt in ("evt_a", "evt_b"):  # same pm delivered twice
        await api.post(
            "/webhooks/stripe",
            content=_pm_attached(evt, "acct_dedup", "cus_dd", "pm_dup"),
            headers=GOOD,
        )
    rows = (
        (await db.execute(select(PaymentMethod).where(PaymentMethod.provider_ref == "pm_dup")))
        .scalars()
        .all()
    )
    assert len(rows) == 1


async def test_payment_method_attached_unknown_account_noop(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    res = await api.post(
        "/webhooks/stripe",
        content=_pm_attached("evt_u", "acct_nobody", "cus_x", "pm_orphan"),
        headers=GOOD,
    )
    assert res.status_code == 200
    rows = (
        (await db.execute(select(PaymentMethod).where(PaymentMethod.provider_ref == "pm_orphan")))
        .scalars()
        .all()
    )
    assert rows == []


async def test_first_attached_card_is_default(api: httpx.AsyncClient, db: AsyncSession) -> None:
    await _enable(db, account="acct_def")
    fresh = Client(
        id=new_id("client"),
        business_id=BIZ,
        name="Card Tester",
        tags=[],
        custom_fields={},
        stripe_customer_id="cus_def",
    )
    db.add(fresh)
    await db.flush()
    for evt, pm in (("evt_d1", "pm_one"), ("evt_d2", "pm_two")):  # two cards, same client
        await api.post(
            "/webhooks/stripe",
            content=_pm_attached(evt, "acct_def", "cus_def", pm),
            headers=GOOD,
        )
    one = (
        await db.execute(select(PaymentMethod).where(PaymentMethod.provider_ref == "pm_one"))
    ).scalar_one()
    two = (
        await db.execute(select(PaymentMethod).where(PaymentMethod.provider_ref == "pm_two"))
    ).scalar_one()
    assert one.is_default is True  # the first card on file
    assert two.is_default is False  # later cards don't steal default


def _saved_card(cid: str, *, ref: str, default: bool = False) -> PaymentMethod:
    return PaymentMethod(
        id=new_id("payment_method"),
        business_id=BIZ,
        client_id=cid,
        type="card",
        brand="visa",
        last4="4242",
        provider="stripe",
        provider_ref=ref,
        is_default=default,
        status="active",
    )


async def test_detach_removes_row_and_calls_gateway(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _enable(db)
    cid = await _client_id(db)
    pm = _saved_card(cid, ref="pm_detach")
    db.add(pm)
    await db.flush()
    res = await as_owner.delete(f"/v1/payments/methods/{pm.id}")
    assert res.status_code == 200, res.text
    assert res.json() == {"detached": True}
    assert gateway.detached == ["pm_detach"]  # the provider was told to detach
    rows = (
        (await db.execute(select(PaymentMethod).where(PaymentMethod.id == pm.id))).scalars().all()
    )
    assert rows == []


async def test_detach_unknown_card_404(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _enable(db)
    assert (await as_owner.delete("/v1/payments/methods/pm_nope")).status_code == 404


async def test_detach_cross_tenant_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    await _enable(db)
    other_biz = await factory.business()
    other_client = await factory.client(business=other_biz)
    pm = PaymentMethod(
        id=new_id("payment_method"),
        business_id=other_biz.id,
        client_id=other_client.id,
        type="card",
        provider="stripe",
        provider_ref="pm_other_biz",
        status="active",
    )
    db.add(pm)
    await db.flush()
    assert (await as_owner.delete(f"/v1/payments/methods/{pm.id}")).status_code == 404


async def test_set_default_flips_and_clears_siblings(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await _client_id(db)
    a = _saved_card(cid, ref="pm_a", default=True)
    b = _saved_card(cid, ref="pm_b", default=False)
    db.add_all([a, b])
    await db.flush()
    res = await as_owner.post(f"/v1/payments/methods/{b.id}/default")
    assert res.status_code == 200, res.text
    assert res.json()["is_default"] is True
    a_default = (
        await db.execute(select(PaymentMethod.is_default).where(PaymentMethod.id == a.id))
    ).scalar_one()
    b_default = (
        await db.execute(select(PaymentMethod.is_default).where(PaymentMethod.id == b.id))
    ).scalar_one()
    assert b_default is True
    assert a_default is False  # the prior default was cleared


async def test_staff_cannot_manage_cards(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client_id(db)
    pm = _saved_card(cid, ref="pm_staff")
    db.add(pm)
    await db.flush()
    assert (await as_staff.delete(f"/v1/payments/methods/{pm.id}")).status_code == 403
    assert (await as_staff.post(f"/v1/payments/methods/{pm.id}/default")).status_code == 403


def _invoice_row(cid: str, *, number: int) -> Invoice:
    return Invoice(
        id=new_id("invoice"),
        business_id=BIZ,
        client_id=cid,
        number=number,
        status="sent",
        currency="CAD",
        subtotal_cents=4000,
        tax_total_cents=0,
        total_cents=4000,
        balance_cents=4000,
    )


async def test_off_session_card_declined_402(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _enable(db)
    cid = await _client_id(db)
    await db.execute(update(Client).where(Client.id == cid).values(stripe_customer_id="cus_dec"))
    pm = _saved_card(cid, ref="pm_card_declined")
    inv = _invoice_row(cid, number=9800)
    db.add_all([pm, inv])
    await db.flush()
    res = await as_owner.post(f"/v1/payments/invoice/{inv.id}?payment_method_id={pm.id}")
    assert res.status_code == 402
    assert res.json()["error"] == "card_declined"
    # the declined charge left no phantom pending payment
    rows = (await db.execute(select(Payment).where(Payment.invoice_id == inv.id))).scalars().all()
    assert rows == []


async def test_off_session_requires_action_402(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
    cid = await _client_id(db)
    await db.execute(update(Client).where(Client.id == cid).values(stripe_customer_id="cus_act"))
    pm = _saved_card(cid, ref="pm_requires_action")
    inv = _invoice_row(cid, number=9801)
    db.add_all([pm, inv])
    await db.flush()
    res = await as_owner.post(f"/v1/payments/invoice/{inv.id}?payment_method_id={pm.id}")
    assert res.status_code == 402
    assert res.json()["error"] == "payment_action_required"


async def _fresh_client(db: AsyncSession, *, customer: str) -> str:
    """A client with no seeded saved cards, so default resolution is fully controlled."""
    client = Client(
        id=new_id("client"),
        business_id=BIZ,
        name="Default Tester",
        tags=[],
        custom_fields={},
        stripe_customer_id=customer,
    )
    db.add(client)
    await db.flush()
    return client.id


async def test_pay_with_default_card(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _enable(db)
    cid = await _fresh_client(db, customer="cus_dflt")
    default = _saved_card(cid, ref="pm_default", default=True)
    other = _saved_card(cid, ref="pm_other_card", default=False)
    inv = _invoice_row(cid, number=9802)
    db.add_all([default, other, inv])
    await db.flush()
    res = await as_owner.post(f"/v1/payments/invoice/{inv.id}?payment_method_id=default")
    assert res.status_code == 200, res.text
    assert gateway.charged_methods == ["pm_default"]  # the is_default card was charged off-session


async def test_pay_with_default_no_default_404(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
    cid = await _fresh_client(db, customer="cus_nodflt")
    pm = _saved_card(cid, ref="pm_nondefault", default=False)
    inv = _invoice_row(cid, number=9803)
    db.add_all([pm, inv])
    await db.flush()
    res = await as_owner.post(f"/v1/payments/invoice/{inv.id}?payment_method_id=default")
    assert res.status_code == 404
