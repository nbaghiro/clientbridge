import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.phones import e164
from clientbridge.models.clients import Client
from clientbridge.services.clients import find_or_create_by_contact
from tests.conftest import Factory
from tests.helpers import ok

BIZ = "bz_birchbark"


@pytest.mark.parametrize(
    ("typed", "stored"),
    [
        ("(250) 555-0101", "+12505550101"),
        ("250.555.0101", "+12505550101"),
        ("1 250 555 0101", "+12505550101"),
        ("+1 250-555-0101", "+12505550101"),
        ("+44 20 7946 0958", "+442079460958"),
        ("555-0101", None),
        ("0250 555 0101", None),
        ("+0 123 4567", None),
        ("call me", None),
    ],
)
def test_numbers_become_e164_or_are_refused(typed: str, stored: str | None) -> None:
    assert e164(typed) == stored


async def test_a_new_client_phone_is_stored_as_e164(as_owner: httpx.AsyncClient) -> None:
    out = ok(
        await as_owner.post("/v1/clients", json={"name": "Typed", "phone": "(604) 555-7101"}), 201
    ).json()
    assert out["phone"] == "+16045557101"
    edited = ok(await as_owner.patch(f"/v1/clients/{out['id']}", json={"phone": "6045557102"}))
    assert edited.json()["phone"] == "+16045557102"
    cleared = ok(await as_owner.patch(f"/v1/clients/{out['id']}", json={"phone": " "}))
    assert cleared.json()["phone"] is None


async def test_an_unparseable_phone_is_422(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/clients", json={"name": "Short", "phone": "555-0101"})
    assert res.status_code == 422
    out = ok(await as_owner.post("/v1/clients", json={"name": "Fine"}), 201).json()
    res = await as_owner.patch(f"/v1/clients/{out['id']}", json={"phone": "12345"})
    assert res.status_code == 422


async def test_a_client_stored_as_typed_is_found_by_its_e164_number(
    db: AsyncSession, factory: Factory
) -> None:
    business = await factory.business(name="Typed Phones")
    legacy = await factory.client(business=business)
    legacy.phone = "(250) 555-0177"
    await db.flush()
    found = await find_or_create_by_contact(
        db, business.id, name="Online", phone="+12505550177", source="online_booking"
    )
    assert found.id == legacy.id
    other = await factory.business(name="Other Typed Phones")
    fresh = await find_or_create_by_contact(
        db, other.id, name="Online", phone="+12505550177", source="online_booking"
    )
    assert fresh.id != legacy.id and isinstance(fresh, Client)
