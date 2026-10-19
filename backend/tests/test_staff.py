"""Staff invites — owner/admin create + email; invitee accepts → active staff."""

from datetime import timedelta
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.errors import TooManyRequests
from clientbridge.core.ratelimit import RateLimiter, public_invite_rate_limit
from clientbridge.integrations.identity import Identity
from clientbridge.main import app
from clientbridge.models.business import Business
from clientbridge.models.platform import Audit
from tests.conftest import Factory, FakeEmailSender, FakeIdentityProvider, session_token

BIZ = "bz_birchbark"
_CANCEL = {"future": "cancel"}


async def _actions(db: AsyncSession, entity_id: str) -> list[str]:
    return list(
        (
            await db.execute(
                select(Audit.action).where(Audit.business_id == BIZ, Audit.entity_id == entity_id)
            )
        )
        .scalars()
        .all()
    )


async def test_owner_creates_invite_and_emails(
    as_owner: httpx.AsyncClient, email: FakeEmailSender
) -> None:
    res = await as_owner.post(
        "/v1/staff/invites", json={"email": "newbie@test.ca", "role": "staff"}
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "invited"
    assert body["invite_token"]
    assert len(email.sent) == 1
    assert email.sent[0].to == "newbie@test.ca"


async def test_staff_cannot_invite_403(as_staff: httpx.AsyncClient) -> None:
    res = await as_staff.post("/v1/staff/invites", json={"email": "x@test.ca", "role": "staff"})
    assert res.status_code == 403


async def test_cannot_invite_owner_role_422(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/staff/invites", json={"email": "x@test.ca", "role": "owner"})
    assert res.status_code == 422


async def test_staff_cannot_set_pay_403(as_staff: httpx.AsyncClient) -> None:
    res = await as_staff.patch("/v1/staff/st_diego/pay", json={"payee": True})
    assert res.status_code == 403


async def test_foreign_staff_pay_404_by_scoping(
    as_owner: httpx.AsyncClient, factory: Factory
) -> None:
    other = await factory.business()
    member = await factory.staff(business=other, role="staff")
    res = await as_owner.patch(f"/v1/staff/{member.id}/pay", json={"payee": True})
    assert res.status_code == 404


def _joiner(
    identities: FakeIdentityProvider, address: str, *, verified: bool = True
) -> dict[str, str]:
    """Session headers for someone who signed up with `address` and has no team yet."""
    identity = Identity(
        id=str(uuid4()),
        email=address,
        verified_emails=frozenset({address.casefold()}) if verified else frozenset(),
        name="Joiner",
        session_id=str(uuid4()),
        second_factor=False,
    )
    return {"X-Session-Token": identities.issue(identity), "X-Business-Id": ""}


async def _invite(as_owner: httpx.AsyncClient, address: str) -> dict[str, str]:
    res = await as_owner.post("/v1/staff/invites", json={"email": address, "role": "staff"})
    assert res.status_code == 201, res.text
    body: dict[str, str] = res.json()
    return body


async def test_invite_email_links_to_the_accept_page(
    as_owner: httpx.AsyncClient, email: FakeEmailSender
) -> None:
    inv = await _invite(as_owner, "link@test.ca")
    assert f"/accept-invite?token={inv['invite_token']}" in email.sent[0].body


async def test_accept_invite_activates_staff(
    as_owner: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    inv = await _invite(as_owner, "join@test.ca")
    res = await as_owner.post(
        "/v1/staff/invites/accept",
        json={"token": inv["invite_token"]},
        headers=_joiner(identities, "join@test.ca"),
    )
    assert res.status_code == 200, res.text
    assert res.json() == {"business_id": BIZ, "staff_id": inv["id"]}
    row = (
        await db.execute(
            text(
                "SELECT s.status, u.name, u.email FROM staff s JOIN users u ON u.id = s.user_id "
                "WHERE s.id = :i"
            ),
            {"i": inv["id"]},
        )
    ).one()
    assert tuple(row) == ("active", "Joiner", "join@test.ca")


async def test_accept_matches_the_invited_address_case_insensitively(
    as_owner: httpx.AsyncClient, identities: FakeIdentityProvider
) -> None:
    inv = await _invite(as_owner, "Mixed.Case@Test.ca")
    res = await as_owner.post(
        "/v1/staff/invites/accept",
        json={"token": inv["invite_token"]},
        headers=_joiner(identities, "mixed.case@test.ca"),
    )
    assert res.status_code == 200, res.text


async def test_accept_needs_the_invited_address_verified(
    as_owner: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    # the inviter also sees the raw token, so only the owner of the invited address can join
    inv = await _invite(as_owner, "victim@test.ca")
    url, body = "/v1/staff/invites/accept", {"token": inv["invite_token"]}
    other = await as_owner.post(url, json=body, headers=_joiner(identities, "thief@test.ca"))
    assert other.status_code == 403 and other.json()["error"] == "invite_email_mismatch"
    unverified = await as_owner.post(
        url, json=body, headers=_joiner(identities, "victim@test.ca", verified=False)
    )
    assert unverified.status_code == 403 and unverified.json()["error"] == "email_unverified"
    status = await db.scalar(text("SELECT status FROM staff WHERE id = :i"), {"i": inv["id"]})
    assert status == "invited"


async def test_accept_invite_grants_scoped_access(
    as_owner: httpx.AsyncClient, identities: FakeIdentityProvider
) -> None:
    inv = await _invite(as_owner, "j2@test.ca")
    headers = _joiner(identities, "j2@test.ca")
    accepted = await as_owner.post(
        "/v1/staff/invites/accept", json={"token": inv["invite_token"]}, headers=headers
    )
    assert accepted.status_code == 200, accepted.text
    team = await as_owner.get("/v1/staff/team", headers=headers)
    assert team.status_code == 200
    assert {m["id"] for m in team.json()["members"]} >= {"st_owner", "st_diego", inv["id"]}


async def test_double_accept_409(
    as_owner: httpx.AsyncClient, identities: FakeIdentityProvider
) -> None:
    inv = await _invite(as_owner, "dbl@test.ca")
    headers = _joiner(identities, "dbl@test.ca")
    body = {"token": inv["invite_token"]}
    first = await as_owner.post("/v1/staff/invites/accept", json=body, headers=headers)
    assert first.status_code == 200
    second = await as_owner.post("/v1/staff/invites/accept", json=body, headers=headers)
    assert second.status_code == 409


async def test_accept_by_a_current_member_409(
    as_owner: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    inv = await _invite(as_owner, "diego@birchbark.example")
    diego = await session_token(identities, db, "us_diego")
    res = await as_owner.post(
        "/v1/staff/invites/accept",
        json={"token": inv["invite_token"]},
        headers={"X-Session-Token": diego, "X-Business-Id": ""},
    )
    assert res.status_code == 409 and res.json()["error"] == "already_member"


async def test_a_removed_member_rejoins_through_a_new_invite(
    as_owner: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    assert (await as_owner.post("/v1/staff/st_priya/remove", json=_CANCEL)).status_code == 200
    inv = await _invite(as_owner, "priya@birchbark.example")
    priya = await session_token(identities, db, "us_priya")
    res = await as_owner.post(
        "/v1/staff/invites/accept",
        json={"token": inv["invite_token"]},
        headers={"X-Session-Token": priya, "X-Business-Id": ""},
    )
    assert res.status_code == 200, res.text
    assert res.json()["staff_id"] == "st_priya"
    rows = (await db.execute(text("SELECT id, status FROM staff WHERE user_id = 'us_priya'"))).all()
    assert [tuple(r) for r in rows] == [("st_priya", "active")]
    gone = await db.scalar(text("SELECT count(*) FROM staff WHERE id = :i"), {"i": inv["id"]})
    assert gone == 0


async def test_accept_invalid_token_404(
    api: httpx.AsyncClient, identities: FakeIdentityProvider
) -> None:
    res = await api.post(
        "/v1/staff/invites/accept",
        json={"token": "bogus"},
        headers=_joiner(identities, "x@test.ca"),
    )
    assert res.status_code == 404 and res.json()["error"] == "invite_invalid"


async def test_accept_needs_a_session_401(as_owner: httpx.AsyncClient) -> None:
    inv = await _invite(as_owner, "nosession@test.ca")
    as_owner.headers.pop("X-Session-Token")
    res = await as_owner.post("/v1/staff/invites/accept", json={"token": inv["invite_token"]})
    assert res.status_code == 401


async def test_preview_shows_the_business_and_address(
    as_owner: httpx.AsyncClient, identities: FakeIdentityProvider
) -> None:
    inv = await _invite(as_owner, "preview@test.ca")
    as_owner.headers.pop("X-Session-Token")
    url = "/v1/staff/invites/preview"
    res = await as_owner.post(url, json={"token": inv["invite_token"]})
    assert res.status_code == 200, res.text
    body = res.json()
    assert (body["business_name"], body["email"], body["role"]) == (
        "Birchbark Pet Studio",
        "preview@test.ca",
        "staff",
    )
    assert (await as_owner.post(url, json={"token": "bogus"})).status_code == 404
    accepted = await as_owner.post(
        "/v1/staff/invites/accept",
        json={"token": inv["invite_token"]},
        headers=_joiner(identities, "preview@test.ca"),
    )
    assert accepted.status_code == 200
    assert (await as_owner.post(url, json={"token": inv["invite_token"]})).status_code == 409


async def test_invite_is_audited_and_idempotent(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    headers = {"Idempotency-Key": "inv-1"}
    first = await as_owner.post(
        "/v1/staff/invites", json={"email": "dup@test.ca", "role": "staff"}, headers=headers
    )
    assert first.status_code == 201, first.text
    assert await _actions(db, first.json()["id"]) == ["staff.invite"]
    # a retry with the same key replays the same invite — no second pending staff, no second email
    second = await as_owner.post(
        "/v1/staff/invites", json={"email": "dup@test.ca", "role": "staff"}, headers=headers
    )
    assert second.status_code == 201, second.text
    assert second.json() == first.json()
    assert len(email.sent) == 1
    pending = (
        await db.execute(text("SELECT count(*) FROM staff WHERE invite_email = 'dup@test.ca'"))
    ).scalar_one()
    assert pending == 1


async def test_accept_invite_is_audited(
    as_owner: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    inv = await _invite(as_owner, "aud@test.ca")
    res = await as_owner.post(
        "/v1/staff/invites/accept",
        json={"token": inv["invite_token"]},
        headers=_joiner(identities, "aud@test.ca"),
    )
    assert res.status_code == 200, res.text
    assert set(await _actions(db, inv["id"])) == {"staff.invite", "staff.accept"}


async def test_accept_expired_invite_410(
    as_owner: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    token = (await _invite(as_owner, "exp@test.ca"))["invite_token"]
    await db.execute(
        text("UPDATE staff SET invited_at = :at WHERE invite_email = 'exp@test.ca'"),
        {"at": clock.now() - timedelta(days=8)},
    )
    res = await as_owner.post(
        "/v1/staff/invites/accept",
        json={"token": token},
        headers=_joiner(identities, "exp@test.ca"),
    )
    assert res.status_code == 410 and res.json()["error"] == "invite_expired"


async def test_team_lists_members_and_invites(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.get("/v1/staff/team")
    assert res.status_code == 200, res.text
    body = res.json()
    owner = next(m for m in body["members"] if m["id"] == "st_owner")
    assert owner["email"] == "hannah@birchbark.example"
    assert owner["last_active_at"] is not None
    invite = next(i for i in body["invites"] if i["id"] == "st_invite")
    assert invite["email"] == "sam.newhire@example.com"
    assert invite["expires_at"] is not None


async def test_staff_see_the_team_without_emails_or_invites(as_staff: httpx.AsyncClient) -> None:
    body = (await as_staff.get("/v1/staff/team")).json()
    assert {m["id"] for m in body["members"]} >= {"st_owner", "st_diego"}
    assert all(m["email"] is None and m["last_active_at"] is None for m in body["members"])
    assert body["invites"] == []


async def test_resend_invite_issues_a_new_link(
    as_owner: httpx.AsyncClient,
    email: FakeEmailSender,
    db: AsyncSession,
    identities: FakeIdentityProvider,
) -> None:
    first = (
        await as_owner.post("/v1/staff/invites", json={"email": "again@test.ca", "role": "staff"})
    ).json()
    await db.execute(
        text("UPDATE staff SET invited_at = :at WHERE id = :i"),
        {"at": clock.now() - timedelta(days=6), "i": first["id"]},
    )
    res = await as_owner.post(f"/v1/staff/invites/{first['id']}/resend")
    assert res.status_code == 200, res.text
    assert res.json()["invite_token"] != first["invite_token"]
    assert len(email.sent) == 2
    headers = _joiner(identities, "again@test.ca")
    old = await as_owner.post(
        "/v1/staff/invites/accept", json={"token": first["invite_token"]}, headers=headers
    )
    assert old.status_code == 404
    new = await as_owner.post(
        "/v1/staff/invites/accept", json={"token": res.json()["invite_token"]}, headers=headers
    )
    assert new.status_code == 200


async def test_revoke_invite_removes_it(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    inv = (
        await as_owner.post("/v1/staff/invites", json={"email": "gone@test.ca", "role": "staff"})
    ).json()
    assert (await as_owner.post(f"/v1/staff/invites/{inv['id']}/revoke")).status_code == 204
    left = await db.scalar(text("SELECT count(*) FROM staff WHERE id = :i"), {"i": inv["id"]})
    assert left == 0
    assert "staff.invite_revoke" in await _actions(db, inv["id"])
    assert (await as_owner.post(f"/v1/staff/invites/{inv['id']}/revoke")).status_code == 404


async def test_change_role_and_remove_member(
    as_owner: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    priya = await session_token(identities, db, "us_priya")
    res = await as_owner.patch("/v1/staff/st_priya", json={"role": "admin"})
    assert res.status_code == 204
    assert await db.scalar(text("SELECT role FROM staff WHERE id = 'st_priya'")) == "admin"
    assert (await as_owner.post("/v1/staff/st_priya/remove", json=_CANCEL)).status_code == 200
    assert await db.scalar(text("SELECT status FROM staff WHERE id = 'st_priya'")) == "removed"
    # Removal ends this membership only: the person stays signed in for any other business.
    assert (await as_owner.get("/v1/me", headers={"X-Session-Token": priya})).status_code == 200
    team = await as_owner.get(
        "/v1/staff/team", headers={"X-Session-Token": priya, "X-Business-Id": "bz_birchbark"}
    )
    assert team.status_code == 403
    assert set(await _actions(db, "st_priya")) >= {"staff.role", "staff.remove"}
    assert (await as_owner.post("/v1/staff/st_priya/remove", json=_CANCEL)).status_code == 404


async def test_role_changes_are_guarded(as_owner: httpx.AsyncClient) -> None:
    assert (await as_owner.patch("/v1/staff/st_owner", json={"role": "staff"})).status_code == 403
    res = await as_owner.patch("/v1/staff/st_diego", json={"role": "owner"})
    assert res.status_code == 422


async def test_staff_cannot_manage_the_team_403(as_staff: httpx.AsyncClient) -> None:
    assert (await as_staff.patch("/v1/staff/st_priya", json={"role": "staff"})).status_code == 403
    assert (await as_staff.post("/v1/staff/st_priya/remove", json=_CANCEL)).status_code == 403
    assert (await as_staff.post("/v1/staff/invites/st_invite/revoke")).status_code == 403
    assert (await as_staff.post("/v1/staff/invites/st_invite/resend")).status_code == 403


async def test_team_endpoints_scope_by_business(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    member = await factory.staff(business=other, role="staff")
    invite = await factory.staff(business=other, role="staff")
    invite.status = "invited"
    await db.flush()
    res = await as_owner.patch(f"/v1/staff/{member.id}", json={"role": "admin"})
    assert res.status_code == 404
    assert (await as_owner.post(f"/v1/staff/invites/{invite.id}/resend")).status_code == 404
    assert (await as_owner.post(f"/v1/staff/invites/{invite.id}/revoke")).status_code == 404
    assert await db.scalar(text("SELECT status FROM staff WHERE id = :i"), {"i": invite.id}) == (
        "invited"
    )
    assert (await as_owner.post(f"/v1/staff/{member.id}/remove", json=_CANCEL)).status_code == 404


async def test_owner_sets_staff_pay(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.patch(
        "/v1/staff/st_diego/pay", json={"retail_rate_bps": 1500, "payee": True}
    )
    assert res.status_code == 200, res.text
    assert res.json()["retail_rate_bps"] == 1500
    assert (
        await as_owner.patch("/v1/staff/st_diego/pay", json={"retail_rate_bps": 20000})
    ).status_code == 422
    assert (await as_owner.patch("/v1/staff/st_nope/pay", json={"payee": True})).status_code == 404


async def test_staff_rate_is_held_in_the_unit_of_its_basis(as_owner: httpx.AsyncClient) -> None:
    pct = await as_owner.patch(
        "/v1/staff/st_diego/pay", json={"rate_type": "percent", "rate_bps": 4250}
    )
    assert (pct.json()["rate_bps"], pct.json()["rate_cents"]) == (4250, None)
    hourly = await as_owner.patch(
        "/v1/staff/st_diego/pay", json={"rate_type": "hourly", "rate_cents": 2400}
    )
    assert (hourly.json()["rate_bps"], hourly.json()["rate_cents"]) == (None, 2400)
    wrong = await as_owner.patch("/v1/staff/st_diego/pay", json={"rate_bps": 5000})
    assert wrong.status_code == 422
    assert wrong.json()["message"] == "rate_cents holds the rate for rate_type hourly"
    unset = await as_owner.patch("/v1/staff/st_invite/pay", json={"rate_cents": 1000})
    assert unset.status_code == 422


async def _as_admin(
    api: httpx.AsyncClient, db: AsyncSession, factory: Factory, identities: FakeIdentityProvider
) -> None:
    biz = await db.get(Business, BIZ)
    assert biz is not None
    user = await factory.user()
    await factory.staff(business=biz, user=user, role="admin")
    api.headers.update({"X-Session-Token": await session_token(identities, factory.db, user.id)})


async def test_an_admin_cannot_change_or_remove_the_owner_403(
    api: httpx.AsyncClient,
    db: AsyncSession,
    factory: Factory,
    identities: FakeIdentityProvider,
) -> None:
    await _as_admin(api, db, factory, identities)
    assert (await api.patch("/v1/staff/st_owner", json={"role": "staff"})).status_code == 403
    assert (await api.post("/v1/staff/st_owner/remove", json=_CANCEL)).status_code == 403
    assert await db.scalar(text("SELECT role FROM staff WHERE id = 'st_owner'")) == "owner"
    assert await db.scalar(text("SELECT status FROM staff WHERE id = 'st_owner'")) == "active"


async def test_an_admin_manages_other_members(
    api: httpx.AsyncClient,
    db: AsyncSession,
    factory: Factory,
    identities: FakeIdentityProvider,
) -> None:
    await _as_admin(api, db, factory, identities)
    assert (await api.patch("/v1/staff/st_priya", json={"role": "admin"})).status_code == 204


async def test_nobody_removes_themselves_403(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    assert (await as_owner.post("/v1/staff/st_owner/remove", json=_CANCEL)).status_code == 403
    assert await db.scalar(text("SELECT status FROM staff WHERE id = 'st_owner'")) == "active"


async def test_resending_to_an_active_member_404(as_owner: httpx.AsyncClient) -> None:
    assert (await as_owner.post("/v1/staff/invites/st_diego/resend")).status_code == 404
    assert (await as_owner.post("/v1/staff/invites/st_diego/revoke")).status_code == 404


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/v1/staff/team"),
        ("POST", "/v1/staff/invites/st_invite/resend"),
        ("POST", "/v1/staff/invites/st_invite/revoke"),
        ("PATCH", "/v1/staff/st_priya"),
        ("POST", "/v1/staff/st_priya/remove"),
    ],
)
async def test_unauth_401(unauth: httpx.AsyncClient, method: str, path: str) -> None:
    body = {"role": "staff"} if method == "PATCH" else None
    assert (await unauth.request(method, path, json=body)).status_code == 401


async def test_preview_of_an_expired_invite_410(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    token = (await _invite(as_owner, "old-preview@test.ca"))["invite_token"]
    await db.execute(
        text("UPDATE staff SET invited_at = :at WHERE invite_email = 'old-preview@test.ca'"),
        {"at": clock.now() - timedelta(days=8)},
    )
    as_owner.headers.pop("X-Session-Token")
    res = await as_owner.post("/v1/staff/invites/preview", json={"token": token})
    assert res.status_code == 410 and res.json()["error"] == "invite_expired"


async def test_preview_is_rate_limited(api: httpx.AsyncClient) -> None:
    limiter = RateLimiter(limit=1, window_s=60.0)

    def limited() -> None:
        if not limiter.check("ip", 0.0):
            raise TooManyRequests("slow down")

    app.dependency_overrides[public_invite_rate_limit] = limited
    url = "/v1/staff/invites/preview"
    assert (await api.post(url, json={"token": "probe"})).status_code == 404
    assert (await api.post(url, json={"token": "probe"})).status_code == 429
