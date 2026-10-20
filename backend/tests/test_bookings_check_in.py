from datetime import UTC, datetime

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.ids import new_id
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client
from clientbridge.models.documents import Contract, Form, FormResponse, Signature
from clientbridge.models.platform import Audit
from clientbridge.models.scheduling import Booking, Slot
from tests.conftest import BIZ, Factory
from tests.helpers import new_client


async def _booking(
    db: AsyncSession,
    staff_id: str,
    status: str = "confirmed",
    day: int = 3,
    client: str | None = None,
) -> str:
    client_id = (await db.execute(select(Client.id).where(Client.business_id == BIZ))).scalars()
    item_id = (
        await db.execute(
            select(Item.id).where(Item.business_id == BIZ, Item.kind == "service").limit(1)
        )
    ).scalar_one()
    slot = Slot(
        id=new_id("slot"),
        business_id=BIZ,
        item_id=item_id,
        staff_id=staff_id,
        starts_at=datetime(2027, 8, day, 17, tzinfo=UTC),
        ends_at=datetime(2027, 8, day, 18, tzinfo=UTC),
        capacity=1,
        status="scheduled",
    )
    db.add(slot)
    await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=BIZ,
        slot_id=slot.id,
        starts_at=slot.starts_at,
        staff_id=staff_id,
        client_id=client or client_id.first(),
        status=status,
        source="manual",
        price_cents=7500,
    )
    db.add(booking)
    await db.flush()
    return booking.id


async def _checked_in_at(db: AsyncSession, booking_id: str) -> datetime | None:
    row = await db.get(Booking, booking_id, populate_existing=True)
    assert row is not None
    return row.checked_in_at


