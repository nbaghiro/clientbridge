"""Staff invites — owner/admin create + email; invitee accepts → active staff."""

import httpx
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.platform import AuditLog
from tests.conftest import FakeEmailSender

BIZ = "bz_birchbark"


async def _actions(db: AsyncSession, entity_id: str) -> list[str]:
    return list(
        (
            await db.execute(
                select(AuditLog.action).where(
                    AuditLog.business_id == BIZ, AuditLog.entity_id == entity_id
                )
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


async def test_cannot_invite_owner_role_400(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/staff/invites", json={"email": "x@test.ca", "role": "owner"})
    assert res.status_code == 400


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
            text("SELECT status, user_id FROM staff WHERE invite_email = 'join@test.ca'")
        )
    ).first()
    assert row is not None
    assert row[0] == "active"
    assert row[1] is not None  # linked to a user


async def test_accept_invite_for_existing_user_requires_their_password(
    as_owner: httpx.AsyncClient, api: httpx.AsyncClient
) -> None:
    # A pre-existing account can only be joined by someone who knows ITS password — the raw invite
    # token (also visible to the inviter) must not be enough to mint the victim's session.
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
    # the invitee's own access now resolves to the business + sees its client book
    clients = await as_owner.get("/v1/clients", headers={"Authorization": f"Bearer {access}"})
    assert clients.status_code == 200
    assert all(c["business_id"] == BIZ for c in clients.json()["items"])


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
            "UPDATE staff SET created_at = now() - interval '60 days' "
            "WHERE invite_email = 'exp@test.ca'"
        )
    )
    res = await as_owner.post(
        "/auth/accept-invite", json={"token": token, "name": "E", "password": "pw-123456"}
    )
    assert res.status_code == 401
