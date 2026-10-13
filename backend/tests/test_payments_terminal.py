import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.errors import Unprocessable
from clientbridge.integrations.stripe import PostalAddress
from clientbridge.models.business import Business, ProvinceCode
from clientbridge.services.business import postal_address
from tests.conftest import FakePaymentGateway

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
    business.brand = {**business.brand, "address": "Government Street, Victoria"}
    await db.flush()
    res = await as_owner.post("/v1/terminal/connection-token")
    assert res.status_code == 422
    assert res.json()["error"] == "business_address_incomplete"
    assert gateway.created_locations == []


def _business(address: object, province: ProvinceCode | None = "BC") -> Business:
    return Business(id="bz_x", name="X", slug="x", province=province, brand={"address": address})


@pytest.mark.parametrize(
    ("address", "expected"),
    [
        (
            "1207 Government Street, Victoria, BC V8W 1Y9",
            PostalAddress("1207 Government Street", "Victoria", "BC", "V8W 1Y9"),
        ),
        (
            "Unit 4, 88 Fort St, Victoria BC v8w1y9",
            PostalAddress("Unit 4", "Victoria", "BC", "V8W 1Y9", line2="88 Fort St"),
        ),
        (
            "88 Fort St, Victoria, British Columbia, V8W 1Y9",
            PostalAddress("88 Fort St", "Victoria", "BC", "V8W 1Y9"),
        ),
        (
            "88 Fort St, Victoria V8W 1Y9",
            PostalAddress("88 Fort St", "Victoria", "BC", "V8W 1Y9"),
        ),
        (
            "88 Fort St, Victoria, BC V8W 1Y9, Canada",
            PostalAddress("88 Fort St", "Victoria", "BC", "V8W 1Y9"),
        ),
        (
            "88 Fort St\nVictoria BC V8W 1Y9\nCA",
            PostalAddress("88 Fort St", "Victoria", "BC", "V8W 1Y9"),
        ),
    ],
)
def test_postal_address_reads_canadian_formats(address: str, expected: PostalAddress) -> None:
    assert postal_address(_business(address)) == expected


@pytest.mark.parametrize(
    "address",
    ["1 Rue des Jardins, Québec G1R 4S9", "1 Rue des Jardins, Québec, QC G1R 4S9, Canada"],
)
def test_a_city_named_like_its_province_stays_the_city(address: str) -> None:
    assert postal_address(_business(address, "QC")) == PostalAddress(
        "1 Rue des Jardins", "Québec", "QC", "G1R 4S9"
    )


def test_a_unit_line_before_a_city_named_like_its_province_keeps_the_city() -> None:
    address = "1 Rue Saint-Louis, Apt 2, Québec G1R 3Z2"
    assert postal_address(_business(address, "QC")) == PostalAddress(
        "1 Rue Saint-Louis", "Québec", "QC", "G1R 3Z2", line2="Apt 2"
    )


@pytest.mark.parametrize(
    ("address", "province"),
    [
        ("1207 Government Street, Victoria, BC", "BC"),
        ("Victoria, BC V8W 1Y9", "BC"),
        ("88 Fort St, Toronto, ON M5H 2N2", "BC"),
        ("88 Fort St, Victoria, BC V8W 1Y9", None),
        (None, "BC"),
    ],
)
def test_postal_address_refuses_incomplete_addresses(
    address: str | None, province: ProvinceCode | None
) -> None:
    with pytest.raises(Unprocessable):
        postal_address(_business(address, province))
