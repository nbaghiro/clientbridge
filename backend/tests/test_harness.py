import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.config import Settings
from clientbridge.core.ids import new_id
from clientbridge.integrations.postmark import Email
from clientbridge.integrations.stripe import get_payment_gateway
from clientbridge.main import app
from clientbridge.models.clients import Client
from tests.conftest import Factory, FakeEmailSender

MARKER = "cl_isolation_marker"


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
    await email.send(Email(to="a@b.ca", subject="hi", body="x"))
    assert len(email.sent) == 1
    assert email.sent[0].to == "a@b.ca"


client = TestClient(app)


def test_prod_requires_real_secrets() -> None:
    # Fail closed: a non-dev env with the public dev jwt secret / empty stripe secret must refuse.
    with pytest.raises(ValidationError):
        Settings(env="prod")
    assert Settings(env="dev").env == "dev"  # dev keeps the convenient defaults


def test_health() -> None:
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


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
