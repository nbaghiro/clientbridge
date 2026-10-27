"""Ways the books can drift from Stripe's balance; each test states the correct outcome."""

import json
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime

import httpx
import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.deps import Principal
from clientbridge.core.errors import Conflict
from clientbridge.core.ids import new_id
from clientbridge.integrations.stripe import ChargeFees
from clientbridge.models.billing import Invoice
from clientbridge.models.ledger import Entry
from clientbridge.models.payments import Payment
from clientbridge.models.platform import Audit
from clientbridge.schemas.reports import IncomeReport
from clientbridge.services import ledger
from clientbridge.services.payments import assert_payable
from clientbridge.services.reports import ReportService
from tests.conftest import BIZ, OWNER_USER, Factory, FakePaymentGateway, book_invoice
from tests.helpers import (
    business_balance,
    client_id,
    enable_payments,
    invoice,
    owner_balance,
    payment,
    payment_by_ref,
    sent_invoice,
    stripe_event,
)

STRIPE = {"Stripe-Signature": "good"}


async def _charge(
    db: AsyncSession,
    pi: str,
    *,
    status: str = "succeeded",
    invoice_id: str | None = None,
    amount: int = 8000,
) -> Payment:
    row = Payment(
        id=f"pay_{pi}",
        business_id=BIZ,
        client_id=await client_id(db),
        invoice_id=invoice_id,
        kind="payment",
        amount_cents=amount,
        currency="CAD",
        method="card",
        provider="stripe",
        provider_ref=pi,
        status=status,
        paid_at=clock.now() if status == "succeeded" else None,
    )
    db.add(row)
    await db.flush()
    if status == "succeeded":
        await ledger.post_payment(db, row)
    return row


def _refund(pi: str, status: str, **extra: object) -> dict[str, object]:
    return {"id": f"re_{pi}", "payment_intent": pi, "amount": 8000, "status": status, **extra}


def _dispute(
    pi: str, status: str, txns: Sequence[Mapping[str, object]], *, amount: int = 8000
) -> dict[str, object]:
    return {
        "id": f"du_{pi}",
        "payment_intent": pi,
        "amount": amount,
        "status": status,
        "balance_transactions": txns,
    }


