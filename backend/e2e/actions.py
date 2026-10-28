"""Setup actions and checks for e2e cases that need the product's own code."""

import argparse
import asyncio
import hashlib
import hmac
import json
import os
import sys
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import boto3
import httpx
from botocore.config import Config
from botocore.exceptions import ClientError
from scripts.demo_context import (
    DEMO_IDS,
    DEMO_PASSWORD,
    FIXTURE_BUSINESS,
    demo_business,
    run_email,
    run_id,
)
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.config import get_settings
from clientbridge.core.db import SessionLocal, engine
from clientbridge.core.locale import SOURCE_LOCALE
from clientbridge.integrations.stripe import PlanSubscription, SubscribedItem
from clientbridge.models.business import Business, Staff
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client, Subject
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Recurrence, Slot
from clientbridge.services.notifications import inbound_message_alert_text
from clientbridge.services.plans import PLAN_PRICES, apply_plan_subscription


async def stand_in(business_id: str, status: str) -> dict[str, object]:
    settings = get_settings()
    if settings.env != "dev" or urlparse(settings.smtp_url or "").hostname not in (
        "localhost",
        "127.0.0.1",
        "mailpit",
    ):
        raise RuntimeError("e2e requires dev settings and a local SMTP sink")
    if business_id in {*DEMO_IDS, *map(run_id, DEMO_IDS)}:
        raise RuntimeError("only a business the run created can stand in for a plan")
    async with SessionLocal() as db:
        business = await db.scalar(
            select(Business).where(Business.id == business_id).with_for_update()
        )
        if (
            business is None
            or business.stripe_subscription_id is not None
            or business.created_at < clock.now() - timedelta(hours=2)
        ):
            raise RuntimeError("the business is not one this run signed up without a plan")
        team = PLAN_PRICES["team_month"]
        changed = apply_plan_subscription(
            business,
            PlanSubscription(
                id=f"sub_e2e_{business_id}",
                status=status,
                customer_account=None,
                business_id=business_id,
                items=(SubscribedItem(team.product, team.interval, 1),),
                cancel_at_period_end=False,
                trial_end=None,
            ),
        )
        await db.commit()
        return {"plan_status": business.plan_status, "plan": business.plan, "changed": changed}


async def plan_main(argv: list[str]) -> None:
    """Stand in for Stripe's plan subscription on a run-owned business, through its mirror."""
    parser = argparse.ArgumentParser(prog="python -m e2e.actions plan")
    parser.add_argument("business_id")
    parser.add_argument("status", choices=("active", "canceled"))
    args = parser.parse_args(argv)
    try:
        print(json.dumps(await stand_in(args.business_id, args.status)))
    finally:
        await engine.dispose()


_OWNED = (
    "SELECT b.id FROM businesses b WHERE b.id = :business AND b.plan_status = 'trialing' "
    "AND b.stripe_subscription_id IS NULL AND b.created_at > now() - interval '2 hours' "
    "AND (SELECT count(*) FROM staff s WHERE s.business_id = b.id AND s.status = 'active') = 1 "
    "AND EXISTS (SELECT 1 FROM staff s JOIN users u ON u.id = s.user_id "
    "WHERE s.business_id = b.id AND s.role = 'owner' AND s.status = 'active' "
    "AND lower(u.email) = lower(:owner))"
)


async def end_trial(business_id: str, owner: str) -> dict[str, object]:
    settings = get_settings()
    if settings.env != "dev" or urlparse(settings.smtp_url or "").hostname not in (
        "localhost",
        "127.0.0.1",
        "mailpit",
    ):
        raise RuntimeError("e2e requires dev settings and a local SMTP sink")
    params = {"business": business_id, "owner": owner}
    async with engine.begin() as db:
        if await db.scalar(text(_OWNED), params) is None:
            raise RuntimeError("the business is not a fresh trial this case signed up")
        ended = await db.execute(
            text(
                "UPDATE businesses SET trial_ends_at = now() - interval '1 second' "
                "WHERE id = :business RETURNING id, plan_status, trial_ends_at < now() AS lapsed"
            ),
            params,
        )
        return dict(ended.mappings().one())


