"""Sync streams on the shared test tier: replica rows per role, revocation and key rotation."""

import argparse
import asyncio
import fcntl
import json
import secrets
import signal
import subprocess
import sys
import threading
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from datetime import time as hour
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import IO
from uuid import NAMESPACE_URL, uuid5

import httpx
import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from scripts.db_access import ADMIN_URL
from scripts.demo_context import run_email, run_id
from scripts.gen_sync_schema import synced_tables
from sqlalchemy import delete, text, update
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from clientbridge.core import clock
from clientbridge.core.config import get_settings
from clientbridge.core.db import Base, SessionLocal, engine
from clientbridge.integrations.identity import Credential, Identity
from clientbridge.integrations.kratos import get_identity_provider
from clientbridge.main import create_app
from clientbridge.models.billing import Invoice, Line, Order
from clientbridge.models.business import Business, Staff, User
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client
from clientbridge.models.ledger import Account, Entry
from clientbridge.models.messaging import Message, Thread
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking, Hours, Slot
from e2e import tier
from e2e.results import SYNC_CASES, Report
from e2e.runner import environment, flush_redis, free_port, purge, stop
from e2e.tier import DATABASE


def sync_identity(role: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"clientbridge-sync:{get_settings().run_namespace}:{role}"))


def require_run() -> None:
    """Sync fixtures live in the tier's database under a run's namespace, never anywhere else."""
    if not get_settings().run_namespace or engine.url.database != DATABASE:
        raise RuntimeError("sync fixtures need RUN_NAMESPACE and the test tier's database")


async def seed() -> None:
    require_run()
    async with SessionLocal() as db:
        for name in ("first", "second", "foreign"):
            db.add(
                Business(
                    id=run_id(f"bz_{name}"),
                    name=name,
                    slug=f"sync-{name}-{get_settings().run_namespace}",
                    gst_hst_number="private-tax-number",
                    # west of UTC, so a history read that used local dates would miss its boundary
                    timezone="America/Vancouver",
                )
            )
        for role in ("owner", "admin", "staff", "contractor", "multi", "foreign", "removed"):
            db.add(
                User(
                    id=run_id(f"us_{role}"),
                    identity_id=sync_identity(role),
                    email=run_email(f"{role}@sync.test"),
                    name=role,
                )
            )
        await db.flush()
        for name in ("first", "second", "foreign"):
            db.add(
                Client(
                    id=run_id(f"cl_{name}"),
                    business_id=run_id(f"bz_{name}"),
                    name=name,
                    stripe_customer_id=f"private-provider-{name}",
                )
            )
        for role in ("owner", "admin", "staff", "contractor", "multi", "foreign"):
            business = "foreign" if role == "foreign" else "first"
            db.add(
                Staff(
                    id=run_id(f"st_{role}"),
                    business_id=run_id(f"bz_{business}"),
                    user_id=run_id(f"us_{role}"),
                    role="owner" if role in ("multi", "foreign") else role,
                    status="active",
                    rate_cents=3456,
                    rate_type="hourly",
                    invite_token=f"private-invite-{role}",
                )
            )
        db.add(
            Staff(
                id=run_id("st_second"),
                business_id=run_id("bz_second"),
                user_id=run_id("us_multi"),
                role="staff",
                status="active",
            )
        )
        # a former member gets no access, but their name still reaches their old business
        db.add(
            Staff(
                id=run_id("st_removed"),
                business_id=run_id("bz_first"),
                user_id=run_id("us_removed"),
                role="staff",
                status="removed",
                rate_cents=3456,
                rate_type="hourly",
            )
        )
        await db.flush()
        for staff, business in (
            ("owner", "first"),
            ("staff", "first"),
            ("second", "second"),
            ("foreign", "foreign"),
        ):
            db.add(
                Hours(
                    id=run_id(f"av_{staff}"),
                    business_id=run_id(f"bz_{business}"),
                    staff_id=run_id(f"st_{staff}"),
                    basis="recurring",
                    weekday=1,
                    start_time=hour(9),
                    end_time=hour(17),
                    available=True,
                    note="server baseline",
                )
            )
        await financial(db)
        await history_edge(db)
        await db.commit()
    await engine.dispose()


