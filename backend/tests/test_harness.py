import argparse
import io
import json
import logging
import os
import re
import select as readiness
import signal
import socket
import subprocess
import sys
import time
from collections.abc import AsyncIterator, Callable
from contextlib import ExitStack, suppress
from datetime import datetime
from pathlib import Path
from typing import IO, cast
from uuid import UUID

import httpx
import pytest
import stripe
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from pydantic import ValidationError
from scripts import e2e_stack as functional
from scripts import e2e_stripe_recover as recovery
from scripts import e2e_stripe_stack as runner
from scripts.e2e_results import (
    BROWSER_CASES,
    REQUIRED_CASES,
    Attempt,
    Report,
    Spec,
    Suite,
    browser_cases,
    validate_native_evidence,
)
from scripts.e2e_results import Test as FunctionalTest
from scripts.e2e_stack import environment, stop
from scripts.e2e_stripe_recover import Fixture, Manifest, recover
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.types import Receive, Scope, Send

from clientbridge.core.config import Environment
from clientbridge.core.cors import SplitCors
from clientbridge.core.deployment import SESSION_COOKIE, public_urls
from clientbridge.core.ids import new_id
from clientbridge.core.logs import JsonFormatter, configure_logging
from clientbridge.integrations.resend import Email
from clientbridge.integrations.stripe import get_payment_gateway
from clientbridge.main import app
from clientbridge.models.clients import Client
from tests.conftest import Factory, FakeEmailSender
from tests.helpers import EnvSettings

MARKER = "cl_isolation_marker"
PEM = (
    rsa.generate_private_key(public_exponent=65537, key_size=2048)
    .private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    )
    .decode()
)


async def test_isolation_writes_marker(db: AsyncSession) -> None:
    db.add(Client(id=MARKER, business_id="bz_birchbark", name="marker", tags=[], custom_fields={}))
    await db.flush()
    n = (
        await db.execute(text("SELECT count(*) FROM clients WHERE id = :i"), {"i": MARKER})
    ).scalar()
    assert n == 1


async def test_isolation_marker_rolled_back(db: AsyncSession) -> None:
    # the marker written by the previous test must be gone — proving each test rolls back
    n = (
        await db.execute(text("SELECT count(*) FROM clients WHERE id = :i"), {"i": MARKER})
    ).scalar()
    assert n == 0


async def test_factory_builds_scoped_rows(db: AsyncSession, factory: Factory) -> None:
    biz = await factory.business(province="ON")
    user = await factory.user()
    staff = await factory.staff(business=biz, user=user, role="admin")
    client = await factory.client(business=biz)
    assert biz.province == "ON"
    assert staff.business_id == biz.id
    assert staff.role == "admin"
    assert client.business_id == biz.id
    name = (
        await db.execute(text("SELECT name FROM clients WHERE id = :i"), {"i": client.id})
    ).scalar()
    assert name == "Test Client"


async def test_auth_clients_resolve_principal(
    as_owner: httpx.AsyncClient, as_staff: httpx.AsyncClient
) -> None:
    for client in (as_owner, as_staff):
        res = await client.get("/v1/staff/team")
        assert res.status_code == 200
        assert len(res.json()["members"]) > 0


async def test_unauth_rejected(unauth: httpx.AsyncClient) -> None:
    res = await unauth.get("/v1/staff/team")
    assert res.status_code == 401


async def test_fake_email_records(email: FakeEmailSender) -> None:
    ref = await email.send(Email(to="a@b.ca", subject="hi", body="x"))
    assert ref == "email_fake1"
    assert len(email.sent) == 1
    assert email.sent[0].to == "a@b.ca"


client = TestClient(app)


def _deploy(monkeypatch: pytest.MonkeyPatch, env: Environment, base_domain: str) -> None:
    """The environment a deployed pod boots with: the base domain and secrets, no URLs."""
    for name in (*public_urls(base_domain), "auth_session_cookie", "auth_internal_url"):
        monkeypatch.delenv(name.upper(), raising=False)
    values = {
        "ENV": env,
        "BASE_DOMAIN": base_domain,
        "DATABASE_URL": "postgresql+asyncpg://clientbridge_api:secret@127.0.0.1:5432/clientbridge",
        "REDIS_URL": "redis://redis:6379/0",
        "S3_ENDPOINT": "https://storage.googleapis.com",
        "S3_BUCKET": f"clientbridge-{env}",
        "S3_ACCESS_KEY": "GOOG1EXAMPLE",
        "S3_SECRET_KEY": "hmac-secret",
        "S3_REGION": "us-east1",
        "STRIPE_SECRET_KEY": "sk_test_x",
        "STRIPE_WEBHOOK_SECRET": "whsec_connect",
        "STRIPE_THIN_WEBHOOK_SECRET": "whsec_thin",
        "STRIPE_PLATFORM_WEBHOOK_SECRET": "whsec_platform",
        "STRIPE_PORTAL_CONFIGURATION": "bpc_x",
        "TWILIO_AUTH_TOKEN": "twilio-token",
        "RESEND_API_KEY": "re_x",
        "RESEND_WEBHOOK_SECRET": "whsec_dGVzdHNlY3JldA==",
        "EMAIL_FROM": f"Clientbridge <hello@{base_domain}>",
        "JWT_SECRET": "private-test-secret",
        "AUTH_ADMIN_URL": "http://auth-admin:4434",
        "AUTH_EMAIL_HOOK_SECRET": "courier-secret",
        "POWERSYNC_USE_RS256": "true",
        "POWERSYNC_PRIVATE_KEY_PEM": PEM,
        "POWERSYNC_KID": "rotation-2026-10",
        "TRUSTED_PROXY_HOPS": "2",
    }
    for name, value in values.items():
        monkeypatch.setenv(name, value)


def test_prod_requires_real_secrets() -> None:
    # Fail closed: a non-dev env with the public dev jwt secret / empty stripe secret must refuse.
    with pytest.raises(ValidationError) as caught:
        EnvSettings(env="prod")  # a developer's .env must not satisfy prod
    for name in (
        "BASE_DOMAIN",
        "S3_ACCESS_KEY",
        "S3_SECRET_KEY",
        "STRIPE_SECRET_KEY",
        "TWILIO_AUTH_TOKEN",
        "AUTH_EMAIL_HOOK_SECRET",
        "RESEND_API_KEY",
        "EMAIL_FROM",
        "RESEND_WEBHOOK_SECRET",
        "STRIPE_PLATFORM_WEBHOOK_SECRET",
        "STRIPE_PORTAL_CONFIGURATION",
    ):
        assert name in str(caught.value)
    dev = EnvSettings(env="dev")  # dev keeps the convenient defaults
    assert dev.web_base_url == "http://localhost:8700" and dev.cors_allow_origins == ""