async def trial_clock_main(argv: list[str]) -> None:
    """End the trial of a business a case signed up, so a lapse needs no clock change."""
    parser = argparse.ArgumentParser(prog="python -m e2e.actions trial-clock")
    parser.add_argument("business_id")
    parser.add_argument("owner_email")
    args = parser.parse_args(argv)
    try:
        print(json.dumps(await end_trial(args.business_id, args.owner_email)))
    finally:
        await engine.dispose()


async def payload(client_id: str, preview: str) -> dict[str, object]:
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        row = (
            (
                await db.execute(
                    text(
                        "SELECT t.id AS thread, c.name AS client, b.name AS business "
                        "FROM threads t JOIN clients c ON c.id = t.client_id "
                        "JOIN businesses b ON b.id = t.business_id WHERE t.client_id = :client "
                        "ORDER BY t.updated_at DESC LIMIT 1"
                    ),
                    {"client": client_id},
                )
            )
            .mappings()
            .one()
        )
    body = inbound_message_alert_text(SOURCE_LOCALE, row["client"], preview)
    # Expo puts a push's data under "body" on iOS, beside the alert
    return {
        "aps": {"alert": {"title": row["business"], "body": body}},
        "body": {"type": "message", "thread_id": row["thread"], "client_id": client_id},
    }


def native_push_main(argv: list[str]) -> None:
    """The push a client's next message sends staff, as Expo hands it to an iPhone."""
    parser = argparse.ArgumentParser(prog="python -m e2e.actions native-push")
    parser.add_argument("client_id")
    parser.add_argument("preview")
    args = parser.parse_args(argv)
    print(json.dumps(asyncio.run(payload(args.client_id, args.preview))))


Row = dict[str, object]


def _plain(row: Row) -> Row:
    return {key: v.isoformat() if isinstance(v, datetime) else v for key, v in row.items()}


async def _rows(query: str, params: dict[str, object]) -> list[Row]:
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        rows = await db.execute(text(query), params)
        return [_plain(dict(row)) for row in rows.mappings()]


async def clients(ids: list[str]) -> Row:
    params: dict[str, object] = {"ids": ids}
    messages = "SELECT id FROM threads WHERE client_id = ANY(:ids)"
    return {
        "threads": await _rows(
            "SELECT id, business_id, client_id, status FROM threads "
            "WHERE client_id = ANY(:ids) ORDER BY client_id",
            params,
        ),
        "messages": await _rows(
            "SELECT m.id, m.business_id, t.client_id, m.direction, m.body, m.status, "
            "m.provider_ref, m.sent_by, m.broadcast_id FROM messages m "
            f"JOIN threads t ON t.id = m.thread_id WHERE m.thread_id IN ({messages}) "
            "ORDER BY m.created_at, m.id",
            params,
        ),
        "consents": await _rows(
            "SELECT business_id, client_id, status, source, recorded_by FROM consents "
            "WHERE client_id = ANY(:ids) ORDER BY created_at, id",
            params,
        ),
    }


async def webhooks(ids: list[str]) -> Row:
    return {
        "webhooks": await _rows(
            "SELECT id, provider, event, status, payload FROM webhooks "
            "WHERE id = ANY(:ids) ORDER BY id",
            {"ids": ids},
        )
    }


async def deliveries(prefix: str) -> Row:
    return {
        "deliveries": await _rows(
            "SELECT id, business_id, state, error, payload->>'channel' AS channel, "
            "payload->'message'->>'to' AS recipient, payload->'message'->>'subject' AS subject, "
            "payload->'message'->>'from_number' AS from_number, created_at FROM deliveries "
            "WHERE starts_with(key, :prefix) ORDER BY payload->>'channel', id",
            {"prefix": prefix},
        )
    }


async def broadcasts(ids: list[str]) -> Row:
    params: dict[str, object] = {"ids": ids}
    return {
        "broadcasts": await _rows(
            "SELECT id, business_id, name, status, scheduled_at, recipient_count, "
            "excluded_count FROM broadcasts WHERE id = ANY(:ids) ORDER BY id",
            params,
        ),
        "messages": await _rows(
            "SELECT id, broadcast_id, status FROM messages WHERE broadcast_id = ANY(:ids) "
            "ORDER BY id",
            params,
        ),
        "audits": await _rows(
            "SELECT action, entity_id, performed_by FROM audits WHERE entity_id = ANY(:ids) "
            "ORDER BY created_at, id",
            params,
        ),
    }


