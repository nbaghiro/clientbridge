"""Meta-tests: prove the test foundation itself — isolation, factories, fakes, auth clients."""

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.integrations.notifications import Email
from clientbridge.models.crm import Client
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
        res = await client.get("/v1/clients", params={"limit": 1})
        assert res.status_code == 200
        assert res.json()["total"] > 0


async def test_unauth_rejected(unauth: httpx.AsyncClient) -> None:
    res = await unauth.get("/v1/clients", params={"limit": 1})
    assert res.status_code == 401


async def test_fake_email_records(email: FakeEmailSender) -> None:
    await email.send(Email(to="a@b.ca", subject="hi", body="x"))
    assert len(email.sent) == 1
    assert email.sent[0].to == "a@b.ca"
