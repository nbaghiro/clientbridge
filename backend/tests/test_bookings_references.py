"""Booking inputs keep pets and resources inside the selected business and client."""

from datetime import UTC, datetime

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.clients import Subject
from clientbridge.models.scheduling import Resource
from tests.conftest import BIZ, Factory


@pytest.mark.parametrize("endpoint", ["bookings", "recurrences"])
@pytest.mark.parametrize("kind", ["foreign", "other_client", "deleted"])
async def test_booking_rejects_a_pet_outside_the_client_record(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory, endpoint: str, kind: str
) -> None:
    biz, client = BIZ, "cl_amelie"
    if kind == "foreign":
        other = await factory.business()
        foreign = await factory.client(business=other)
        biz, client = other.id, foreign.id
    elif kind == "other_client":
        client = "cl_marcus"
    pet = Subject(
        id=new_id("subject"),
        business_id=biz,
        client_id=client,
        kind="pet",
        name="Private pet",
        attributes={},
        deleted_at=datetime.now(UTC) if kind == "deleted" else None,
    )
    db.add(pet)
    await db.flush()
    body: dict[str, object] = {
        "client_id": "cl_amelie",
        "subject_id": pet.id,
        "item_id": "it_groom_sm",
        "staff_id": "st_priya",
        "starts_at": "2027-03-02T18:00:00Z",
    }
    if endpoint == "recurrences":
        body |= {"frequency": "week", "count": 2}
    res = await as_owner.post(f"/v1/{endpoint}", json=body)
    assert res.status_code == 404, res.text


@pytest.mark.parametrize("kind", ["foreign", "inactive"])
async def test_recurrence_rejects_an_unavailable_resource(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory, kind: str
) -> None:
    biz = (await factory.business()).id if kind == "foreign" else BIZ
    resource = Resource(
        id=new_id("resource"),
        business_id=biz,
        name="Private room",
        category="room",
        active=kind != "inactive",
    )
    db.add(resource)
    await db.flush()
    res = await as_owner.post(
        "/v1/recurrences",
        json={
            "client_id": "cl_amelie",
            "item_id": "it_groom_sm",
            "staff_id": "st_priya",
            "resource_id": resource.id,
            "starts_at": "2027-03-02T18:00:00Z",
            "frequency": "week",
            "count": 2,
        },
    )
    assert res.status_code == (404 if kind == "foreign" else 409), res.text
