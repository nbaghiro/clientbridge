from datetime import timedelta

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.ids import new_id
from clientbridge.models.catalog import Package
from clientbridge.models.clients import Subject
from clientbridge.models.scheduling import Booking, Slot
from tests.conftest import BIZ, Factory
from tests.helpers import key

PKG_ITEM = "it_pkg5"
CLIENT = "cl_marcus"
REX = "sj_rex"


async def _sibling(db: AsyncSession, client: str = CLIENT, business: str = BIZ) -> str:
    subject = Subject(
        id=new_id("subject"),
        business_id=business,
        client_id=client,
        name="Juniper",
        attributes={},
    )
    db.add(subject)
    await db.flush()
    return subject.id


async def _package(db: AsyncSession, subject: str | None) -> Package:
    pkg = Package(
        id=new_id("package"),
        business_id=BIZ,
        client_id=CLIENT,
        item_id=PKG_ITEM,
        subject_id=subject,
        sessions_total=5,
        status="active",
    )
    db.add(pkg)
    await db.flush()
    return pkg


async def _visit(db: AsyncSession, subject: str | None, *, days_ago: int = 400) -> Booking:
    start = clock.now() - timedelta(days=days_ago)
    slot = Slot(
        id=new_id("slot"),
        business_id=BIZ,
        item_id="it_bath",
        staff_id="st_owner",
        starts_at=start,
        ends_at=start + timedelta(hours=1),
        capacity=1,
        status="scheduled",
    )
    db.add(slot)
    await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=BIZ,
        slot_id=slot.id,
        starts_at=start,
        staff_id="st_owner",
        client_id=CLIENT,
        subject_id=subject,
        status="confirmed",
        source="manual",
    )
    db.add(booking)
    await db.flush()
    return booking


async def _cover(api: httpx.AsyncClient, pkg: Package, booking: Booking) -> httpx.Response:
    return await api.post(
        f"/v1/packages/{pkg.id}/cover", json={"booking_id": booking.id}, headers=key()
    )


async def _buy(api: httpx.AsyncClient, subject: str | None, client: str = CLIENT) -> httpx.Response:
    return await api.post(
        "/v1/packages",
        json={"client_id": client, "item_id": PKG_ITEM, "subject_id": subject, "cash": True},
        headers=key(),
    )


async def test_a_package_bought_for_one_subject_names_it(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    res = await _buy(as_owner, REX)
    assert res.status_code == 201, res.text
    pkg = await db.get(Package, res.json()["package_id"])
    assert pkg is not None and pkg.subject_id == REX
    shared = await _buy(as_owner, None)
    assert shared.status_code == 201, shared.text
    row = await db.get(Package, shared.json()["package_id"])
    assert row is not None and row.subject_id is None


async def test_a_subject_package_covers_only_that_subjects_visits(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    pkg = await _package(db, REX)
    res = await _cover(as_owner, pkg, await _visit(db, REX))
    assert res.status_code == 200, res.text
    assert res.json()["subject_id"] == REX and res.json()["sessions_used"] == 1


@pytest.mark.parametrize("visit_for", ["sibling", "nobody"])
async def test_a_subject_package_refuses_a_siblings_visit(
    as_owner: httpx.AsyncClient, db: AsyncSession, visit_for: str
) -> None:
    pkg = await _package(db, REX)
    booking = await _visit(db, await _sibling(db) if visit_for == "sibling" else None)
    res = await _cover(as_owner, pkg, booking)
    assert res.status_code == 422, res.text
    assert res.json()["error"] == "package_other_subject"


async def test_a_shared_package_covers_any_of_the_clients_visits(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    pkg = await _package(db, None)
    used: list[int] = []
    for index, subject in enumerate((REX, await _sibling(db), None)):
        res = await _cover(as_owner, pkg, await _visit(db, subject, days_ago=400 + index))
        assert res.status_code == 200, res.text
        used.append(res.json()["sessions_used"])
    assert used == [1, 2, 3]


async def test_a_package_cannot_name_another_clients_or_another_business_subject(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    stranger = await factory.client(business=other)
    foreign = await _sibling(db, stranger.id, other.id)
    neighbour = (
        await db.execute(
            select(Subject.id)
            .where(
                Subject.client_id != CLIENT,
                Subject.business_id == BIZ,
                Subject.deleted_at.is_(None),
            )
            .limit(1)
        )
    ).scalar_one()
    for subject in (foreign, neighbour, "sj_nope"):
        res = await _buy(as_owner, subject)
        assert res.status_code == 404, subject
    assert (
        await db.execute(select(Package.id).where(Package.subject_id == neighbour))
    ).first() is None


async def test_staff_cannot_sell_a_subject_package(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    assert (await _buy(as_staff, REX)).status_code == 403


async def test_a_replayed_purchase_keeps_its_subject(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    headers = key()
    body = {"client_id": CLIENT, "item_id": PKG_ITEM, "subject_id": REX, "cash": True}
    first = await as_owner.post("/v1/packages", json=body, headers=headers)
    again = await as_owner.post("/v1/packages", json=body, headers=headers)
    assert first.status_code == again.status_code == 201
    assert again.json()["package_id"] == first.json()["package_id"]
    found = await db.execute(select(Package.id).where(Package.subject_id == REX))
    assert len(found.all()) == 1


async def test_a_deleted_subjects_package_still_covers_its_visits(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    sibling = await _sibling(db)
    pkg = await _package(db, sibling)
    booking = await _visit(db, sibling)
    row = await db.get(Subject, sibling)
    assert row is not None
    row.deleted_at = clock.now()
    await db.flush()
    assert (await _cover(as_owner, pkg, booking)).status_code == 200
