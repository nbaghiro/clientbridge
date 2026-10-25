import argparse
import io
import json
import logging
import os
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
from typing import IO
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
from scripts.e2e_results import REQUIRED_CASES, Attempt, Report, Spec, Suite
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

    def configure(self) -> None:
        pass

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
            report = Report(
                errors=[],
                suites=[
                    Suite(
                        specs=[
                            Spec(title=f"{identity} harness fixture", tests=[result])
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
    assert record["cleanup"] == ("passed" if fault == "none" else "failed")
    assert record["outcome"] == ("passed" if fault == "none" else "failed")
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
