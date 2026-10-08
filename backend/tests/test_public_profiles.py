from datetime import UTC, datetime

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.business import Business
from clientbridge.models.reviews import Review
from tests.conftest import BIZ, Factory


async def test_profile_publishes_opted_in_team_and_only_public_reviews(
    api: httpx.AsyncClient, as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    updated = await as_owner.patch(
        "/v1/business",
        json={
            "brand": {
                "about": " Our studio ",
                "public_staff_ids": ["st_owner"],
                "cover_url": "https://example.test/cover.jpg",
                "gallery_urls": ["https://example.test/room.jpg"],
                "address": "123 Main St",
                "phone": "+12505550100",
            }
        },
    )
    assert updated.status_code == 200, updated.text
    published_id = new_id("review")
    for status, row_id in [("published", published_id), ("hidden", new_id("review"))]:
        db.add(
            Review(
                id=row_id,
                business_id=BIZ,
                client_id="cl_amelie",
                status=status,
                rating=5,
                body=f"{status} review",
                submitted_at=datetime.now(UTC),
            )
        )
    await db.flush()
    response = await api.get("/book/birchbark/profile")
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["about"] == "Our studio"
    assert data["cover_url"] == "https://example.test/cover.jpg"
    assert data["gallery_urls"] == ["https://example.test/room.jpg"]
    assert [person["id"] for person in data["staff"]] == ["st_owner"]
    assert data["hours"]
    assert any(review["id"] == published_id for review in data["reviews"])
    assert all(review["body"] != "hidden review" for review in data["reviews"])
    assert all("client_id" not in review and "token" not in review for review in data["reviews"])


async def test_profile_opt_in_is_scoped_and_owner_only(
    api: httpx.AsyncClient,
    as_owner: httpx.AsyncClient,
    factory: Factory,
) -> None:
    other = await factory.business()
    staff = await factory.staff(business=other)
    response = await as_owner.patch(
        "/v1/business", json={"brand": {"public_staff_ids": [staff.id]}}
    )
    assert response.status_code == 404
    assert (await api.get("/book/missing/profile")).status_code == 404
    assert (await api.get(f"/book/{other.slug}/profile")).json()["reviews"] == []
    assert (await api.get(f"/book/{other.slug}/profile")).json()["staff"] == []


async def test_partial_brand_edits_preserve_profile_and_pickup_settings(
    as_owner: httpx.AsyncClient,
) -> None:
    response = await as_owner.patch(
        "/v1/business",
        json={
            "brand": {
                "about": "Our studio",
                "cover_url": "https://example.test/cover.jpg",
                "pickup_prep_minutes": 90,
                "pickup_hold_days": 5,
                "pickup_capacity": 8,
            }
        },
    )
    assert response.status_code == 200
    response = await as_owner.patch("/v1/business", json={"brand": {"primary": "#123456"}})
    brand = response.json()["brand"]
    assert brand["about"] == "Our studio"
    assert brand["pickup_prep_minutes"] == 90
    assert brand["pickup_hold_days"] == 5 and brand["pickup_capacity"] == 8
    response = await as_owner.patch("/v1/business", json={"brand": {"about": ""}})
    assert "about" not in response.json()["brand"]
    assert response.json()["brand"]["cover_url"] == "https://example.test/cover.jpg"


async def test_profile_rejects_unsafe_and_unbounded_settings(as_owner: httpx.AsyncClient) -> None:
    for brand in [
        {"cover_url": "javascript:alert(1)"},
        {"website": "https://"},
        {"gallery_urls": ["data:image/png;base64,a"]},
        {"email": "not-email"},
        {"about": "a" * 3001},
        {"gallery_urls": ["https://example.test/a"] * 13},
        {"pickup_prep_minutes": -1},
        {"pickup_capacity": 0},
        {"pickup_hold_days": 31},
    ]:
        response = await as_owner.patch("/v1/business", json={"brand": brand})
        assert response.status_code == 422, response.text


async def test_next_openings_match_live_availability_and_validate_input(
    api: httpx.AsyncClient,
) -> None:
    response = await api.get(
        "/book/birchbark/next-openings",
        params=[
            ("item_ids", "it_groom_sm"),
            ("item_ids", "it_groom_sm"),
            ("item_ids", "it_groom_lg"),
        ],
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert len(data["services"]) == 2
    for service in data["services"]:
        assert len(service["slots"]) <= 3
        for slot in service["slots"]:
            assert slot["staff_id"]
            assert datetime.fromisoformat(slot["starts_at"]) > datetime.now(UTC)
    assert (await api.get("/book/birchbark/next-openings")).status_code == 422
    assert (
        await api.get("/book/birchbark/next-openings", params=[("item_ids", "it_groom_sm")] * 13)
    ).status_code == 422
    assert (
        await api.get("/book/birchbark/next-openings", params={"item_ids": "missing"})
    ).status_code == 404
    assert (
        await api.get("/book/birchbark/next-openings", params={"item_ids": "it_shampoo"})
    ).status_code == 409
    assert (
        await api.get("/book/missing/next-openings", params={"item_ids": "it_groom_sm"})
    ).status_code == 404


async def test_malformed_legacy_profile_does_not_break_public_page(
    api: httpx.AsyncClient,
    db: AsyncSession,
) -> None:
    business = await db.get(Business, BIZ)
    assert business is not None
    business.brand = {"cover_url": "javascript:bad", "public_staff_ids": ["st_owner"]}
    await db.flush()
    data = (await api.get("/book/birchbark/profile")).json()
    assert data["cover_url"] is None
    assert data["staff"] == []


async def test_staff_cannot_publish_profile(as_staff: httpx.AsyncClient) -> None:
    response = await as_staff.patch("/v1/business", json={"brand": {"about": "No"}})
    assert response.status_code == 403