def history_start(now: datetime) -> datetime:
    """The client's historyStart: the first of the month twelve months back, in UTC."""
    first = now.astimezone(UTC).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return first.replace(year=first.year - 1)


# a visit and a message a millisecond either side of the history window's start, and at it
EDGES = {"before": -1, "at": 0, "after": 1}


async def history_edge(db: AsyncSession) -> None:
    start = history_start(clock.now())
    db.add(
        Thread(
            id=run_id("th_edge"),
            business_id=run_id("bz_first"),
            client_id=run_id("cl_first"),
            channel="sms",
        )
    )
    for name, offset in EDGES.items():
        at = start + timedelta(milliseconds=offset)
        db.add(
            Slot(
                id=run_id(f"sl_edge_{name}"),
                business_id=run_id("bz_first"),
                item_id=run_id("it_first"),
                staff_id=run_id("st_owner"),
                starts_at=at,
                # a millisecond long, so the three slots of one member don't overlap
                ends_at=at + timedelta(milliseconds=1),
            )
        )
    await db.flush()
    for name, offset in EDGES.items():
        at = start + timedelta(milliseconds=offset)
        db.add(
            Booking(
                id=run_id(f"bk_edge_{name}"),
                business_id=run_id("bz_first"),
                slot_id=run_id(f"sl_edge_{name}"),
                starts_at=at,
                staff_id=run_id("st_owner"),
                client_id=run_id("cl_first"),
                status="completed",
                price_cents=6000,
            )
        )
        db.add(
            Message(
                id=run_id(f"ms_edge_{name}"),
                business_id=run_id("bz_first"),
                thread_id=run_id("th_edge"),
                direction="out",
                channel="sms",
                status="sent",
                body=name,
                created_at=at,
            )
        )


async def history_pages() -> None:
    """Every older visit and message the API pages return before the history window."""
    require_run()
    before = history_start(clock.now()).isoformat()
    found: dict[str, list[str]] = {"visits": [], "messages": []}
    try:
        app = create_app()
        app.dependency_overrides[get_identity_provider] = OwnerSession
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://verification"
        ) as client:
            headers = {"X-Session-Token": "sync-hours", "X-Business-Id": run_id("bz_first")}
            for kind, path, params in (
                ("visits", "/v1/bookings/visits", {"client_id": run_id("cl_first")}),
                ("messages", f"/v1/threads/{run_id('th_edge')}/messages", {}),
            ):
                cursor: dict[str, str] = {"before": before}
                while True:
                    response = await client.get(
                        path, params=params | cursor | {"limit": "2"}, headers=headers
                    )
                    response.raise_for_status()
                    page = response.json()
                    rows = page[kind]
                    found[kind] += [row["id"] for row in rows]
                    if not page["more"] or not rows:
                        break
                    last = rows[-1]
                    cursor = {
                        "before": last["starts_at" if kind == "visits" else "created_at"],
                        "before_id": last["id"],
                    }
        print(json.dumps(found))
    finally:
        await engine.dispose()


