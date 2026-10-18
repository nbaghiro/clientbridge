"""A member's name is their account's; an open invite is named by the address it went to."""

from dataclasses import replace

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.business import User
from clientbridge.models.scheduling import Booking
from tests.conftest import BIZ, Factory, FakeIdentityProvider, identity_for

DIEGO = "st_diego"
SLUG = "birchbark"


async def _rename(
    api: httpx.AsyncClient, identities: FakeIdentityProvider, db: AsyncSession, name: str
) -> None:
    """What Security does: the auth service takes the new name, then the account is read back."""
    user = await db.get(User, "us_diego")
    assert user is not None
    token = identities.issue(replace(identity_for(user), name=name))
    res = await api.get("/v1/me", headers={"X-Session-Token": token, "X-Business-Id": ""})
    assert res.status_code == 200, res.text
    assert res.json()["name"] == name


def _named(staff: list[dict[str, object]], staff_id: str) -> object:
    return next(s["name"] for s in staff if s["id"] == staff_id)


async def test_a_rename_reaches_the_team_calendar_and_booking_pages(
    as_owner: httpx.AsyncClient, identities: FakeIdentityProvider, db: AsyncSession
) -> None:
    client_id = await db.scalar(
        select(Booking.client_id).where(Booking.business_id == BIZ, Booking.staff_id == DIEGO)
    )
    assert client_id is not None
    await _rename(as_owner, identities, db, "Diego Renamed")

    team = (await as_owner.get("/v1/staff/team")).json()
    assert _named(team["members"], DIEGO) == "Diego Renamed"
    visits = await as_owner.get(
        "/v1/bookings/visits",
        params={"client_id": client_id, "before": "2100-01-01T00:00:00Z", "limit": 100},
    )
    assert visits.status_code == 200, visits.text
    names = {v["staff_name"] for v in visits.json()["visits"] if v["staff_id"] == DIEGO}
    assert names == {"Diego Renamed"}
    online = (await as_owner.get("/v1/online-booking")).json()
    assert _named(online["staff"], DIEGO) == "Diego Renamed"
    page = (await as_owner.get(f"/book/{SLUG}/services")).json()
    assert _named(page["staff"], DIEGO) == "Diego Renamed"


async def test_an_open_invite_shows_its_email_and_never_reaches_the_booking_page(
    as_owner: httpx.AsyncClient,
) -> None:
    team = (await as_owner.get("/v1/staff/team")).json()
    assert _named(team["invites"], "st_invite") == "sam.newhire@example.com"
    page = (await as_owner.get(f"/book/{SLUG}/services")).json()
    assert "st_invite" not in {s["id"] for s in page["staff"]}
    assert "sam.newhire@example.com" not in {s["name"] for s in page["staff"]}


async def test_names_from_another_business_never_appear(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    stranger = await factory.user(name="Elsewhere Ed")
    await factory.staff(business=other, user=stranger, role="owner")
    invite = await factory.staff(business=other, role="staff")
    invite.status, invite.invite_email = "invited", "elsewhere.invite@test.ca"
    await db.flush()
    team = (await as_owner.get("/v1/staff/team")).json()
    online = (await as_owner.get("/v1/online-booking")).json()
    page = (await as_owner.get(f"/book/{SLUG}/services")).json()
    shown = {m["name"] for m in team["members"] + team["invites"]}
    shown |= {s["name"] for s in online["staff"] + page["staff"]}
    assert shown.isdisjoint({"Elsewhere Ed", "elsewhere.invite@test.ca"})


async def test_staff_see_renamed_colleagues_without_their_emails(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    owner = await db.get(User, "us_dev")
    assert owner is not None
    owner.name = "Hannah Renamed"
    await db.flush()
    team = (await as_staff.get("/v1/staff/team")).json()
    assert _named(team["members"], "st_owner") == "Hannah Renamed"
    assert all(m["email"] is None for m in team["members"])
