import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice, Line, Order
from clientbridge.models.clients import Client
from clientbridge.models.ledger import Account, Entry
from clientbridge.models.payments import Payment
from clientbridge.services import ledger
from clientbridge.services.earnings import cancel_returned_tips, load_earning
from clientbridge.services.ledger import Leg
from tests.conftest import FakeEmailSender, FakePaymentGateway, FakeSmsSender
from tests.helpers import enable_payments, key, ok, payment, sent_invoice, settle, stripe_event

BIZ = "bz_birchbark"
GROOM = {
    "description": "Full Groom",
    "unit_amount_cents": 7500,
    "item_id": "it_groom_sm",
    "tax_class": "federal_only",
    "staff_id": "st_diego",
    "discount": {"kind": "percent", "value": 10, "reason": "Loyalty"},
}
SHAMPOO = {
    "description": "Shampoo",
    "unit_amount_cents": 2400,
    "item_id": "it_shampoo",
    "tax_class": "standard",
    "staff_id": "st_owner",
}
SALE = {"lines": [GROOM, SHAMPOO], "discount": {"kind": "amount", "value": 500, "reason": "Wait"}}


async def _tip_journals(db: AsyncSession, payment_id: str) -> dict[str, int]:
    rows = await db.execute(
        select(Account.owner_id, Entry.amount_cents)
        .join(Account, Account.id == Entry.account_id)
        .where(Entry.event == "tip", Entry.source_id == payment_id, Account.category == "payable")
    )
    owed: dict[str, int] = {}
    for staff_id, cents in rows.tuples().all():
        owed[staff_id] = owed.get(staff_id, 0) - cents
    return owed