async def financial(db: AsyncSession) -> None:
    """One row of each owner-only or self-only record type, so the replica check covers them."""
    today = clock.now().replace(hour=15, minute=0, second=0, microsecond=0)
    start = today + timedelta(days=7)
    db.add(
        Item(id=run_id("it_first"), business_id=run_id("bz_first"), kind="service", name="Groom")
    )
    db.add(
        Invoice(
            id=run_id("inv_first"),
            business_id=run_id("bz_first"),
            client_id=run_id("cl_first"),
            status="sent",
        )
    )
    db.add(
        Order(
            id=run_id("ord_first"),
            business_id=run_id("bz_first"),
            staff_id=run_id("st_staff"),
            source="online",
        )
    )
    for staff in ("owner", "staff"):
        db.add(
            Account(
                id=run_id(f"ac_{staff}"),
                business_id=run_id("bz_first"),
                owner_type="staff",
                owner_id=run_id(f"st_{staff}"),
                category="payable",
            )
        )
    db.add(
        Account(
            id=run_id("ac_revenue"),
            business_id=run_id("bz_first"),
            owner_type="business",
            owner_id=run_id("bz_first"),
            category="revenue",
        )
    )
    await db.flush()
    for staff in ("owner", "staff"):
        db.add(
            Slot(
                id=run_id(f"sl_{staff}"),
                business_id=run_id("bz_first"),
                item_id=run_id("it_first"),
                staff_id=run_id(f"st_{staff}"),
                starts_at=start,
                ends_at=start + timedelta(hours=1),
            )
        )
    db.add(
        Payment(
            id=run_id("pay_first"),
            business_id=run_id("bz_first"),
            client_id=run_id("cl_first"),
            invoice_id=run_id("inv_first"),
            amount_cents=4200,
            method="card",
            provider="stripe",
            provider_ref=run_id("private-provider-payment"),
            status="succeeded",
        )
    )
    db.add(
        Line(
            id=run_id("ln_pickup"),
            business_id=run_id("bz_first"),
            order_id=run_id("ord_first"),
            description="Shampoo",
            unit_amount_cents=2400,
            amount_cents=2400,
            for_pickup=True,
        )
    )
    for leg, (account, owner_type, owner, cents) in enumerate(
        (
            (run_id("ac_staff"), "staff", run_id("st_staff"), 1500),
            (run_id("ac_revenue"), "business", run_id("bz_first"), -1500),
        )
    ):
        db.add(
            Entry(
                id=run_id(f"en_{leg}"),
                business_id=run_id("bz_first"),
                journal_id=run_id("jr_earning"),
                account_id=account,
                owner_type=owner_type,
                owner_id=owner,
                amount_cents=cents,
                event="earning",
                ref=run_id("earning:fixture"),
                leg=leg,
            )
        )
    await db.flush()
    # older than the device history window, so no identity receives it
    db.add(
        Slot(
            id=run_id("sl_archive"),
            business_id=run_id("bz_first"),
            item_id=run_id("it_first"),
            staff_id=run_id("st_owner"),
            starts_at=start - timedelta(days=3 * 365),
            ends_at=start - timedelta(days=3 * 365) + timedelta(hours=1),
        )
    )
    await db.flush()
    for staff in ("owner", "staff"):
        db.add(
            Booking(
                id=run_id(f"bk_{staff}"),
                business_id=run_id("bz_first"),
                slot_id=run_id(f"sl_{staff}"),
                starts_at=start,
                staff_id=run_id(f"st_{staff}"),
                client_id=run_id("cl_first"),
                status="confirmed",
                price_cents=6000,
                manage_token=run_id(f"private-manage-{staff}"),
            )
        )
    db.add(
        Booking(
            id=run_id("bk_archive"),
            business_id=run_id("bz_first"),
            slot_id=run_id("sl_archive"),
            starts_at=start - timedelta(days=3 * 365),
            staff_id=run_id("st_owner"),
            client_id=run_id("cl_first"),
            status="completed",
            price_cents=6000,
        )
    )


class OwnerSession:
    """The sync fixtures have no logins; every request is the run's seeded owner."""

    async def whoami(self, credential: Credential, *, fresh: bool = False) -> Identity:
        email = run_email("owner@sync.test")
        return Identity(
            id=sync_identity("owner"),
            email=email,
            verified_emails=frozenset({email}),
            name="owner",
            session_id="sync-hours",
            second_factor=False,
        )

    async def identity_exists(self, identity_id: str) -> bool:
        return True


async def post_hours(payload: str) -> None:
    require_run()
    owner, hours = run_id("st_owner"), run_id("av_owner")
    try:
        async with SessionLocal() as db:
            if payload == "reset":
                await db.execute(delete(Hours).where(Hours.staff_id == owner, Hours.id != hours))
                await db.execute(
                    update(Hours)
                    .where(Hours.id == hours)
                    .values(start_time=hour(9), end_time=hour(17), available=True)
                )
                await db.execute(update(Staff).where(Staff.id == owner).values(hours_revision=0))
                await db.commit()
                return
        app = create_app()
        app.dependency_overrides[get_identity_provider] = OwnerSession
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://verification"
        ) as client:
            response = await client.post(
                f"/v1/hours/{owner}/week",
                content=payload,
                headers={
                    "X-Session-Token": "sync-hours",
                    "Content-Type": "application/json",
                    "X-Business-Id": run_id("bz_first"),
                },
            )
            print(json.dumps({"status": response.status_code, "body": response.text}))
    finally:
        await engine.dispose()