async def plan(business_id: str) -> Row:
    params: dict[str, object] = {"business": business_id}
    [business] = await _rows(
        "SELECT id, plan, plan_status, trial_ends_at, stripe_account_id, stripe_subscription_id "
        "FROM businesses WHERE id = :business",
        params,
    )
    return {
        "business": business,
        "staff": await _rows(
            "SELECT s.id, s.role, s.status, s.invited_at IS NOT NULL AS invited, "
            "COALESCE(u.email, s.invite_email) AS email FROM staff s "
            "LEFT JOIN users u ON u.id = s.user_id "
            "WHERE s.business_id = :business ORDER BY s.created_at, s.id",
            params,
        ),
        "audits": await _rows(
            "SELECT action, entity_type, performed_by FROM audits WHERE business_id = :business "
            "AND (action LIKE 'plan.%' OR action LIKE 'connect.%') ORDER BY created_at, id",
            params,
        ),
    }


async def outreach_main(argv: list[str]) -> None:
    """Observe owned threads, consents, callbacks, deliveries, broadcasts and plan state."""
    settings = get_settings()
    if settings.env != "dev" or urlparse(settings.smtp_url or "").hostname not in (
        "localhost",
        "127.0.0.1",
        "mailpit",
    ):
        raise RuntimeError("e2e requires dev settings and a local SMTP sink")
    parser = argparse.ArgumentParser(prog="python -m e2e.actions outreach")
    parser.add_argument("kind", choices=("clients", "webhooks", "deliveries", "broadcasts", "plan"))
    parser.add_argument("ids", nargs="+")
    args = parser.parse_args(argv)
    ids = list(args.ids)
    try:
        if args.kind == "clients":
            result = await clients(ids)
        elif args.kind == "webhooks":
            result = await webhooks(ids)
        elif args.kind == "deliveries":
            result = await deliveries(ids[0])
        elif args.kind == "broadcasts":
            result = await broadcasts(ids)
        else:
            result = await plan(ids[0])
        print(json.dumps(result))
    finally:
        await engine.dispose()


async def file_evidence(client_id: str) -> list[dict[str, object]]:
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        rows = await db.execute(
            text(
                "SELECT id, business_id, parent_id, content_type, size, uploaded_at, s3_key "
                "FROM files WHERE parent_type = 'client' AND parent_id = :client "
                "AND purpose = 'photo' ORDER BY id"
            ),
            {"client": client_id},
        )
        files = [dict(row) for row in rows.mappings()]
    settings = get_settings()
    storage = boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
        config=Config(response_checksum_validation="when_required"),
    )
    for file in files:
        try:
            response = storage.get_object(Bucket=settings.s3_bucket, Key=str(file.pop("s3_key")))
            with response["Body"] as stream:
                body = stream.read()
            file["storage"] = {"size": len(body), "sha256": hashlib.sha256(body).hexdigest()}
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") not in {"NoSuchKey", "404"}:
                raise
            file["storage"] = None
    return files


async def files_main(argv: list[str]) -> None:
    """Read committed client-photo rows and independently hash their stored bytes."""
    parser = argparse.ArgumentParser(prog="python -m e2e.actions files")
    parser.add_argument("client_id")
    args = parser.parse_args(argv)
    try:
        print(json.dumps(await file_evidence(args.client_id), default=str))
    finally:
        await engine.dispose()


# no money or saved cards, so a merge is not blocked; no demo name list has it, so it is unique
DUPLICATE = "Robin Ashgrove"


async def _has_series(db: AsyncSession, biz: str) -> bool:
    found = await db.execute(
        select(Recurrence.id)
        .join(Slot, Slot.recurrence_id == Recurrence.id)
        .where(
            Recurrence.business_id == biz,
            Recurrence.client_id.is_not(None),
            Recurrence.status == "active",
            Slot.starts_at > clock.now(),
        )
        .limit(1)
    )
    return found.first() is not None


