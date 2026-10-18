from datetime import UTC, datetime

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.ids import new_id
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client
from clientbridge.models.platform import File
from clientbridge.models.scheduling import Booking, Slot
from tests.conftest import BIZ, Factory, FakeFileStorage


async def _booking(db: AsyncSession, staff_id: str, business_id: str = BIZ) -> str:
    client_id = await db.scalar(select(Client.id).where(Client.business_id == business_id))
    item_id = await db.scalar(
        select(Item.id).where(Item.business_id == business_id, Item.kind == "service").limit(1)
    )
    assert client_id is not None and item_id is not None
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
        starts_at=slot.starts_at,
        staff_id=staff_id,
        client_id=client_id,
        status="confirmed",
        source="manual",
        price_cents=7500,
    )
    db.add(booking)
    await db.flush()
    return booking.id


def _photo(booking_id: str, **extra: object) -> dict[str, object]:
    return {
        "parent_type": "booking",
        "parent_id": booking_id,
        "purpose": "photo",
        "content_type": "image/jpeg",
        "size": 2048,
        **extra,
    }


async def test_staff_adds_a_photo_to_their_booking_and_reads_it_back(
    as_staff: httpx.AsyncClient, db: AsyncSession, storage: FakeFileStorage
) -> None:
    bid = await _booking(db, "st_diego")
    res = await as_staff.post("/v1/files", json=_photo(bid))
    assert res.status_code == 201, res.text
    file = res.json()["file"]
    assert file["parent_type"] == "booking" and file["parent_id"] == bid
    assert (await as_staff.get(f"/v1/files/{file['id']}/link")).status_code == 404
    storage.stored[file["s3_key"]] = 2048
    done = await as_staff.post(f"/v1/files/{file['id']}/complete")
    assert done.status_code == 200, done.text
    link = await as_staff.get(f"/v1/files/{file['id']}/link")
    assert link.status_code == 200, link.text
    assert link.json()["url"] == f"https://files.test/{file['s3_key']}"
    assert storage.downloads == [file["s3_key"]]


async def test_owner_adds_a_photo_to_any_booking(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid = await _booking(db, "st_diego")
    assert (await as_owner.post("/v1/files", json=_photo(bid))).status_code == 201


async def test_staff_cannot_photograph_or_read_another_members_booking_403(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid = await _booking(db, "st_owner")
    before = await db.scalar(select(File.id).where(File.parent_id == bid))
    res = await as_staff.post("/v1/files", json=_photo(bid))
    assert res.status_code == 403
    assert before is None and await db.scalar(select(File.id).where(File.parent_id == bid)) is None
    db.add(
        File(
            id="fl_owner_photo",
            business_id=BIZ,
            parent_type="booking",
            parent_id=bid,
            purpose="photo",
            s3_key=f"{BIZ}/fl_owner_photo",
            uploaded_at=clock.now(),
        )
    )
    await db.flush()
    assert (await as_staff.get("/v1/files/fl_owner_photo/link")).status_code == 403


@pytest.mark.parametrize(
    "extra",
    [{"purpose": "attachment"}, {"purpose": None}, {"content_type": "application/pdf"}],
)
async def test_a_booking_takes_only_photos_422(
    as_owner: httpx.AsyncClient, db: AsyncSession, extra: dict[str, object]
) -> None:
    bid = await _booking(db, "st_owner")
    res = await as_owner.post("/v1/files", json=_photo(bid, **extra))
    assert res.status_code == 422
    assert res.json()["error"] == "invalid_request"


async def test_unknown_deleted_or_foreign_booking_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    assert (await as_owner.post("/v1/files", json=_photo("bk_missing"))).status_code == 404
    gone = await _booking(db, "st_owner")
    row = await db.get(Booking, gone)
    assert row is not None
    row.deleted_at = clock.now()
    await db.flush()
    assert (await as_owner.post("/v1/files", json=_photo(gone))).status_code == 404
    other = await factory.business(name="Rival Co")
    owner = await factory.staff(business=other, user=await factory.user(), role="owner")
    await factory.client(business=other)
    db.add(
        Item(
            id=new_id("item"),
            business_id=other.id,
            kind="service",
            name="Rival visit",
            price_cents=5000,
            currency="CAD",
            duration_min=60,
        )
    )
    await db.flush()
    foreign = await _booking(db, owner.id, other.id)
    assert (await as_owner.post("/v1/files", json=_photo(foreign))).status_code == 404


async def test_links_are_only_for_uploaded_booking_photos_of_this_business_404(
    as_owner: httpx.AsyncClient, unauth: httpx.AsyncClient, db: AsyncSession
) -> None:
    db.add(
        File(
            id="fl_subject_doc",
            business_id=BIZ,
            parent_type="subject",
            parent_id="sj_bella",
            s3_key=f"{BIZ}/fl_subject_doc",
            uploaded_at=clock.now(),
        )
    )
    await db.flush()
    assert (await as_owner.get("/v1/files/fl_subject_doc/link")).status_code == 404
    assert (await as_owner.get("/v1/files/fl_missing/link")).status_code == 404
    unauth.headers.clear()
    assert (await unauth.get("/v1/files/fl_subject_doc/link")).status_code == 401


async def test_creating_the_same_photo_twice_with_one_key_returns_one_file(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid = await _booking(db, "st_diego")
    headers = {"Idempotency-Key": "photo-once"}
    first = await as_staff.post("/v1/files", json=_photo(bid), headers=headers)
    again = await as_staff.post("/v1/files", json=_photo(bid), headers=headers)
    assert first.status_code == 201 and again.status_code == 201
    assert first.json()["file"]["id"] == again.json()["file"]["id"]
    rows = await db.scalars(select(File.id).where(File.parent_id == bid))
    assert len(rows.all()) == 1