async def mutate(action: str) -> None:
    require_run()
    async with SessionLocal() as db:
        if action in {"downgrade", "remove", "restore"}:
            await db.execute(
                update(Staff)
                .where(Staff.id == run_id("st_admin"))
                .values(
                    role="staff" if action == "downgrade" else "admin",
                    status="removed" if action == "remove" else "active",
                )
            )
        elif action in {"rename", "restore_name"}:
            await db.execute(
                update(User)
                .where(User.id == run_id("us_owner"))
                .values(name="renamed" if action == "rename" else "owner")
            )
        elif action in {"delete_client", "restore_client"}:
            await db.execute(
                update(Client)
                .where(Client.id == run_id("cl_first"))
                .values(
                    deleted_at=clock.now() if action == "delete_client" else None,
                )
            )
        else:
            raise ValueError("unknown verification mutation")
        await db.commit()
    await engine.dispose()


TIMEOUT_SECONDS = 600
TOUCH = "UPDATE businesses SET updated_at = updated_at WHERE id = (SELECT min(id) FROM businesses)"
REACHED = (
    "SELECT coalesce(bool_or(last_checkpoint_lsn::pg_lsn >= CAST(CAST(:target AS text) AS pg_lsn)),"
    " false) FROM powersync.sync_rules WHERE state = 'ACTIVE' AND snapshot_done"
)


async def caught_up() -> None:
    source = create_async_engine(ADMIN_URL)
    storage = create_async_engine(make_url(ADMIN_URL).set(database="powersync_storage"))
    async with source.begin() as conn:
        target = await conn.scalar(text("SELECT pg_current_wal_lsn()::text"))
        # a commit on a synced table, so the checkpoint moves past the target once PowerSync is idle
        await conn.execute(text(TOUCH))
    deadline = time.monotonic() + TIMEOUT_SECONDS
    while True:
        async with storage.connect() as conn:
            reached = await conn.scalar(text(REACHED), {"target": target})
        if reached:
            break
        if time.monotonic() > deadline:
            raise SystemExit(f"powersync has not replicated up to {target}")
        await asyncio.sleep(1)
    await source.dispose()
    await storage.dispose()
    print(f"PowerSync has replicated up to {target}.")


ROOT = Path(__file__).resolve().parents[2]
PROJECTIONS = ROOT / "backend/tests/fixtures/sync_projections.json"
ROLES = ("owner", "admin", "staff", "contractor", "multi", "foreign")


def rsa_pair() -> tuple[str, str]:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()
    public = (
        key.public_key()
        .public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
        .decode()
    )
    return private, public


def signer(
    base: dict[str, str], kid: str, private: str, previous: dict[str, str]
) -> dict[str, str]:
    return {
        **base,
        "POWERSYNC_USE_RS256": "true",
        "POWERSYNC_KID": kid,
        "POWERSYNC_PRIVATE_KEY_PEM": private,
        "POWERSYNC_PREVIOUS_PUBLIC_KEYS": json.dumps(previous),
    }


def wait_for(check: Callable[[], bool], seconds: float) -> float:
    started = time.monotonic()
    while True:
        try:
            if check():
                return time.monotonic() - started
        except httpx.TransportError:
            pass
        if time.monotonic() - started >= seconds:
            raise RuntimeError(f"condition not met within {seconds:.0f} seconds")
        time.sleep(0.5)


