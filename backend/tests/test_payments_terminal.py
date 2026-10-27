import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.errors import Unprocessable
from clientbridge.integrations.stripe import PostalAddress
from clientbridge.models.business import Business
from clientbridge.services.business import postal_address
from tests.conftest import FakePaymentGateway
from tests.helpers import ok

BIZ = "bz_birchbark"


async def _set_account(db: AsyncSession, account: str | None) -> None:
    # A Terminal location belongs to an account, so a linked local demo's location is cleared too.
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_account_id=account, stripe_terminal_location_id=None)
    )
    await db.flush()


async def test_connection_token_returns_secret(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _set_account(db, "acct_test")
    res = await as_owner.post("/v1/terminal/connection-token")
    assert res.status_code == 200, res.text
    assert res.json()["secret"].startswith("pst_fake")


async def test_connection_token_requires_onboarding(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _set_account(db, None)
    assert (await as_owner.post("/v1/terminal/connection-token")).status_code == 409


async def test_staff_can_get_connection_token(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _set_account(db, "acct_test")  # the reader is staff-operated — any principal may connect
    res = await as_staff.post("/v1/terminal/connection-token")
    assert res.status_code == 200, res.text


async def test_connection_token_mints_and_reuses_terminal_location(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _set_account(db, "acct_test")
    first = (await as_owner.post("/v1/terminal/connection-token")).json()
    loc = first["location_id"]
    assert loc is not None and loc.startswith("tml_fake")
    assert len(gateway.created_locations) == 1
    stored = (
        await db.execute(select(Business.stripe_terminal_location_id).where(Business.id == BIZ))
    ).scalar_one()
    assert stored == loc
    # a second call reuses the cached location — no second mint
    second = (await as_owner.post("/v1/terminal/connection-token")).json()
    assert second["location_id"] == loc
    assert len(gateway.created_locations) == 1


async def test_connection_token_is_scoped_to_the_business_location(
    as_staff: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _set_account(db, "acct_test")
    first = ok(await as_staff.post("/v1/terminal/connection-token")).json()
    second = ok(await as_staff.post("/v1/terminal/connection-token")).json()
    assert gateway.token_locations == [first["location_id"], second["location_id"]]


async def test_a_new_address_deletes_the_old_location(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _set_account(db, "acct_test")
    old = ok(await as_owner.post("/v1/terminal/connection-token")).json()["location_id"]
    ok(await as_owner.patch("/v1/business", json={"brand": {"address": "Elsewhere"}}))
    assert gateway.deleted_locations == []
    ok(await as_owner.patch("/v1/business", json={"unit": "Suite 4"}))
    assert gateway.deleted_locations == [old]
    new = ok(await as_owner.post("/v1/terminal/connection-token")).json()["location_id"]
    assert new != old and gateway.token_locations[-1] == new


async def test_a_location_stripe_will_not_delete_leaves_the_address_saved(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
    caplog: pytest.LogCaptureFixture,
) -> None:
    await _set_account(db, "acct_test")
    ok(await as_owner.post("/v1/terminal/connection-token"))
    gateway.location_delete_fails = True
    ok(await as_owner.patch("/v1/business", json={"unit": "Suite 4"}))
    business = await db.get(Business, BIZ, populate_existing=True)
    assert business is not None and business.unit == "Suite 4"
    assert business.stripe_terminal_location_id is None
    assert "terminal location delete failed" in caplog.text


async def test_terminal_location_uses_the_business_street_address(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _set_account(db, "acct_test")
    assert (await as_owner.post("/v1/terminal/connection-token")).status_code == 200
    assert gateway.location_addresses == [
        PostalAddress(
            line1="1207 Government Street",
            city="Victoria",
            province="BC",
            postal_code="V8W 1Y9",
        )
    ]


async def test_terminal_location_needs_a_complete_address(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _set_account(db, "acct_test")
    business = await db.get(Business, BIZ)
    assert business is not None
    business.street_number = None
    await db.flush()
    res = await as_owner.post("/v1/terminal/connection-token")
    assert res.status_code == 422
    assert res.json()["error"] == "business_address_incomplete"
    assert gateway.created_locations == []


def _business(**fields: str | None) -> Business:
    address: dict[str, str | None] = {
        "province": "BC",
        "street_number": "88",
        "street_name": "Fort St",
        "city": "Victoria",
        "postal_code": "V8W 1Y9",
    }
    return Business(id="bz_x", name="X", slug="x", **(address | fields))


def test_postal_address_joins_the_number_and_street_and_carries_the_unit() -> None:
    assert postal_address(_business()) == PostalAddress("88 Fort St", "Victoria", "BC", "V8W 1Y9")
    assert postal_address(_business(unit="Suite 4")) == PostalAddress(
        "88 Fort St", "Victoria", "BC", "V8W 1Y9", line2="Suite 4"
    )


@pytest.mark.parametrize(
    "missing", ["street_number", "street_name", "city", "postal_code", "province"]
)
def test_postal_address_refuses_an_address_missing_a_part(missing: str) -> None:
    with pytest.raises(Unprocessable):
        postal_address(_business(**{missing: None}))