async def test_owner_checks_a_client_in(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    bid = await _booking(db, "st_diego")
    res = await as_owner.post(f"/v1/bookings/{bid}/check-in")
    assert res.status_code == 200, res.text
    assert res.json()["checked_in_at"] is not None
    assert res.json()["status"] == "confirmed"
    assert await _checked_in_at(db, bid) is not None
    audit = await db.execute(
        select(Audit.action).where(Audit.entity_id == bid, Audit.action == "booking.check_in")
    )
    assert audit.scalar_one_or_none() == "booking.check_in"


async def test_staff_checks_in_their_own_booking(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid = await _booking(db, "st_diego")
    res = await as_staff.post(f"/v1/bookings/{bid}/check-in")
    assert res.status_code == 200, res.text
    assert await _checked_in_at(db, bid) is not None


async def test_staff_cannot_check_in_another_members_booking(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid = await _booking(db, "st_owner")
    res = await as_staff.post(f"/v1/bookings/{bid}/check-in")
    assert res.status_code == 403
    assert await _checked_in_at(db, bid) is None


async def test_unauth_cannot_check_in(unauth: httpx.AsyncClient, db: AsyncSession) -> None:
    bid = await _booking(db, "st_owner")
    res = await unauth.post(f"/v1/bookings/{bid}/check-in")
    assert res.status_code == 401
    assert await _checked_in_at(db, bid) is None


async def test_unknown_booking_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/bookings/bk_missing/check-in")
    assert res.status_code == 404


async def test_another_business_booking_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Rival Co")
    owner = await factory.staff(business=other, user=await factory.user(), role="owner")
    client = await factory.client(business=other)
    item = Item(
        id=new_id("item"),
        business_id=other.id,
        kind="service",
        name="Rival Groom",
        price_cents=5000,
        currency="CAD",
        duration_min=60,
    )
    db.add(item)
    await db.flush()
    slot = Slot(
        id=new_id("slot"),
        business_id=other.id,
        item_id=item.id,
        staff_id=owner.id,
        starts_at=datetime(2027, 8, 4, 17, tzinfo=UTC),
        ends_at=datetime(2027, 8, 4, 18, tzinfo=UTC),
        capacity=1,
        status="scheduled",
    )
    db.add(slot)
    await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=other.id,
        slot_id=slot.id,
        starts_at=slot.starts_at,
        staff_id=owner.id,
        client_id=client.id,
        status="confirmed",
        source="manual",
    )
    db.add(booking)
    await db.flush()
    res = await as_owner.post(f"/v1/bookings/{booking.id}/check-in")
    assert res.status_code == 404
    assert await _checked_in_at(db, booking.id) is None


async def test_closed_booking_cannot_be_checked_in(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    for day, status in enumerate(("completed", "canceled", "no_show"), start=10):
        bid = await _booking(db, "st_owner", status=status, day=day)
        res = await as_owner.post(f"/v1/bookings/{bid}/check-in")
        assert res.status_code == 409, status
        assert await _checked_in_at(db, bid) is None


async def test_checking_in_twice_keeps_the_first_arrival(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid = await _booking(db, "st_owner")
    first = (await as_owner.post(f"/v1/bookings/{bid}/check-in")).json()["checked_in_at"]
    again = await as_owner.post(f"/v1/bookings/{bid}/check-in")
    assert again.status_code == 200
    assert again.json()["checked_in_at"] == first
    audits = await db.execute(
        select(Audit.id).where(Audit.entity_id == bid, Audit.action == "booking.check_in")
    )
    assert len(audits.scalars().all()) == 1


async def test_a_mistaken_check_in_can_be_undone(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid = await _booking(db, "st_owner")
    assert (await as_owner.post(f"/v1/bookings/{bid}/check-in")).status_code == 200
    res = await as_owner.delete(f"/v1/bookings/{bid}/check-in")
    assert res.status_code == 200, res.text
    assert res.json()["checked_in_at"] is None and await _checked_in_at(db, bid) is None
    assert (await as_owner.delete(f"/v1/bookings/{bid}/check-in")).status_code == 409


async def test_staff_cannot_undo_another_members_check_in(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid = await _booking(db, "st_owner")
    row = await db.get(Booking, bid)
    assert row is not None
    row.checked_in_at = clock.now()
    await db.flush()
    assert (await as_staff.delete(f"/v1/bookings/{bid}/check-in")).status_code == 403
    assert await _checked_in_at(db, bid) is not None


async def test_a_paid_visits_check_in_stays(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    bid = await _booking(db, "st_owner")
    await as_owner.post(f"/v1/bookings/{bid}/check-in")
    row = await db.get(Booking, bid)
    assert row is not None
    row.charged_at = clock.now()
    await db.flush()
    assert (await as_owner.delete(f"/v1/bookings/{bid}/check-in")).status_code == 409


async def _intake(db: AsyncSession) -> Form:
    form = Form(id=new_id("form"), business_id=BIZ, name="Intake", send_on="booking")
    db.add(form)
    await db.flush()
    return form


async def _waiver(db: AsyncSession, client: str, *, signed: int | None, version: int) -> Signature:
    contract = Contract(
        id=new_id("contract"), business_id=BIZ, name="Waiver", body="I agree.", version=version
    )
    db.add(contract)
    await db.flush()
    signature = Signature(
        id=new_id("signature"),
        business_id=BIZ,
        contract_id=contract.id,
        client_id=client,
        status="pending" if signed is None else "signed",
        token=f"tok_{new_id('signature')}",
        contract_version=signed or version,
    )
    db.add(signature)
    await db.flush()
    return signature


async def test_needs_list_what_the_client_still_owes(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    client = await new_client(db)
    form = await _intake(db)
    pending = await _waiver(db, client, signed=None, version=1)
    outdated = await _waiver(db, client, signed=1, version=2)
    bid = await _booking(db, "st_owner", client=client)
    row = await db.get(Booking, bid)
    assert row is not None
    row.deposit_status, row.deposit_amount_cents = "pending", 2500
    await db.flush()
    res = await as_owner.get(f"/v1/bookings/{bid}/needs")
    assert res.status_code == 200, res.text
    owed = {(n["kind"], n["ref_id"]): n for n in res.json()["needs"]}
    assert {
        ("form", form.id),
        ("signature", pending.id),
        ("signature", outdated.contract_id),
        ("deposit", bid),
    } <= set(owed)
    assert owed[("signature", pending.id)]["token"] == pending.token
    assert owed[("deposit", bid)]["amount_cents"] == 2500
    db.add(
        FormResponse(
            id=new_id("form_response"),
            business_id=BIZ,
            form_id=form.id,
            client_id=client,
            status="submitted",
            definition={},
        )
    )
    await db.flush()
    again = (await as_owner.get(f"/v1/bookings/{bid}/needs")).json()["needs"]
    assert ("form", form.id) not in {(n["kind"], n["ref_id"]) for n in again}


async def test_staff_see_needs_only_for_their_own_visits(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    mine = await _booking(db, "st_diego", day=5)
    theirs = await _booking(db, "st_owner", day=5)
    assert (await as_staff.get(f"/v1/bookings/{theirs}/needs")).status_code == 403
    day = await as_staff.get("/v1/bookings/needs", params={"day": "2027-08-05"})
    assert day.status_code == 200, day.text
    assert [v["booking_id"] for v in day.json()] == [mine]


async def test_checking_in_past_an_owed_form_is_audited(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    client = await new_client(db)
    form = await _intake(db)
    bid = await _booking(db, "st_owner", client=client)
    assert (await as_owner.post(f"/v1/bookings/{bid}/check-in")).status_code == 200
    changes = (
        await db.execute(
            select(Audit.changes).where(Audit.entity_id == bid, Audit.action == "booking.check_in")
        )
    ).scalar_one()
    outstanding = changes["outstanding"]
    assert isinstance(outstanding, list) and {"kind": "form", "ref_id": form.id} in outstanding


async def test_a_signed_current_version_clears_an_older_pending_request(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    client = await new_client(db)
    pending = await _waiver(db, client, signed=None, version=1)
    db.add(
        Signature(
            id=new_id("signature"),
            business_id=BIZ,
            contract_id=pending.contract_id,
            client_id=client,
            status="signed",
            token=f"tok_{new_id('signature')}",
            contract_version=1,
        )
    )
    await db.flush()
    bid = await _booking(db, "st_owner", client=client)
    needs = (await as_owner.get(f"/v1/bookings/{bid}/needs")).json()["needs"]
    assert all(n["kind"] != "signature" for n in needs)


async def test_a_pending_visits_check_in_can_be_undone(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid = await _booking(db, "st_owner", status="pending")
    assert (await as_owner.post(f"/v1/bookings/{bid}/check-in")).status_code == 200
    assert (await as_owner.delete(f"/v1/bookings/{bid}/check-in")).status_code == 200