class KeyFront:
    """Where the tier's relay reads this run's keys; it swaps APIs with no gap, as a deploy does."""

    def __init__(self, log: IO[bytes]) -> None:
        self.log = log
        self.api: subprocess.Popen[bytes] | None = None
        self.upstream = ""
        front = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                try:
                    response = httpx.get(f"{front.upstream}{self.path}", timeout=10)
                    status, body = response.status_code, response.content
                except httpx.HTTPError as error:
                    status, body = 502, str(error).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, format: str, *args: object) -> None:
                pass

        # the relay runs in Docker, so the front answers on every interface, not just loopback
        self.server = ThreadingHTTPServer(("0.0.0.0", 0), Handler)
        self.url = f"http://localhost:{self.server.server_address[1]}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def deploy(self, env: dict[str, str]) -> None:
        """Start an API with these keys, send key reads to it, then stop the one it replaces."""
        port = free_port()
        process = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "clientbridge.main:app", "--port", str(port)],
            cwd=ROOT / "backend",
            env=env,
            stdout=self.log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            wait_for(lambda: httpx.get(f"http://localhost:{port}/health", timeout=2).is_success, 30)
        except BaseException:
            stop(process)
            raise
        previous, self.api = self.api, process
        self.upstream = f"http://localhost:{port}"
        if previous is not None:
            stop(previous)

    def close(self) -> None:
        if self.api is not None:
            stop(self.api)
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=10)


def mint(env: dict[str, str]) -> str:
    return subprocess.check_output(
        [
            sys.executable,
            "-c",
            "from clientbridge.core.security import issue_powersync_token as t; "
            "from scripts.demo_context import run_id; "
            "print(t(run_id('us_owner')))",
        ],
        cwd=ROOT / "backend",
        env=env,
        text=True,
    ).strip()


def accepted(sync_url: str, token: str) -> bool:
    with httpx.stream(
        "POST",
        f"{sync_url}/sync/stream",
        json={},
        headers={"Authorization": f"Token {token}"},
        timeout=10,
    ) as response:
        return response.status_code == 200


def role_tokens(namespace: str) -> dict[str, str]:
    """Tokens signed with the tier's development key, one per fixture identity."""
    now = int(clock.wall().timestamp())
    return {
        role: jwt.encode(
            {
                "sub": f"us_{role}_{namespace}",
                "aud": tier.default("powersync_audience"),
                "iat": now,
                "exp": now + 600,
            },
            tier.default("jwt_secret"),
            algorithm="HS256",
            headers={"kid": tier.default("powersync_kid")},
        )
        for role in ROLES
    }


def rotation_drill(
    sync_url: str, base: dict[str, str], front: KeyFront, first: tuple[str, str], kid: str
) -> dict[str, float]:
    """Keys overlap across a deploy and a second worker, and a JWKS refresh retires the old one."""
    second = rsa_pair()
    token_a = mint(signer(base, f"{kid}-a", first[0], {}))
    timings: dict[str, float] = {}
    overlap = signer(base, f"{kid}-b", second[0], {f"{kid}-a": first[1]})
    front.deploy(overlap)
    token_b = mint(overlap)
    timings["new key accepted"] = wait_for(lambda: accepted(sync_url, token_b), 120)
    if not accepted(sync_url, token_a):
        raise RuntimeError("a token signed by the previous key failed during the overlap")
    if not accepted(sync_url, mint(overlap)):
        raise RuntimeError("a token signed in another worker process was refused")
    unpublished = mint(signer(base, f"{kid}-unpublished", rsa_pair()[0], {}))

    def retired() -> bool:
        # an unknown key ID makes PowerSync re-read the JWKS now rather than at its 5-minute refresh
        if accepted(sync_url, unpublished):
            raise RuntimeError("a token signed by an unpublished key was accepted")
        return not accepted(sync_url, token_a)

    front.deploy(signer(base, f"{kid}-b", second[0], {}))
    if not accepted(sync_url, token_a):
        raise RuntimeError("the previous key was refused before PowerSync re-read the keys")
    timings["retired key refused"] = wait_for(retired, 90)
    if not accepted(sync_url, token_b):
        raise RuntimeError("the current key stopped working after the previous one retired")
    return timings


