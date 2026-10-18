"""Owners and admins set a member's title and calendar colour."""

import httpx
import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.business import Business
from clientbridge.models.platform import Audit
from tests.conftest import Factory, FakeIdentityProvider, session_token

BIZ = "bz_birchbark"


async def _row(db: AsyncSession, staff_id: str) -> tuple[str | None, str | None, str]:
    row = (
        await db.execute(
            text("SELECT title, color, role FROM staff WHERE id = :i"), {"i": staff_id}
        )
    ).one()
    return row.title, row.color, row.role


async def _profile_audits(db: AsyncSession, staff_id: str) -> list[dict[str, object]]:
    return list(
        (
            await db.execute(
                select(Audit.changes).where(
                    Audit.business_id == BIZ,
                    Audit.entity_id == staff_id,
                    Audit.action == "staff.profile",
                )
            )
        )
        .scalars()
        .all()
    )


async def _sign_in_as(
    api: httpx.AsyncClient,
    factory: Factory,
    identities: FakeIdentityProvider,
    db: AsyncSession,
    role: str,
) -> None:
    biz = await db.get(Business, BIZ)
    assert biz is not None
    user = await factory.user()
    await factory.staff(business=biz, user=user, role=role)
    token = await session_token(identities, factory.db, user.id)
    api.headers.update({"X-Session-Token": token, "X-Business-Id": BIZ})


async def test_owner_sets_title(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    res = await as_owner.patch("/v1/staff/st_diego", json={"title": "  Lead Groomer  "})
    assert res.status_code == 204, res.text
    assert await _row(db, "st_diego") == ("Lead Groomer", "#2E7A5A", "staff")
    assert await _profile_audits(db, "st_diego") == [
        {"title": {"from": "Senior Groomer", "to": "Lead Groomer"}}
    ]


async def test_owner_sets_colour(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    res = await as_owner.patch("/v1/staff/st_diego", json={"color": "#7d5a82"})
    assert res.status_code == 204, res.text
    assert await _row(db, "st_diego") == ("Senior Groomer", "#7D5A82", "staff")


async def test_empty_values_clear_title_and_colour(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    res = await as_owner.patch("/v1/staff/st_diego", json={"title": "   ", "color": ""})
    assert res.status_code == 204, res.text
    assert await _row(db, "st_diego") == (None, None, "staff")


async def test_owner_edits_their_own_profile(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    res = await as_owner.patch("/v1/staff/st_owner", json={"title": "Owner", "color": "#2E4A3F"})
    assert res.status_code == 204, res.text
    assert await _row(db, "st_owner") == ("Owner", "#2E4A3F", "owner")


async def test_role_and_profile_change_together(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    body = {"role": "admin", "title": "Manager"}
    assert (await as_owner.patch("/v1/staff/st_priya", json=body)).status_code == 204
    assert await _row(db, "st_priya") == ("Manager", "#86621E", "admin")


async def test_owner_role_guard_still_blocks_a_mixed_update(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    body = {"role": "staff", "title": "Demoted"}
    assert (await as_owner.patch("/v1/staff/st_owner", json=body)).status_code == 403
    assert await _row(db, "st_owner") == ("Owner & Lead Groomer", "#3F5E80", "owner")


@pytest.mark.parametrize(
    "body",
    [
        {"title": "x" * 61},
        {"color": "blue"},
        {"color": "#abc"},
        {"color": "#12345G"},
        {"title": 7},
    ],
)
async def test_invalid_values_422(
    as_owner: httpx.AsyncClient, db: AsyncSession, body: dict[str, object]
) -> None:
    assert (await as_owner.patch("/v1/staff/st_diego", json=body)).status_code == 422
    assert await _row(db, "st_diego") == ("Senior Groomer", "#2E7A5A", "staff")


async def test_unknown_member_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.patch("/v1/staff/st_nobody", json={"title": "Ghost"})
    assert res.status_code == 404


async def test_pending_invite_is_not_a_member_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.patch("/v1/staff/st_invite", json={"title": "Groomer"})
    assert res.status_code == 404


async def test_staff_cannot_edit_profiles_403(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    for target in ("st_diego", "st_priya"):
        res = await as_staff.patch(f"/v1/staff/{target}", json={"title": "Boss"})
        assert res.status_code == 403
    assert (await _row(db, "st_diego"))[0] == "Senior Groomer"


async def test_contractor_cannot_edit_profiles_403(
    api: httpx.AsyncClient, db: AsyncSession, factory: Factory, identities: FakeIdentityProvider
) -> None:
    await _sign_in_as(api, factory, identities, db, "contractor")
    assert (await api.patch("/v1/staff/st_priya", json={"color": "#2E4A3F"})).status_code == 403
    assert (await _row(db, "st_priya"))[1] == "#86621E"


async def test_admin_edits_members_and_the_owner(
    api: httpx.AsyncClient, db: AsyncSession, factory: Factory, identities: FakeIdentityProvider
) -> None:
    await _sign_in_as(api, factory, identities, db, "admin")
    assert (await api.patch("/v1/staff/st_priya", json={"title": "Bather"})).status_code == 204
    assert (await api.patch("/v1/staff/st_owner", json={"color": "#2E6670"})).status_code == 204
    assert await _row(db, "st_owner") == ("Owner & Lead Groomer", "#2E6670", "owner")


async def test_foreign_member_404_by_scoping(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    member = await factory.staff(business=other, role="staff")
    res = await as_owner.patch(f"/v1/staff/{member.id}", json={"title": "Poached"})
    assert res.status_code == 404
    assert (await _row(db, member.id))[0] is None


async def test_unauth_401(unauth: httpx.AsyncClient) -> None:
    assert (await unauth.patch("/v1/staff/st_diego", json={"title": "x"})).status_code == 401


async def test_repeating_an_update_is_a_no_op(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    body = {"title": "Lead Groomer", "color": "#2E7A5A"}
    assert (await as_owner.patch("/v1/staff/st_diego", json=body)).status_code == 204
    assert (await as_owner.patch("/v1/staff/st_diego", json=body)).status_code == 204
    assert await _row(db, "st_diego") == ("Lead Groomer", "#2E7A5A", "staff")
    assert await _profile_audits(db, "st_diego") == [
        {"title": {"from": "Senior Groomer", "to": "Lead Groomer"}}
    ]


async def test_omitted_fields_are_left_alone(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    assert (await as_owner.patch("/v1/staff/st_diego", json={})).status_code == 204
    assert await _row(db, "st_diego") == ("Senior Groomer", "#2E7A5A", "staff")
    assert await _profile_audits(db, "st_diego") == []