@pytest.mark.parametrize(
    ("env", "base"), [("prod", "clientbridge.ca"), ("staging", "staging.clientbridge.ca")]
)
def test_one_base_domain_derives_every_public_url(
    monkeypatch: pytest.MonkeyPatch, env: Environment, base: str
) -> None:
    _deploy(monkeypatch, env, base)
    settings = EnvSettings()
    assert settings.api_base_url == f"https://api.{base}"
    assert settings.auth_public_url == f"https://api.{base}/auth"
    assert settings.web_base_url == f"https://app.{base}"
    assert settings.book_base_url == f"https://book.{base}"
    assert settings.shop_base_url == f"https://shop.{base}"
    assert settings.page_url("birchbark") == f"https://birchbark.{base}"
    assert settings.pay_base_url == f"https://pay.{base}"
    assert settings.allowed_origins() == [
        f"https://book.{base}",
        f"https://pay.{base}",
        f"https://shop.{base}",
    ]
    assert settings.admin_base_url == f"https://admin.{base}"
    assert settings.app_origins() == [f"https://app.{base}", f"https://admin.{base}"]
    assert settings.auth_session_cookie == SESSION_COOKIE
    assert settings.auth_internal_url == f"https://api.{base}/auth"


def test_a_deploy_reaches_the_auth_service_inside_the_cluster(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _deploy(monkeypatch, "prod", "clientbridge.ca")
    monkeypatch.setenv("AUTH_INTERNAL_URL", "http://auth.prod.svc.cluster.local:4433")
    settings = EnvSettings()
    assert settings.auth_internal_url == "http://auth.prod.svc.cluster.local:4433"
    assert settings.auth_public_url == "https://api.clientbridge.ca/auth"
    monkeypatch.setenv("AUTH_SESSION_COOKIE", "cb_session")
    with pytest.raises(ValidationError, match="AUTH_SESSION_COOKIE"):
        EnvSettings()


@pytest.mark.parametrize(
    "name", ["STRIPE_SECRET_KEY", "S3_SECRET_KEY", "REDIS_URL", "DATABASE_URL", "BASE_DOMAIN"]
)
def test_a_missing_deployed_setting_refuses_to_start(
    monkeypatch: pytest.MonkeyPatch, name: str
) -> None:
    _deploy(monkeypatch, "prod", "clientbridge.ca")
    monkeypatch.delenv(name)
    with pytest.raises(ValidationError, match=name):
        EnvSettings()


@pytest.mark.parametrize("value", ["{}", " {} "])
def test_an_empty_previous_keys_secret_means_no_previous_keys(
    monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    _deploy(monkeypatch, "prod", "clientbridge.ca")
    monkeypatch.setenv("POWERSYNC_PREVIOUS_PUBLIC_KEYS", value)
    assert EnvSettings().powersync_previous_public_keys == {}


def test_a_refused_start_does_not_echo_a_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    _deploy(monkeypatch, "prod", "clientbridge.ca")
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://api:do-not-print-me@db/clientbridge")
    monkeypatch.delenv("TWILIO_AUTH_TOKEN")
    with pytest.raises(ValidationError, match="TWILIO_AUTH_TOKEN") as caught:
        EnvSettings()
    assert "do-not-print-me" not in str(caught.value)
    assert "sk_test_x" not in str(caught.value)


def test_an_explicit_url_must_agree_with_the_base_domain(monkeypatch: pytest.MonkeyPatch) -> None:
    _deploy(monkeypatch, "staging", "staging.clientbridge.ca")
    monkeypatch.setenv("WEB_BASE_URL", "https://app.staging.clientbridge.ca/")
    assert EnvSettings().web_base_url == "https://app.staging.clientbridge.ca/"
    monkeypatch.setenv("WEB_BASE_URL", "https://app.clientbridge.ca")
    monkeypatch.setenv("CORS_ALLOW_ORIGINS", "https://book.staging.clientbridge.ca")
    with pytest.raises(ValidationError, match="WEB_BASE_URL, CORS_ALLOW_ORIGINS"):
        EnvSettings()


@pytest.mark.parametrize(
    ("env", "base"), [("prod", "clientbridge.ca"), ("staging", "staging.clientbridge.ca")]
)
def test_a_deploy_refuses_to_trust_no_proxies(
    monkeypatch: pytest.MonkeyPatch, env: Environment, base: str
) -> None:
    _deploy(monkeypatch, env, base)
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "0")
    with pytest.raises(ValidationError, match="TRUSTED_PROXY_HOPS"):
        EnvSettings()
    monkeypatch.delenv("TRUSTED_PROXY_HOPS")
    with pytest.raises(ValidationError, match="TRUSTED_PROXY_HOPS"):
        EnvSettings()


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("REDIS_URL", "redis://localhost:6379/0"),
        ("S3_ENDPOINT", "http://127.0.0.1:9000"),
        ("AUTH_ADMIN_URL", "http://host.docker.internal:4434"),
        ("AUTH_INTERNAL_URL", "http://auth.localhost:4433"),
    ],
)
def test_a_deploy_refuses_a_service_on_this_machine(
    monkeypatch: pytest.MonkeyPatch, name: str, value: str
) -> None:
    _deploy(monkeypatch, "staging", "staging.clientbridge.ca")
    monkeypatch.setenv(name, value)
    with pytest.raises(ValidationError, match=f"{name} must not point at this machine"):
        EnvSettings()


@pytest.mark.parametrize("base", ["base.invalid", "clientbridge.localhost", "clientbridge.test"])
def test_a_deploy_refuses_a_reserved_base_domain(
    monkeypatch: pytest.MonkeyPatch, base: str
) -> None:
    _deploy(monkeypatch, "staging", base)
    with pytest.raises(ValidationError, match="reserved name"):
        EnvSettings()


@pytest.mark.parametrize(
    "sender", ["Clientbridge <no-reply@clientbridge.ca>", "no-reply@localhost", "no-reply"]
)
def test_a_deploy_sends_mail_only_from_its_base_domain(
    monkeypatch: pytest.MonkeyPatch, sender: str
) -> None:
    _deploy(monkeypatch, "staging", "staging.clientbridge.ca")
    monkeypatch.setenv("EMAIL_FROM", sender)
    with pytest.raises(ValidationError, match="EMAIL_FROM must be an address at BASE_DOMAIN"):
        EnvSettings()


async def _busy(scope: Scope, receive: Receive, send: Send) -> None:
    await JSONResponse({}, status_code=429, headers={"Retry-After": "5"})(scope, receive, send)


@pytest.mark.parametrize(
    ("env", "base"), [("prod", "clientbridge.ca"), ("staging", "staging.clientbridge.ca")]
)
async def test_a_deploy_gives_each_origin_only_the_cors_it_needs(
    monkeypatch: pytest.MonkeyPatch, env: Environment, base: str
) -> None:
    _deploy(monkeypatch, env, base)
    cors = SplitCors(_busy, EnvSettings())
    other = "clientbridge.ca" if base != "clientbridge.ca" else "staging.clientbridge.ca"
    expected = {
        f"https://app.{base}": True,
        f"https://book.{base}": False,
        f"https://pay.{base}": False,
        f"https://shop.{base}": False,
        f"https://birchbark.{base}": False,
        f"https://{base}": None,
        f"https://shop.birchbark.{base}": None,
        f"https://app.{other}": None,
        "http://localhost:8700": None,
        "https://customer-site.example": None,
    }
    transport = httpx.ASGITransport(app=cors)
    async with httpx.AsyncClient(transport=transport, base_url=f"https://api.{base}") as client:
        for origin, credentialed in expected.items():
            preflight = await client.options(
                "/v1/me",
                headers={
                    "Origin": origin,
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "content-type,idempotency-key",
                },
            )
            res = await client.get("/v1/me", headers={"Origin": origin})
            allowed = res.headers.get("access-control-allow-origin")
            if credentialed is None:
                assert preflight.status_code == 400 and allowed is None, origin
                continue
            assert preflight.status_code == 200 and allowed == origin, origin
            assert ("access-control-allow-credentials" in res.headers) is credentialed, origin
            assert res.headers["access-control-expose-headers"] == "Retry-After", origin


