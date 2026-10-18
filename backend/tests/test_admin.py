from dataclasses import replace

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.config import get_settings
from clientbridge.models.platform import Audit
from tests.conftest import Factory, FakeEmailSender, FakeIdentityProvider
from tests.test_auth import fresh


async def test_admin_requires_authentication(api: httpx.AsyncClient) -> None:
    assert (await api.get("/admin/v1/session")).status_code == 401


async def test_admin_access_is_explicit_and_revocable(
    api: httpx.AsyncClient, identities: FakeIdentityProvider, monkeypatch: pytest.MonkeyPatch
) -> None:
    identity = fresh()
    headers = {"X-Session-Token": identities.issue(identity)}
    settings = get_settings()
    monkeypatch.setattr(settings, "platform_admin_identity_ids", "")
    assert (await api.get("/admin/v1/session", headers=headers)).status_code == 403
    monkeypatch.setattr(settings, "platform_admin_identity_ids", identity.id)
    result = await api.get("/admin/v1/session", headers=headers)
    assert result.status_code == 200
    assert result.json() == {"identity_id": identity.id}
    assert result.headers["cache-control"] == "no-store"
    monkeypatch.setattr(settings, "platform_admin_identity_ids", "other-identity")
    assert (await api.get("/admin/v1/session", headers=headers)).status_code == 403


async def test_unverified_admin_is_denied(
    api: httpx.AsyncClient, identities: FakeIdentityProvider, monkeypatch: pytest.MonkeyPatch
) -> None:
    identity = replace(fresh(), verified_emails=frozenset())
    monkeypatch.setattr(get_settings(), "platform_admin_identity_ids", identity.id)
    result = await api.get(
        "/admin/v1/session", headers={"X-Session-Token": identities.issue(identity)}
    )
    assert result.status_code == 403


async def test_business_owner_is_not_platform_admin(
    as_owner: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "platform_admin_identity_ids", "")
    monkeypatch.setattr(get_settings(), "dev_platform_admin_identity_ids", "")
    assert (await as_owner.get("/admin/v1/session")).status_code == 403