async def test_refund_that_fails_after_succeeding_returns_the_money(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    """Stripe can fail a card refund up to 30 days after it succeeded; the balance gets it back."""
    await enable_payments(db)
    await _charge(db, "pi_rf")
    before = await business_balance(db, "stripe")
    income = await _income(db)
    await stripe_event(api, "refund.created", _refund("pi_rf", "succeeded"))
    assert await business_balance(db, "stripe") == before - 8000
    assert (await _income(db)).refunds_cents == income.refunds_cents + 8000
    await stripe_event(
        api,
        "refund.updated",
        _refund(
            "pi_rf",
            "failed",
            failure_reason="expired_or_canceled_card",
            failure_balance_transaction="txn_rf_back",
        ),
    )
    refund = await payment_by_ref(db, "re_pi_rf")
    assert refund.status == "failed"
    assert await business_balance(db, "stripe") == before
    assert (
        await _income(db) == income
    )  # the reversal carries the refund's source, so reports net it


async def _income(db: AsyncSession) -> IncomeReport:
    owner = Principal(user_id=OWNER_USER, business_id=BIZ, staff_id="st_owner", role="owner")
    lo, hi = datetime(2026, 1, 1, tzinfo=UTC), datetime(2027, 1, 1, tzinfo=UTC)
    return await ReportService(db, owner).income_summary_between(lo, hi)


async def test_won_dispute_reinstates_what_stripe_reinstated(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    """A win returns the amount and the countered fee; the ledger follows Stripe's transactions."""
    inv_id = await sent_invoice(db, number=9500, total=8000)
    await _charge(db, "pi_won", invoice_id=inv_id)
    assert (await invoice(db, inv_id)).status == "paid"
    before = await business_balance(db, "stripe")
    pulled = {"id": "txn_dp_out", "amount": -8000, "fee": 1500, "net": -9500}
    await stripe_event(
        api, "charge.dispute.created", _dispute("pi_won", "needs_response", [pulled])
    )
    assert await business_balance(db, "stripe") == before - 9500
    assert await _paid(db, inv_id) == ("paid", 0, 8000)  # the case is open, nothing is owed yet
    row = await db.get(Invoice, inv_id)
    assert row is not None
    with pytest.raises(Conflict):
        await assert_payable(db, row)
    back = {"id": "txn_dp_in", "amount": 8000, "fee": -1500, "net": 9500}
    await stripe_event(api, "charge.dispute.closed", _dispute("pi_won", "won", [pulled, back]))
    assert await business_balance(db, "stripe") == before
    assert await _paid(db, inv_id) == ("paid", 0, 8000)


async def _paid(db: AsyncSession, invoice_id: str) -> tuple[str, int, int]:
    out = await invoice(db, invoice_id)
    return out.status, out.balance_cents, out.amount_paid_cents


async def test_lost_dispute_writes_the_sale_off(
    api: httpx.AsyncClient, as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    """A lost chargeback is uncollectable: no receivable on the client, no revenue from the sale."""
    inv_id = await sent_invoice(db, number=9501, total=8000)
    row = await _charge(db, "pi_lost", invoice_id=inv_id)
    assert row.client_id is not None
    revenue = await business_balance(db, "revenue")
    taxable = await _taxable_sales(as_owner)
    income = await _income(db)
    pulled = {"id": "txn_lost_out", "amount": -8000, "fee": 1500, "net": -9500}
    await stripe_event(
        api, "charge.dispute.created", _dispute("pi_lost", "needs_response", [pulled])
    )
    await stripe_event(api, "charge.dispute.closed", _dispute("pi_lost", "lost", [pulled]))
    assert await owner_balance(db, "client", row.client_id, "receivable") == 0
    assert await business_balance(db, "revenue") == revenue + 8000
    assert await _paid(db, inv_id) == ("refunded", 0, 0)
    assert await _taxable_sales(as_owner) == taxable - 8000  # off GST line 101 with the revenue
    after = await _income(db)
    assert after.refunds_cents == income.refunds_cents + 8000  # money back, like a refund
    assert after.by_method["card"] == income.by_method["card"] - 8000


async def test_a_lost_dispute_stays_written_off_when_a_late_update_arrives(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    """The lost journal settles the case; the mirrored dispute status is display only."""
    inv_id = await sent_invoice(db, number=9503, total=8000)
    await _charge(db, "pi_late", invoice_id=inv_id)
    pulled = {"id": "txn_late_out", "amount": -8000, "fee": 1500, "net": -9500}
    await stripe_event(
        api, "charge.dispute.created", _dispute("pi_late", "needs_response", [pulled])
    )
    await stripe_event(api, "charge.dispute.closed", _dispute("pi_late", "lost", [pulled]))
    late = _dispute("pi_late", "under_review", [pulled])
    await stripe_event(api, "charge.dispute.updated", late)
    assert await _paid(db, inv_id) == ("refunded", 0, 0)


async def test_a_lost_dispute_and_a_refund_on_one_invoice_unwind_it_exactly(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    """Each unwind counts the other, so revenue and tax clear to the cent between them."""
    await enable_payments(db)
    row = Invoice(
        id=new_id("invoice"),
        business_id=BIZ,
        client_id=await client_id(db),
        number=9502,
        status="sent",
        currency="CAD",
        subtotal_cents=7619,
        tax_total_cents=381,
        total_cents=8000,
    )
    db.add(row)
    await db.flush()
    await book_invoice(db, row)
    await _charge(db, "pi_half_a", invoice_id=row.id, amount=4000)
    await _charge(db, "pi_half_b", invoice_id=row.id, amount=4000)
    pulled = {"id": "txn_half_out", "amount": -4000, "fee": 1500, "net": -5500}
    lost = _dispute("pi_half_a", "lost", [pulled], amount=4000)
    await stripe_event(api, "charge.dispute.created", {**lost, "status": "needs_response"})
    await stripe_event(api, "charge.dispute.closed", lost)
    await stripe_event(api, "charge.dispute.updated", {**lost, "status": "under_review"})
    await stripe_event(api, "refund.created", {**_refund("pi_half_b", "succeeded"), "amount": 4000})
    for category in ("revenue", "tax"):
        left = await ledger.subject_balance(
            db, BIZ, category=category, subject_type="invoice", subject_id=row.id
        )
        assert left == 0, category
    assert await _paid(db, row.id) == ("refunded", 0, 0)


async def _taxable_sales(as_owner: httpx.AsyncClient) -> int:
    res = await as_owner.get("/v1/reports/gst-hst?start=2026-01-01&end=2026-12-31")
    return int(res.json()["taxable_sales_cents"])


PAYOUT_CREATED = datetime(2026, 10, 12, 9, 0, tzinfo=UTC)
PAYOUT_ARRIVES = datetime(2026, 10, 14, tzinfo=UTC)
PAYOUT_FAILED = datetime(2026, 10, 15, 8, 30, tzinfo=UTC)


def _payout(payout_id: str, status: str) -> dict[str, object]:
    return {
        "id": payout_id,
        "amount": 5000,
        "currency": "cad",
        "status": status,
        "created": int(PAYOUT_CREATED.timestamp()),
        "arrival_date": int(PAYOUT_ARRIVES.timestamp()),
    }


async def _money(db: AsyncSession) -> tuple[int, int, int]:
    return (
        await business_balance(db, "stripe"),
        await business_balance(db, "transit"),
        await business_balance(db, "bank"),
    )


async def _dated(api: httpx.AsyncClient, event_type: str, obj: dict[str, object]) -> None:
    body = {
        "id": f"evt_{new_id('audit')}",
        "type": event_type,
        "account": "acct_test",
        "created": int(PAYOUT_FAILED.timestamp()),
        "data": {"object": obj},
    }
    res = await api.post("/webhooks/stripe", content=json.dumps(body), headers=STRIPE)
    assert res.status_code == 200, res.text


async def test_payout_moves_to_transit_when_created(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    """Stripe books the payout's balance transaction at creation, days before the bank has it."""
    await enable_payments(db)
    stripe, transit, bank = await _money(db)
    await stripe_event(api, "payout.created", _payout("po_new", "pending"))
    assert await _money(db) == (stripe - 5000, transit + 5000, bank)
    booked = await db.execute(
        select(Entry.occurred_at, Entry.available_at).where(Entry.ref == "payout:po_new").limit(1)
    )
    assert booked.one() == (PAYOUT_CREATED, PAYOUT_ARRIVES)


async def test_a_paid_payout_reaches_the_bank_on_its_arrival_date(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    stripe, transit, bank = await _money(db)
    for event_type, status in (
        ("payout.created", "pending"),
        ("payout.paid", "paid"),
        ("payout.paid", "paid"),
    ):
        await stripe_event(api, event_type, _payout("po_paid", status))
    assert await _money(db) == (stripe - 5000, transit, bank + 5000)
    arrived = await db.scalars(select(Entry.occurred_at).where(Entry.ref == "payout:po_paid:paid"))
    assert set(arrived) == {PAYOUT_ARRIVES}


async def test_a_paid_payout_arriving_before_its_creation_books_both_legs_once(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    stripe, transit, bank = await _money(db)
    await stripe_event(api, "payout.paid", _payout("po_early", "paid"))
    await stripe_event(api, "payout.created", _payout("po_early", "pending"))
    assert await _money(db) == (stripe - 5000, transit, bank + 5000)


async def test_canceled_payout_comes_back_dated_when_it_was_canceled(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    before = await _money(db)
    await stripe_event(api, "payout.created", _payout("po_cxl", "pending"))
    await _dated(api, "payout.canceled", _payout("po_cxl", "canceled"))
    assert await ledger.journal_for(db, BIZ, "payout:po_cxl") is not None
    assert await _money(db) == before
    returned = await db.scalars(
        select(Entry.occurred_at).where(Entry.ref == "payout:po_cxl:failed")
    )
    assert set(returned) == {PAYOUT_FAILED}


async def test_a_payout_that_fails_after_arriving_leaves_the_bank(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    before = await _money(db)
    await stripe_event(api, "payout.created", _payout("po_bounce", "pending"))
    await stripe_event(api, "payout.paid", _payout("po_bounce", "paid"))
    await _dated(api, "payout.failed", _payout("po_bounce", "failed"))
    await stripe_event(api, "payout.paid", _payout("po_bounce", "paid"))
    assert await _money(db) == before
    returned = await db.scalars(
        select(Entry.occurred_at).where(
            Entry.ref.in_(("payout:po_bounce:failed", "payout:po_bounce:paid:failed"))
        )
    )
    assert set(returned) == {PAYOUT_FAILED}


async def test_a_payout_that_fails_before_its_creation_lands_stays_reversed(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    """A retried `payout.created` carries its original snapshot, so it can't tell it failed."""
    await enable_payments(db)
    before = await _money(db)
    await stripe_event(api, "payout.failed", _payout("po_late", "failed"))
    await stripe_event(api, "payout.created", _payout("po_late", "pending"))
    await stripe_event(api, "payout.paid", _payout("po_late", "paid"))
    assert await _money(db) == before


async def test_a_foreign_currency_payout_is_refused_once(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    before = await _money(db)
    for event_type in ("payout.created", "payout.paid", "payout.paid"):
        await stripe_event(api, event_type, {**_payout("po_usd", "paid"), "currency": "usd"})
    refused = await db.scalars(select(Audit).where(Audit.action == "payout.refused"))
    assert [audit.changes["id"] for audit in refused] == ["po_usd"]
    assert await _money(db) == before


async def test_charge_without_a_readable_balance_transaction_is_retried(
    api: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No balance transaction yet means no fee figures; booking the charge gross is wrong."""
    await enable_payments(db)
    pay_id = (await _charge(db, "pi_nofee", status="pending")).id

    async def unreadable(account_id: str, *, payment_intent_id: str) -> ChargeFees | None:
        return None

    monkeypatch.setattr(gateway, "get_payment_fees", unreadable)
    await db.commit()
    body = json.dumps(
        {
            "id": "evt_nofee",
            "type": "payment_intent.succeeded",
            "account": "acct_test",
            "data": {"object": {"id": "pi_nofee"}},
        }
    )
    res = await api.post("/webhooks/stripe", content=body, headers=STRIPE)
    await db.rollback()
    assert res.status_code == 503
    assert (await payment(db, pay_id)).status == "pending"


async def test_another_account_cannot_settle_or_refund_this_business_charge(
    api: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    await enable_payments(db)
    pay_id = (await _charge(db, "pi_foreign", status="pending")).id
    other = await factory.business()
    other.stripe_account_id = "acct_foreign"
    await db.commit()
    for event_type, obj in (
        ("payment_intent.succeeded", {"id": "pi_foreign"}),
        ("refund.updated", _refund("pi_foreign", "succeeded")),
    ):
        body = {"id": f"evt_{new_id('audit')}", "type": event_type, "account": "acct_foreign"}
        res = await api.post(
            "/webhooks/stripe",
            content=json.dumps({**body, "data": {"object": obj}}),
            headers=STRIPE,
        )
        assert res.status_code == 200, res.text
    assert (await payment(db, pay_id)).status == "pending"
    refunds = await db.scalars(select(Payment).where(Payment.provider_ref == "re_pi_foreign"))
    assert list(refunds) == []


async def test_account_balance_cannot_leave_its_entries(db: AsyncSession) -> None:
    """balance_cents is a cache of SUM(entries); nothing may move it on its own."""
    await _charge(db, "pi_cache")
    with pytest.raises(DBAPIError):
        await db.execute(
            text(
                "UPDATE accounts SET balance_cents = balance_cents + 1"
                " WHERE business_id = :biz AND owner_type = 'business'"
                " AND owner_id = :biz AND category = 'stripe'"
            ),
            {"biz": BIZ},
        )


async def test_an_account_cannot_be_born_with_a_balance(db: AsyncSession) -> None:
    with pytest.raises(DBAPIError, match="only through ledger entries"):
        await db.execute(
            text(
                "INSERT INTO accounts (id, business_id, owner_type, owner_id, category, code,"
                " currency, balance_cents, created_at, updated_at)"
                " VALUES (:id, :biz, 'business', :biz, 'cash', 'born', 'CAD', 1, now(), now())"
            ),
            {"id": new_id("account"), "biz": BIZ},
        )


async def test_a_closed_dispute_ignores_a_late_creation_snapshot(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    inv_id = await sent_invoice(db, total=8000)
    row = await _charge(db, "pi_closed_first", invoice_id=inv_id)
    before = await business_balance(db, "stripe")
    pulled = {"amount": -8000, "fee": 1500, "net": -9500}
    returned = {"amount": 8000, "fee": -1500, "net": 9500}
    await stripe_event(
        api, "charge.dispute.closed", _dispute("pi_closed_first", "won", [pulled, returned])
    )
    await stripe_event(
        api, "charge.dispute.created", _dispute("pi_closed_first", "needs_response", [pulled])
    )
    await db.refresh(row)
    assert row.dispute_status == "won"
    assert await business_balance(db, "stripe") == before


async def test_dispute_fees_arriving_after_creation_are_booked(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    inv_id = await sent_invoice(db, total=8000)
    await _charge(db, "pi_late_fee", invoice_id=inv_id)
    before = await business_balance(db, "stripe")
    await stripe_event(api, "charge.dispute.created", _dispute("pi_late_fee", "needs_response", []))
    pulled = {"amount": -8000, "fee": 1500, "net": -9500}
    await stripe_event(
        api, "charge.dispute.funds_withdrawn", _dispute("pi_late_fee", "needs_response", [pulled])
    )
    assert await business_balance(db, "stripe") == before - 9500


@pytest.mark.parametrize("status", ["won", "lost"])
@pytest.mark.parametrize("event", ["charge.dispute.closed", "charge.dispute.funds_withdrawn"])
async def test_closed_dispute_reconciles_late_fees_without_reopening(
    api: httpx.AsyncClient, db: AsyncSession, status: str, event: str
) -> None:
    inv_id = await sent_invoice(db, total=8000)
    row = await _charge(db, "pi_closed_late_fee", invoice_id=inv_id)
    before = await business_balance(db, "stripe")
    await stripe_event(api, "charge.dispute.closed", _dispute(row.provider_ref or "", status, []))
    for fee in (1500, 2000, 1500, 2000):
        pulled = {"amount": -8000, "fee": fee, "net": -8000 - fee}
        await stripe_event(api, event, _dispute(row.provider_ref or "", status, [pulled]))
    await db.refresh(row)
    assert row.dispute_status == status
    assert await business_balance(db, "stripe") == before - 2000 - (8000 if status == "lost" else 0)


async def test_won_dispute_reconciles_incremental_fee_returns(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    inv_id = await sent_invoice(db, total=8000)
    row = await _charge(db, "pi_fee_return", invoice_id=inv_id)
    before = await business_balance(db, "stripe")
    pulled = {"amount": -8000, "fee": 2000, "net": -10000}
    for returned in (500, 2000, 500, 2000):
        credit = {"amount": 8000, "fee": -returned, "net": 8000 + returned}
        await stripe_event(
            api, "charge.dispute.closed", _dispute(row.provider_ref or "", "won", [pulled, credit])
        )
    assert await business_balance(db, "stripe") == before