def verify(lease: tier.Lease, directory: Path, log: IO[bytes], selection: list[str]) -> None:
    namespace = lease.namespace
    base = environment() | {
        **tier.environment(),
        "RUN_NAMESPACE": namespace,
        "REDIS_URL": lease.redis_url,
        "S3_BUCKET": lease.bucket,
    }
    sync_url = base["POWERSYNC_URL"]

    def run(arguments: list[str]) -> None:
        subprocess.run(
            arguments, cwd=ROOT / "backend", env=base, check=True, stdout=log, stderr=log
        )

    flush_redis(lease.redis_url)
    run([sys.executable, "-m", "e2e.sync", "seed"])
    first = rsa_pair()
    kid = f"sync-{namespace}-{secrets.token_hex(4)}"
    current = signer(base, f"{kid}-a", first[0], {})
    front = KeyFront(log)
    try:
        front.deploy(current)
        lease.register(front.url, keys=True)
        timings = {"first key accepted": wait_for(lambda: accepted(sync_url, mint(current)), 120)}
        browser = base | {
            "SYNC_TEST_URL": sync_url,
            "SYNC_TEST_NAMESPACE": namespace,
            "SYNC_TEST_PORT": str(lease.web_port),
            "SYNC_TEST_OUTPUT": str(directory / "browser"),
            "SYNC_TEST_PYTHON": sys.executable,
            "SYNC_TEST_BACKEND": str(ROOT / "backend"),
            "SYNC_TEST_TOKENS": json.dumps(role_tokens(namespace)),
            "SYNC_TEST_MODEL": json.dumps(
                {
                    table: [c.name for c in Base.metadata.tables[table].c]
                    for table in synced_tables()
                }
            ),
            "SYNC_TEST_PROJECTIONS": PROJECTIONS.read_text(),
        }
        with (directory / "browser.log").open("wb") as browser_log:
            subprocess.run(
                [
                    "pnpm",
                    "exec",
                    "playwright",
                    "test",
                    "-c",
                    "packages/sync/playwright.config.ts",
                    *selection,
                ],
                cwd=ROOT / "frontend",
                env=browser,
                check=True,
                stdout=browser_log,
                stderr=subprocess.STDOUT,
            )
        report = Report.model_validate_json((directory / "browser" / "results.json").read_text())
        # a selected run proves only what it ran; the full lane must run every required case
        report.validate_evidence([], {} if selection else SYNC_CASES)
        if not accepted(sync_url, mint(current)):
            raise RuntimeError("PowerSync does not accept the current signing key")
        timings |= rotation_drill(sync_url, base, front, first, kid)
    finally:
        front.close()
    (directory / "rotation.json").write_text(json.dumps(timings, indent=2) + "\n")
    print("signing-key rotation:", json.dumps(timings), flush=True)
    run([sys.executable, "-m", "scripts.replication_health"])


def drill(selection: list[str]) -> None:
    directory = ROOT / ".scratchpad" / f"sync-{secrets.token_hex(6)}"
    directory.mkdir(parents=True)
    print(f"Sync diagnostics: {directory}", flush=True)
    signal.signal(signal.SIGTERM, lambda _signal, _frame: sys.exit(143))
    with (
        tier.hold(),
        tier.lease() as lease,
        # one drill at a time: a key read another drill forces would retire this one's key early
        (tier.TIER / "sync.lock").open("a") as drill,
        (directory / "setup.log").open("wb") as log,
    ):
        fcntl.flock(drill, fcntl.LOCK_EX)
        (directory / "tier.json").write_text(
            json.dumps({"namespace": lease.namespace, "slot": lease.slot}, indent=2)
        )
        try:
            verify(lease, directory, log, selection)
        finally:
            purge(lease.namespace, lease.redis_url, directory / "purge.json")


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m e2e.sync", description=__doc__)
    parser.add_argument(
        "command", choices=("verify", "seed", "hours", "mutate", "caught-up", "history")
    )
    parser.add_argument("argument", nargs="?", help="the hours body, or the mutation")
    # verify passes what follows it to Playwright, to run a selection of the cases
    if sys.argv[1:2] == ["verify"]:
        drill(sys.argv[2:])
        return
    args = parser.parse_args()
    if args.command in ("hours", "mutate") and args.argument is None:
        parser.error(f"{args.command} takes one argument")
    if args.command == "seed":
        asyncio.run(seed())
    elif args.command == "hours":
        asyncio.run(post_hours(args.argument))
    elif args.command == "mutate":
        asyncio.run(mutate(args.argument))
    elif args.command == "history":
        asyncio.run(history_pages())
    else:
        asyncio.run(caught_up())


if __name__ == "__main__":
    main()
