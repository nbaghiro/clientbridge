from dataclasses import replace

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.config import get_settings
from clientbridge.core.ids import new_id
from clientbridge.models.business import Business
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
        "businesses/bz_birchbark/drift",
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
        "businesses/bz_birchbark/drift",
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
        "recipient": "operator@example.ca",
        "transport": "smtp",
        "request_id": "admin-test-delivery-001",
    }
    response = await api.post("/admin/v1/emails/invoice/send", headers=admin_headers, json=body)
    assert response.status_code == 200, response.text
    assert len(email.sent) == 1
    assert email.sent[0].to == "operator@example.ca"
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


async def test_admin_sets_the_edition_and_audits_each_change(
    api: httpx.AsyncClient, admin_headers: dict[str, str], db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    path = "/admin/v1/businesses/bz_birchbark/edition"
    result = await api.post(path, json={"subject": "student"}, headers=admin_headers)
    assert result.status_code == 200, result.text
    assert result.json()["subject"] == "student"
    assert (await api.post(path, json={"subject": "student"}, headers=admin_headers)).json()[
        "subject"
    ] == "student"
    cleared = await api.post(path, json={"subject": None}, headers=admin_headers)
    assert cleared.status_code == 200
    assert cleared.json()["subject"] is None
    audits = list(await db.scalars(select(Audit).where(Audit.action == "business.edition")))
    assert {(row.changes["old"], row.changes["new"]) for row in audits} == {
        ("pet", "student"),
        ("student", None),
    }
    assert all(row.business_id == "bz_birchbark" and row.changes["identity_id"] for row in audits)
    await db.refresh(other)
    assert other.subject == "pet"


async def test_admin_switches_a_business_to_vehicles(
    api: httpx.AsyncClient, admin_headers: dict[str, str], db: AsyncSession
) -> None:
    path = "/admin/v1/businesses/bz_birchbark/edition"
    result = await api.post(path, json={"subject": "vehicle"}, headers=admin_headers)
    assert result.status_code == 200, result.text
    assert result.json()["subject"] == "vehicle"
    stored = await db.scalar(select(Business.subject).where(Business.id == "bz_birchbark"))
    assert stored == "vehicle"


@pytest.mark.parametrize(
    "business_id,body,code",
    [("missing", {"subject": "pet"}, 404), ("bz_birchbark", {"subject": "boat"}, 422)],
)
async def test_admin_edition_rejects_unknown_business_and_kind(
    api: httpx.AsyncClient, admin_headers: dict[str, str], business_id: str, body: object, code: int
) -> None:
    path = f"/admin/v1/businesses/{business_id}/edition"
    assert (await api.post(path, json=body, headers=admin_headers)).status_code == code


async def test_only_a_platform_admin_sets_the_edition(
    api: httpx.AsyncClient, as_owner: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "platform_admin_identity_ids", "")
    monkeypatch.setattr(get_settings(), "dev_platform_admin_identity_ids", "")
    path = "/admin/v1/businesses/bz_birchbark/edition"
    anonymous = await api.post(path, json={"subject": None}, headers={"X-Session-Token": ""})
    assert anonymous.status_code == 401
    assert (await as_owner.post(path, json={"subject": None})).status_code == 403


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


async def test_drift_acknowledgement_is_scoped_and_idempotent(
    api: httpx.AsyncClient, db: AsyncSession, admin_headers: dict[str, str]
) -> None:
    finding_id = new_id("audit")
    db.add(
        Audit(
            id=finding_id,
            business_id="bz_birchbark",
            action="ledger.transaction_drift",
            entity_type="stripe_source",
            entity_id="txn_unknown",
            changes={"stripe_cents": -50},
        )
    )
    await db.commit()
    path = f"/admin/v1/businesses/bz_birchbark/drift/{finding_id}/acknowledge"
    body = {"reason": "reviewed provider adjustment"}
    assert (await api.post(path, json=body)).status_code == 401
    assert (await api.post(path, json={"reason": " "}, headers=admin_headers)).status_code == 422
    assert (
        await api.post(
            path.replace("bz_birchbark", "bz_cedarcoast"), json=body, headers=admin_headers
        )
    ).status_code == 404
    for _ in range(2):
        response = await api.post(path, json=body, headers=admin_headers)
        assert response.status_code == 200, response.text
        assert response.json() == {"finding_id": finding_id}
    rows = list(
        await db.scalars(
            select(Audit).where(
                Audit.action == "ledger.drift_acknowledged",
                Audit.entity_id == finding_id,
            )
        )
    )
    assert len(rows) == 1
    assert rows[0].changes["reason"] == body["reason"]
    assert rows[0].changes["identity_id"]


async def test_business_owner_cannot_acknowledge_drift(as_owner: httpx.AsyncClient) -> None:
    response = await as_owner.post(
        "/admin/v1/businesses/bz_birchbark/drift/audit_missing/acknowledge",
        json={"reason": "reviewed"},
    )
    assert response.status_code == 403


def _audit(
    audit_id: str,
    action: str,
    entity_type: str,
    entity_id: str,
    changes: dict[str, object],
    business_id: str = "bz_birchbark",
) -> Audit:
    return Audit(
        id=audit_id,
        business_id=business_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        changes=changes,
    )


async def _seed_drift(db: AsyncSession) -> None:
    tx: dict[str, object] = {
        "source": "ch_a",
        "transaction_ids": ["txn_a1"],
        "ledger_cents": 900,
        "stripe_cents": 1000,
    }
    db.add_all(
        [
            _audit("aud_drift_a1", "ledger.transaction_drift", "stripe_source", "ch_a", tx),
            _audit(
                "aud_drift_a2",
                "ledger.transaction_drift",
                "stripe_source",
                "ch_a",
                {**tx, "transaction_ids": ["txn_a1", "txn_a2"], "ledger_cents": 800},
            ),
            _audit(
                "aud_drift_b1",
                "ledger.transaction_drift",
                "stripe_source",
                "ch_b",
                {"source": "ch_b", "transaction_ids": ["txn_b1"], "ledger_cents": 0},
            ),
            _audit("aud_drift_b2", "ledger.drift_resolved", "audit", "aud_drift_b1", {}),
            _audit(
                "aud_drift_c1",
                "ledger.transaction_drift",
                "stripe_source",
                "balance",
                {"residual_cents": 100},
            ),
            _audit(
                "aud_drift_c2",
                "ledger.drift_acknowledged",
                "audit",
                "aud_drift_c1",
                {"reason": "provider adjustment", "identity_id": "idn_reviewer"},
            ),
            _audit(
                "aud_drift_d1",
                "ledger.transaction_drift",
                "stripe_source",
                "ch_other",
                {"source": "ch_other", "ledger_cents": 1, "stripe_cents": 2},
                business_id="bz_demo_second",
            ),
        ]
    )
    await db.commit()


async def test_drift_lists_the_active_finding_per_source(
    api: httpx.AsyncClient, db: AsyncSession, admin_headers: dict[str, str]
) -> None:
    await _seed_drift(db)
    response = await api.get("/admin/v1/businesses/bz_birchbark/drift", headers=admin_headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["has_more"] is False
    items = {item["source"]: item for item in body["items"]}
    assert set(items) == {"ch_a", "balance"}
    assert items["ch_a"]["id"] == "aud_drift_a2"
    assert items["ch_a"]["ledger_cents"] == 800
    assert items["ch_a"]["stripe_cents"] == 1000
    assert items["ch_a"]["residual_cents"] is None
    assert items["ch_a"]["transaction_ids"] == ["txn_a1", "txn_a2"]
    assert items["ch_a"]["acknowledgement"] is None
    assert items["ch_a"]["created_at"]
    assert items["balance"]["id"] == "aud_drift_c1"
    assert items["balance"]["residual_cents"] == 100
    assert items["balance"]["transaction_ids"] == []
    acknowledgement = items["balance"]["acknowledgement"]
    assert acknowledgement["reason"] == "provider adjustment"
    assert acknowledgement["identity_id"] == "idn_reviewer"
    assert acknowledgement["acknowledged_at"]
    other = await api.get("/admin/v1/businesses/bz_demo_second/drift", headers=admin_headers)
    assert [item["id"] for item in other.json()["items"]] == ["aud_drift_d1"]
    missing = await api.get("/admin/v1/businesses/bz_missing/drift", headers=admin_headers)
    assert missing.status_code == 404


async def test_drift_acknowledgement_refuses_inactive_findings(
    api: httpx.AsyncClient, db: AsyncSession, admin_headers: dict[str, str]
) -> None:
    await _seed_drift(db)
    base = "/admin/v1/businesses/bz_birchbark/drift"
    body = {"reason": "reviewed"}
    superseded = await api.post(
        f"{base}/aud_drift_a1/acknowledge", json=body, headers=admin_headers
    )
    assert superseded.status_code == 409
    assert superseded.json()["error"] == "finding_superseded"
    resolved = await api.post(f"{base}/aud_drift_b1/acknowledge", json=body, headers=admin_headers)
    assert resolved.status_code == 409
    assert resolved.json()["error"] == "finding_resolved"
    assert (
        await api.post(f"{base}/aud_drift_d1/acknowledge", json=body, headers=admin_headers)
    ).status_code == 404
    for _ in range(2):
        current = await api.post(
            f"{base}/aud_drift_a2/acknowledge", json=body, headers=admin_headers
        )
        assert current.status_code == 200, current.text
    rows = list(
        await db.scalars(
            select(Audit).where(
                Audit.action == "ledger.drift_acknowledged",
                Audit.entity_id.in_(["aud_drift_a1", "aud_drift_a2", "aud_drift_b1"]),
            )
        )
    )
    assert [row.entity_id for row in rows] == ["aud_drift_a2"]
    listed = (await api.get(base, headers=admin_headers)).json()["items"]
    assert next(i for i in listed if i["id"] == "aud_drift_a2")["acknowledgement"]["reason"] == (
        "reviewed"
    )
