"""Gift-card purchase (charge now, grant on settlement) + redeem, against the seeded DB."""

from datetime import timedelta

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.ids import new_id
from clientbridge.models.billing import Order
from clientbridge.models.business import Business
from clientbridge.models.catalog import GiftCard, Item, StockMovement
from clientbridge.models.ledger import Account, Entry
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking
from clientbridge.services import ledger
from clientbridge.services.ledger import Leg
from tests.conftest import BIZ, Factory, FakePaymentGateway, FakeSmsSender
from tests.helpers import enable_payments, key, settle
from tests.helpers import key as retry_key

PURCHASER = "cl_marcus"  # seeded client with a default saved card (pm_demo_5454)


async def _active_card(db: AsyncSession, *, code: str, balance: int = 5000) -> GiftCard:
    card = GiftCard(
        id=new_id("gift_card"),
        business_id=BIZ,
        code=code,
        initial_cents=balance,
        status="active",
    )
    db.add(card)
    await db.flush()
    await ledger.post(
        db,
        BIZ,
        event="payment",
        ref=f"test:purchase:{card.id}",
        legs=[
            Leg("business", BIZ, "stripe", balance),
            Leg("gift_card", card.id, "gift_card", -balance),
        ],
        subject=("gift_card", card.id),
    )
    return card


async def _gift_item(db: AsyncSession, *, price: int) -> str:
    item = Item(id=new_id("item"), business_id=BIZ, kind="gift", name="Gift", price_cents=price)
    db.add(item)
    await db.flush()
    return item.id