@pytest.mark.parametrize("base", ["https://clientbridge.ca", "clientbridge.ca/", "Clientbridge.ca"])
def test_the_base_domain_is_a_bare_domain(base: str) -> None:
    with pytest.raises(ValidationError, match="BASE_DOMAIN"):
        EnvSettings(env="dev", base_domain=base)


def test_json_logs_are_one_object_per_line() -> None:
    try:
        raise RuntimeError("boom")
    except RuntimeError:
        record = logging.getLogger("clientbridge.test").makeRecord(
            "clientbridge.test",
            logging.ERROR,
            __file__,
            1,
            "failed %s",
            ("once",),
            sys.exc_info(),
            extra={"job": "reminders"},
        )
    line = JsonFormatter().format(record)
    assert "\n" not in line
    entry = json.loads(line)
    assert entry["level"] == entry["severity"] == "ERROR"
    assert entry["logger"] == "clientbridge.test" and entry["message"] == "failed once"
    assert entry["job"] == "reminders" and "RuntimeError: boom" in entry["exception"]
    assert entry["stack_trace"] == entry["exception"]
    assert entry["stack_trace"].startswith("Traceback (most recent call last):")
    assert entry["time"].endswith("+00:00")


def test_logging_is_configured_once_with_info_level() -> None:
    root = logging.getLogger()
    handlers, level = root.handlers, root.level
    try:
        configure_logging("prod")
        assert root.level == logging.INFO
        assert [type(h.formatter) for h in root.handlers] == [JsonFormatter]
        assert logging.getLogger("arq").handlers == []
        assert logging.getLogger("uvicorn.access").disabled
    finally:
        root.handlers, root.level = handlers, level
        logging.getLogger("uvicorn.access").disabled = False


async def test_each_request_is_logged_by_route_without_its_token(
    unauth: httpx.AsyncClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, logger="clientbridge.requests")
    await unauth.get("/contract/secret-token-value")
    (record,) = [r for r in caplog.records if r.name == "clientbridge.requests"]
    assert record.__dict__["method"] == "GET"
    assert record.__dict__["path"] == "/contract/{token}"
    assert record.__dict__["status"] == 404
    assert isinstance(record.__dict__["duration_ms"], float)
    assert "secret-token-value" not in caplog.text


def test_new_id_has_prefix() -> None:
    assert new_id("business").startswith("bz_")
    assert new_id("invoice").startswith("inv_")


def test_sync_token_requires_auth_even_in_dev() -> None:
    res = client.get("/sync/token")
    assert res.status_code == 401


async def test_unhandled_error_still_carries_cors_headers(as_owner: httpx.AsyncClient) -> None:
    def broken() -> None:
        raise RuntimeError("boom")

    app.dependency_overrides[get_payment_gateway] = broken
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get(
            "/v1/connect/status",
            headers={**as_owner.headers, "Origin": "http://localhost:8700"},
        )
    assert res.status_code == 500
    assert res.json()["error"] == "internal_error"
    assert res.headers["access-control-allow-origin"] == "http://localhost:8700"


def test_functional_environment_cannot_inherit_provider_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("STRIPE_SECRET_KEY", "must-not-reach-the-child")
    monkeypatch.setenv("RESEND_API_KEY", "must-not-reach-the-child")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "must-not-reach-the-child")
    monkeypatch.setenv("DATABASE_URL", "must-not-reach-the-child")
    child = environment()
    assert child["STRIPE_SECRET_KEY"] == ""
    assert child["RESEND_API_KEY"] == ""
    assert child["TWILIO_AUTH_TOKEN"] == ""
    assert "must-not-reach-the-child" not in child.values()


def test_functional_stack_signs_callbacks_with_its_own_secrets_and_sends_to_no_provider(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "must-not-reach-the-child")
    first, second = functional.Stack(tmp_path / "a"), functional.Stack(tmp_path / "b")
    for name in ("TWILIO_AUTH_TOKEN", "RESEND_WEBHOOK_SECRET"):
        assert first.env[name]
        assert first.env[name] != second.env[name]
    assert first.env["RESEND_WEBHOOK_SECRET"].startswith("whsec_")
    assert first.env["TWILIO_ACCOUNT_SID"] == ""
    assert first.env["RESEND_API_KEY"] == ""


@pytest.mark.parametrize(
    "failure", ["missing", "empty", "skipped", "retry", "expected_failure", "global_error"]
)
def test_functional_evidence_cannot_certify_missing_or_unclean_work(failure: str) -> None:
    attempt = Attempt(status="passed", retry=0)
    result = FunctionalTest(expectedStatus="passed", status="expected", results=[attempt])
    report = Report(
        errors=[], suites=[Suite(specs=[Spec(title="FLOW-01 real journey", tests=[result])])]
    )
    report.validate_evidence(["FLOW-01"])
    required = ["FLOW-01"]
    if failure == "missing":
        required.append("FLOW-02")
    elif failure == "empty":
        report.suites[0].specs[0].tests = []
    elif failure == "skipped":
        result.status = "skipped"
        attempt.status = "skipped"
    elif failure == "retry":
        attempt.retry = 1
    elif failure == "expected_failure":
        result.expectedStatus = "failed"
        attempt.status = "failed"
    else:
        report.errors = [{"message": "global teardown failed"}]
    with pytest.raises(ValueError):
        report.validate_evidence(required)


def _run(project: str, *statuses: str) -> list[FunctionalTest]:
    return [
        FunctionalTest(
            expectedStatus="passed",
            status="expected" if status == "passed" else "unexpected",
            results=[Attempt(status=status, retry=0)],
            projectName=project,
        )
        for status in statuses
    ]


def test_browser_evidence_needs_each_case_in_each_browser() -> None:
    title = "sign up, confirm the email with the mailed code, then open a business"
    report = Report(
        errors=[],
        suites=[Suite(specs=[Spec(title=title, tests=_run("firefox", "passed"))])],
    )
    report.validate_evidence([], {"firefox": [title]})
    with pytest.raises(ValueError, match="in webkit"):
        report.validate_evidence([], {"firefox": [title], "webkit": [title]})
    with pytest.raises(ValueError, match="missing"):
        report.validate_evidence(["sign up"])