async def _has_low_stock(db: AsyncSession, biz: str) -> bool:
    found = await db.execute(
        select(Item.id)
        .where(
            Item.business_id == biz,
            Item.track_stock.is_(True),
            Item.active.is_(True),
            Item.stock_on_hand <= Item.low_stock_at,
        )
        .limit(1)
    )
    return found.first() is not None


async def _has_duplicate(db: AsyncSession, biz: str) -> bool:
    found = await db.execute(
        select(Client.id)
        .where(
            Client.business_id == biz,
            Client.name == DUPLICATE,
            Client.deleted_at.is_(None),
        )
        .limit(1)
    )
    return found.first() is not None


async def _has_dispute(db: AsyncSession, biz: str) -> bool:
    found = await db.execute(
        select(Payment.id)
        .where(Payment.business_id == biz, Payment.dispute_status.is_not(None))
        .limit(1)
    )
    return found.first() is not None


async def _series_body(db: AsyncSession, biz: str) -> dict[str, object]:
    active = (Client.business_id == biz, Client.status == "active", Client.deleted_at.is_(None))
    subject = (
        await db.execute(
            select(Subject)
            .join(Client, Client.id == Subject.client_id)
            .where(*active)
            .order_by(Subject.id)
            .limit(1)
        )
    ).scalar_one_or_none()
    client_id = (
        subject.client_id
        if subject is not None
        else (
            await db.execute(select(Client.id).where(*active).order_by(Client.id).limit(1))
        ).scalar_one()
    )
    service = (
        await db.execute(
            select(Item)
            .where(
                Item.business_id == biz,
                Item.kind == "service",
                Item.active.is_(True),
                Item.duration_min > 0,
            )
            .order_by(Item.duration_min, Item.id)
            .limit(1)
        )
    ).scalar_one()
    owner = (
        await db.execute(select(Staff).where(Staff.business_id == biz, Staff.role == "owner"))
    ).scalar_one()
    business = await db.get(Business, biz)
    assert business is not None
    tz = ZoneInfo(business.timezone)
    today = clock.today(tz)
    wednesday = today + timedelta(days=(2 - today.weekday()) % 7 + 7)
    starts_at = datetime.combine(wednesday, datetime.min.time(), tz).replace(hour=15)
    return {
        "client_id": client_id,
        "subject_id": subject.id if subject is not None else None,
        "item_id": service.id,
        "staff_id": owner.id,
        "starts_at": starts_at.isoformat(),
        "frequency": "week",
        "interval": 2,
        "byday": ["WE"],
        "count": 6,
        "confirmation": "none",
    }


async def _dispute_event(db: AsyncSession, biz: str) -> bytes:
    refunded = select(Payment.parent_payment_id).where(Payment.parent_payment_id.is_not(None))
    payment = (
        await db.execute(
            select(Payment)
            .where(
                Payment.business_id == biz,
                Payment.kind == "payment",
                Payment.method == "card",
                Payment.status == "succeeded",
                Payment.provider_ref.like("pi_%"),
                Payment.id.not_in(refunded),
            )
            .order_by(Payment.paid_at.desc(), Payment.id)
            .limit(1)
        )
    ).scalar_one()
    due_by = int(clock.now().timestamp()) + 7 * 86400
    event = {
        "id": f"evt_web_{payment.id}",
        "object": "event",
        "type": "charge.dispute.created",
        "data": {
            "object": {
                "id": f"dp_web_{payment.id}",
                "object": "dispute",
                "payment_intent": payment.provider_ref,
                "amount": payment.amount_cents,
                "currency": payment.currency.lower(),
                "status": "needs_response",
                "reason": "product_not_received",
                "evidence_details": {"due_by": due_by},
                "balance_transactions": [{"fee": 1500}],
            }
        },
    }
    return json.dumps(event).encode()


def _stripe_signature(payload: bytes) -> str:
    stamp = str(int(clock.wall().timestamp()))
    secret = get_settings().stripe_webhook_secret.encode()
    digest = hmac.new(secret, f"{stamp}.".encode() + payload, hashlib.sha256).hexdigest()
    return f"t={stamp},v1={digest}"


