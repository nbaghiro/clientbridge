"""Staff invites — owner/admin create + email; invitee accepts → active staff."""

import httpx
import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.business import Business
from clientbridge.models.platform import Audit
from tests.conftest import Factory, FakeEmailSender, access_token

BIZ = "bz_birchbark"


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


async def test_accept_invite_activates_staff(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    inv = await as_owner.post("/v1/staff/invites", json={"email": "join@test.ca", "role": "staff"})
    token = inv.json()["invite_token"]
    # accept-invite ignores the auth header (it carries its own token in the body)
    res = await as_owner.post(
        "/auth/accept-invite", json={"token": token, "name": "Joiner", "password": "pw-123456"}
    )
    assert res.status_code == 200
    assert res.json()["access_token"]
    row = (
        await db.execute(
            text("SELECT status, user_id, name FROM staff WHERE invite_email = 'join@test.ca'")
        )
    ).first()
    assert row is not None
    assert row[0] == "active"
    assert row[1] is not None  # linked to a user
    assert row[2] == "Joiner"


async def test_accept_invite_for_existing_user_requires_their_password(
    as_owner: httpx.AsyncClient, api: httpx.AsyncClient
) -> None:
    # The inviter also sees the raw token, so joining an existing account must need its password
    reg = await api.post(
        "/auth/register", json={"email": "victim@test.ca", "password": "victim-secret-1"}
    )
    assert reg.status_code == 201, reg.text
    token = (
        await as_owner.post("/v1/staff/invites", json={"email": "victim@test.ca", "role": "staff"})
    ).json()["invite_token"]

    wrong = await api.post(
        "/auth/accept-invite", json={"token": token, "name": "X", "password": "not-the-password"}
    )
    assert wrong.status_code == 401  # takeover blocked

    right = await api.post(
        "/auth/accept-invite",
        json={"token": token, "name": "Victim", "password": "victim-secret-1"},
    )
    assert right.status_code == 200 and right.json()["access_token"]


async def test_accept_invite_grants_scoped_access(as_owner: httpx.AsyncClient) -> None:
    inv = await as_owner.post("/v1/staff/invites", json={"email": "j2@test.ca", "role": "staff"})
    token = inv.json()["invite_token"]
    res = await as_owner.post(
        "/auth/accept-invite", json={"token": token, "name": "J2", "password": "pw-123456"}
    )
    access = res.json()["access_token"]
    # the invitee's own access now resolves to the business and sees its team
    team = await as_owner.get("/v1/staff/team", headers={"Authorization": f"Bearer {access}"})
    assert team.status_code == 200
    assert {m["id"] for m in team.json()["members"]} >= {"st_owner", "st_diego"}


async def test_double_accept_409(as_owner: httpx.AsyncClient) -> None:
    inv = await as_owner.post("/v1/staff/invites", json={"email": "dbl@test.ca", "role": "staff"})
    token = inv.json()["invite_token"]
    first = await as_owner.post(
        "/auth/accept-invite", json={"token": token, "name": "D", "password": "pw-123456"}
    )
    assert first.status_code == 200
    second = await as_owner.post(
        "/auth/accept-invite", json={"token": token, "name": "D", "password": "pw-123456"}
    )
    assert second.status_code == 409


async def test_accept_invalid_token_401(api: httpx.AsyncClient) -> None:
    res = await api.post(
        "/auth/accept-invite", json={"token": "bogus", "name": "X", "password": "pw-123456"}
    )
    assert res.status_code == 401


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


async def test_accept_invite_is_audited(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    inv = await as_owner.post("/v1/staff/invites", json={"email": "aud@test.ca", "role": "staff"})
    staff_id = inv.json()["id"]
    res = await as_owner.post(
        "/auth/accept-invite",
        json={"token": inv.json()["invite_token"], "name": "Aud", "password": "pw-123456"},
    )
    assert res.status_code == 200, res.text
    assert set(await _actions(db, staff_id)) == {"staff.invite", "staff.accept"}


async def test_accept_expired_invite_401(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    inv = await as_owner.post("/v1/staff/invites", json={"email": "exp@test.ca", "role": "staff"})
    token = inv.json()["invite_token"]
    await db.execute(
        text(
            "UPDATE staff SET invited_at = now() - interval '8 days' "
            "WHERE invite_email = 'exp@test.ca'"
        )
    )
    res = await as_owner.post(
        "/auth/accept-invite", json={"token": token, "name": "E", "password": "pw-123456"}
    )
    assert res.status_code == 401


async def test_team_lists_members_and_invites(as_owner: httpx.AsyncClient) -> None:
    await as_owner.post(
        "/auth/login", json={"email": "hannah@birchbarkpets.ca", "password": "demo1234"}
    )
    res = await as_owner.get("/v1/staff/team")
    assert res.status_code == 200, res.text
    body = res.json()
    owner = next(m for m in body["members"] if m["id"] == "st_owner")
    assert owner["email"] == "hannah@birchbarkpets.ca"
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
    as_owner: httpx.AsyncClient, email: FakeEmailSender, db: AsyncSession
) -> None:
    first = (
        await as_owner.post("/v1/staff/invites", json={"email": "again@test.ca", "role": "staff"})
    ).json()
    await db.execute(
        text("UPDATE staff SET invited_at = now() - interval '6 days' WHERE id = :i"),
        {"i": first["id"]},
    )
    res = await as_owner.post(f"/v1/staff/invites/{first['id']}/resend")
    assert res.status_code == 200, res.text
    assert res.json()["invite_token"] != first["invite_token"]
    assert len(email.sent) == 2
    old = await as_owner.post(
        "/auth/accept-invite",
        json={"token": first["invite_token"], "name": "A", "password": "pw-123456"},
    )
    assert old.status_code == 401
    new = await as_owner.post(
        "/auth/accept-invite",
        json={"token": res.json()["invite_token"], "name": "A", "password": "pw-123456"},
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


async def test_change_role_and_remove_member(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await db.execute(
        text(
            "INSERT INTO sessions (id, user_id, family_id, token_hash, expires_at)"
            " VALUES ('ase_priya', 'us_priya', 'fam', 'h', now() + interval '1 day')"
        )
    )
    res = await as_owner.patch("/v1/staff/st_priya", json={"role": "admin"})
    assert res.status_code == 204
    assert await db.scalar(text("SELECT role FROM staff WHERE id = 'st_priya'")) == "admin"
    assert (await as_owner.delete("/v1/staff/st_priya")).status_code == 204
    assert await db.scalar(text("SELECT status FROM staff WHERE id = 'st_priya'")) == "removed"
    revoked = await db.scalar(text("SELECT revoked_at FROM sessions WHERE id = 'ase_priya'"))
    assert revoked is not None
    assert set(await _actions(db, "st_priya")) >= {"staff.role", "staff.remove"}
    assert (await as_owner.delete("/v1/staff/st_priya")).status_code == 404


async def test_role_changes_are_guarded(as_owner: httpx.AsyncClient) -> None:
    assert (await as_owner.patch("/v1/staff/st_owner", json={"role": "staff"})).status_code == 403
    res = await as_owner.patch("/v1/staff/st_diego", json={"role": "owner"})
    assert res.status_code == 422


async def test_staff_cannot_manage_the_team_403(as_staff: httpx.AsyncClient) -> None:
    assert (await as_staff.patch("/v1/staff/st_priya", json={"role": "staff"})).status_code == 403
    assert (await as_staff.delete("/v1/staff/st_priya")).status_code == 403
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
    assert (await as_owner.delete(f"/v1/staff/{member.id}")).status_code == 404
    assert (await as_owner.post(f"/v1/staff/invites/{invite.id}/resend")).status_code == 404
    assert (await as_owner.post(f"/v1/staff/invites/{invite.id}/revoke")).status_code == 404
    assert await db.scalar(text("SELECT status FROM staff WHERE id = :i"), {"i": invite.id}) == (
        "invited"
    )


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


async def _as_admin(api: httpx.AsyncClient, db: AsyncSession, factory: Factory) -> None:
    biz = await db.get(Business, BIZ)
    assert biz is not None
    user = await factory.user()
    await factory.staff(business=biz, user=user, role="admin")
    api.headers.update({"Authorization": f"Bearer {await access_token(factory.db, user.id)}"})


async def test_an_admin_cannot_change_or_remove_the_owner_403(
    api: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    await _as_admin(api, db, factory)
    assert (await api.patch("/v1/staff/st_owner", json={"role": "staff"})).status_code == 403
    assert (await api.delete("/v1/staff/st_owner")).status_code == 403
    assert await db.scalar(text("SELECT role FROM staff WHERE id = 'st_owner'")) == "owner"
    assert await db.scalar(text("SELECT status FROM staff WHERE id = 'st_owner'")) == "active"


async def test_an_admin_manages_other_members(
    api: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    await _as_admin(api, db, factory)
    assert (await api.patch("/v1/staff/st_priya", json={"role": "admin"})).status_code == 204


async def test_nobody_removes_themselves_403(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    assert (await as_owner.delete("/v1/staff/st_owner")).status_code == 403
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
        ("DELETE", "/v1/staff/st_priya"),
    ],
)
async def test_unauth_401(unauth: httpx.AsyncClient, method: str, path: str) -> None:
    body = {"role": "staff"} if method == "PATCH" else None
    assert (await unauth.request(method, path, json=body)).status_code == 401