def test_every_browser_case_is_tagged_and_named_once() -> None:
    root = Path(__file__).resolve().parents[2] / "frontend" / "apps"
    sources = "\n".join(
        path.read_text()
        for app in ("web", "connect")
        for path in (root / app / "e2e").glob("*.ts")
        if "@browsers" in path.read_text()
    )
    identities = [identity for cases in BROWSER_CASES.values() for identity in cases.values()]
    assert len(identities) == len(set(identities))
    assert len(set(BROWSER_CASES["web"]) | set(BROWSER_CASES["connect"])) == len(
        BROWSER_CASES["web"]
    ) + len(BROWSER_CASES["connect"])
    for identity in identities:
        assert re.search(rf'test\(\s*"{re.escape(identity)}[ "]', sources), identity
    assert sources.count('tag: "@browsers"') == len(identities)


def test_first_attempts_separate_flakes_from_failures() -> None:
    report = Report(
        errors=[],
        suites=[
            Suite(
                specs=[
                    Spec(title="CASE-01 steady", tests=_run("default", "passed", "passed")),
                    Spec(title="CASE-02 shaky", tests=_run("default", "passed", "failed")),
                    Spec(title="CASE-03 broken", tests=_run("webkit", "timedOut", "failed")),
                ]
            )
        ],
    )
    assert [(o["case"], o["verdict"]) for o in report.first_attempts()] == [
        ("CASE-01 steady", "stable"),
        ("CASE-02 shaky", "flaky"),
        ("CASE-03 broken", "failing"),
    ]
    with pytest.raises(ValueError):
        report.validate_evidence([])


def test_a_shuffled_lane_imports_every_listed_file_in_its_seeded_order(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    listed = ["auth.e2e.ts", "billing.e2e.ts", "crm.e2e.ts", "sales.e2e.ts"]

    def listing(*_: object, **__: object) -> subprocess.CompletedProcess[str]:
        suites = [{"file": name} for name in reversed(listed)]
        return subprocess.CompletedProcess([], 0, json.dumps({"suites": suites}), "")

    monkeypatch.setattr(functional, "ROOT", tmp_path)
    monkeypatch.setattr(functional.subprocess, "run", listing)
    stack = argparse.Namespace(project="e2e-000000000000", env={}, directory=tmp_path)
    args = argparse.Namespace(surface="web", project="default", tests=[])
    config = Path(functional.shuffled_config(cast(functional.Stack, stack), args, 7))
    wrappers = sorted((config.parent / "cases").iterdir())
    order = [path.read_text().split("/")[-1].removesuffix('";\n') for path in wrappers]
    assert sorted(order) == listed
    assert order == json.loads((tmp_path / "shuffle.json").read_text())["files"]
    again = functional.shuffled_config(
        cast(functional.Stack, argparse.Namespace(**{**vars(stack), "project": "e2e-1"})), args, 7
    )
    assert [p.name for p in sorted((Path(again).parent / "cases").iterdir())] == [
        p.name for p in wrappers
    ]
    assert 'testMatch: "*.ts"' in config.read_text()
    assert str(tmp_path / "frontend" / "apps" / "web") in config.read_text()


def test_functional_cleanup_kills_a_descendant_after_its_leader_exits() -> None:
    child = (
        "import os, signal, socket, time; "
        "signal.signal(signal.SIGTERM, signal.SIG_IGN); "
        "server = socket.socket(); server.bind(('127.0.0.1', 0)); server.listen(); "
        "print(os.getpid(), server.getsockname()[1], flush=True); time.sleep(60)"
    )
    parent = "import subprocess, sys; subprocess.Popen([sys.executable, '-c', sys.argv[1]])"
    process = subprocess.Popen(
        [sys.executable, "-c", parent, child],
        stdout=subprocess.PIPE,
        start_new_session=True,
    )
    try:
        assert process.stdout is not None
        assert readiness.select([process.stdout], [], [], 5)[0]
        descendant, port = (int(value) for value in process.stdout.readline().split())
        assert os.getpgid(descendant) == process.pid
        assert process.wait(timeout=5) == 0
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            pass
        stop(process, grace_seconds=0.1)
        deadline = time.monotonic() + 5
        while True:
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.1):
                    pass
            except ConnectionRefusedError:
                break
            assert time.monotonic() < deadline, "owned descendant survived cleanup"
            time.sleep(0.01)
    finally:
        with suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=5)
        if process.stdout is not None:
            process.stdout.close()


