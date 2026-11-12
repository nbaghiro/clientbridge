import json

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.errors import TooManyRequests
from clientbridge.core.ids import new_id
from clientbridge.core.ratelimit import RateLimiter, public_pay_rate_limit
from clientbridge.main import app
from clientbridge.models.billing import Invoice, Line
from clientbridge.models.business import Business
from clientbridge.models.payments import Payment
from clientbridge.services import ledger
from clientbridge.services.ledger import Leg
from tests.conftest import FakePaymentGateway
from tests.helpers import client_id, key, pay_link_card, sent_invoice

BIZ = "bz_birchbark"
GOOD = {"Stripe-Signature": "good"}


async def _sent_invoice(db: AsyncSession, *, total: int = 8000) -> tuple[str, str]:
    token = f"pt_{new_id('invoice')[3:19]}"
    return await sent_invoice(db, total=total, number=9400, pay_token=token), token


async def test_send_sets_pay_token_then_public_fetch(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    inv = Invoice(
        id=new_id("invoice"),
        business_id=BIZ,
        client_id=await client_id(db),
        status="draft",
        currency="CAD",
        subtotal_cents=8000,
        tax_total_cents=0,
        total_cents=8000,
    )
    db.add(inv)
    await db.flush()
    db.add(
        Line(
            id=new_id("line"),
            business_id=BIZ,
            invoice_id=inv.id,
            description="Groom",
            unit_amount_cents=8000,
            amount_cents=8000,
        )
    )
    await db.flush()
    sent = await as_owner.post(f"/v1/invoices/{inv.id}/send")
    assert sent.status_code == 200, sent.text
    token = sent.json()["pay_token"]
    assert token
    total = sent.json()["total_cents"]
    assert total == 8960  # BC GST + PST, fixed when the invoice is issued
    pub = await as_owner.get(f"/pay/{token}")
    assert pub.status_code == 200
    assert pub.json()["balance_cents"] == total


async def test_public_invoice_by_token(api: httpx.AsyncClient, db: AsyncSession) -> None:
    _, token = await _sent_invoice(db)
    body = (await api.get(f"/pay/{token}")).json()
    assert body["balance_cents"] == 8000
    assert body["business_name"]
    assert body["brand"]["primary"] == "#2E4A3F"  # the business brand is exposed on the pay surface
    assert body["status"] == "sent"


async def test_unknown_token_404(api: httpx.AsyncClient) -> None:
    assert (await api.get("/pay/nope")).status_code == 404


async def test_pay_page_names_the_business_contact_when_it_takes_no_cards(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    brand = {"phone": "+1 250 555 0100", "email": "hello@birchbark.example"}
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_charges_enabled=False, brand=Business.brand.op("||")(brand))
    )
    _, token = await _sent_invoice(db)
    body = (await api.get(f"/pay/{token}")).json()
    assert body["accepts_card"] is False
    assert (body["contact_phone"], body["contact_email"]) == (brand["phone"], brand["email"])
    assert "interac" not in body and "interac_email" not in body


async def test_public_pay_card_requires_charges_enabled(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(
        update(Business).where(Business.id == BIZ).values(stripe_charges_enabled=False)
    )
    _, token = await _sent_invoice(db)
    assert (await pay_link_card(api, db, token)).status_code == 409


async def test_public_pay_card_returns_client_secret(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_account_id="acct_pub", stripe_charges_enabled=True)
    )
    inv_id, token = await _sent_invoice(db)
    body = (await pay_link_card(api, db, token)).json()
    assert body["client_secret"].endswith("_secret")
    assert body["stripe_account_id"] == "acct_pub"
    pay = (
        await db.execute(
            select(Payment).where(Payment.invoice_id == inv_id, Payment.method == "card")
        )
    ).scalar_one()
    assert pay.status == "pending"


async def test_cannot_pay_a_paid_invoice(api: httpx.AsyncClient, db: AsyncSession) -> None:
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_account_id="acct_pub", stripe_charges_enabled=True)
    )
    inv_id, token = await _sent_invoice(db)
    await ledger.post(
        db,
        BIZ,
        event="payment",
        ref=f"test:paid:{inv_id}",
        legs=[Leg("business", BIZ, "bank", 8000), Leg("client", "cl_x", "receivable", -8000)],
        subject=("invoice", inv_id),
    )
    assert (await pay_link_card(api, db, token)).status_code == 409
    assert not (await _card_rows(db, inv_id))


