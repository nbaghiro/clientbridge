"""Sign up, open a business, invite a teammate, and the teammate joins."""

import httpx

from tests.flows import ok


async def test_sign_up_onboard_invite_and_accept(unauth: httpx.AsyncClient) -> None:
    api = unauth
    tokens = ok(
        await api.post(
            "/auth/register",
            json={"email": "founder@flow.test", "password": "founder-pw-1", "name": "Founder"},
        ),
        201,
    ).json()
    api.headers["Authorization"] = f"Bearer {tokens['access_token']}"

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

    joined = ok(
        await api.post(
            "/auth/accept-invite",
            json={"token": invite["invite_token"], "name": "Hire", "password": "hire-pw-123"},
        )
    ).json()
    api.headers["Authorization"] = f"Bearer {joined['access_token']}"
    page = ok(await api.get("/v1/clients")).json()
    assert [c["id"] for c in page["items"]] == [client["id"]]
    denied = await api.post("/v1/staff/invites", json={"email": "x@flow.test", "role": "staff"})
    assert denied.status_code == 403
