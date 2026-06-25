"""The authz spine: `current_principal` resolution — membership, multi-business, foreign."""

import httpx

from clientbridge.core.security import issue_access_token
from tests.conftest import Factory


def _auth(api: httpx.AsyncClient, user_id: str) -> None:
    api.headers.update({"Authorization": f"Bearer {issue_access_token(user_id)}"})


async def test_no_membership_forbidden(api: httpx.AsyncClient, factory: Factory) -> None:
    user = await factory.user()  # a user with no staff row
    _auth(api, user.id)
    res = await api.get("/v1/clients")
    assert res.status_code == 403


async def test_multi_business_requires_header(api: httpx.AsyncClient, factory: Factory) -> None:
    user = await factory.user()
    b1 = await factory.business()
    b2 = await factory.business()
    await factory.staff(business=b1, user=user)
    await factory.staff(business=b2, user=user)
    _auth(api, user.id)

    # ambiguous without the header
    assert (await api.get("/v1/clients")).status_code == 400

    # X-Business-Id disambiguates → scoped to that business
    res = await api.get("/v1/clients", headers={"X-Business-Id": b1.id})
    assert res.status_code == 200
    assert res.json()["total"] == 0

    await factory.client(business=b1)
    res = await api.get("/v1/clients", headers={"X-Business-Id": b1.id})
    assert res.json()["total"] == 1


async def test_foreign_business_header_forbidden(api: httpx.AsyncClient, factory: Factory) -> None:
    user = await factory.user()
    b1 = await factory.business()
    await factory.staff(business=b1, user=user)
    _auth(api, user.id)
    res = await api.get("/v1/clients", headers={"X-Business-Id": "bz_not_mine"})
    assert res.status_code == 403