async def test_card_double_submit_is_idempotent(api: httpx.AsyncClient, db: AsyncSession) -> None:
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_account_id="acct_pub", stripe_charges_enabled=True)
    )
    inv_id, token = await _sent_invoice(db)
    first = (await pay_link_card(api, db, token)).json()
    second = (await pay_link_card(api, db, token)).json()
    assert first["client_secret"] == second["client_secret"]  # one intent, reused
    rows = (await db.execute(select(Payment).where(Payment.invoice_id == inv_id))).scalars().all()
    assert len(rows) == 1  # no duplicate pending row


async def _card_rows(db: AsyncSession, inv_id: str) -> list[tuple[str, str | None, int]]:
    rows = await db.execute(
        select(Payment.status, Payment.provider_ref, Payment.tip_cents)
        .where(Payment.invoice_id == inv_id, Payment.method == "card")
        .order_by(Payment.created_at, Payment.id)
    )
    return [(s, ref, tip) for s, ref, tip in rows.all()]


async def _card_ready_invoice(db: AsyncSession) -> tuple[str, str]:
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_account_id="acct_pub", stripe_charges_enabled=True)
    )
    invoice_id, token = await _sent_invoice(db)
    db.add(
        Line(
            id=new_id("line"),
            business_id=BIZ,
            invoice_id=invoice_id,
            description="Groom",
            unit_amount_cents=8000,
            amount_cents=8000,
        )
    )
    await db.flush()
    return invoice_id, token


def _intent_event(event_type: str, pi: str) -> str:
    return json.dumps(
        {"id": f"evt_{new_id('payment')}", "type": event_type, "data": {"object": {"id": pi}}}
    )


