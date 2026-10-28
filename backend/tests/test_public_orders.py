import uuid
from datetime import timedelta
from zoneinfo import ZoneInfo

import httpx
import pytest
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.models.billing import Order
from clientbridge.models.ledger import Account, Entry
from clientbridge.models.payments import Payment
from clientbridge.services.notifications import Notifier
from clientbridge.services.orders import run_pickup_reminders, run_reap_unpaid_orders
from tests.conftest import FakeEmailSender, FakePaymentGateway, FakePushSender, FakeSmsSender
from tests.helpers import column, enable_payments, settle, stripe_event


async def place(api: httpx.AsyncClient, db: AsyncSession) -> dict[str, str]:
    await enable_payments(db)
    response = await api.post(
        "/book/birchbark/shop/orders",
        headers={"Idempotency-Key": uuid.uuid4().hex},
        json={
            "client": {"name": "Pickup Client", "phone": "+16045550164"},
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
    from datetime import timedelta

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
        "client": {"name": "Scheduled Pickup", "phone": "+16045550165"},
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
    payload["pickup_from"] = (clock.now() - timedelta(days=1)).isoformat()
    payload["pickup_to"] = (clock.now() - timedelta(days=1) + timedelta(hours=1)).isoformat()
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


@pytest.mark.parametrize("failed", [False, True])
async def test_unpaid_order_expires_only_after_intent_cancellation(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway, failed: bool
) -> None:
    await enable_payments(db)
    response = await api.post(
        "/book/birchbark/shop/orders",
        headers={"Idempotency-Key": uuid.uuid4().hex},
        json={
            "client": {"name": "Abandoned", "phone": "+16045550166"},
            "lines": [{"item_id": "it_shampoo", "quantity": 1}],
        },
    )
    order = await db.get(Order, response.json()["order_id"])
    assert order is not None
    order.created_at = clock.now() - timedelta(hours=1)
    payment = (await db.execute(select(Payment).where(Payment.order_id == order.id))).scalar_one()
    assert payment.provider_ref is not None
    if failed:
        payment.status = "failed"
        await db.flush()
    gateway.confirmed.add(payment.provider_ref)
    assert await run_reap_unpaid_orders(db, gateway, clock.now()) == 0
    assert order.status == "open"
    gateway.confirmed.clear()
    assert await run_reap_unpaid_orders(db, gateway, clock.now()) == 1
    assert await column(db, "orders", order.id, "status") == "void"
    assert await column(db, "payments", payment.id, "status") == "canceled"
    assert payment.provider_ref in gateway.canceled_intents


async def test_ready_order_reminder_sent_once_and_respects_alert_choice(
    api: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
) -> None:
    await db.execute(
        update(Order).where(Order.pickup_status == "ready").values(ready_at=clock.now())
    )
    placed = await place(api, db)
    order = await db.get(Order, placed["order_id"])
    assert order is not None
    order.pickup_status = "ready"
    order.ready_at = clock.now() - timedelta(days=2)
    order.notify_sms = False
    await db.flush()
    email.sent.clear()
    sms.sent.clear()
    notifier = Notifier(email, sms, push)
    morning = clock.now().astimezone(ZoneInfo("America/Vancouver")).replace(hour=9, minute=0)
    assert await run_pickup_reminders(db, notifier, morning.replace(hour=10)) == 0
    assert await run_pickup_reminders(db, notifier, morning) == 1
    assert email.sent == [] and sms.sent == []
    assert await run_pickup_reminders(db, notifier, morning) == 0
    assert email.sent == []


async def test_late_settlement_of_a_void_order_is_recorded_and_refunded(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    response = await api.post(
        "/book/birchbark/shop/orders",
        headers={"Idempotency-Key": uuid.uuid4().hex},
        json={
            "client": {"name": "Late", "phone": "+16045550167"},
            "lines": [{"item_id": "it_shampoo", "quantity": 1}],
        },
    )
    order = await db.get(Order, response.json()["order_id"])
    assert order is not None
    payment = (await db.scalars(select(Payment).where(Payment.order_id == order.id))).one()
    order.status, payment.status = "void", "canceled"
    await db.commit()
    await settle(api, db, payment.id, "evt_late_void_payment")
    await db.refresh(payment)
    refunds = list(await db.scalars(select(Payment).where(Payment.parent_payment_id == payment.id)))
    assert payment.status == "succeeded"
    assert len(refunds) == 1 and refunds[0].amount_cents == payment.amount_cents
    assert refunds[0].status == "succeeded" and refunds[0].credit_note is not None
    assert order.pickup_status is None
    await settle(api, db, payment.id, "evt_late_void_replay")
    assert (
        len(list(await db.scalars(select(Payment).where(Payment.parent_payment_id == payment.id))))
        == 1
    )


async def test_pickup_windows_use_a_bounded_number_of_queries(db: AsyncSession) -> None:
    from sqlalchemy import event

    from clientbridge.core.db import engine
    from clientbridge.models.business import Business
    from clientbridge.services.orders import pickup_windows
    from tests.conftest import BIZ

    business = await db.get(Business, BIZ)
    assert business is not None
    statements: list[str] = []

    def count(statement: str) -> None:
        statements.append(statement)

    def before(*args: object) -> None:
        statement = args[2]
        assert isinstance(statement, str)
        count(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", before)
    try:
        assert await pickup_windows(db, business)
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", before)
    assert len(statements) <= 6, len(statements)


async def test_stock_corrected_after_checkout_refunds_without_fulfilling(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    from clientbridge.models.catalog import Item

    await enable_payments(db)
    product = await db.get(Item, "it_shampoo")
    assert product is not None
    product.track_stock, product.stock_on_hand = True, 1
    await db.commit()
    response = await api.post(
        "/book/birchbark/shop/orders",
        headers={"Idempotency-Key": uuid.uuid4().hex},
        json={
            "client": {"name": "Corrected", "phone": "+16045550168"},
            "lines": [{"item_id": product.id, "quantity": 1}],
        },
    )
    assert response.status_code == 200
    payment = (
        await db.scalars(select(Payment).where(Payment.order_id == response.json()["order_id"]))
    ).one()
    product.stock_on_hand = 0
    await db.commit()
    await settle(api, db, payment.id)
    refunds = list(await db.scalars(select(Payment).where(Payment.parent_payment_id == payment.id)))
    assert len(refunds) == 1 and refunds[0].status == "succeeded"
    await db.refresh(product)
    assert product.stock_on_hand == 0
    order = await db.get(Order, payment.order_id)
    assert order is not None and order.status == "void" and order.pickup_status is None
    assert gateway.refunds[-1][2] is True  # we voided it, so our platform fee goes back too
    platform_fee = await db.scalar(
        select(func.coalesce(func.sum(Entry.amount_cents), 0))
        .join(Account, Account.id == Entry.account_id)
        .where(
            Entry.source_id == payment.id,
            Account.category == "platform_fee",
            Account.owner_type == "business",
        )
    )
    assert platform_fee == 0


async def test_a_void_refund_that_settles_later_still_returns_our_fee(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    from clientbridge.models.catalog import Item

    await enable_payments(db)
    product = await db.get(Item, "it_shampoo")
    assert product is not None
    product.track_stock, product.stock_on_hand = True, 1
    await db.commit()
    response = await api.post(
        "/book/birchbark/shop/orders",
        headers={"Idempotency-Key": uuid.uuid4().hex},
        json={
            "client": {"name": "Later", "phone": "+16045550169"},
            "lines": [{"item_id": product.id, "quantity": 1}],
        },
    )
    payment = (
        await db.scalars(select(Payment).where(Payment.order_id == response.json()["order_id"]))
    ).one()
    product.stock_on_hand = 0
    gateway.refund_status = "pending"
    await db.commit()
    await settle(api, db, payment.id)

    async def platform_fee() -> int:
        return (
            await db.scalar(
                select(func.coalesce(func.sum(Entry.amount_cents), 0))
                .join(Account, Account.id == Entry.account_id)
                .where(
                    Entry.source_id == payment.id,
                    Account.category == "platform_fee",
                    Account.owner_type == "business",
                )
            )
            or 0
        )

    assert await platform_fee() > 0
    (refund,) = await db.scalars(select(Payment).where(Payment.parent_payment_id == payment.id))
    assert refund.provider_ref is not None
    body = {"id": refund.provider_ref, "payment_intent": payment.provider_ref}
    await stripe_event(
        api, "refund.updated", body | {"amount": refund.amount_cents, "status": "succeeded"}
    )
    assert await platform_fee() == 0
