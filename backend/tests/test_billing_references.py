"""Every billing composer validates the tenant of a referenced visit."""

from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.catalog import Item
from clientbridge.models.scheduling import Booking, Slot
from tests.conftest import Factory


@pytest.mark.parametrize("endpoint", ["invoices", "estimates", "orders"])
@pytest.mark.parametrize("editing", [False, True])
async def test_billing_lines_cannot_reference_a_foreign_booking(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory, endpoint: str, editing: bool
) -> None:
    other = await factory.business()
    client = await factory.client(business=other)
    staff = await factory.staff(business=other)
    item = Item(id=new_id("item"), business_id=other.id, kind="service", name="Private service")
    db.add(item)
    await db.flush()
    start = datetime(2027, 3, 2, 18, tzinfo=UTC)
    slot = Slot(
        id=new_id("slot"),
        business_id=other.id,
        item_id=item.id,
        staff_id=staff.id,
        starts_at=start,
        ends_at=start + timedelta(hours=1),
        capacity=1,
    )
    db.add(slot)
    await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=other.id,
        slot_id=slot.id,
        staff_id=staff.id,
        client_id=client.id,
        price_cents=10000,
    )
    db.add(booking)
    await db.flush()
    line: dict[str, object] = {"description": "Visit", "quantity": 1, "unit_amount_cents": 10000}
    url = f"/v1/{endpoint}"
    if editing:
        made = await as_owner.post(url, json={"client_id": "cl_amelie", "lines": [line]})
        assert made.status_code == 201, made.text
        res = await as_owner.patch(
            f"{url}/{made.json()['id']}", json={"lines": [line | {"booking_id": booking.id}]}
        )
    else:
        res = await as_owner.post(
            url, json={"client_id": "cl_amelie", "lines": [line | {"booking_id": booking.id}]}
        )
    assert res.status_code == 404, res.text
