import json
import logging
import sys

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from pydantic import ValidationError
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
    assert settings.connect_base_url == f"https://book.{base}"
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
        f"https://{base}": None,
        f"https://www.{base}": None,
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
