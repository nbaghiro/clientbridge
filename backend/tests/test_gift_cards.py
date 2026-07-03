"""Gift-card purchase (charge now, grant on settlement) + redeem, against the seeded DB."""

import json

import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.catalog import GiftCard, Item
from clientbridge.models.identity import Business
from clientbridge.models.payments import Payment
from tests.conftest import BIZ, Factory, FakeEmailSender, FakePaymentGateway

PURCHASER = "cl_marcus"  # seeded client with a default saved card (pm_demo_5454)


async def _enable(db: AsyncSession) -> None:
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_account_id="acct_test", stripe_charges_enabled=True)
    )
    await db.flush()


async def _active_card(db: AsyncSession, *, code: str, balance: int = 5000) -> GiftCard:
    card = GiftCard(
        id=new_id("gift_card"),
        business_id=BIZ,
        code=code,
        initial_cents=balance,
        balance_cents=balance,
        status="active",
    )
    db.add(card)
    await db.flush()
    return card


async def _gift_item(db: AsyncSession, *, price: int) -> str:
    item = Item(id=new_id("item"), business_id=BIZ, kind="gift", name="Gift", price_cents=price)
    db.add(item)
    await db.flush()
    return item.id


async def _settle(api: httpx.AsyncClient, db: AsyncSession, payment_id: str, event_id: str) -> None:
    ref = (
        await db.execute(select(Payment.provider_ref).where(Payment.id == payment_id))
    ).scalar_one()
    event = json.dumps(
        {"id": event_id, "type": "payment_intent.succeeded", "data": {"object": {"id": ref}}}
    )
    res = await api.post("/webhooks/stripe", content=event, headers={"Stripe-Signature": "good"})
    assert res.status_code == 200, res.text