async def test_purchase_off_session_creates_pending_card_and_payment(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    res = await as_owner.post(
        "/v1/gift-cards",
        json={
            "amount_cents": 5000,
            "purchaser_client_id": PURCHASER,
            "payment_method_id": "default",
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["gift_card_id"].startswith("gc_")
    assert len(body["code"]) == 12
    assert body["client_secret"]

    card = (
        await db.execute(select(GiftCard).where(GiftCard.id == body["gift_card_id"]))
    ).scalar_one()
    pay = (await db.execute(select(Payment).where(Payment.id == body["payment_id"]))).scalar_one()
    assert card.status == "pending"
    assert card.initial_cents == 5000
    assert await ledger.gift_card_balance(db, card) == 0  # liability books on settlement
    assert card.payment_id == pay.id
    assert pay.status == "pending" and pay.amount_cents == 5000  # face value, not taxed at sale
    assert gateway.charged_methods == ["pm_demo_5454"]


async def test_purchase_settles_active_and_notifies_recipient(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    await enable_payments(db)
    body = (
        await as_owner.post(
            "/v1/gift-cards",
            json={
                "amount_cents": 8000,
                "purchaser_client_id": PURCHASER,
                "payment_method_id": "default",
                "recipient": "+15145550233",
            },
        )
    ).json()
    await settle(as_owner, db, body["payment_id"], "evt_gc_settle")

    card = (
        await db.execute(select(GiftCard).where(GiftCard.id == body["gift_card_id"]))
    ).scalar_one()
    assert card.status == "active"
    sent = [m for m in sms.sent if m.to == "+15145550233"]
    assert len(sent) == 1
    assert body["code"] in sent[0].body
    assert "a $80.00 gift card" in sent[0].body  # in the purchase's currency


async def test_settle_redelivery_activates_once_and_notifies_once(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    # A new event id for the same intent gets past webhook dedup and must hit the settled guard
    await enable_payments(db)
    body = (
        await as_owner.post(
            "/v1/gift-cards",
            json={
                "amount_cents": 6000,
                "purchaser_client_id": PURCHASER,
                "payment_method_id": "default",
                "recipient": "+15145550234",
            },
        )
    ).json()
    await settle(as_owner, db, body["payment_id"], "evt_gc_first")
    card = (
        await db.execute(select(GiftCard).where(GiftCard.id == body["gift_card_id"]))
    ).scalar_one()
    assert card.status == "active"
    assert len([m for m in sms.sent if m.to == "+15145550234"]) == 1

    await settle(as_owner, db, body["payment_id"], "evt_gc_redelivery")  # second event id
    card = (
        await db.execute(select(GiftCard).where(GiftCard.id == body["gift_card_id"]))
    ).scalar_one()
    assert card.status == "active"  # still active, not re-activated
    assert len([m for m in sms.sent if m.to == "+15145550234"]) == 1


async def test_redeem_before_activation_409(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await enable_payments(db)
    body = (
        await as_owner.post(
            "/v1/gift-cards",
            json={
                "amount_cents": 5000,
                "purchaser_client_id": PURCHASER,
                "payment_method_id": "default",
            },
        )
    ).json()
    res = await as_owner.post(
        "/v1/gift-cards/redeem", json={"code": body["code"], "amount_cents": 1000}, headers=key()
    )
    assert res.status_code == 409


async def test_purchase_interactive_returns_client_secret(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    res = await as_owner.post(
        "/v1/gift-cards", json={"amount_cents": 5000, "purchaser_client_id": PURCHASER}
    )
    assert res.status_code == 201, res.text
    assert res.json()["client_secret"]
    assert gateway.charged_methods == []


async def test_purchase_by_item_uses_item_price(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    item_id = await _gift_item(db, price=7500)
    res = await as_owner.post(
        "/v1/gift-cards", json={"item_id": item_id, "purchaser_client_id": PURCHASER}
    )
    assert res.status_code == 201, res.text
    card = (
        await db.execute(select(GiftCard).where(GiftCard.id == res.json()["gift_card_id"]))
    ).scalar_one()
    assert card.initial_cents == 7500
    assert await ledger.gift_card_balance(db, card) == 0


async def test_purchase_not_onboarded_409(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    business = await db.get(Business, BIZ)
    assert business is not None
    business.stripe_account_id = None
    business.stripe_charges_enabled = False
    await db.flush()
    res = await as_owner.post(
        "/v1/gift-cards", json={"amount_cents": 5000, "purchaser_client_id": PURCHASER}
    )
    assert res.status_code == 409


async def test_purchase_requires_purchaser_422(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    res = await as_owner.post("/v1/gift-cards", json={"amount_cents": 5000})
    assert res.status_code == 422


async def test_purchase_requires_amount_or_item_422(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    res = await as_owner.post("/v1/gift-cards", json={"purchaser_client_id": PURCHASER})
    assert res.status_code == 422


async def test_purchase_negative_amount_422(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
        "/v1/gift-cards", json={"amount_cents": -5, "purchaser_client_id": PURCHASER}
    )
    assert res.status_code == 422


async def test_purchase_unknown_purchaser_404(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    res = await as_owner.post(
        "/v1/gift-cards", json={"amount_cents": 5000, "purchaser_client_id": "cl_nope"}
    )
    assert res.status_code == 404


async def test_purchase_zero_price_gift_item_409(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)  # the seeded "it_gift" item has price 0 — no amount to charge
    res = await as_owner.post(
        "/v1/gift-cards", json={"item_id": "it_gift", "purchaser_client_id": PURCHASER}
    )
    assert res.status_code == 409


async def test_purchase_non_gift_item_409(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await enable_payments(db)
    item_id = (
        (await db.execute(select(Item.id).where(Item.business_id == BIZ, Item.kind == "product")))
        .scalars()
        .first()
    )
    assert item_id
    res = await as_owner.post(
        "/v1/gift-cards", json={"item_id": item_id, "purchaser_client_id": PURCHASER}
    )
    assert res.status_code == 409


async def test_redeem_partial_then_balance(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    card = await _active_card(db, code="REDEEMCODE01", balance=5000)
    res = await as_owner.post(
        "/v1/gift-cards/redeem", json={"code": card.code, "amount_cents": 2000}, headers=key()
    )
    assert res.status_code == 200, res.text
    assert res.json()["balance_cents"] == 3000
    assert res.json()["status"] == "active"


async def test_redeem_unknown_code_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
        "/v1/gift-cards/redeem", json={"code": "NOPENOPENOPE", "amount_cents": 100}, headers=key()
    )
    assert res.status_code == 404


async def test_redeem_over_balance_409(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    card = await _active_card(db, code="OVERCODE0001", balance=5000)
    res = await as_owner.post(
        "/v1/gift-cards/redeem", json={"code": card.code, "amount_cents": 6000}, headers=key()
    )
    assert res.status_code == 409


async def test_redeem_zero_amount_409(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    card = await _active_card(db, code="ZEROCODE0001", balance=5000)
    res = await as_owner.post(
        "/v1/gift-cards/redeem", json={"code": card.code, "amount_cents": 0}, headers=key()
    )
    assert res.status_code == 409


async def test_redeem_to_zero_marks_redeemed(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    card = await _active_card(db, code="FULLCODE0001", balance=5000)
    full = await as_owner.post(
        "/v1/gift-cards/redeem", json={"code": card.code, "amount_cents": 5000}, headers=key()
    )
    assert full.status_code == 200
    assert full.json()["balance_cents"] == 0
    assert full.json()["status"] == "redeemed"
    again = await as_owner.post(
        "/v1/gift-cards/redeem", json={"code": card.code, "amount_cents": 1}, headers=key()
    )
    assert again.status_code == 409


async def test_staff_cannot_purchase_403(as_staff: httpx.AsyncClient) -> None:
    res = await as_staff.post(
        "/v1/gift-cards", json={"amount_cents": 5000, "purchaser_client_id": PURCHASER}
    )
    assert res.status_code == 403


async def test_staff_cannot_redeem_403(as_staff: httpx.AsyncClient) -> None:
    res = await as_staff.post(
        "/v1/gift-cards/redeem", json={"code": "WHATEVER1234", "amount_cents": 100}, headers=key()
    )
    assert res.status_code == 403


async def test_other_business_code_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    db.add(
        GiftCard(
            id=new_id("gift_card"),
            business_id=other.id,
            code="OTHERBIZCODE",
            initial_cents=5000,
            status="active",
        )
    )
    await db.flush()
    res = await as_owner.post(
        "/v1/gift-cards/redeem", json={"code": "OTHERBIZCODE", "amount_cents": 100}, headers=key()
    )
    assert res.status_code == 404


async def test_code_collision_409(
    as_owner: httpx.AsyncClient, db: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    await enable_payments(db)
    monkeypatch.setattr("clientbridge.services.entitlements._gift_code", lambda: "FIXEDCODE123")
    body = {"amount_cents": 1000, "purchaser_client_id": PURCHASER, "payment_method_id": "default"}
    first = await as_owner.post("/v1/gift-cards", json=body)
    assert first.status_code == 201
    second = await as_owner.post("/v1/gift-cards", json=body)
    assert second.status_code == 409


async def test_idempotent_purchase_replays(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    headers = {"Idempotency-Key": "gc-buy-1"}
    body = {"amount_cents": 4000, "purchaser_client_id": PURCHASER, "payment_method_id": "default"}
    first = await as_owner.post("/v1/gift-cards", json=body, headers=headers)
    second = await as_owner.post("/v1/gift-cards", json=body, headers=headers)
    assert first.status_code == 201 and second.status_code == 201
    assert first.json()["gift_card_id"] == second.json()["gift_card_id"]
    assert first.json()["code"] == second.json()["code"]
    assert first.json()["payment_id"] == second.json()["payment_id"]
    assert gateway.charged_methods.count("pm_demo_5454") == 1  # one off-session charge
    cards = (
        await db.execute(select(GiftCard.id).where(GiftCard.id == first.json()["gift_card_id"]))
    ).all()
    payments = (
        await db.execute(select(Payment.id).where(Payment.id == first.json()["payment_id"]))
    ).all()
    assert len(cards) == 1 and len(payments) == 1


async def test_distinct_keys_purchase_twice(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    body = {"amount_cents": 4000, "purchaser_client_id": PURCHASER, "payment_method_id": "default"}
    first = await as_owner.post("/v1/gift-cards", json=body, headers={"Idempotency-Key": "k1"})
    second = await as_owner.post("/v1/gift-cards", json=body, headers={"Idempotency-Key": "k2"})
    assert first.status_code == 201 and second.status_code == 201
    assert first.json()["gift_card_id"] != second.json()["gift_card_id"]
    assert first.json()["payment_id"] != second.json()["payment_id"]
    assert gateway.charged_methods.count("pm_demo_5454") == 2


async def test_refund_voids_settled_gift_card(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    body = (
        await as_owner.post(
            "/v1/gift-cards",
            json={
                "amount_cents": 5000,
                "purchaser_client_id": PURCHASER,
                "payment_method_id": "default",
            },
        )
    ).json()
    await settle(as_owner, db, body["payment_id"], "evt_gc_refund")
    card = (
        await db.execute(select(GiftCard).where(GiftCard.id == body["gift_card_id"]))
    ).scalar_one()
    assert card.status == "active"
    refunded = await as_owner.post(
        f"/v1/payments/{body['payment_id']}/refund", json={}, headers=retry_key()
    )
    assert refunded.status_code == 200, refunded.text
    card = (
        await db.execute(select(GiftCard).where(GiftCard.id == body["gift_card_id"]))
    ).scalar_one()
    assert card.status == "void"


async def test_refund_partially_redeemed_gift_card_blocked(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    body = (
        await as_owner.post(
            "/v1/gift-cards",
            json={
                "amount_cents": 5000,
                "purchaser_client_id": PURCHASER,
                "payment_method_id": "default",
            },
        )
    ).json()
    await settle(as_owner, db, body["payment_id"], "evt_gc_partial_refund")
    redeemed = await as_owner.post(
        "/v1/gift-cards/redeem", json={"code": body["code"], "amount_cents": 2000}, headers=key()
    )
    assert redeemed.status_code == 200, redeemed.text
    # $20 of value already delivered → refunding the full $50 purchase must be blocked
    refunded = await as_owner.post(
        f"/v1/payments/{body['payment_id']}/refund", json={}, headers=retry_key()
    )
    assert refunded.status_code == 409
    assert refunded.json()["error"] == "gift_card_redeemed"
    preview = await as_owner.get(f"/v1/payments/{body['payment_id']}/refund-preview")
    assert preview.status_code == 200 and preview.json()["blocked"] == "gift_card_redeemed"


async def test_redeem_replays_on_the_same_key(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    card = await _active_card(db, code="REPLAYCODE01", balance=5000)
    headers = key()
    body = {"code": card.code, "amount_cents": 2000}
    first = await as_owner.post("/v1/gift-cards/redeem", json=body, headers=headers)
    again = await as_owner.post("/v1/gift-cards/redeem", json=body, headers=headers)
    assert first.status_code == again.status_code == 200
    assert again.json() == first.json()
    assert await ledger.gift_card_balance(db, card) == 3000


async def test_a_redemption_at_a_balance_seen_before_still_redeems(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    card = await _active_card(db, code="SAMEBAL01", balance=8000)
    body = {"code": card.code, "amount_cents": 2000}
    assert (
        await as_owner.post("/v1/gift-cards/redeem", json=body, headers=key())
    ).status_code == 200
    await ledger.post(
        db,
        BIZ,
        event="reversal",
        ref=f"test:topup:{card.id}",
        legs=[Leg("gift_card", card.id, "gift_card", -2000), Leg("business", BIZ, "revenue", 2000)],
        subject=("gift_card", card.id),
    )
    again = {"code": card.code, "amount_cents": 3000}
    assert (
        await as_owner.post("/v1/gift-cards/redeem", json=again, headers=key())
    ).status_code == 200
    assert await ledger.gift_card_balance(db, card) == 5000


async def test_an_expired_card_is_refused_before_the_sweep_runs(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    card = await _active_card(db, code="EXPIRED01", balance=5000)
    card.expires_at = clock.now() - timedelta(minutes=1)
    await db.flush()
    body = {"code": card.code, "amount_cents": 1000}
    res = await as_owner.post("/v1/gift-cards/redeem", json=body, headers=key())
    assert res.status_code == 409
    await db.refresh(card)
    assert await ledger.gift_card_balance(db, card) == 5000


async def test_a_redemption_needs_an_idempotency_key(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    card = await _active_card(db, code="NOKEY0001", balance=5000)
    body = {"code": card.code, "amount_cents": 1000}
    assert (await as_owner.post("/v1/gift-cards/redeem", json=body)).status_code == 422


@pytest.mark.parametrize("path", ["/v1/gift-cards", "/v1/gift-cards/redeem"])
async def test_writes_need_a_session_401(unauth: httpx.AsyncClient, path: str) -> None:
    body = {"code": "WHATEVER1234", "amount_cents": 100, "purchaser_client_id": PURCHASER}
    assert (await unauth.post(path, json=body, headers=key())).status_code == 401


BRUSH = {"description": "Brush", "unit_amount_cents": 2900, "tax_class": "standard"}


async def _sale(api: httpx.AsyncClient) -> dict[str, object]:
    created = await api.post("/v1/orders", json={"lines": [BRUSH]})
    assert created.status_code == 201, created.text
    sale: dict[str, object] = created.json()
    return sale


async def _apply(
    api: httpx.AsyncClient, order_id: object, code: str, headers: dict[str, str] | None = None
) -> httpx.Response:
    return await api.post(
        f"/v1/orders/{order_id}/gift-card", json={"code": code}, headers=headers or key()
    )


async def _balance(db: AsyncSession, card: GiftCard) -> int:
    return await ledger.gift_card_balance(db, card)


async def test_a_gift_card_pays_part_of_a_sale_and_cash_pays_the_rest(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    card = await _active_card(db, code="GIFTPART", balance=1000)
    sale = await _sale(as_staff)
    applied = await _apply(as_staff, sale["id"], "GIFTPART")
    assert applied.status_code == 200, applied.text
    out = applied.json()
    assert (out["gift_card_cents"], out["status"]) == (1000, "open")
    assert out["due_cents"] == out["total_cents"] - 1000
    assert await _balance(db, card) == 0
    paid = await as_staff.post(
        f"/v1/orders/{sale['id']}/cash", json={"tendered_cents": 5000}, headers=key()
    )
    assert paid.status_code == 200, paid.text
    assert paid.json()["amount_cents"] == out["due_cents"]


async def test_a_gift_card_with_enough_balance_settles_the_sale(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    card = await _active_card(db, code="GIFTFULL", balance=10000)
    sale = await _sale(as_owner)
    out = (await _apply(as_owner, sale["id"], "GIFTFULL")).json()
    assert (out["status"], out["gift_card_cents"]) == ("paid", sale["total_cents"])
    assert out["paid_at"] is not None
    assert await _balance(db, card) == 10000 - int(str(sale["total_cents"]))


async def _booked(db: AsyncSession) -> tuple[int, int]:
    """The business's tax and revenue balances, as credits."""
    tax = await ledger.account_total(db, BIZ, Account.category == "tax")
    revenue = await ledger.account_total(db, BIZ, Account.category == "revenue")
    return -tax, -revenue


async def _gst(as_owner: httpx.AsyncClient) -> tuple[int, int]:
    report = (await as_owner.get("/v1/reports/gst-hst?start=2026-01-01&end=2026-12-31")).json()
    collected = int(report["tax_collected_cents"]) + int(report["pst_cents"])
    return collected, int(report["taxable_sales_cents"])


async def test_a_sale_paid_by_gift_card_books_its_tax(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _active_card(db, code="GIFTTAX", balance=10000)
    tax_before, revenue_before = await _booked(db)
    gst_before = await _gst(as_owner)
    sale = await _sale(as_owner)
    assert (await _apply(as_owner, sale["id"], "GIFTTAX")).json()["status"] == "paid"
    total, tax = int(str(sale["total_cents"])), int(str(sale["tax_total_cents"]))
    assert tax > 0
    tax_after, revenue_after = await _booked(db)
    assert (tax_after - tax_before, revenue_after - revenue_before) == (tax, total - tax)
    gst_after = await _gst(as_owner)
    assert gst_after[0] - gst_before[0] == tax
    assert gst_after[1] - gst_before[1] == total - tax


async def test_a_gift_card_and_cash_book_the_sale_tax_once_with_no_negative_revenue(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    sale = await _sale(as_owner)
    total, tax = int(str(sale["total_cents"])), int(str(sale["tax_total_cents"]))
    # the cash part is a dollar, less than the tax, which used to push revenue negative
    await _active_card(db, code="GIFTMOST", balance=total - 100)
    tax_before, revenue_before = await _booked(db)
    assert (await _apply(as_owner, sale["id"], "GIFTMOST")).status_code == 200
    paid = await as_owner.post(
        f"/v1/orders/{sale['id']}/cash", json={"tendered_cents": 100}, headers=key()
    )
    assert paid.status_code == 200, paid.text
    tax_after, revenue_after = await _booked(db)
    assert (tax_after - tax_before, revenue_after - revenue_before) == (tax, total - tax)
    debits = await db.scalar(
        select(func.count())
        .select_from(Entry)
        .join(Account, Account.id == Entry.account_id)
        .where(
            Account.category == "revenue",
            Entry.amount_cents > 0,
            Entry.source_id.in_(
                [
                    str(sale["id"]),
                    *await db.scalars(select(Payment.id).where(Payment.order_id == sale["id"])),
                ]
            ),
        )
    )
    assert debits == 0


async def test_voiding_a_gift_card_sale_gives_its_tax_back(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    sale = await _sale(as_owner)
    await _active_card(db, code="GIFTHALF", balance=1000)
    before = await _booked(db)
    gst_before = await _gst(as_owner)
    assert (await _apply(as_owner, sale["id"], "GIFTHALF")).status_code == 200
    assert (await as_owner.post(f"/v1/orders/{sale['id']}/void", headers=key())).status_code == 200
    assert await _booked(db) == before
    assert await _gst(as_owner) == gst_before


async def test_a_sale_gift_cards_paid_in_full_can_be_returned_to_the_card(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    card = await _active_card(db, code="GIFTBACK", balance=10000)
    before = await _booked(db)
    sale = await _sale(as_owner)
    assert (await _apply(as_owner, sale["id"], "GIFTBACK")).json()["status"] == "paid"
    returned = await as_owner.post(f"/v1/orders/{sale['id']}/void")
    assert returned.status_code == 200, returned.text
    assert returned.json()["status"] == "void"
    await db.refresh(card)
    assert await _balance(db, card) == 10000
    assert await _booked(db) == before


async def test_returning_a_gift_card_sale_frees_its_visit_to_be_rung_up_again(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking = await db.scalar(
        select(Booking)
        .where(
            Booking.business_id == BIZ,
            Booking.invoice_id.is_(None),
            Booking.order_id.is_(None),
            Booking.charged_at.is_(None),
            Booking.package_id.is_(None),
        )
        .order_by(Booking.id)
        .limit(1)
    )
    assert booking is not None
    await _active_card(db, code="GIFTVISIT", balance=20000)
    line = {"description": "Visit", "unit_amount_cents": 4000, "booking_id": booking.id}
    created = await as_owner.post("/v1/orders", json={"lines": [line]})
    assert created.status_code == 201, created.text
    sale = created.json()
    assert (await _apply(as_owner, sale["id"], "GIFTVISIT")).json()["status"] == "paid"
    assert (await as_owner.post(f"/v1/orders/{sale['id']}/void")).status_code == 200
    freed = await db.scalar(
        select(Booking).where(Booking.id == booking.id).execution_options(populate_existing=True)
    )
    assert freed is not None and (freed.order_id, freed.charged_at) == (None, None)
    again = await as_owner.post("/v1/orders", json={"lines": [line]})
    assert again.status_code == 201, again.text


async def test_a_sale_paid_with_cash_is_refunded_rather_than_voided(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    sale = await _sale(as_owner)
    paid = await as_owner.post(
        f"/v1/orders/{sale['id']}/cash", json={"tendered_cents": 10000}, headers=key()
    )
    assert paid.status_code == 200, paid.text
    assert (await as_owner.post(f"/v1/orders/{sale['id']}/void")).status_code == 409


async def test_refunding_the_rest_gives_the_gift_card_balance_back(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    card = await _active_card(db, code="GIFTBACK", balance=1000)
    sale = await _sale(as_owner)
    await _apply(as_owner, sale["id"], "GIFTBACK")
    pay = await as_owner.post(f"/v1/orders/{sale['id']}/pay", json={})
    assert pay.status_code == 200, pay.text
    await settle(as_owner, db, pay.json()["payment_id"])
    refunded = await as_owner.post(
        f"/v1/payments/{pay.json()['payment_id']}/refund", json={}, headers=retry_key()
    )
    assert refunded.status_code == 200, refunded.text
    assert await _balance(db, card) == 1000


async def test_voiding_the_sale_gives_the_gift_card_balance_back(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    card = await _active_card(db, code="GIFTVOID", balance=1000)
    sale = await _sale(as_owner)
    await _apply(as_owner, sale["id"], "GIFTVOID")
    voided = await as_owner.post(f"/v1/orders/{sale['id']}/void")
    assert voided.status_code == 200, voided.text
    assert await _balance(db, card) == 1000


async def test_applying_a_gift_card_replays_without_charging_twice(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    card = await _active_card(db, code="GIFTONCE", balance=1000)
    sale = await _sale(as_staff)
    headers = key()
    first = await _apply(as_staff, sale["id"], "GIFTONCE", headers)
    again = await _apply(as_staff, sale["id"], "GIFTONCE", headers)
    assert first.status_code == again.status_code == 200
    assert again.json()["gift_card_cents"] == 1000
    assert await _balance(db, card) == 0


async def test_a_gift_card_is_refused_when_it_cannot_pay(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    sale = await _sale(as_owner)
    assert (await _apply(as_owner, sale["id"], "NOSUCHCARD")).status_code == 404
    spent = await _active_card(db, code="GIFTSPENT", balance=1000)
    await ledger.post_redemption(db, spent, 1000)
    assert (await _apply(as_owner, sale["id"], "GIFTSPENT")).status_code == 409
    other = await _active_card(db, code="GIFTOTHER")
    other.business_id = (await factory.business(name="Elsewhere")).id
    await db.flush()
    assert (await _apply(as_owner, sale["id"], "GIFTOTHER")).status_code == 404
    await _active_card(db, code="GIFTPAID", balance=10000)
    assert (await _apply(as_owner, sale["id"], "GIFTPAID")).status_code == 200
    assert (await _apply(as_owner, sale["id"], "GIFTPAID")).status_code == 409


async def test_editing_a_sale_gives_its_gift_card_credit_back(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    card = await _active_card(db, code="GIFTEDIT", balance=1000)
    sale = await _sale(as_owner)
    await _apply(as_owner, sale["id"], "GIFTEDIT")
    cheaper = {**BRUSH, "unit_amount_cents": 500}
    edited = await as_owner.patch(f"/v1/orders/{sale['id']}", json={"lines": [cheaper]})
    assert edited.status_code == 200, edited.text
    assert (edited.json()["gift_card_cents"], edited.json()["status"]) == (0, "open")
    assert await _balance(db, card) == 1000
    again = await _apply(as_owner, sale["id"], "GIFTEDIT")
    assert again.status_code == 200, again.text
    assert again.json()["status"] == "paid"
    assert await _balance(db, card) == 1000 - again.json()["total_cents"]


async def test_a_gift_card_cannot_settle_a_unit_an_online_checkout_holds(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    shampoo = await db.get(Item, "it_shampoo")
    assert shampoo is not None
    shampoo.track_stock, shampoo.stock_on_hand = True, 1
    online = await as_owner.post(
        "/book/birchbark/shop/orders",
        json={
            "client": {"name": "Online Shopper", "phone": "+16045550330"},
            "lines": [{"item_id": shampoo.id, "quantity": 1}],
        },
        headers=key(),
    )
    assert online.status_code == 200, online.text
    line = {"description": "Shampoo", "unit_amount_cents": 2400, "item_id": shampoo.id}
    desk = await as_owner.post("/v1/orders", json={"lines": [line]})
    assert desk.status_code == 201, desk.text
    card = await _active_card(db, code="GIFTHELD", balance=10000)
    item_id, order_id = shampoo.id, online.json()["order_id"]
    sold = select(func.count()).select_from(StockMovement).where(StockMovement.item_id == item_id)
    movements = await db.scalar(sold)
    await db.commit()  # the 409 below rolls the request back; keep the setup
    refused = await _apply(as_owner, desk.json()["id"], "GIFTHELD")
    assert refused.status_code == 409, refused.text
    assert refused.json()["error"] == "out_of_stock"
    await db.refresh(card)
    assert await _balance(db, card) == 10000
    sale = await db.get(Order, desk.json()["id"])
    assert sale is not None and (await ledger.order_state(db, sale))[0] == "open"
    hold = await db.scalar(select(Payment.status).where(Payment.order_id == order_id))
    assert hold == "pending"
    assert await db.scalar(sold) == movements
    assert await db.scalar(select(Item.stock_on_hand).where(Item.id == item_id)) == 1
