"""Booking inputs keep pets inside the selected business and client."""

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.ids import new_id
from clientbridge.models.clients import Subject
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
        name="Private pet",
        attributes={},
        deleted_at=clock.now() if kind == "deleted" else None,
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
