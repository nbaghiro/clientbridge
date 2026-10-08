import uuid
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.billing import Order
from clientbridge.models.payments import Payment
from clientbridge.services.notifications import Notifier
from clientbridge.services.orders import run_pickup_reminders, run_reap_unpaid_orders
from tests.conftest import FakeEmailSender, FakePaymentGateway, FakePushSender, FakeSmsSender
from tests.helpers import enable_payments, settle


async def place(api: httpx.AsyncClient, db: AsyncSession) -> dict[str, str]:
    await enable_payments(db)
    response = await api.post(
        "/book/birchbark/shop/orders",
        headers={"Idempotency-Key": uuid.uuid4().hex},
        json={
            "client": {"name": "Pickup Client", "email": "pickup@example.com"},
            "lines": [{"item_id": "it_shampoo", "quantity": 1}],
        },
    )
    assert response.status_code == 200, response.text
    result: dict[str, str] = response.json()
    payment_id = (
        await db.execute(select(Payment.id).where(Payment.order_id == result["order_id"]))
    ).scalar_one()
    await settle(api, db, payment_id, uuid.uuid4().hex)
    return result


async def test_public_order_tracks_explicit_preparation(
    api: httpx.AsyncClient, as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    order = await place(api, db)
    url = f"/order/{order['order_token']}"
    initial = (await api.get(url)).json()
    assert initial["pickup_status"] == "unfulfilled"
    assert initial["can_cancel"] is True
    assert initial["receipt_token"] != order["order_token"]
    assert (await api.get(f"/order/{initial['receipt_token']}")).status_code == 404
    assert "client_id" not in initial
    for stage in ("preparing", "ready", "picked_up"):
        response = await as_owner.post(
            f"/v1/orders/{order['order_id']}/pickup", json={"status": stage}
        )
        assert response.status_code == 200, response.text
        current = (await api.get(url)).json()
        assert current["pickup_status"] == stage
        assert current[f"{stage}_at"] is not None
        assert current["can_cancel"] is False
    assert (
        await api.post(url + "/cancel", headers={"Idempotency-Key": uuid.uuid4().hex})
    ).status_code == 409


async def test_public_order_alerts_and_invalid_token(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    order = await place(api, db)
    url = f"/order/{order['order_token']}"
    response = await api.patch(url + "/alerts", json={"notify_sms": False})
    assert response.status_code == 200
    assert response.json()["notify_sms"] is False
    assert (await api.patch(url + "/alerts", json={})).status_code == 422
    assert (await api.get("/order/not-a-token")).status_code == 404
    assert (
        await api.patch("/order/not-a-token/alerts", json={"notify_sms": True})
    ).status_code == 404
    row = await db.get(Order, order["order_id"])
    assert row is not None and row.notify_sms is False


async def test_cancel_order_refunds_once_and_releases_stock(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    order = await place(api, db)
    headers = {"Idempotency-Key": uuid.uuid4().hex}
    url = f"/order/{order['order_token']}/cancel"
    response = await api.post(url, headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "refunded"
    again = await api.post(url, headers=headers)
    assert again.status_code == 200
    assert again.json() == response.json()
    assert (await api.post(url, headers={"Idempotency-Key": uuid.uuid4().hex})).status_code == 409
    refunds = (
        (
            await db.execute(
                select(Payment).where(
                    Payment.order_id == order["order_id"], Payment.kind == "refund"
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(refunds) == 1


async def test_pickup_windows_validate_and_enforce_capacity(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    from datetime import UTC, datetime, timedelta

    from clientbridge.models.business import Business
    from tests.conftest import BIZ

    await enable_payments(db)
    business = await db.get(Business, BIZ)
    assert business is not None
    business.brand = {**business.brand, "pickup_capacity": 1, "pickup_prep_minutes": 0}
    await db.flush()
    windows = (await api.get("/book/birchbark/shop/pickup-days")).json()["windows"]
    assert windows
    window = windows[0]
    payload = {
        "client": {"name": "Scheduled Pickup", "email": "scheduled@example.com"},
        "lines": [{"item_id": "it_shampoo", "quantity": 1}],
        "pickup_from": window["starts_at"],
        "pickup_to": window["ends_at"],
        "note": "Collecting after work",
        "notify_sms": False,
    }
    first = await api.post(
        "/book/birchbark/shop/orders", json=payload, headers={"Idempotency-Key": uuid.uuid4().hex}
    )
    assert first.status_code == 200, first.text
    second = await api.post(
        "/book/birchbark/shop/orders", json=payload, headers={"Idempotency-Key": uuid.uuid4().hex}
    )
    assert second.status_code == 409
    row = await db.get(Order, first.json()["order_id"])
    assert row is not None and row.note == "Collecting after work" and row.notify_sms is False
    payload["pickup_from"] = (datetime.now(UTC) - timedelta(days=1)).isoformat()
    payload["pickup_to"] = (datetime.now(UTC) - timedelta(days=1) + timedelta(hours=1)).isoformat()
    invalid = await api.post(
        "/book/birchbark/shop/orders", json=payload, headers={"Idempotency-Key": uuid.uuid4().hex}
    )
    assert invalid.status_code == 409


async def test_pending_refund_blocks_cancellation_and_preparation(
    api: httpx.AsyncClient,
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
) -> None:
    order = await place(api, db)
    gateway.refund_status = "pending"
    url = f"/order/{order['order_token']}"
    response = await api.post(url + "/cancel", headers={"Idempotency-Key": uuid.uuid4().hex})
    assert response.status_code == 200, response.text
    assert response.json()["refund_pending"] is True
    assert response.json()["status"] == "paid"
    assert response.json()["can_cancel"] is False
    assert (
        await api.post(url + "/cancel", headers={"Idempotency-Key": uuid.uuid4().hex})
    ).status_code == 409
    assert (
        await as_owner.post(f"/v1/orders/{order['order_id']}/pickup", json={"status": "preparing"})
    ).status_code == 409
    refund = (
        await db.execute(
            select(Payment).where(Payment.order_id == order["order_id"], Payment.kind == "refund")
        )
    ).scalar_one()
    assert refund.status == "pending" and refund.credit_note is None and refund.paid_at is None


async def test_unpaid_order_expires_only_after_intent_cancellation(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    response = await api.post(
        "/book/birchbark/shop/orders",
        headers={"Idempotency-Key": uuid.uuid4().hex},
        json={
            "client": {"name": "Abandoned", "email": "abandoned@example.com"},
            "lines": [{"item_id": "it_shampoo", "quantity": 1}],
        },
    )
    order = await db.get(Order, response.json()["order_id"])
    assert order is not None
    order.created_at = datetime.now(UTC) - timedelta(hours=1)
    payment = (await db.execute(select(Payment).where(Payment.order_id == order.id))).scalar_one()
    assert payment.provider_ref is not None
    gateway.confirmed.add(payment.provider_ref)
    assert await run_reap_unpaid_orders(db, gateway, datetime.now(UTC)) == 0
    assert order.status == "open"
    gateway.confirmed.clear()
    assert await run_reap_unpaid_orders(db, gateway, datetime.now(UTC)) == 1
    assert order.status == "void" and payment.status == "canceled"
    assert payment.provider_ref in gateway.canceled_intents


async def test_ready_order_reminder_sent_once_and_respects_alert_choice(
    api: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
) -> None:
    await db.execute(
        update(Order).where(Order.pickup_status == "ready").values(ready_at=datetime.now(UTC))
    )
    placed = await place(api, db)
    order = await db.get(Order, placed["order_id"])
    assert order is not None
    order.pickup_status = "ready"
    order.ready_at = datetime.now(UTC) - timedelta(days=2)
    order.notify_sms = False
    await db.flush()
    email.sent.clear()
    sms.sent.clear()
    notifier = Notifier(email, sms, push)
    assert await run_pickup_reminders(db, notifier, datetime.now(UTC)) == 1
    assert len(email.sent) == 1 and sms.sent == []
    assert await run_pickup_reminders(db, notifier, datetime.now(UTC)) == 0
    assert len(email.sent) == 1