async def test_purchase_off_session_creates_pending_card_and_payment(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _enable(db)
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
    assert card.initial_cents == 5000 and card.balance_cents == 5000
    assert card.payment_id == pay.id
    assert pay.status == "pending" and pay.amount_cents == 5000  # face value, not taxed at sale
    assert gateway.charged_methods == ["pm_demo_5454"]


async def test_purchase_settles_active_and_notifies_recipient(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    await _enable(db)
    body = (
        await as_owner.post(
            "/v1/gift-cards",
            json={
                "amount_cents": 8000,
                "purchaser_client_id": PURCHASER,
                "payment_method_id": "default",
                "recipient": "mum@example.com",
            },
        )
    ).json()
    await _settle(as_owner, db, body["payment_id"], "evt_gc_settle")

    card = (
        await db.execute(select(GiftCard).where(GiftCard.id == body["gift_card_id"]))
    ).scalar_one()
    assert card.status == "active"
    sent = [m for m in email.sent if m.to == "mum@example.com"]
    assert len(sent) == 1
    assert body["code"] in sent[0].body


async def test_settle_redelivery_activates_once_and_notifies_once(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    # A redelivered entitlement settle (same intent, a NEW event id so WebhookEvent dedup doesn't
    # mask it) must hit the payment-already-settled guard: card active once, recipient emailed once.
    await _enable(db)
    body = (
        await as_owner.post(
            "/v1/gift-cards",
            json={
                "amount_cents": 6000,
                "purchaser_client_id": PURCHASER,
                "payment_method_id": "default",
                "recipient": "gran@example.com",
            },
        )
    ).json()
    await _settle(as_owner, db, body["payment_id"], "evt_gc_first")
    card = (
        await db.execute(select(GiftCard).where(GiftCard.id == body["gift_card_id"]))
    ).scalar_one()
    assert card.status == "active"
    assert len([m for m in email.sent if m.to == "gran@example.com"]) == 1

    await _settle(as_owner, db, body["payment_id"], "evt_gc_redelivery")  # second event id
    card = (
        await db.execute(select(GiftCard).where(GiftCard.id == body["gift_card_id"]))
    ).scalar_one()
    assert card.status == "active"  # still active, not re-activated
    assert len([m for m in email.sent if m.to == "gran@example.com"]) == 1  # emailed exactly once


async def test_redeem_before_activation_409(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _enable(db)
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
        "/v1/gift-cards/redeem", json={"code": body["code"], "amount_cents": 1000}
    )
    assert res.status_code == 409


async def test_purchase_interactive_returns_client_secret(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _enable(db)
    res = await as_owner.post(
        "/v1/gift-cards", json={"amount_cents": 5000, "purchaser_client_id": PURCHASER}
    )
    assert res.status_code == 201, res.text
    assert res.json()["client_secret"]
    assert gateway.charged_methods == []


async def test_purchase_by_item_uses_item_price(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
    item_id = await _gift_item(db, price=7500)
    res = await as_owner.post(
        "/v1/gift-cards", json={"item_id": item_id, "purchaser_client_id": PURCHASER}
    )
    assert res.status_code == 201, res.text
    card = (
        await db.execute(select(GiftCard).where(GiftCard.id == res.json()["gift_card_id"]))
    ).scalar_one()
    assert card.initial_cents == 7500 and card.balance_cents == 7500


async def test_purchase_not_onboarded_409(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
        "/v1/gift-cards", json={"amount_cents": 5000, "purchaser_client_id": PURCHASER}
    )
    assert res.status_code == 409


async def test_purchase_requires_purchaser_422(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
    res = await as_owner.post("/v1/gift-cards", json={"amount_cents": 5000})
    assert res.status_code == 422


async def test_purchase_requires_amount_or_item_422(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
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
    await _enable(db)
    res = await as_owner.post(
        "/v1/gift-cards", json={"amount_cents": 5000, "purchaser_client_id": "cl_nope"}
    )
    assert res.status_code == 404


async def test_purchase_zero_price_gift_item_409(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)  # the seeded "it_gift" item has price 0 — no amount to charge
    res = await as_owner.post(
        "/v1/gift-cards", json={"item_id": "it_gift", "purchaser_client_id": PURCHASER}
    )
    assert res.status_code == 409


async def test_purchase_non_gift_item_409(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _enable(db)
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
        "/v1/gift-cards/redeem", json={"code": card.code, "amount_cents": 2000}
    )
    assert res.status_code == 200, res.text
    assert res.json()["balance_cents"] == 3000
    assert res.json()["status"] == "active"


async def test_redeem_unknown_code_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
        "/v1/gift-cards/redeem", json={"code": "NOPENOPENOPE", "amount_cents": 100}
    )
    assert res.status_code == 404


async def test_redeem_over_balance_409(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    card = await _active_card(db, code="OVERCODE0001", balance=5000)
    res = await as_owner.post(
        "/v1/gift-cards/redeem", json={"code": card.code, "amount_cents": 6000}
    )
    assert res.status_code == 409


async def test_redeem_zero_amount_409(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    card = await _active_card(db, code="ZEROCODE0001", balance=5000)
    res = await as_owner.post("/v1/gift-cards/redeem", json={"code": card.code, "amount_cents": 0})
    assert res.status_code == 409


async def test_redeem_to_zero_marks_redeemed(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    card = await _active_card(db, code="FULLCODE0001", balance=5000)
    full = await as_owner.post(
        "/v1/gift-cards/redeem", json={"code": card.code, "amount_cents": 5000}
    )
    assert full.status_code == 200
    assert full.json()["balance_cents"] == 0
    assert full.json()["status"] == "redeemed"
    again = await as_owner.post(
        "/v1/gift-cards/redeem", json={"code": card.code, "amount_cents": 1}
    )
    assert again.status_code == 409


async def test_staff_cannot_purchase_403(as_staff: httpx.AsyncClient) -> None:
    res = await as_staff.post(
        "/v1/gift-cards", json={"amount_cents": 5000, "purchaser_client_id": PURCHASER}
    )
    assert res.status_code == 403


async def test_staff_cannot_redeem_403(as_staff: httpx.AsyncClient) -> None:
    res = await as_staff.post(
        "/v1/gift-cards/redeem", json={"code": "WHATEVER1234", "amount_cents": 100}
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
            balance_cents=5000,
            status="active",
        )
    )
    await db.flush()
    res = await as_owner.post(
        "/v1/gift-cards/redeem", json={"code": "OTHERBIZCODE", "amount_cents": 100}
    )
    assert res.status_code == 404


async def test_code_collision_409(
    as_owner: httpx.AsyncClient, db: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _enable(db)
    monkeypatch.setattr(
        "clientbridge.services.gift_card_service._gift_code", lambda: "FIXEDCODE123"
    )
    body = {"amount_cents": 1000, "purchaser_client_id": PURCHASER, "payment_method_id": "default"}
    first = await as_owner.post("/v1/gift-cards", json=body)
    assert first.status_code == 201
    second = await as_owner.post("/v1/gift-cards", json=body)
    assert second.status_code == 409


async def test_idempotent_purchase_replays(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _enable(db)
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
    await _enable(db)
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
    await _enable(db)
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
    await _settle(as_owner, db, body["payment_id"], "evt_gc_refund")
    card = (
        await db.execute(select(GiftCard).where(GiftCard.id == body["gift_card_id"]))
    ).scalar_one()
    assert card.status == "active"
    refunded = await as_owner.post(f"/v1/payments/{body['payment_id']}/refund")
    assert refunded.status_code == 200, refunded.text
    card = (
        await db.execute(select(GiftCard).where(GiftCard.id == body["gift_card_id"]))
    ).scalar_one()
    assert card.status == "void"


async def test_refund_partially_redeemed_gift_card_blocked(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
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
    await _settle(as_owner, db, body["payment_id"], "evt_gc_partial_refund")
    redeemed = await as_owner.post(
        "/v1/gift-cards/redeem", json={"code": body["code"], "amount_cents": 2000}
    )
    assert redeemed.status_code == 200, redeemed.text
    # $20 of value already delivered → refunding the full $50 purchase must be blocked
    refunded = await as_owner.post(f"/v1/payments/{body['payment_id']}/refund")
    assert refunded.status_code == 409
