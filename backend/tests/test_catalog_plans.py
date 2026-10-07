"""Plan details on catalog items: the service a package covers, membership perks, gift amounts."""

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.catalog import Item
from tests.conftest import Factory

BATH = "it_bath"  # seeded service
SHAMPOO = "it_shampoo"  # seeded product


async def test_package_covers_a_service(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
        "/v1/items",
        json={
            "kind": "package",
            "name": "5 Baths",
            "price_cents": 20000,
            "session_count": 5,
            "covers_item_id": BATH,
        },
    )
    assert res.status_code == 201, res.text
    assert res.json()["covers_item_id"] == BATH
    cleared = await as_owner.patch(f"/v1/items/{res.json()['id']}", json={"covers_item_id": None})
    assert cleared.json()["covers_item_id"] is None


async def test_membership_perks_and_gift_amounts(as_owner: httpx.AsyncClient) -> None:
    club = await as_owner.post(
        "/v1/items",
        json={
            "kind": "subscription",
            "name": "Spa Club",
            "price_cents": 5900,
            "interval": 1,
            "frequency": "month",
            "visits_per_period": 2,
            "member_discount_bps": 1000,
        },
    )
    assert club.status_code == 201, club.text
    assert (club.json()["visits_per_period"], club.json()["member_discount_bps"]) == (2, 1000)
    gift = await as_owner.post(
        "/v1/items",
        json={"kind": "gift", "name": "Gift card", "gift_amounts": [10000, 5000, 5000]},
    )
    assert gift.status_code == 201, gift.text
    assert gift.json()["gift_amounts"] == [5000, 10000]
    emptied = await as_owner.patch(f"/v1/items/{gift.json()['id']}", json={"gift_amounts": []})
    assert emptied.json()["gift_amounts"] is None


async def test_plan_fields_belong_to_their_kind_422(as_owner: httpx.AsyncClient) -> None:
    for body in (
        {"kind": "service", "name": "Trim", "covers_item_id": BATH},
        {"kind": "package", "name": "P", "session_count": 2, "visits_per_period": 1},
        {"kind": "product", "name": "P", "member_discount_bps": 500},
        {"kind": "service", "name": "Trim", "gift_amounts": [500]},
        {"kind": "gift", "name": "G", "gift_amounts": [0]},
        {"kind": "subscription", "name": "S", "interval": 1, "member_discount_bps": 10001},
    ):
        res = await as_owner.post("/v1/items", json=body)
        assert res.status_code == 422, body


async def test_package_must_cover_a_bookable_item(as_owner: httpx.AsyncClient) -> None:
    product = await as_owner.post(
        "/v1/items",
        json={"kind": "package", "name": "P", "session_count": 2, "covers_item_id": SHAMPOO},
    )
    assert product.status_code == 422
    missing = await as_owner.post(
        "/v1/items",
        json={"kind": "package", "name": "P", "session_count": 2, "covers_item_id": "it_nope"},
    )
    assert missing.status_code == 404


async def test_package_cannot_cover_another_tenants_service(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    foreign = Item(id=new_id("item"), business_id=other.id, kind="service", name="Theirs")
    db.add(foreign)
    await db.flush()
    res = await as_owner.post(
        "/v1/items",
        json={"kind": "package", "name": "P", "session_count": 2, "covers_item_id": foreign.id},
    )
    assert res.status_code == 404


async def test_staff_cannot_set_plan_fields_403(as_staff: httpx.AsyncClient) -> None:
    res = await as_staff.patch(f"/v1/items/{BATH}", json={"member_discount_bps": 100})
    assert res.status_code == 403
