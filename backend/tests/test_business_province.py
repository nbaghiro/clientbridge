import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.business import Business
from clientbridge.models.platform import Audit
from clientbridge.services.business import has_issued_tax
from tests.conftest import BIZ, Factory, FakeIdentityProvider, session_token

GROOM = {"description": "Full Groom", "unit_amount_cents": 5000}
TORONTO = {"province": "ON", "city": "Toronto", "postal_code": "M5H 2N2"}


@pytest.fixture
async def fresh(
    api: httpx.AsyncClient, db: AsyncSession, factory: Factory, identities: FakeIdentityProvider
) -> Business:
    business = await factory.business()
    business.street_number, business.street_name = "1207", "Government Street"
    business.city, business.postal_code = "Victoria", "V8W 1Y9"
    business.stripe_terminal_location_id = "tml_old"
    user = await factory.user()
    await factory.staff(business=business, user=user)
    await db.flush()
    token = await session_token(identities, db, user.id)
    api.headers.update({"X-Session-Token": token, "X-Business-Id": business.id})
    return business


async def _registered(db: AsyncSession, business: Business) -> None:
    await db.execute(update(Business).where(Business.id == business.id).values(tax_registered=True))
    await db.flush()


async def _client(factory: Factory, business: Business) -> str:
    return (await factory.client(business=business)).id


async def test_a_business_without_taxed_documents_changes_its_province(
    api: httpx.AsyncClient, db: AsyncSession, fresh: Business
) -> None:
    assert await has_issued_tax(db, BIZ)
    res = await api.patch("/v1/business", json={"province": "ON"})
    assert res.status_code == 422 and res.json()["error"] == "postal_code_province_mismatch"
    await db.refresh(fresh)
    assert fresh.province == "BC"
    res = await api.patch("/v1/business", json=TORONTO)
    assert res.status_code == 200, res.text
    assert (res.json()["province"], res.json()["postal_code"]) == ("ON", "M5H 2N2")
    await db.refresh(fresh)
    assert fresh.stripe_terminal_location_id is None
    audit = (
        await db.execute(
            select(Audit).where(Audit.business_id == fresh.id, Audit.action == "business.province")
        )
    ).scalar_one()
    assert audit.changes == {"old": "BC", "new": "ON"}
    assert (await api.patch("/v1/business", json={"province": None})).status_code == 200
    assert (await api.patch("/v1/business", json={"province": "ZZ"})).status_code == 422
    await db.refresh(fresh)
    assert fresh.province == "ON"


async def test_untaxed_and_draft_documents_leave_the_province_open(
    api: httpx.AsyncClient, db: AsyncSession, factory: Factory, fresh: Business
) -> None:
    cid = await _client(factory, fresh)
    sent = {"client_id": cid, "lines": [GROOM], "send": True}
    assert (await api.post("/v1/invoices", json=sent)).status_code == 201
    assert (await api.post("/v1/orders", json={"lines": [GROOM]})).status_code == 201
    await _registered(db, fresh)
    draft = {"client_id": cid, "lines": [GROOM]}
    assert (await api.post("/v1/invoices", json=draft)).status_code == 201
    assert (await api.post("/v1/estimates", json=draft)).status_code == 201
    assert not await has_issued_tax(db, fresh.id)
    assert (await api.patch("/v1/business", json=TORONTO)).status_code == 200


@pytest.mark.parametrize("document", ["invoices", "orders", "estimates"])
async def test_a_taxed_document_locks_the_province(
    api: httpx.AsyncClient, db: AsyncSession, factory: Factory, fresh: Business, document: str
) -> None:
    await _registered(db, fresh)
    body = (
        {"lines": [GROOM]}
        if document == "orders"
        else {"client_id": await _client(factory, fresh), "lines": [GROOM], "send": True}
    )
    created = await api.post(f"/v1/{document}", json=body)
    assert created.status_code == 201, created.text
    assert created.json()["tax_total_cents"] > 0
    res = await api.patch("/v1/business", json=TORONTO)
    assert res.status_code == 409 and res.json()["error"] == "province_locked"
    await db.refresh(fresh)
    assert (fresh.province, fresh.postal_code) == ("BC", "V8W 1Y9")
    assert (await api.patch("/v1/business", json={"province": "BC"})).status_code == 200


async def test_the_seeded_business_keeps_its_province(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    res = await as_owner.patch("/v1/business", json={"province": "AB"})
    assert res.status_code == 409 and res.json()["error"] == "province_locked"
    res = await as_owner.patch("/v1/business", json={"province": "BC", "unit": "Suite 2"})
    assert res.status_code == 200, res.text
    assert not await db.scalar(select(Audit.id).where(Audit.action == "business.province"))


async def test_staff_cannot_change_the_province(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    res = await as_staff.patch("/v1/business", json={"province": "BC"})
    assert res.status_code == 403
    assert (await db.get_one(Business, BIZ)).province == "BC"