def test_functional_cleanup_accepts_a_refused_signal_only_once_the_group_is_gone(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    process = subprocess.Popen([sys.executable, "-c", "pass"], start_new_session=True)
    process.wait(timeout=5)

    alive = False

    def refused(_: int, __: int) -> None:
        raise PermissionError

    def group_alive(_: int) -> bool:
        return alive

    monkeypatch.setattr(functional.os, "killpg", refused)
    monkeypatch.setattr(functional, "group_alive", group_alive)
    functional.stop(process)
    alive = True
    with pytest.raises(PermissionError):
        functional.stop(process)


class _Runtime:
    def __init__(self, directory: Path, fault: str) -> None:
        self.directory = directory
        self.project = directory.name
        self.api = "http://localhost:1"
        self.fault = fault
        self.env: dict[str, str] = {}
        self.process_cleanup_failed = False
        self.provider_cleanup_attempted = False
        self.docker_cleanup_attempted = False
        self.browser_report_written = False
        self.worker_checks: dict[str, object] = {"worker_final": "pending"}

    def configure(self) -> None:
        pass

    def finish_worker(self) -> dict[str, object]:
        self.worker_checks["worker_final"] = "failed" if self.fault == "worker" else "passed"
        return dict(self.worker_checks)

    def require_worker(self) -> None:
        if self.worker_checks["worker_final"] != "passed":
            raise functional.WorkerFailed("injected worker stop")

    def start(
        self,
        processes: ExitStack,
        _log: IO[bytes],
        before_api: Callable[[], None] | None = None,
        browser_fixtures: bool = True,
    ) -> None:
        assert not browser_fixtures
        assert before_api is not None
        before_api()
        if self.fault == "callback":
            processes.callback(self.failed_callback)

    def failed_callback(self) -> None:
        raise PermissionError("injected callback stop failure")

    def command(self, arguments: list[str], _log: IO[bytes], *, frontend: bool = False) -> None:
        if frontend:
            result = FunctionalTest(
                expectedStatus="passed",
                status="expected",
                results=[Attempt(status="passed", retry=0)],
            )
            browsers = browser_cases("stripe")
            report = Report(
                errors=[],
                suites=[
                    Suite(
                        specs=[
                            Spec(
                                title=f"{identity} harness fixture",
                                tests=[
                                    result,
                                    *(
                                        result.model_copy(update={"projectName": project})
                                        for project, cases in browsers.items()
                                        if identity in cases
                                    ),
                                ],
                            )
                            for identity in REQUIRED_CASES["stripe"]
                        ]
                    )
                ],
            )
            output = self.directory / "browser-results" / "results.json"
            output.parent.mkdir()
            output.write_text(report.model_dump_json())
            self.browser_report_written = True
            if self.fault == "command":
                self.process_cleanup_failed = True
                raise PermissionError("injected command stop failure")
        elif arguments[-1] == "cleanup":
            self.provider_cleanup_attempted = True
            if self.fault == "provider":
                raise RuntimeError("injected provider cleanup failure")

    def cleanup(self) -> None:
        self.docker_cleanup_attempted = True
        if self.fault == "docker":
            raise RuntimeError("injected Docker cleanup failure")


class _Relay:
    """Inert socket/provider boundary; relay delivery behavior has its own test suite."""

    def __init__(self, manifest: Path, upstream: str) -> None:
        self.manifest = manifest
        self.upstream = upstream
        self.token = "test-relay-token"
        self.secret = ""
        self.recoveries = 0
        self.closed = False

    def start(self) -> str:
        return "http://localhost:2"

    def recover(self, resend: Callable[[str], None]) -> None:
        assert not self.closed
        assert self.secret == "whsec_harness_fixture"
        self.recoveries += 1

    def close(self) -> None:
        self.closed = True


@pytest.mark.parametrize(
    ("fault", "provider", "process", "docker"),
    [
        ("none", "passed", "passed", "passed"),
        ("command", "passed", "failed", "passed"),
        ("callback", "passed", "failed", "passed"),
        ("provider", "failed", "passed", "passed"),
        ("docker", "passed", "passed", "failed"),
        ("worker", "passed", "passed", "passed"),
    ],
)
def test_provider_runner_retains_cleanup_failures_without_external_services(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    fault: str,
    provider: str,
    process: str,
    docker: str,
) -> None:
    runtime = _Runtime(tmp_path, fault)
    relays: list[_Relay] = []

    def relay(manifest: Path, upstream: str) -> _Relay:
        boundary = _Relay(manifest, upstream)
        relays.append(boundary)
        return boundary

    def stack(_directory: Path) -> _Runtime:
        return runtime

    def credentials(
        _profile: str, _merchants: Path, _publishable_file: Path, _mode: str
    ) -> dict[str, str]:
        return {}

    def listener(_runtime: _Runtime, _processes: ExitStack) -> str:
        return "whsec_harness_fixture"

    monkeypatch.setattr(runner, "Stack", stack)
    monkeypatch.setattr(runner, "Relay", relay)
    monkeypatch.setattr(runner, "credentials", credentials)
    monkeypatch.setattr(runner, "listener", listener)
    monkeypatch.setattr(runner, "source_snapshot", lambda: {"source_sha256": "harness-fixture"})
    args = argparse.Namespace(
        configure_only=False,
        credentials="environment",
        activation="pointer",
        allow_source_changes=False,
        profile="unused",
        merchants=tmp_path / "unused",
        publishable_file=tmp_path / "unused",
    )
    if fault == "none":
        runner.run(args, tmp_path)
    else:
        error = PermissionError if fault in ("command", "callback") else RuntimeError
        with pytest.raises(error, match="injected"):
            runner.run(args, tmp_path)
    record = json.loads((tmp_path / "run.json").read_text())
    assert record["provider_cleanup"] == provider
    assert record["process_cleanup"] == process
    assert record["docker_cleanup"] == docker
    assert record["cleanup"] == ("passed" if fault in ("none", "worker") else "failed")
    assert record["outcome"] == ("passed" if fault == "none" else "failed")
    assert record["worker_final"] == ("failed" if fault == "worker" else "passed")
    if fault == "worker":
        assert record["failure_type"] == "WorkerFailed"
    if fault == "docker":
        assert record["failure_type"] == "CleanupFailed"
    assert record["source_stable"] is True
    assert runtime.browser_report_written
    assert runtime.provider_cleanup_attempted
    assert runtime.docker_cleanup_attempted
    assert len(relays) == 1
    assert relays[0].manifest == tmp_path / "stripe-fixtures.json"
    assert relays[0].upstream == "http://localhost:1/webhooks/stripe"
    assert relays[0].closed
    assert relays[0].recoveries == 2
    assert runtime.env["STRIPE_BROWSER_RELAY_TOKEN"] == "test-relay-token"


RUN = "3a64dda1-0a7a-4c18-82f7-3156fa224117"
ENV = {
    "STRIPE_TEST_SECRET_KEY": "sk_test_fixture",
    "STRIPE_TEST_PLATFORM": "acct_platform",
    "STRIPE_TEST_CONNECTED_ACCOUNT": "acct_a",
    "STRIPE_TEST_OTHER_ACCOUNT": "acct_b",
}


class _Page[T]:
    def __init__(self, rows: list[T]) -> None:
        self.rows = rows

    async def auto_paging_iter(self) -> AsyncIterator[T]:
        for row in self.rows:
            yield row


class _Stripe:
    def __init__(self, monkeypatch: pytest.MonkeyPatch, status: str = "requires_action") -> None:
        monkeypatch.setattr(stripe, "api_key", stripe.api_key)
        monkeypatch.setattr(stripe, "api_version", stripe.api_version)
        self.live = False
        self.environment = "local"
        self.operations: list[str] = []
        self.refunds: list[stripe.Refund] = []
        self.customers = {
            "cus_a": stripe.Customer.construct_from(
                {
                    "id": "cus_a",
                    "object": "customer",
                    "livemode": False,
                    "metadata": {
                        "clientbridge_qa": "payments",
                        "clientbridge_qa_environment": "local",
                        "clientbridge_qa_run": RUN,
                        "clientbridge_qa_invoice": "inv_a",
                        "clientbridge_qa_client": "cl_a",
                    },
                },
                "sk_test_fixture",
            )
        }
        self.payment = stripe.PaymentIntent.construct_from(
            {
                "id": "pi_a",
                "object": "payment_intent",
                "livemode": False,
                "customer": "cus_a",
                "amount": 2000,
                "currency": "cad",
                "status": status,
                "metadata": {"invoice_id": "inv_a", "business_id": "bz_birchbark"},
                "latest_charge": "ch_a" if status == "succeeded" else None,
            },
            "sk_test_fixture",
        )
        self.charge = stripe.Charge.construct_from(
            {
                "id": "ch_a",
                "object": "charge",
                "livemode": False,
                "payment_intent": "pi_a",
                "amount": 2000,
                "amount_refunded": 0,
            },
            "sk_test_fixture",
        )
        monkeypatch.setattr(stripe.Account, "retrieve_async", self.account)
        monkeypatch.setattr(stripe.Balance, "retrieve_async", self.balance)
        monkeypatch.setattr(stripe.Customer, "retrieve_async", self.customer)
        monkeypatch.setattr(stripe.PaymentIntent, "list_async", self.intents)
        monkeypatch.setattr(stripe.PaymentIntent, "retrieve_async", self.intent)
        monkeypatch.setattr(stripe.PaymentIntent, "cancel_async", self.cancel)
        monkeypatch.setattr(stripe.Charge, "retrieve_async", self.get_charge)
        monkeypatch.setattr(stripe.Refund, "list_async", self.get_refunds)
        monkeypatch.setattr(stripe.Refund, "create_async", self.refund)

    async def account(self, account_id: str | None = None, **_options: object) -> stripe.Account:
        return stripe.Account.construct_from(
            {
                "id": account_id or "acct_platform",
                "object": "account",
                "metadata": {
                    "clientbridge_qa": "payments",
                    "clientbridge_qa_environment": self.environment,
                    "clientbridge_qa_slot": "a" if account_id == "acct_a" else "b",
                },
            },
            "sk_test_fixture",
        )

    async def balance(self, **_options: object) -> stripe.Balance:
        return stripe.Balance.construct_from(
            {"object": "balance", "livemode": self.live}, "sk_test_fixture"
        )

    async def customer(self, customer_id: str, **options: object) -> stripe.Customer:
        assert options["stripe_account"] == "acct_a"
        return self.customers[customer_id]

    async def intents(self, **options: object) -> _Page[stripe.PaymentIntent]:
        assert options == {"customer": "cus_a", "stripe_account": "acct_a"}
        return _Page([self.payment])

    async def intent(self, intent_id: str, **options: object) -> stripe.PaymentIntent:
        assert intent_id == "pi_a" and options["stripe_account"] == "acct_a"
        return self.payment

    async def cancel(self, intent_id: str, **options: object) -> stripe.PaymentIntent:
        assert intent_id == "pi_a" and options["stripe_account"] == "acct_a"
        self.operations.append("cancel")
        self.payment.status = "canceled"
        return self.payment

    async def get_charge(self, charge_id: str, **options: object) -> stripe.Charge:
        assert charge_id == "ch_a" and options["stripe_account"] == "acct_a"
        return self.charge

    async def get_refunds(self, **options: object) -> _Page[stripe.Refund]:
        assert options == {"charge": "ch_a", "stripe_account": "acct_a"}
        return _Page(self.refunds)

    async def refund(self, **options: object) -> stripe.Refund:
        assert options["payment_intent"] == "pi_a" and options["stripe_account"] == "acct_a"
        assert options["refund_application_fee"] is True
        assert options["amount"] == 2000
        assert options["idempotency_key"] == f"browser:{RUN}:pi_a:cleanup:2000"
        self.operations.append("refund")
        result = stripe.Refund.construct_from(
            {"id": "re_a", "object": "refund", "amount": 2000, "status": "succeeded"},
            "sk_test_fixture",
        )
        self.refunds.append(result)
        self.charge.amount_refunded = 2000
        return result


def _manifest() -> Manifest:
    return Manifest(
        run_id=UUID(RUN),
        account="acct_a",
        platform="acct_platform",
        business="bz_birchbark",
        database={},
        fixtures=[Fixture(invoice="inv_a", client="cl_a", customer="cus_a")],
    )


@pytest.mark.parametrize("status", ["requires_action", "succeeded"])
async def test_recovery_plans_without_writes_then_is_idempotent(
    monkeypatch: pytest.MonkeyPatch, status: str
) -> None:
    boundary = _Stripe(monkeypatch, status)
    planned = await recover(_manifest(), ENV, "local", apply=False)
    assert planned[0]["status"] == ("planned_refund" if status == "succeeded" else "planned_cancel")
    assert boundary.operations == []
    first = await recover(_manifest(), ENV, "local", apply=True)
    second = await recover(_manifest(), ENV, "local", apply=True)
    assert first[0]["status"] == ("succeeded" if status == "succeeded" else "canceled")
    assert second[0]["status"] == (
        "already_refunded" if status == "succeeded" else "already_canceled"
    )
    assert boundary.operations == (["refund"] if status == "succeeded" else ["cancel"])


@pytest.mark.parametrize(
    "fault", ["live", "environment", "customer", "invoice", "amount", "processing"]
)
async def test_recovery_refuses_unproven_or_unsafe_objects_without_mutation(
    monkeypatch: pytest.MonkeyPatch, fault: str
) -> None:
    boundary = _Stripe(monkeypatch)
    if fault == "live":
        boundary.live = True
    elif fault == "environment":
        boundary.environment = "ci"
    elif fault == "customer":
        metadata = boundary.customers["cus_a"].metadata
        assert metadata is not None
        metadata["clientbridge_qa_run"] = "another-run"
    elif fault == "invoice":
        boundary.payment.metadata["invoice_id"] = "inv_someone_else"
    elif fault == "amount":
        boundary.payment.amount = 3000
    else:
        boundary.payment.status = "processing"
    with pytest.raises(ValueError):
        await recover(_manifest(), ENV, "local", apply=True)
    assert boundary.operations == []


async def test_recovery_validates_all_customers_before_mutating_the_first(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    boundary = _Stripe(monkeypatch)
    manifest = _manifest()
    manifest.fixtures.append(Fixture(invoice="inv_b", client="cl_b", customer="cus_b"))
    boundary.customers["cus_b"] = stripe.Customer.construct_from(
        {"id": "cus_b", "object": "customer", "livemode": False, "metadata": {}}, "sk_test_fixture"
    )
    with pytest.raises(ValueError, match="customer ownership"):
        await recover(manifest, ENV, "local", apply=True)
    assert boundary.operations == []


async def test_recovery_never_certifies_a_pending_refund_as_clean(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    boundary = _Stripe(monkeypatch, "succeeded")
    boundary.charge.amount_refunded = 2000
    boundary.refunds.append(
        stripe.Refund.construct_from(
            {"id": "re_a", "object": "refund", "amount": 2000, "status": "pending"},
            "sk_test_fixture",
        )
    )
    with pytest.raises(ValueError, match="unsettled refund"):
        await recover(_manifest(), ENV, "local", apply=True)
    assert boundary.operations == []


def test_recovery_refuses_incomplete_manifest_lineage() -> None:
    with pytest.raises(ValidationError, match="incomplete registered customer lineage"):
        Manifest(
            run_id=UUID(RUN),
            account="acct_a",
            platform="acct_platform",
            business="bz_birchbark",
            database={},
            fixtures=[Fixture(invoice="inv_a", client="cl_a")],
        )


@pytest.mark.parametrize("incomplete", [False, True])
async def test_recovery_cli_preserves_failed_evidence_and_redacts_credentials(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    incomplete: bool,
) -> None:
    boundary = _Stripe(monkeypatch)
    directory = tmp_path / ".scratchpad" / "e2e-aaaaaaaaaaaa"
    directory.mkdir(parents=True)
    state = directory / "stripe-fixtures.json"
    original = directory / "run.json"
    payload = _manifest().model_dump(mode="json")
    if incomplete:
        payload["fixtures"][0].pop("customer")
    state.write_text(json.dumps(payload))
    original.write_text(
        json.dumps({"surface": "connect-stripe", "outcome": "failed", "provider_cleanup": "failed"})
    )
    before = (state.read_bytes(), original.read_bytes())

    def credentials(_mode: str, _profile: str, _merchants: Path) -> dict[str, str]:
        return ENV

    monkeypatch.setattr(recovery, "ROOT", tmp_path)
    monkeypatch.setattr(recovery, "credentials", credentials)
    monkeypatch.setattr(sys, "argv", ["recover", "--state", str(state), "--apply"])
    assert await recovery.main() == (1 if incomplete else 0)
    history = json.loads((directory / "provider-recovery.json").read_text())
    assert history[0]["status"] == ("failed" if incomplete else "verified_clean")
    assert history[0]["original_outcome"] == "failed"
    assert boundary.operations == ([] if incomplete else ["cancel"])
    if not incomplete:
        assert await recovery.main() == 0
        assert boundary.operations == ["cancel"]
        assert len(json.loads((directory / "provider-recovery.json").read_text())) == 2
    assert (state.read_bytes(), original.read_bytes()) == before
    assert "sk_test_fixture" not in capsys.readouterr().out


@pytest.mark.parametrize(
    ("instant", "expected"),
    [
        ("2026-01-01T07:59:00+00:00", "2025-10-01T12:00:00-07:00"),
        ("2026-01-01T08:00:00+00:00", "2026-01-01T12:00:00-08:00"),
        ("2026-03-20T12:00:00+00:00", "2026-01-01T12:00:00-08:00"),
        ("2026-04-01T07:00:00+00:00", "2026-04-01T12:00:00-07:00"),
        ("2026-10-01T06:59:00+00:00", "2026-07-01T12:00:00-07:00"),
        ("2026-12-15T12:00:00+00:00", "2026-10-01T12:00:00-07:00"),
    ],
)
def test_filings_anchor_uses_local_quarter_and_anchor_dst(instant: str, expected: str) -> None:
    assert functional.filing_seed_anchor(datetime.fromisoformat(instant)).isoformat() == expected


@pytest.mark.parametrize("value", ["2026-10-01", "2026-10-01T12:00:00", "invalid"])
def test_filings_seed_rejects_ambiguous_instant(value: str) -> None:
    with pytest.raises(argparse.ArgumentTypeError):
        functional.seed_timestamp(value)


@pytest.mark.parametrize("value", [None, "2026-10-01T12:00:00-07:00", "2026-10-01T19:00:00Z"])
def test_functional_first_seed_forwards_only_explicit_anchor(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, value: str | None
) -> None:
    at = functional.seed_timestamp(value) if value is not None else None
    stack = functional.Stack(tmp_path, seed_as_of=at)
    calls: list[list[str]] = []

    def command(arguments: list[str], log: IO[bytes], *, frontend: bool = False) -> None:
        calls.append(arguments)

    monkeypatch.setattr(stack, "command", command)
    stack.seed(io.BytesIO())
    expected = [sys.executable, "-m", "scripts.seed_demo", "--core"]
    if at is not None:
        expected.extend(["--as-of", at.isoformat()])
        assert stack.env["E2E_SEED_AS_OF"] == at.isoformat()
    else:
        assert "E2E_SEED_AS_OF" not in stack.env
    assert calls == [expected]
    assert not any(key.startswith("CLOCK") for key in stack.env)


@pytest.mark.parametrize(
    "arguments",
    [
        ["--surface", "filings", "--project", "pseudo"],
        ["--cleanup", "e2e-123456789abc", "--seed-as-of", "2026-10-01T12:00:00-07:00"],
        ["--seed-as-of", "2026-10-01T12:00:00"],
    ],
)
def test_functional_invalid_seed_modes_fail_before_infrastructure(
    monkeypatch: pytest.MonkeyPatch, arguments: list[str]
) -> None:
    def forbidden(*args: object, **kwargs: object) -> None:
        pytest.fail("invalid arguments must not construct a stack")

    monkeypatch.setattr(functional, "Stack", forbidden)
    monkeypatch.setattr(sys, "argv", ["e2e_stack", *arguments])
    with pytest.raises(SystemExit) as error:
        functional.main()
    assert error.value.code == 2


@pytest.mark.parametrize(
    ("process", "provider", "expected"),
    [
        ("passed", "failed", "failed"),
        ("passed", "pending", "incomplete"),
        ("passed", "unknown", "incomplete"),
        ("failed", "passed", "failed"),
        ("failed", "pending", "failed"),
        (None, "passed", "incomplete"),
        ("pending", "passed", "incomplete"),
        ("unknown", None, "incomplete"),
        ("passed", None, "passed"),
        ("passed", "passed", "passed"),
        ("passed", "not_started", "passed"),
    ],
)
def test_docker_reaper_preserves_provider_and_process_evidence(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    process: str | None,
    provider: str | None,
    expected: str,
) -> None:
    project = "e2e-123456789abc"
    directory = tmp_path / ".scratchpad" / project
    directory.mkdir(parents=True)
    (directory / "compose.json").write_text("{}")
    original: dict[str, object] = {
        "outcome": "failed",
        "failure_type": "OriginalProviderOrBrowserFailure",
        "provider_cleanup_failure": {"type": "OriginalRecoveryFailure"},
        "docker_cleanup": "pending",
        "cleanup": "failed",
    }
    if process is not None:
        original["process_cleanup"] = process
    if provider is not None:
        original["provider_cleanup"] = provider
    metadata = directory / "run.json"
    metadata.write_text(json.dumps(original))
    cleaned: list[Path] = []

    class DockerBoundary:
        def __init__(self, owned: Path) -> None:
            self.directory = owned

        def cleanup(self) -> None:
            cleaned.append(self.directory)

    monkeypatch.setattr(functional, "ROOT", tmp_path)
    monkeypatch.setattr(functional, "Stack", DockerBoundary)
    monkeypatch.setattr(sys, "argv", ["e2e_stack", "--cleanup", project])
    functional.main()
    actual = json.loads(metadata.read_text())
    assert cleaned == [directory]
    assert actual["cleanup"] == expected
    assert actual["docker_cleanup"] == "passed"
    assert datetime.fromisoformat(actual.pop("reaped_at")).utcoffset() is not None
    preserved = {
        key: value for key, value in actual.items() if key not in ("cleanup", "docker_cleanup")
    }
    assert preserved == {
        key: value for key, value in original.items() if key not in ("cleanup", "docker_cleanup")
    }


def _worker(stack: functional.Stack, code: str) -> subprocess.Popen[bytes]:
    stack.worker = subprocess.Popen([sys.executable, "-c", code], start_new_session=True)
    return stack.worker


def _log(stack: functional.Stack, *lines: str) -> None:
    with (stack.directory / "worker.log").open("a") as log:
        for line in lines:
            log.write(f"2026-10-25 09:00:15,000 INFO arq.worker {line}\n")


def test_functional_browsers_wait_for_a_live_worker_heartbeat(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    stack = functional.Stack(tmp_path)
    beats: list[bool] = [False, True]
    monkeypatch.setattr(stack, "worker_heartbeat", lambda: beats.pop(0))
    exited = _worker(stack, "pass")
    exited.wait(timeout=10)
    with pytest.raises(functional.WorkerFailed, match="no heartbeat"):
        stack.await_worker(seconds=5)
    assert stack.worker_checks["worker_heartbeat"] == "failed"
    assert beats == [False, True]
    running = _worker(stack, "import time; time.sleep(30)")
    try:
        stack.await_worker(seconds=10)
    finally:
        stop(running, grace_seconds=5)
    assert stack.worker_checks["worker_heartbeat"] == "passed"
    assert beats == []


def test_functional_probe_runs_a_real_cron_entry_by_its_scheduled_name(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from arq.cron import CronJob

    from clientbridge.tasks.worker import WorkerSettings

    enqueued: list[tuple[str, str | None]] = []
    stack = functional.Stack(tmp_path)
    stack.env["REDIS_URL"] = "redis://localhost:1/0"

    class Pool:
        async def enqueue_job(self, function: str, *, _job_id: str | None = None) -> object:
            enqueued.append((function, _job_id))
            _log(stack, f"  0.01s ← {function} ● 0")
            return object()

        async def aclose(self) -> None:
            pass

    async def pool(_settings: object) -> Pool:
        return Pool()

    monkeypatch.setattr(functional, "create_pool", pool)
    running = _worker(stack, "import time; time.sleep(30)")
    try:
        stack.probe_schedule(seconds=10)
    finally:
        stop(running, grace_seconds=5)
    names = [job.name for job in WorkerSettings.cron_jobs if isinstance(job, CronJob)]
    assert [function for function, _ in enqueued] == [f"cron:{functional.PROBE_JOB}"]
    assert enqueued[0][0] in names
    assert (enqueued[0][1] or "").startswith("e2e-probe:")
    assert stack.worker_checks["worker_probe"] == "passed"


def test_functional_probe_fails_when_the_cron_job_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    stack = functional.Stack(tmp_path)
    stack.env["REDIS_URL"] = "redis://localhost:1/0"

    class Pool:
        async def enqueue_job(self, function: str, *, _job_id: str | None = None) -> object:
            _log(stack, f"  0.01s ! {function} failed, RuntimeError: injected")
            return object()

        async def aclose(self) -> None:
            pass

    async def pool(_settings: object) -> Pool:
        return Pool()

    monkeypatch.setattr(functional, "create_pool", pool)
    running = _worker(stack, "import time; time.sleep(30)")
    try:
        with pytest.raises(functional.WorkerFailed, match="probed cron job"):
            stack.probe_schedule(seconds=10)
    finally:
        stop(running, grace_seconds=5)
    assert stack.worker_checks["worker_probe"] == "failed"


@pytest.mark.parametrize(
    ("lines", "alive", "schedule", "final"),
    [
        ([f"  0.01s ← cron:{functional.PROBE_JOB} ● 0"], True, "failed", "passed"),
        (["  0.02s ← cron:send_deliveries ● 1"], True, "passed", "passed"),
        (["  0.02s ← cron:send_deliveries ● 1"], False, "passed", "failed"),
        (
            ["  0.02s ← cron:send_deliveries ● 1", "  0.03s ! cron:reconcile_ledger failed, X: y"],
            True,
            "failed",
            "passed",
        ),
    ],
)
def test_functional_run_records_the_scheduler_and_a_worker_alive_at_the_end(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    lines: list[str],
    alive: bool,
    schedule: str,
    final: str,
) -> None:
    stack = functional.Stack(tmp_path)
    stack.worker_checks.update(worker_heartbeat="passed", worker_probe="passed")
    monkeypatch.setattr(stack, "worker_heartbeat", lambda: alive)
    _log(stack, *lines)
    running = _worker(stack, "import time; time.sleep(30)")
    try:
        evidence = stack.finish_worker(seconds=0.5)
    finally:
        stop(running, grace_seconds=5)
    assert evidence["worker_schedule"] == schedule
    assert evidence["worker_final"] == final
    assert evidence["scheduled_jobs"] == functional.scheduled_jobs(tmp_path / "worker.log")
    if schedule == final == "passed":
        stack.require_worker()
    else:
        with pytest.raises(functional.WorkerFailed):
            stack.require_worker()


def test_functional_run_without_a_started_worker_keeps_pending_checks(tmp_path: Path) -> None:
    stack = functional.Stack(tmp_path)
    assert stack.finish_worker(seconds=0) == {
        "worker_heartbeat": "pending",
        "worker_probe": "pending",
        "worker_schedule": "pending",
        "worker_final": "pending",
    }
    with pytest.raises(functional.WorkerFailed, match="worker_heartbeat"):
        stack.require_worker()


def test_a_stack_waits_for_a_free_slot_on_the_machine(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(functional, "SLOTS", tmp_path)
    monkeypatch.setenv("E2E_STACK_SLOTS", "1")
    waits: list[float] = []

    def sleep(seconds: float) -> None:
        waits.append(seconds)
        raise TimeoutError

    with functional.stack_slot() as held:
        assert held == 0
        monkeypatch.setattr(functional.time, "sleep", sleep)
        with pytest.raises(TimeoutError), functional.stack_slot(poll_seconds=0.5):
            pass
    assert waits == [0.5]
    with functional.stack_slot() as again:
        assert again == 0


def test_the_slot_count_follows_dockers_memory(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("E2E_STACK_SLOTS", raising=False)

    def docker_info(*_: object, **__: object) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess([], 0, stdout=str(4 * 1024**3), stderr="")

    monkeypatch.setattr(functional.subprocess, "run", docker_info)
    assert functional.slot_count() == 2
    monkeypatch.setenv("E2E_STACK_SLOTS", "3")
    assert functional.slot_count() == 3


def native_junit(*cases: tuple[str, str, str]) -> str:
    rows = "".join(
        f'<testcase name="{name}" status="{status}">{child}</testcase>'
        for name, status, child in cases
    )
    return f"<testsuites><testsuite>{rows}</testsuite></testsuites>"


@pytest.mark.parametrize("failure", ["missing", "failed", "error_child", "repeated", "empty"])
def test_native_evidence_cannot_certify_missing_or_unclean_flows(failure: str) -> None:
    passed = ("NATIVE-CRM-01 client lifecycle", "SUCCESS", "")
    validate_native_evidence(native_junit(passed), ["NATIVE-CRM-01"])
    required = ["NATIVE-CRM-01"]
    cases = [passed]
    if failure == "missing":
        required.append("NATIVE-IOS-01")
    elif failure == "failed":
        cases = [("NATIVE-CRM-01 client lifecycle", "ERROR", "")]
    elif failure == "error_child":
        cases = [("NATIVE-CRM-01 client lifecycle", "SUCCESS", "<failure>stalled</failure>")]
    elif failure == "repeated":
        cases = [passed, passed]
    else:
        cases = []
    with pytest.raises(ValueError):
        validate_native_evidence(native_junit(*cases), required)


def test_the_native_link_forwards_until_it_is_cut_and_again_once_restored() -> None:
    with socket.socket() as upstream:
        upstream.bind(("127.0.0.1", 0))
        upstream.listen()
        listen = functional.free_port()
        link = functional.NativeLink({listen: upstream.getsockname()[1]})
        try:
            link.online()
            with socket.create_connection(("127.0.0.1", listen), timeout=5) as app:
                served, _ = upstream.accept()
                with served:
                    app.sendall(b"ping")
                    assert served.recv(4) == b"ping"
                    link.offline()
                    assert app.recv(4) == b""
            with pytest.raises(ConnectionRefusedError):
                socket.create_connection(("127.0.0.1", listen), timeout=5)
            link.online()
            with socket.create_connection(("127.0.0.1", listen), timeout=5) as app:
                served, _ = upstream.accept()
                with served:
                    served.sendall(b"pong")
                    assert app.recv(4) == b"pong"
        finally:
            link.close()


def test_ci_builds_the_android_app_the_native_lane_installs() -> None:
    workflow = (functional.ROOT / ".github" / "workflows" / "ci.yml").read_text()
    build = workflow[workflow.index("  mobile-build:") : workflow.index("  mobile-shard:")]
    for name, value in functional.native_urls("android").items():
        assert f"      {name}: {value}\n" in build
