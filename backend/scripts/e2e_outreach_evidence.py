"""Observe owned threads, consents, callbacks, deliveries, broadcasts and plan state read-only."""

import argparse
import asyncio
import json
from datetime import datetime
from urllib.parse import urlparse

from sqlalchemy import text

from clientbridge.core.config import get_settings
from clientbridge.core.db import engine
from clientbridge.services.consents import prefs_url

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
            "SELECT id, business_id, client_id, channel, status FROM threads "
            "WHERE client_id = ANY(:ids) ORDER BY client_id, channel",
            params,
        ),
        "messages": await _rows(
            "SELECT m.id, m.business_id, t.client_id, m.direction, m.channel, m.body, m.status, "
            "m.provider_ref, m.sent_by, m.broadcast_id FROM messages m "
            f"JOIN threads t ON t.id = m.thread_id WHERE m.thread_id IN ({messages}) "
            "ORDER BY m.created_at, m.id",
            params,
        ),
        "consents": await _rows(
            "SELECT business_id, client_id, channel, status, source, recorded_by FROM consents "
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
            "SELECT id, business_id, name, channel, status, scheduled_at, recipient_count, "
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


async def main() -> None:
    settings = get_settings()
    if settings.env != "dev" or urlparse(settings.smtp_url or "").hostname not in (
        "localhost",
        "127.0.0.1",
        "mailpit",
    ):
        raise RuntimeError("e2e requires dev settings and a local SMTP sink")
    parser = argparse.ArgumentParser()
    parser.add_argument("kind", choices=("clients", "webhooks", "deliveries", "broadcasts", "plan"))
    parser.add_argument("ids", nargs="+")
    parser.add_argument("--prefs", action="store_true")
    args = parser.parse_args()
    ids = list(args.ids)
    try:
        if args.kind == "clients":
            result = await clients(ids)
            if args.prefs:
                result["prefs"] = {client: prefs_url(client) for client in ids}
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


if __name__ == "__main__":
    asyncio.run(main())
