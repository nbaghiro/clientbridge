"""The authz spine: `current_principal` resolution — membership, multi-business, foreign."""

import httpx

from tests.conftest import Factory, access_token


async def _auth(api: httpx.AsyncClient, factory: Factory, user_id: str) -> None:
    api.headers.update({"Authorization": f"Bearer {await access_token(factory.db, user_id)}"})


async def test_no_membership_forbidden(api: httpx.AsyncClient, factory: Factory) -> None:
    user = await factory.user()  # a user with no staff row
    await _auth(api, factory, user.id)
    res = await api.get("/v1/staff/team")
    assert res.status_code == 403


async def test_multi_business_requires_header(api: httpx.AsyncClient, factory: Factory) -> None:
    user = await factory.user()
    b1 = await factory.business()
    b2 = await factory.business()
    await factory.staff(business=b1, user=user)
    await factory.staff(business=b2, user=user)
    await _auth(api, factory, user.id)

    # ambiguous without the header
    assert (await api.get("/v1/staff/team")).status_code == 400

    # X-Business-Id disambiguates → scoped to that business
    res = await api.get("/v1/staff/team", headers={"X-Business-Id": b1.id})
    assert res.status_code == 200
    assert len(res.json()["members"]) == 1

    # a member of the user's OTHER business never leaks into b1's scope
    await factory.staff(business=b2)
    res = await api.get("/v1/staff/team", headers={"X-Business-Id": b1.id})
    assert len(res.json()["members"]) == 1
    res = await api.get("/v1/staff/team", headers={"X-Business-Id": b2.id})
    assert len(res.json()["members"]) == 2


async def test_foreign_business_header_forbidden(api: httpx.AsyncClient, factory: Factory) -> None:
    user = await factory.user()
    b1 = await factory.business()
    await factory.staff(business=b1, user=user)
    await _auth(api, factory, user.id)
    res = await api.get("/v1/staff/team", headers={"X-Business-Id": "bz_not_mine"})
    assert res.status_code == 403