async def sign_in(http: httpx.AsyncClient, *, email: str, password: str) -> str:
    """A native password login against the auth service, as the mobile app does it."""
    auth = get_settings().auth_public_url
    flow = await http.get(f"{auth}/self-service/login/api")
    flow.raise_for_status()
    login = await http.post(
        f"{auth}/self-service/login",
        params={"flow": flow.json()["id"]},
        json={"method": "password", "identifier": email, "password": password},
    )
    login.raise_for_status()
    return str(login.json()["session_token"])


async def web_fixtures(seeded: str) -> None:
    biz = run_id(seeded)
    async with SessionLocal() as db:
        need_series = not await _has_series(db, biz)
        need_stock = not await _has_low_stock(db, biz)
        need_dispute = not await _has_dispute(db, biz)
        need_duplicate = not await _has_duplicate(db, biz)
        series = await _series_body(db, biz) if need_series else None
        dispute = await _dispute_event(db, biz) if need_dispute else None
    await engine.dispose()

    added: list[str] = []
    async with httpx.AsyncClient(base_url=os.environ["API_URL"], timeout=30) as http:
        owner = run_email(demo_business(seeded).owner_login)
        http.headers["X-Session-Token"] = await sign_in(http, email=owner, password=DEMO_PASSWORD)
        http.headers["X-Business-Id"] = biz
        stamp = clock.today(UTC).isoformat()
        if series is not None:
            booked = await http.post(
                "/v1/recurrences",
                json=series,
                headers={"Idempotency-Key": f"web-fixtures-series-{stamp}"},
            )
            booked.raise_for_status()
            added.append("a client series")
        if need_stock:
            made = await http.post(
                "/v1/items",
                json={
                    "kind": "product",
                    "name": "Ear Cleaning Wipes",
                    "price_cents": 1600,
                    "cost_cents": 700,
                    "category": "Retail",
                    "track_stock": True,
                    "low_stock_at": 5,
                },
                headers={"Idempotency-Key": f"web-fixtures-item-{stamp}"},
            )
            made.raise_for_status()
            restocked = await http.post(
                f"/v1/items/{made.json()['id']}/restock",
                json={"quantity": 2, "note": "Opening count"},
                headers={"Idempotency-Key": f"web-fixtures-restock-{stamp}"},
            )
            restocked.raise_for_status()
            added.append("a low-stock product")
        if need_duplicate:
            client = await http.post(
                "/v1/clients",
                json={"name": DUPLICATE},
                headers={"Idempotency-Key": f"web-fixtures-duplicate-{stamp}"},
            )
            client.raise_for_status()
            added.append("a duplicate client")
        if dispute is not None:
            hook = await http.post(
                "/webhooks/stripe",
                content=dispute,
                headers={
                    "Content-Type": "application/json",
                    "Stripe-Signature": _stripe_signature(dispute),
                },
            )
            hook.raise_for_status()
            added.append("a dispute")
    print(f"web fixtures: added {', '.join(added)}" if added else "web fixtures: all present")


def web_fixtures_main(argv: list[str]) -> None:
    """Give the web smoke test a series, low stock, a dispute and a duplicate client."""
    parser = argparse.ArgumentParser(prog="python -m e2e.actions web-fixtures")
    parser.add_argument("--business", default=FIXTURE_BUSINESS, choices=DEMO_IDS)
    asyncio.run(web_fixtures(parser.parse_args(argv).business))


COMMANDS: dict[str, Callable[[list[str]], None]] = {
    "plan": lambda argv: asyncio.run(plan_main(argv)),
    "trial-clock": lambda argv: asyncio.run(trial_clock_main(argv)),
    "native-push": native_push_main,
    "outreach": lambda argv: asyncio.run(outreach_main(argv)),
    "files": lambda argv: asyncio.run(files_main(argv)),
    "web-fixtures": web_fixtures_main,
}


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        raise SystemExit(f"usage: python -m e2e.actions {{{','.join(COMMANDS)}}} ...")
    COMMANDS[sys.argv[1]](sys.argv[2:])


if __name__ == "__main__":
    main()