async def test_admin_origin_supports_credentials(api: httpx.AsyncClient) -> None:
    result = await api.options(
        "/admin/v1/session",
        headers={
            "Origin": "http://localhost:8711",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert result.headers["access-control-allow-origin"] == "http://localhost:8711"
    assert result.headers["access-control-allow-credentials"] == "true"


@pytest.mark.parametrize("environment,expected", [("dev", 200), ("staging", 403), ("prod", 403)])
async def test_demo_grant_is_development_only(
    api: httpx.AsyncClient,
    identities: FakeIdentityProvider,
    monkeypatch: pytest.MonkeyPatch,
    environment: str,
    expected: int,
) -> None:
    identity = fresh()
    settings = get_settings()
    monkeypatch.setattr(settings, "env", environment)
    monkeypatch.setattr(settings, "platform_admin_identity_ids", "")
    monkeypatch.setattr(settings, "dev_platform_admin_identity_ids", identity.id)
    result = await api.get(
        "/admin/v1/session", headers={"X-Session-Token": identities.issue(identity)}
    )
    assert result.status_code == expected


@pytest.fixture
def admin_headers(
    identities: FakeIdentityProvider, monkeypatch: pytest.MonkeyPatch
) -> dict[str, str]:
    identity = fresh()
    monkeypatch.setattr(get_settings(), "platform_admin_identity_ids", identity.id)
    return {"X-Session-Token": identities.issue(identity)}


@pytest.mark.parametrize(
    "path",
    [
        "overview",
        "businesses",
        "users",
        "clients",
        "payments",
        "activity",
        "operations",
        "email-config",
        "access",
        "emails",
        "emails/invoice",
        "businesses/bz_birchbark",
        "users/us_dev",
    ],
)
async def test_admin_reads_require_platform_grant(
    api: httpx.AsyncClient, as_owner: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch, path: str
) -> None:
    monkeypatch.setattr(get_settings(), "platform_admin_identity_ids", "")
    monkeypatch.setattr(get_settings(), "dev_platform_admin_identity_ids", "")
    assert (await api.get(f"/admin/v1/{path}", headers={"X-Session-Token": ""})).status_code == 401
    assert (await as_owner.get(f"/admin/v1/{path}")).status_code == 403


@pytest.mark.parametrize(
    "path",
    [
        "overview",
        "businesses",
        "users",
        "clients",
        "payments",
        "activity",
        "operations",
        "email-config",
        "access",
        "emails",
        "emails/invoice",
        "businesses/bz_birchbark",
        "users/us_dev",
    ],
)
async def test_admin_reads(
    api: httpx.AsyncClient, admin_headers: dict[str, str], path: str
) -> None:
    response = await api.get(f"/admin/v1/{path}", headers=admin_headers)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    for secret in ('"invite_token"', '"payload"', '"changes"'):
        assert secret not in response.text


async def test_admin_filters_and_payment_evidence(
    api: httpx.AsyncClient, admin_headers: dict[str, str]
) -> None:
    base = "/admin/v1"
    businesses = (await api.get(f"{base}/businesses?q=Birchbark", headers=admin_headers)).json()
    assert businesses["items"] and all(
        "birchbark" in row["name"].lower() for row in businesses["items"]
    )
    assert (await api.get(f"{base}/businesses?q=%25", headers=admin_headers)).json()["items"] == []
    clients = (
        await api.get(f"{base}/clients?business_id=bz_birchbark", headers=admin_headers)
    ).json()
    assert clients["items"] and all(
        row["business_id"] == "bz_birchbark" for row in clients["items"]
    )
    payments = (
        await api.get(f"{base}/payments?business_id=bz_birchbark", headers=admin_headers)
    ).json()
    assert payments["items"]
    for payment in payments["items"][:3]:
        detail = await api.get(f"{base}/payments/{payment['id']}", headers=admin_headers)
        assert detail.status_code == 200
        assert detail.json()["business"]["id"] == "bz_birchbark"
    assert (await api.get(f"{base}/payments?business_id=missing", headers=admin_headers)).json()[
        "items"
    ] == []
    assert (await api.get(f"{base}/businesses?offset=99999", headers=admin_headers)).json()[
        "items"
    ] == []


@pytest.mark.parametrize(
    "path,code",
    [
        ("businesses/missing", 404),
        ("users/missing", 404),
        ("payments/missing", 404),
        ("emails/missing", 404),
        ("payments?status=bad", 422),
        ("users?offset=-1", 422),
    ],
)
async def test_admin_invalid_requests(
    api: httpx.AsyncClient, admin_headers: dict[str, str], path: str, code: int
) -> None:
    assert (await api.get(f"/admin/v1/{path}", headers=admin_headers)).status_code == code


async def test_admin_email_preview_and_send(
    api: httpx.AsyncClient,
    admin_headers: dict[str, str],
    email: FakeEmailSender,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from clientbridge.api.admin import test_sender
    from clientbridge.main import app

    app.dependency_overrides[test_sender] = lambda: email
    monkeypatch.setattr(get_settings(), "smtp_url", "smtp://localhost:1025")
    monkeypatch.setattr(get_settings(), "resend_api_key", "")
    preview = (await api.get("/admin/v1/emails/invoice", headers=admin_headers)).json()
    assert "data:image/png;base64," in preview["html"]
    assert "cid:" not in preview["html"]
    body = {
        "recipient": "operator@example.com",
        "transport": "smtp",
        "request_id": "admin-test-delivery-001",
    }
    response = await api.post("/admin/v1/emails/invoice/send", headers=admin_headers, json=body)
    assert response.status_code == 200, response.text
    assert len(email.sent) == 1
    assert email.sent[0].to == "operator@example.com"
    assert email.sent[0].subject.startswith("[TEST]")
    assert email.sent[0].images
    history = await api.get("/admin/v1/deliveries", headers=admin_headers)
    assert history.status_code == 200
    assert history.json()["items"][0]["id"] == response.json()["delivery_id"]
    assert history.json()["items"][0]["recipient"] == body["recipient"]
    assert history.json()["items"][0]["state"] == "accepted"
    assert (await api.get("/admin/v1/deliveries")).status_code == 401
    assert (
        await api.post("/admin/v1/emails/invoice/send", headers=admin_headers, json=body)
    ).status_code == 200
    assert len(email.sent) == 1
    assert (
        await api.post(
            "/admin/v1/emails/invoice/send",
            headers=admin_headers,
            json={**body, "recipient": "a@example.com,b@example.com"},
        )
    ).status_code == 422
    assert (
        await api.post(
            "/admin/v1/emails/invoice/send",
            headers=admin_headers,
            json={**body, "transport": "resend"},
        )
    ).status_code == 503
    assert (await api.post("/admin/v1/emails/invoice/send", json=body)).status_code == 401


@pytest.mark.parametrize(
    "smtp,resend,expected",
    [
        ("", "", []),
        ("smtp://localhost", "", ["smtp"]),
        ("", "test-key", ["resend"]),
        ("smtp://localhost", "test-key", ["smtp", "resend"]),
    ],
)
async def test_email_configuration(
    api: httpx.AsyncClient,
    admin_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    smtp: str,
    resend: str,
    expected: list[str],
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "smtp_url", smtp)
    monkeypatch.setattr(settings, "resend_api_key", resend)
    monkeypatch.setattr(settings, "email_from", "demo@example.com")
    response = await api.get("/admin/v1/email-config", headers=admin_headers)
    assert response.status_code == 200
    assert response.json() == {"email_transports": expected}
    assert response.headers["cache-control"] == "no-store"


async def test_operations_reports_migration_head(
    api: httpx.AsyncClient, admin_headers: dict[str, str]
) -> None:
    response = await api.get("/admin/v1/operations", headers=admin_headers)
    assert response.status_code == 200
    operations = response.json()
    assert operations["expected_revision"]
    assert operations["database_revision"] == operations["expected_revision"]


async def test_sms_assignment_is_normalized_audited_and_cannot_cross_businesses(
    api: httpx.AsyncClient, admin_headers: dict[str, str], db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    path = "/admin/v1/businesses/bz_birchbark/sms"
    assert (await api.post(path, json={"number": "+12505550123"})).status_code == 401
    result = await api.post(path, json={"number": "250-555-0123"}, headers=admin_headers)
    assert result.status_code == 200
    assert result.json()["sms_number"] == "+12505550123"
    assert (await api.post(path, json={"number": None}, headers=admin_headers)).status_code == 200
    assert (
        await api.post(
            f"/admin/v1/businesses/{other.id}/sms",
            json={"number": "+12505550123"},
            headers=admin_headers,
        )
    ).status_code == 409
    assert (
        await api.post(path, json={"number": "+12505550123"}, headers=admin_headers)
    ).status_code == 200
    audits = list(await db.scalars(select(Audit).where(Audit.action == "business.sms_assignment")))
    assert len(audits) == 3
    assert audits[0].changes["new"] == "+12505550123"
    assert (
        await api.post(path, json={"number": "invalid"}, headers=admin_headers)
    ).status_code == 422


async def test_client_activity_includes_related_records_and_keeps_business_scope(
    api: httpx.AsyncClient, db: AsyncSession, admin_headers: dict[str, str]
) -> None:
    from clientbridge.core.ids import new_id
    from clientbridge.models.scheduling import Booking

    booking = (await db.scalars(select(Booking).where(Booking.client_id == "cl_amelie"))).first()
    assert booking is not None
    identity = new_id("audit")
    db.add(
        Audit(
            id=identity,
            business_id=booking.business_id,
            action="booking.test",
            entity_type="booking",
            entity_id=booking.id,
            changes={},
        )
    )
    await db.commit()
    response = await api.get(
        "/admin/v1/activity",
        params={"q": "cl_amelie", "business_id": booking.business_id},
        headers=admin_headers,
    )
    assert response.status_code == 200
    assert identity in {item["id"] for item in response.json()["items"]}
    other = await api.get(
        "/admin/v1/activity",
        params={"q": "cl_amelie", "business_id": "missing"},
        headers=admin_headers,
    )
    assert other.json()["items"] == []