async def test_discounted_taxed_sale_with_a_cash_tip_books_every_part(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    sale = ok(await as_owner.post("/v1/orders", json=SALE), 201).json()
    assert (sale["subtotal_cents"], sale["tax_total_cents"], sale["total_cents"]) == (
        8650,
        591,
        9241,
    )
    assert [ln["amount_cents"] for ln in sale["lines"]] == [6381, 2269]
    assert [ln["discount_cents"] for ln in sale["lines"]] == [750, 0]
    assert [ln["sale_discount_cents"] for ln in sale["lines"]] == [369, 131]
    assert sale["discount_cents"] == 1250
    paid = ok(
        await as_owner.post(
            f"/v1/orders/{sale['id']}/cash",
            json={"tendered_cents": 11000, "tip_cents": 1298},
            headers=key(),
        )
    ).json()
    assert (paid["amount_cents"], paid["tip_cents"], paid["change_cents"]) == (10539, 1298, 461)
    assert await _tip_journals(db, paid["payment_id"]) == {"st_diego": 958, "st_owner": 340}
    revenue = await db.execute(
        select(Account.category, Account.code, Entry.amount_cents)
        .join(Account, Account.id == Entry.account_id)
        .where(Entry.ref == f"payment:{paid['payment_id']}")
    )
    legs = {(c, code): cents for c, code, cents in revenue.tuples().all()}
    assert legs == {
        ("cash", ""): 10539,
        ("revenue", ""): -8650,
        ("tax", "GST"): -432,
        ("tax", "PST"): -159,
        ("staff_cost", ""): -1298,
    }
    order = ok(await as_owner.get("/v1/orders/held")).json()
    assert sale["id"] not in [o["id"] for o in order]


async def test_a_part_refund_returns_the_tip_pro_rata_and_the_last_returns_the_rest(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    sale = ok(await as_owner.post("/v1/orders", json=SALE), 201).json()
    paid = ok(
        await as_owner.post(
            f"/v1/orders/{sale['id']}/cash",
            json={"tendered_cents": 10539, "tip_cents": 1298},
            headers=key(),
        )
    ).json()
    pid = paid["payment_id"]
    preview = ok(await as_owner.get(f"/v1/payments/{pid}/refund-preview?amount_cents=5000")).json()
    parts = {(p["category"], p["code"]): p["cents"] for p in preview["parts"]}
    assert parts[("staff_cost", "")] == 615  # 1298 x 5000 / 10539
    assert sum(parts.values()) == 5000
    first = ok(
        await as_owner.post(
            f"/v1/payments/{pid}/refund", json={"amount_cents": 5000}, headers=key()
        )
    ).json()
    assert first["credit_note"].startswith("CN-S-")
    back = await _tip_journals(db, first["refund_id"])
    assert back == {"st_diego": -454, "st_owner": -161}
    ok(await as_owner.post(f"/v1/payments/{pid}/refund", json={}, headers=key()))
    rows = await db.execute(
        select(Account.owner_id, Entry.amount_cents)
        .join(Account, Account.id == Entry.account_id)
        .where(Entry.event == "tip", Account.category == "payable", Entry.subject_id == sale["id"])
    )
    net: dict[str, int] = {}
    for staff_id, cents in rows.tuples().all():
        net[staff_id] = net.get(staff_id, 0) + cents
    assert net == {"st_diego": 0, "st_owner": 0}
    status, _ = await ledger.order_state(db, await _order(db, sale["id"]))
    assert status == "refunded"


async def test_a_tip_is_approved_and_paid_like_an_earning(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    sale = ok(await as_owner.post("/v1/orders", json={"lines": [SHAMPOO]}), 201).json()
    paid = ok(
        await as_owner.post(
            f"/v1/orders/{sale['id']}/cash",
            json={"tendered_cents": 5000, "tip_cents": 300},
            headers=key(),
        )
    ).json()
    journal = (
        await db.execute(
            select(Entry.journal_id).where(
                Entry.event == "tip", Entry.source_id == paid["payment_id"]
            )
        )
    ).scalar()
    ids = {"ids": [journal]}
    [approved] = ok(await as_owner.post("/v1/earnings/approve", json=ids)).json()["earnings"]
    assert (approved["kind"], approved["amount_cents"], approved["staff_id"]) == (
        "tip",
        300,
        "st_owner",
    )
    [paid_out] = ok(await as_owner.post("/v1/earnings/pay", json=ids)).json()["earnings"]
    assert paid_out["status"] == "paid"


async def test_a_manual_split_gives_the_whole_tip_to_one_person(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    sale = ok(await as_staff.post("/v1/orders", json={"lines": [GROOM, SHAMPOO]}), 201).json()
    paid = ok(
        await as_staff.post(
            f"/v1/orders/{sale['id']}/cash",
            json={
                "tendered_cents": 20000,
                "tip_cents": 1000,
                "tip_split": [{"staff_id": "st_priya", "cents": 1000}],
            },
            headers=key(),
        )
    ).json()
    assert await _tip_journals(db, paid["payment_id"]) == {"st_priya": 1000}


async def test_tip_split_errors(as_owner: httpx.AsyncClient) -> None:
    sale = ok(await as_owner.post("/v1/orders", json={"lines": [SHAMPOO]}), 201).json()
    url = f"/v1/orders/{sale['id']}/cash"
    short = await as_owner.post(
        url,
        json={
            "tendered_cents": 9000,
            "tip_cents": 100,
            "tip_split": [{"staff_id": "st_owner", "cents": 50}],
        },
        headers=key(),
    )
    assert short.status_code == 422
    stranger = await as_owner.post(
        url,
        json={
            "tendered_cents": 9000,
            "tip_cents": 100,
            "tip_split": [{"staff_id": "st_nope", "cents": 100}],
        },
        headers=key(),
    )
    assert stranger.status_code == 404
    orphan = await as_owner.post(
        url,
        json={"tendered_cents": 9000, "tip_split": [{"staff_id": "st_owner", "cents": 100}]},
        headers=key(),
    )
    assert orphan.status_code == 422


async def test_card_tip_settles_through_the_webhook(
    api: httpx.AsyncClient, as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    sale = ok(await as_owner.post("/v1/orders", json={"lines": [GROOM]}), 201).json()
    intent = ok(
        await as_owner.post(f"/v1/orders/{sale['id']}/pay", json={"tip_cents": 500}, headers=key())
    ).json()
    pay = await payment(db, intent["payment_id"])
    assert (pay.amount_cents, pay.tip_cents) == (sale["total_cents"] + 500, 500)
    await settle(api, db, intent["payment_id"])
    assert await _tip_journals(db, intent["payment_id"]) == {"st_diego": 500}
    status, _ = await ledger.order_state(db, await _order(db, sale["id"]))
    assert status == "paid"


async def test_a_tipped_receipt_lists_the_tip_and_counts_it_in_the_total(
    api: httpx.AsyncClient,
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
) -> None:
    await enable_payments(db)
    sale = ok(
        await as_owner.post(
            "/v1/orders", json={"lines": [SHAMPOO], "receipt_phone": "+12505550224"}
        ),
        201,
    ).json()
    intent = ok(
        await as_owner.post(f"/v1/orders/{sale['id']}/pay", json={"tip_cents": 500}, headers=key())
    ).json()
    await settle(api, db, intent["payment_id"])
    assert email.sent == []
    (receipt,) = [m for m in sms.sent if m.to == "+12505550224"]
    assert "Your payment of $31.88" in receipt.body
    assert "Tip  $5.00" in receipt.body
    assert "Total  $31.88" in receipt.body


async def test_pay_link_takes_a_tip_for_the_invoice(
    api: httpx.AsyncClient, unauth: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    inv = await sent_invoice(db, total=10000, pay_token="tok_tip")
    db.add(
        Line(
            id=new_id("line"),
            business_id=BIZ,
            invoice_id=inv,
            item_id="it_groom_sm",
            description="Full Groom",
            unit_amount_cents=10000,
            amount_cents=10000,
        )
    )
    await db.flush()
    res = ok(await unauth.post("/pay/tok_tip/card", json={"tip_cents": 1500}))
    assert res.json()["client_secret"]
    pay = (
        await db.execute(
            select(Payment).where(Payment.invoice_id == inv, Payment.status == "pending")
        )
    ).scalar_one()
    assert (pay.amount_cents, pay.tip_cents) == (11500, 1500)
    await settle(api, db, pay.id)
    assert await _tip_journals(db, pay.id) == {"st_owner": 1500}
    assert (
        await ledger.subject_balance(
            db, BIZ, category="receivable", subject_type="invoice", subject_id=inv
        )
        == 0
    )
    too_much = await unauth.post("/pay/tok_tip/card", json={"tip_cents": 1})
    assert too_much.status_code == 409


async def test_a_second_tipped_instalment_receipt_counts_every_tip_on_the_invoice(
    api: httpx.AsyncClient, unauth: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    await enable_payments(db)
    inv = await sent_invoice(db, total=10000, pay_token="tok_two")
    db.add(
        Line(
            id=new_id("line"),
            business_id=BIZ,
            invoice_id=inv,
            item_id="it_groom_sm",
            description="Full Groom",
            unit_amount_cents=10000,
            amount_cents=10000,
        )
    )
    invoice = await db.get(Invoice, inv)
    assert invoice is not None
    client = await db.get(Client, invoice.client_id)
    assert client is not None
    client.phone = "+15145550223"
    first = Payment(
        id=new_id("payment"),
        business_id=BIZ,
        client_id=invoice.client_id,
        kind="payment",
        invoice_id=inv,
        amount_cents=5500,
        tip_cents=500,
        tip_split=[{"staff_id": "st_owner", "cents": 500}],
        currency="CAD",
        method="cash",
        provider="manual",
        status="succeeded",
    )
    db.add(first)
    await db.flush()
    await ledger.post_payment(db, first)
    ok(await unauth.post("/pay/tok_two/card", json={"tip_cents": 1000}))
    second = (
        await db.execute(
            select(Payment).where(Payment.invoice_id == inv, Payment.status == "pending")
        )
    ).scalar_one()
    await settle(api, db, second.id)
    (receipt,) = [m for m in sms.sent if "Your payment of $60.00" in m.body]
    assert "Tip  $15.00" in receipt.body
    assert "Total  $115.00" in receipt.body


async def test_pay_link_refuses_a_tip_larger_than_the_bill(
    unauth: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    await sent_invoice(db, total=1000, pay_token="tok_big")
    res = await unauth.post("/pay/tok_big/card", json={"tip_cents": 5000})
    assert res.status_code == 422


async def test_tap_to_pay_takes_a_tip_split_as_given(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    sale = ok(await as_owner.post("/v1/orders", json={"lines": [GROOM, SHAMPOO]}), 201).json()
    split = [{"staff_id": "st_diego", "cents": 300}, {"staff_id": "st_priya", "cents": 200}]
    out = ok(
        await as_owner.post(
            f"/v1/orders/{sale['id']}/checkout",
            json={"tip_cents": 500, "tip_split": split},
            headers=key(),
        )
    ).json()
    charge = await payment(db, out["payment_id"])
    assert (charge.amount_cents, charge.tip_cents) == (sale["total_cents"] + 500, 500)
    assert charge.tip_split == split


@pytest.mark.parametrize(
    ("tip", "split", "status"),
    [
        (500, [{"staff_id": "st_diego", "cents": 400}], 422),
        (0, [{"staff_id": "st_diego", "cents": 100}], 422),
        (500, [{"staff_id": "st_nope", "cents": 500}], 404),
    ],
)
async def test_tap_to_pay_refuses_a_bad_tip_split(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    tip: int,
    split: list[dict[str, object]],
    status: int,
) -> None:
    await enable_payments(db)
    sale = ok(await as_owner.post("/v1/orders", json={"lines": [SHAMPOO]}), 201).json()
    res = await as_owner.post(
        f"/v1/orders/{sale['id']}/checkout",
        json={"tip_cents": tip, "tip_split": split},
        headers=key(),
    )
    assert res.status_code == status
    opened = await db.execute(select(Payment.id).where(Payment.order_id == sale["id"]))
    assert opened.first() is None


async def _order(db: AsyncSession, order_id: str) -> Order:
    row = await db.get(Order, order_id, populate_existing=True)
    assert row is not None
    return row


async def test_a_rebuilt_card_sale_keeps_its_tip_split(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    """The sale's command never committed; the intent's metadata still owes each staff member."""
    await enable_payments(db)
    sale = ok(await as_owner.post("/v1/orders", json={"lines": [SHAMPOO]}), 201).json()
    intent = {
        "id": "pi_rebuilt_sale",
        "amount": sale["total_cents"] + 500,
        "currency": "cad",
        "metadata": {
            "business_id": BIZ,
            "order_id": sale["id"],
            "tip_cents": "500",
            "tip_split": "st_owner:300,st_diego:200",
        },
    }
    await stripe_event(as_owner, "payment_intent.succeeded", intent)
    rebuilt = (
        await db.execute(select(Payment).where(Payment.provider_ref == "pi_rebuilt_sale"))
    ).scalar_one()
    assert (rebuilt.status, rebuilt.order_id, rebuilt.tip_cents) == ("succeeded", sale["id"], 500)
    assert await _tip_journals(db, rebuilt.id) == {"st_owner": 300, "st_diego": 200}
    status = (
        await db.execute(select(ledger.order_status_expr()).where(Order.id == sale["id"]))
    ).scalar_one()
    assert status == "paid"


async def test_the_platform_fee_covers_the_tip_too(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    sale = ok(await as_owner.post("/v1/orders", json={"lines": [GROOM]}), 201).json()
    intent = ok(
        await as_owner.post(f"/v1/orders/{sale['id']}/pay", json={"tip_cents": 500}, headers=key())
    ).json()
    pay = await payment(db, intent["payment_id"])
    assert pay.provider_ref is not None
    charged, fee = gateway.charges[pay.provider_ref]
    assert charged == sale["total_cents"] + 500
    assert fee == charged * 30 // 10_000


async def _tipped_sale(as_owner: httpx.AsyncClient) -> tuple[str, str]:
    """A cash sale with a $3 tip for the owner, then refunded in full: (payment, refund)."""
    sale = ok(await as_owner.post("/v1/orders", json={"lines": [SHAMPOO]}), 201).json()
    paid = ok(
        await as_owner.post(
            f"/v1/orders/{sale['id']}/cash",
            json={"tendered_cents": 5000, "tip_cents": 300},
            headers=key(),
        )
    ).json()
    pid = paid["payment_id"]
    refund = ok(await as_owner.post(f"/v1/payments/{pid}/refund", json={}, headers=key()))
    return pid, refund.json()["refund_id"]


async def _journal(db: AsyncSession, ref: str) -> str:
    journal = await ledger.journal_for(db, BIZ, ref)
    assert journal is not None
    return journal


async def _tip_status(db: AsyncSession, journal: str) -> str:
    earning = await load_earning(db, BIZ, journal)
    assert earning is not None
    return earning.status


async def test_a_returned_tip_waits_for_the_tip_it_returns(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    pid, refund_id = await _tipped_sale(as_owner)
    tip = await _journal(db, f"tip:{pid}:st_owner")
    returned = await _journal(db, f"tip:{refund_id}:st_owner")
    meta = (
        await db.execute(select(Entry.meta).where(Entry.journal_id == returned).limit(1))
    ).scalar_one()
    assert meta["of"] == tip
    other = await ledger.post(
        db,
        BIZ,
        event="earning",
        ref=f"earning:{new_id('booking')}:0",
        legs=[
            Leg("business", BIZ, "staff_cost", 1000),
            Leg("staff", "st_owner", "payable", -1000, "pending"),
        ],
    )
    assert other is not None
    ok(await as_owner.post("/v1/earnings/pay", json={"ids": [other]}))
    assert [await _tip_status(db, j) for j in (tip, returned)] == ["pending", "pending"]


async def test_a_failed_refund_cancels_its_unpaid_returned_tip(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    pid, refund_id = await _tipped_sale(as_owner)
    returned = await _journal(db, f"tip:{refund_id}:st_owner")
    ok(await as_owner.post("/v1/earnings/approve", json={"ids": [returned]}))
    refund, original = await db.get(Payment, refund_id), await db.get(Payment, pid)
    assert refund is not None and original is not None
    await cancel_returned_tips(db, refund, original)
    await ledger.reverse_refund(db, refund, original)
    assert await _tip_status(db, returned) == "reversed"
    assert await ledger.journal_for(db, BIZ, f"tip:{refund_id}:st_owner:failed") is None
    assert await _tip_status(db, await _journal(db, f"tip:{pid}:st_owner")) == "pending"