async def test_card_attempt_after_cancel_or_failure_opens_a_new_intent(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    inv_id, token = await _card_ready_invoice(db)
    secrets = [(await pay_link_card(api, db, token)).json()["client_secret"]]
    for event in ("payment_intent.canceled", "payment_intent.payment_failed"):
        live = (await _card_rows(db, inv_id))[-1][1]
        assert live is not None
        res = await api.post("/webhooks/stripe", content=_intent_event(event, live), headers=GOOD)
        assert res.status_code == 200
        retry = await pay_link_card(api, db, token)
        assert retry.status_code == 200, retry.text
        secrets.append(retry.json()["client_secret"])
    assert len(set(secrets)) == 3
    rows = await _card_rows(db, inv_id)
    assert [s for s, _, _ in rows] == ["canceled", "canceled", "pending"]
    assert rows[1][1] in gateway.canceled_intents  # a declined intent could still be confirmed


async def test_card_tip_change_supersedes_the_live_attempt(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    inv_id, token = await _card_ready_invoice(db)
    plain = (await pay_link_card(api, db, token)).json()["client_secret"]
    tipped = await pay_link_card(api, db, token, tip_cents=1200)
    assert tipped.status_code == 200, tipped.text
    retried = (await pay_link_card(api, db, token, tip_cents=1200)).json()
    assert retried["client_secret"] == tipped.json()["client_secret"] != plain
    back = (await pay_link_card(api, db, token)).json()["client_secret"]
    assert back not in (plain, tipped.json()["client_secret"])  # a canceled intent never returns
    rows = await _card_rows(db, inv_id)
    assert [(s, tip) for s, _, tip in rows] == [("canceled", 0), ("canceled", 1200), ("pending", 0)]
    assert gateway.canceled_intents == [rows[0][1], rows[1][1]]


async def test_card_attempt_refused_while_the_payer_already_confirmed(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    inv_id, token = await _card_ready_invoice(db)
    await pay_link_card(api, db, token)
    live = (await _card_rows(db, inv_id))[0][1]
    assert live is not None
    gateway.confirmed.add(live)
    res = await pay_link_card(api, db, token, tip_cents=500)
    assert res.status_code == 409
    assert [s for s, _, _ in await _card_rows(db, inv_id)] == ["pending"]


async def test_a_card_payment_stripe_took_reads_as_paying_until_its_event_settles(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    inv_id, token = await _card_ready_invoice(db)
    assert (await api.get(f"/pay/{token}")).json()["paying"] is False
    await pay_link_card(api, db, token)
    live = (await _card_rows(db, inv_id))[0][1]
    assert live is not None
    gateway.confirmed.add(live)
    page = (await api.get(f"/pay/{token}")).json()
    assert (page["paying"], page["clearing"], page["status"], page["balance_cents"]) == (
        True,
        False,
        "sent",
        8000,
    )
    again = await pay_link_card(api, db, token)
    assert again.status_code == 409
    assert again.json()["error"] == "payment_in_progress"
    assert [s for s, _, _ in await _card_rows(db, inv_id)] == ["pending"]


async def _pending_charge(
    db: AsyncSession, inv_id: str, ref: str, cents: int, method: str = "card"
) -> None:
    invoice = await db.get(Invoice, inv_id)
    assert invoice is not None
    db.add(
        Payment(
            id=new_id("payment"),
            business_id=BIZ,
            client_id=invoice.client_id,
            kind="payment",
            invoice_id=inv_id,
            amount_cents=cents,
            currency="CAD",
            method=method,
            provider="stripe",
            provider_ref=ref,
            status="pending",
        )
    )
    await db.flush()


async def test_a_part_staff_charged_holds_the_link_until_it_settles(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    inv_id, token = await _card_ready_invoice(db)
    await _pending_charge(db, inv_id, "pi_staff_part", 3000)
    gateway.confirmed.add("pi_staff_part")
    page = (await api.get(f"/pay/{token}")).json()
    assert (page["paying"], page["paying_part"], page["balance_cents"]) == (False, True, 8000)
    again = await pay_link_card(api, db, token)
    assert again.status_code == 409
    assert again.json()["error"] == "payment_in_progress"


async def test_a_bank_debit_clearing_for_the_whole_balance_reads_as_clearing(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    inv_id, token = await _card_ready_invoice(db)
    await db.execute(
        update(Invoice).where(Invoice.id == inv_id).values(overdue_notified_at=clock.now())
    )
    await _pending_charge(db, inv_id, "pi_pad_whole", 8000, method="bank_eft")
    gateway.intent_statuses["pi_pad_whole"] = "processing"
    page = (await api.get(f"/pay/{token}")).json()
    assert (page["status"], page["paying"], page["clearing"]) == ("overdue", True, True)


async def test_an_attempt_stripe_closed_is_not_paying(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    inv_id, token = await _card_ready_invoice(db)
    await _pending_charge(db, inv_id, "pi_closed", 8000)
    gateway.intent_statuses["pi_closed"] = "canceled"
    page = (await api.get(f"/pay/{token}")).json()
    assert (page["paying"], page["clearing"]) == (False, False)
    assert gateway.status_reads == ["pi_closed"]


async def test_a_paid_invoice_never_asks_stripe_whether_it_is_paying(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    inv_id, token = await _card_ready_invoice(db)
    await ledger.post(
        db,
        BIZ,
        event="payment",
        ref=f"test:paid:{inv_id}",
        legs=[Leg("business", BIZ, "bank", 8000), Leg("client", "cl_x", "receivable", -8000)],
        subject=("invoice", inv_id),
    )
    page = (await api.get(f"/pay/{token}")).json()
    assert (page["status"], page["paying"]) == ("paid", False)
    assert gateway.status_reads == []


async def test_card_payment_is_refused_when_the_balance_changed_since_the_page_loaded(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    inv_id, token = await _card_ready_invoice(db)
    stale = await api.post(f"/pay/{token}/card", json={"balance_cents": 5000, "tip_cents": 0})
    assert stale.status_code == 409
    assert stale.json()["error"] == "invoice_changed"
    assert await _card_rows(db, inv_id) == []
    fresh = await pay_link_card(api, db, token, tip_cents=600)
    assert fresh.status_code == 200, fresh.text
    assert fresh.json()["amount_cents"] == 8600


async def test_card_payment_on_a_paid_or_void_invoice_says_the_invoice_changed(
    api: httpx.AsyncClient, as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    inv_id, token = await _card_ready_invoice(db)
    assert (await as_owner.post(f"/v1/invoices/{inv_id}/void")).status_code == 200
    refused = await api.post(f"/pay/{token}/card", json={"balance_cents": 8000, "tip_cents": 0})
    assert (refused.status_code, refused.json()["error"]) == (409, "invoice_changed")


async def _declined_attempt(api: httpx.AsyncClient, db: AsyncSession) -> tuple[str, str]:
    """An invoice whose card attempt was declined; the client's open form can still confirm it."""
    inv_id, token = await _card_ready_invoice(db)
    assert (await pay_link_card(api, db, token)).status_code == 200
    pi = (await _card_rows(db, inv_id))[0][1]
    assert pi is not None
    failed = _intent_event("payment_intent.payment_failed", pi)
    assert (await api.post("/webhooks/stripe", content=failed, headers=GOOD)).status_code == 200
    return inv_id, pi


async def _late_success(api: httpx.AsyncClient, db: AsyncSession, pi: str) -> Payment:
    late = _intent_event("payment_intent.succeeded", pi)
    assert (await api.post("/webhooks/stripe", content=late, headers=GOOD)).status_code == 200
    return (
        await db.execute(
            select(Payment)
            .where(Payment.provider_ref == pi)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def _refunds_of(db: AsyncSession, payment: Payment) -> list[tuple[int, str | None]]:
    rows = await db.execute(
        select(Payment.amount_cents, Payment.reason).where(
            Payment.kind == "refund", Payment.parent_payment_id == payment.id
        )
    )
    return [(cents, reason) for cents, reason in rows.tuples().all()]


async def test_a_declined_card_that_succeeds_after_cash_paid_the_invoice_is_refunded(
    api: httpx.AsyncClient,
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
) -> None:
    inv_id, pi = await _declined_attempt(api, db)
    cash = {"method": "cash", "amount_cents": 8000}
    paid = await as_owner.post(f"/v1/invoices/{inv_id}/payments", json=cash, headers=key())
    assert paid.status_code in (200, 201), paid.text
    late = await _late_success(api, db, pi)
    assert late.status == "succeeded"
    assert await _refunds_of(db, late) == [(8000, "unapplied_payment")]
    assert gateway.refunds == [(pi, 8000, True)]
    invoice = await db.get(Invoice, inv_id, populate_existing=True)
    assert invoice is not None
    assert (await ledger.invoice_state(db, invoice))[0] == "paid"
    assert await ledger.invoice_balance(db, invoice) == 0


async def test_a_declined_card_that_succeeds_after_the_invoice_was_voided_is_refunded(
    api: httpx.AsyncClient,
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
) -> None:
    inv_id, pi = await _declined_attempt(api, db)
    voided = await as_owner.post(f"/v1/invoices/{inv_id}/void")
    assert voided.status_code == 200, voided.text
    late = await _late_success(api, db, pi)
    assert await _refunds_of(db, late) == [(8000, "unapplied_payment")]
    assert gateway.refunds == [(pi, 8000, True)]
    invoice = await db.get(Invoice, inv_id, populate_existing=True)
    assert invoice is not None
    assert (await ledger.invoice_state(db, invoice))[0] == "void"
    # the payment and its refund cancel out, so the void invoice owes and holds nothing
    for category in ("receivable", "revenue", "tax"):
        assert (
            await ledger.subject_balance(
                db, BIZ, category=category, subject_type="invoice", subject_id=inv_id
            )
            == 0
        ), category


async def test_public_pay_is_rate_limited(api: httpx.AsyncClient, db: AsyncSession) -> None:
    rl = RateLimiter(limit=1, window_s=60.0)

    def limited() -> None:
        if not rl.check("x", 0.0):
            raise TooManyRequests("slow down")

    app.dependency_overrides[public_pay_rate_limit] = limited
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_account_id="acct_pub", stripe_charges_enabled=True)
    )
    _, token = await _sent_invoice(db)
    assert (await pay_link_card(api, db, token)).status_code == 200
    assert (await pay_link_card(api, db, token)).status_code == 429


async def test_pay_link_get_is_rate_limited(api: httpx.AsyncClient, db: AsyncSession) -> None:
    rl = RateLimiter(limit=1, window_s=60.0)

    def limited() -> None:
        if not rl.check("x", 0.0):
            raise TooManyRequests("slow down")

    app.dependency_overrides[public_pay_rate_limit] = limited
    _, token = await _sent_invoice(db)
    assert (await api.get(f"/pay/{token}")).status_code == 200
    assert (await api.get(f"/pay/{token}")).status_code == 429


async def test_public_invoice_carries_the_document(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await client_id(db)
    lines = [
        {"description": "Bath & Tidy", "unit_amount_cents": 4500, "tax_class": "federal_only"},
        {"description": "Shampoo", "unit_amount_cents": 2400},
    ]
    sent = (
        await as_owner.post("/v1/invoices", json={"client_id": cid, "lines": lines, "send": True})
    ).json()
    paid = await as_owner.post(
        f"/v1/invoices/{sent['id']}/payments",
        json={"method": "etransfer", "amount_cents": 5000, "send_receipt": False},
        headers=key(),
    )
    assert paid.status_code == 201, paid.text
    page = (await as_owner.get(f"/pay/{sent['pay_token']}")).json()
    assert page["client_name"]
    assert page["status"] == "partial"
    assert [ln["tax_codes"] for ln in page["lines"]] == [["GST"], ["GST", "PST"]]
    assert page["taxes"] == [
        {"code": "GST", "rate_bps": 500, "base_cents": 6900, "cents": 345},
        {"code": "PST", "rate_bps": 700, "base_cents": 2400, "cents": 168},
    ]
    assert page["total_cents"] == 7413
    assert page["credits"][0]["kind"] == "payment"
    assert page["credits"][0]["method"] == "etransfer"
    assert page["credits"][0]["amount_cents"] == 5000
    assert page["balance_cents"] == 2413


async def test_a_refunded_invoice_lists_each_credit_note_and_reads_refunded(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await client_id(db)
    lines = [{"description": "Nails", "unit_amount_cents": 4762, "tax_class": "federal_only"}]
    sent = (
        await as_owner.post("/v1/invoices", json={"client_id": cid, "lines": lines, "send": True})
    ).json()
    paid = await as_owner.post(
        f"/v1/invoices/{sent['id']}/payments",
        json={"method": "cash", "amount_cents": 5000, "send_receipt": False},
        headers=key(),
    )
    assert paid.status_code == 201, paid.text
    pid = paid.json()["payment_id"]
    statuses: list[str] = []
    for cents in (1000, 4000):
        refund = await as_owner.post(
            f"/v1/payments/{pid}/refund",
            json={"amount_cents": cents, "notify": False},
            headers=key(),
        )
        assert refund.status_code == 200, refund.text
        statuses.append((await as_owner.get(f"/pay/{sent['pay_token']}")).json()["status"])
    assert statuses == ["paid", "refunded"]
    page = (await as_owner.get(f"/pay/{sent['pay_token']}")).json()
    number = sent["number"]
    assert [(r["credit_note"], r["amount_cents"]) for r in page["refunds"]] == [
        (f"CN-{number}-1", 1000),
        (f"CN-{number}-2", 4000),
    ]
    assert all(r["paid_at"] for r in page["refunds"])
    assert page["balance_cents"] == 0


async def test_public_invoice_names_who_a_tip_goes_to(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await client_id(db)
    lines = [
        {"description": "Groom", "unit_amount_cents": 6000, "staff_id": "st_diego"},
        {"description": "Nails", "unit_amount_cents": 1500, "staff_id": "st_priya"},
        {"description": "Bow", "unit_amount_cents": 500},
    ]
    sent = (
        await as_owner.post("/v1/invoices", json={"client_id": cid, "lines": lines, "send": True})
    ).json()
    page = (await as_owner.get(f"/pay/{sent['pay_token']}")).json()
    assert page["tip_for"] == ["Diego", "Priya"]

    plain = (
        await as_owner.post(
            "/v1/invoices",
            json={"client_id": cid, "lines": [lines[2]], "send": True},
        )
    ).json()
    assert (await as_owner.get(f"/pay/{plain['pay_token']}")).json()["tip_for"] == []


async def test_retail_only_invoice_does_not_accept_tip(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    invoice_id, token = await _card_ready_invoice(db)
    await db.execute(update(Line).where(Line.invoice_id == invoice_id).values(item_id="it_shampoo"))
    response = await api.get(f"/pay/{token}")
    assert response.json()["tip_base_cents"] == 0
    response = await pay_link_card(api, db, token, tip_cents=500)
    assert response.status_code == 422
    assert (await pay_link_card(api, db, token)).status_code == 200
