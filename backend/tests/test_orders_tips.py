import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.billing import Order
from clientbridge.models.ledger import Account, Entry
from clientbridge.models.payments import Payment
from clientbridge.services import ledger
from tests.helpers import enable_payments, key, ok, payment, sent_invoice, settle

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
    approved = ok(await as_owner.post(f"/v1/earnings/{journal}/approve")).json()
    assert (approved["kind"], approved["amount_cents"], approved["staff_id"]) == (
        "tip",
        300,
        "st_owner",
    )
    paid_out = ok(await as_owner.post(f"/v1/earnings/{journal}/pay")).json()
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


async def test_pay_link_takes_a_tip_for_the_invoice(
    api: httpx.AsyncClient, unauth: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    inv = await sent_invoice(db, total=10000, pay_token="tok_tip")
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


async def test_pay_link_refuses_a_tip_larger_than_the_bill(
    unauth: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    await sent_invoice(db, total=1000, pay_token="tok_big")
    res = await unauth.post("/pay/tok_big/card", json={"tip_cents": 5000})
    assert res.status_code == 422


async def _order(db: AsyncSession, order_id: str) -> Order:
    row = await db.get(Order, order_id, populate_existing=True)
    assert row is not None
    return row
