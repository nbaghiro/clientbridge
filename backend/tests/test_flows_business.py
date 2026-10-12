"""Sign up, open a business, invite a teammate, and the teammate joins."""

from uuid import uuid4

import httpx

from clientbridge.integrations.kratos import Identity
from tests.conftest import FakeIdentityProvider
from tests.helpers import ok


def signed_up(email: str, name: str) -> Identity:
    """A fresh Kratos identity that has verified its email, as after sign-up."""
    return Identity(
        id=str(uuid4()),
        email=email,
        verified_emails=frozenset({email}),
        name=name,
        session_id=str(uuid4()),
        aal="aal1",
    )


async def test_sign_up_onboard_invite_and_accept(
    unauth: httpx.AsyncClient, identities: FakeIdentityProvider
) -> None:
    api = unauth
    api.headers["X-Session-Token"] = identities.issue(signed_up("founder@flow.test", "Founder"))
    me = ok(await api.get("/v1/me")).json()
    assert me["email"] == "founder@flow.test" and me["email_verified"] is True

    business = ok(
        await api.post(
            "/v1/onboarding", json={"name": "Flow Studio", "slug": "flow-studio", "province": "ON"}
        ),
        201,
    ).json()
    assert business["slug"] == "flow-studio" and business["province"] == "ON"
    rates = ok(await api.get("/v1/tax-rates")).json()
    assert [(r["jurisdiction"], r["rate_bps"]) for r in rates] == [("HST", 1300)]

    client = ok(await api.post("/v1/clients", json={"name": "First Client"}), 201).json()
    invite = ok(
        await api.post("/v1/staff/invites", json={"email": "hire@flow.test", "role": "staff"}), 201
    ).json()

    api.headers["X-Session-Token"] = identities.issue(signed_up("hire@flow.test", "Hire"))
    joined = ok(await api.post("/v1/staff/invites/accept", json={"token": invite["invite_token"]}))
    assert joined.json()["business_id"] == business["id"]
    team = ok(await api.get("/v1/staff/team")).json()
    assert sorted(m["role"] for m in team["members"]) == ["owner", "staff"]
    note = await api.post(
        "/v1/notes", json={"parent_type": "client", "parent_id": client["id"], "body": "Hello"}
    )
    assert note.status_code == 201
    denied = await api.post("/v1/staff/invites", json={"email": "x@flow.test", "role": "staff"})
    assert denied.status_code == 403
