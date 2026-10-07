from datetime import UTC, datetime

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.catalog import Item
from clientbridge.models.scheduling import Booking, Slot
from tests.conftest import BIZ, Factory


async def _booking(
    db: AsyncSession, staff_id: str, *, business_id: str = BIZ, client_id: str = "cl_amelie"
) -> str:
    item_id = "it_groom_sm"
    if business_id != BIZ:
        item = Item(
            id=new_id("item"),
            business_id=business_id,
            kind="service",
            name="Rival Groom",
            price_cents=5000,
            currency="CAD",
            duration_min=60,
        )
        db.add(item)
        await db.flush()
        item_id = item.id
    slot = Slot(
        id=new_id("slot"),
        business_id=business_id,
        item_id=item_id,
        staff_id=staff_id,
        starts_at=datetime(2027, 8, 3, 17, tzinfo=UTC),
        ends_at=datetime(2027, 8, 3, 18, tzinfo=UTC),
        capacity=1,
        status="scheduled",
    )
    db.add(slot)
    await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=business_id,
        slot_id=slot.id,
        staff_id=staff_id,
        client_id=client_id,
        status="confirmed",
        source="manual",
    )
    db.add(booking)
    await db.flush()
    return booking.id


async def test_reminder_preview_matches_what_is_sent(as_owner: httpx.AsyncClient) -> None:
    created = await as_owner.post(
        "/v1/bookings",
        json={
            "client_id": "cl_amelie",
            "item_id": "it_groom_sm",
            "staff_id": "st_priya",
            "starts_at": "2027-03-01T18:00:00Z",
        },
    )
    bid = created.json()["id"]
    res = await as_owner.get(f"/v1/bookings/{bid}/reminder")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["subject"].startswith("Appointment reminder")
    assert "Change or cancel:" in body["body"]
    assert body["sends_at"].startswith("2027-02-28T18:00")
    assert body["sent_at"] is None
    assert (await as_owner.get("/v1/bookings/bk_missing/reminder")).status_code == 404


async def test_staff_previews_their_own_booking(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid = await _booking(db, "st_diego")
    assert (await as_staff.get(f"/v1/bookings/{bid}/reminder")).status_code == 200


async def test_staff_cannot_preview_another_members_booking(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid = await _booking(db, "st_owner")
    assert (await as_staff.get(f"/v1/bookings/{bid}/reminder")).status_code == 403


async def test_another_business_booking_404(
    as_owner: httpx.AsyncClient, factory: Factory, db: AsyncSession
) -> None:
    other = await factory.business(name="Rival Co")
    owner = await factory.staff(business=other, user=await factory.user(), role="owner")
    client = await factory.client(business=other)
    bid = await _booking(db, owner.id, business_id=other.id, client_id=client.id)
    assert (await as_owner.get(f"/v1/bookings/{bid}/reminder")).status_code == 404


async def test_unauth_cannot_preview(unauth: httpx.AsyncClient, db: AsyncSession) -> None:
    bid = await _booking(db, "st_owner")
    assert (await unauth.get(f"/v1/bookings/{bid}/reminder")).status_code == 401
