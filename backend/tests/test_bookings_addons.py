from datetime import datetime, timedelta

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.catalog import Item
from clientbridge.models.scheduling import Addon, Booking, Slot
from tests.conftest import BIZ, OWNER_USER, Factory, FakeIdentityProvider, session_token
from tests.helpers import client_id, key, ok

SLUG = "birchbark"
TUESDAY = "2026-12-01"
OPENING = "2026-12-01T16:00:00Z"  # 9 a.m. in Vancouver, the first open time
GROOM = "it_groom_sm"  # 75 minutes, 10 after
SHAMPOO, BRUSH = "it_shampoo", "it_brush"


async def _minutes(db: AsyncSession, item_id: str, minutes: int | None) -> None:
    await db.execute(update(Item).where(Item.id == item_id).values(duration_min=minutes))
    await db.flush()


async def _slot(db: AsyncSession, booking_id: str) -> Slot:
    return (
        await db.execute(
            select(Slot)
            .join(Booking, Booking.slot_id == Slot.id)
            .where(Booking.id == booking_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def _length(db: AsyncSession, booking_id: str) -> int:
    slot = await _slot(db, booking_id)
    return int((slot.ends_at - slot.starts_at).total_seconds() // 60)


async def _addons(db: AsyncSession, booking_id: str) -> list[tuple[str, int]]:
    rows = await db.execute(
        select(Addon.item_id, Addon.quantity)
        .where(Addon.booking_id == booking_id)
        .order_by(Addon.created_at, Addon.id)
    )
    return [(item_id, quantity) for item_id, quantity in rows.tuples()]


def _online(starts: str = OPENING, **extra: object) -> dict[str, object]:
    return {
        "item_id": GROOM,
        "staff_id": "st_owner",
        "starts_at": starts,
        "client": {"name": "Long Visit", "email": "long-visit@example.com"},
        **extra,
    }


async def _staff_visit(api: httpx.AsyncClient, db: AsyncSession, starts: str, staff: str) -> str:
    res = await api.post(
        "/v1/bookings",
        json={
            "client_id": await client_id(db),
            "item_id": GROOM,
            "staff_id": staff,
            "starts_at": starts,
            "notify": False,
        },
    )
    assert res.status_code == 201, res.text
    return str(res.json()["id"])


async def test_the_page_lists_what_each_addon_adds(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _minutes(db, SHAMPOO, 30)
    page = ok(await api.get(f"/book/{SLUG}/services")).json()
    minutes = {a["id"]: a["duration_min"] for a in page["addons"]}
    assert minutes == {SHAMPOO: 30, BRUSH: None}


async def test_online_addons_lengthen_the_visit_by_their_minutes(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _minutes(db, SHAMPOO, 15)
    res = await api.post(
        f"/book/{SLUG}",
        json=_online(
            addons=[{"item_id": SHAMPOO, "quantity": 2}, {"item_id": BRUSH, "quantity": 1}]
        ),
    )
    booked = ok(res).json()
    assert await _length(db, booked["booking_id"]) == 75 + 30


async def test_open_times_leave_room_for_the_addons(api: httpx.AsyncClient) -> None:
    params = {"item_id": GROOM, "staff_id": "st_owner", "date": TUESDAY}
    plain = ok(await api.get(f"/book/{SLUG}/slots", params=params)).json()["slots"]
    longer = ok(await api.get(f"/book/{SLUG}/slots", params={**params, "extra_min": 45})).json()[
        "slots"
    ]
    assert plain and longer
    for slot in longer:
        span = datetime.fromisoformat(slot["ends_at"]) - datetime.fromisoformat(slot["starts_at"])
        assert span == timedelta(minutes=120)
    assert max(s["starts_at"] for s in longer) < max(s["starts_at"] for s in plain)
    days = ok(
        await api.get(
            f"/book/{SLUG}/days",
            params={"item_id": GROOM, "staff_id": "st_owner", "from": TUESDAY, "extra_min": 45},
        )
    ).json()["days"]
    assert days[0]["count"] == len(longer)
    refused = await api.get(f"/book/{SLUG}/slots", params={**params, "extra_min": -5})
    assert refused.status_code == 422


async def test_a_time_too_short_for_the_addons_is_refused(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    params = {"item_id": GROOM, "staff_id": "st_owner", "date": TUESDAY}
    last = max(
        s["starts_at"]
        for s in ok(await api.get(f"/book/{SLUG}/slots", params=params)).json()["slots"]
    )
    await _minutes(db, SHAMPOO, 120)
    refused = await api.post(
        f"/book/{SLUG}", json=_online(last, addons=[{"item_id": SHAMPOO, "quantity": 1}])
    )
    assert refused.status_code == 409
    assert refused.json()["error"] == "slot_unavailable"


async def test_a_class_seat_keeps_the_class_length(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _minutes(db, SHAMPOO, 30)
    seat = ok(
        await as_owner.post(
            "/v1/bookings",
            json={
                "client_id": await client_id(db),
                "item_id": "it_puppy",
                "staff_id": "st_owner",
                "starts_at": "2026-12-01T18:00:00Z",
                "notify": False,
            },
        ),
        201,
    ).json()
    added = await as_owner.post(
        f"/v1/bookings/{seat['id']}/addons", json={"item_id": SHAMPOO}, headers=key()
    )
    assert ok(added, 201).json()["ends_at"] == seat["ends_at"]
    assert await _addons(db, seat["id"]) == [(SHAMPOO, 1)]


async def test_a_moved_visit_keeps_its_stored_length(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _minutes(db, SHAMPOO, 30)
    booked = ok(
        await api.post(f"/book/{SLUG}", json=_online(addons=[{"item_id": SHAMPOO, "quantity": 1}]))
    ).json()
    token = booked["manage_token"]
    slots = ok(await api.get(f"/manage/{token}/slots", params={"date": "2026-12-02"})).json()
    assert slots["slots"]
    for slot in slots["slots"]:
        span = datetime.fromisoformat(slot["ends_at"]) - datetime.fromisoformat(slot["starts_at"])
        assert span == timedelta(minutes=105)
    moved = ok(
        await api.post(
            f"/manage/{token}/reschedule",
            json={"starts_at": slots["slots"][0]["starts_at"]},
            headers=key(),
        )
    ).json()
    assert moved["starts_at"] == slots["slots"][0]["starts_at"]
    assert await _length(db, booked["booking_id"]) == 105


async def test_staff_add_an_addon_that_lengthens_the_visit(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _minutes(db, SHAMPOO, 20)
    booking_id = await _staff_visit(as_owner, db, OPENING, "st_owner")
    headers = key()
    first = ok(
        await as_owner.post(
            f"/v1/bookings/{booking_id}/addons",
            json={"item_id": SHAMPOO, "quantity": 2},
            headers=headers,
        ),
        201,
    ).json()
    again = await as_owner.post(
        f"/v1/bookings/{booking_id}/addons",
        json={"item_id": SHAMPOO, "quantity": 2},
        headers=headers,
    )
    assert ok(again, 201).json() == first
    assert await _length(db, booking_id) == 75 + 40
    assert await _addons(db, booking_id) == [(SHAMPOO, 2)]
    ok(
        await as_owner.post(
            f"/v1/bookings/{booking_id}/addons", json={"item_id": BRUSH}, headers=key()
        ),
        201,
    )
    assert await _length(db, booking_id) == 75 + 40
    [shampoo, _] = (
        await db.execute(
            select(Addon.id).where(Addon.booking_id == booking_id).order_by(Addon.created_at)
        )
    ).scalars()
    ok(await as_owner.delete(f"/v1/bookings/{booking_id}/addons/{shampoo}"))
    assert await _length(db, booking_id) == 75
    assert await _addons(db, booking_id) == [(BRUSH, 1)]


async def test_staff_add_addons_to_their_own_visits_only(
    as_staff: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    owner = {
        "X-Session-Token": await session_token(identities, db, OWNER_USER),
        "X-Business-Id": BIZ,
    }
    res = await as_staff.post(
        "/v1/bookings",
        json={
            "client_id": await client_id(db),
            "item_id": GROOM,
            "staff_id": "st_owner",
            "starts_at": OPENING,
            "notify": False,
        },
        headers=owner,
    )
    owners = ok(res, 201).json()["id"]
    diegos = await _staff_visit(as_staff, db, OPENING, "st_diego")
    forbidden = await as_staff.post(
        f"/v1/bookings/{owners}/addons", json={"item_id": SHAMPOO}, headers=key()
    )
    assert forbidden.status_code == 403
    own = await as_staff.post(
        f"/v1/bookings/{diegos}/addons", json={"item_id": SHAMPOO}, headers=key()
    )
    assert own.status_code == 201, own.text


async def test_an_addon_needs_a_signed_in_member(unauth: httpx.AsyncClient) -> None:
    res = await unauth.post("/v1/bookings/bk_x/addons", json={"item_id": SHAMPOO})
    assert res.status_code == 401


async def test_only_this_business_s_active_products_can_be_added(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    booking_id = await _staff_visit(as_owner, db, OPENING, "st_owner")
    other = await factory.business()
    db.add(Item(id="it_rival_wax", business_id=other.id, kind="product", name="Wax"))
    await db.flush()
    for item_id in ("it_rival_wax", "it_bath", "it_nope"):
        res = await as_owner.post(
            f"/v1/bookings/{booking_id}/addons", json={"item_id": item_id}, headers=key()
        )
        assert res.status_code == 404, item_id
    missing = await as_owner.post(
        "/v1/bookings/bk_nope/addons", json={"item_id": SHAMPOO}, headers=key()
    )
    assert missing.status_code == 404
    zero = await as_owner.post(
        f"/v1/bookings/{booking_id}/addons",
        json={"item_id": SHAMPOO, "quantity": 0},
        headers=key(),
    )
    assert zero.status_code == 422
    over = await as_owner.post(
        f"/v1/bookings/{booking_id}/addons",
        json={"item_id": BRUSH, "quantity": 3},
        headers=key(),
    )
    assert over.status_code == 409
    assert await _addons(db, booking_id) == []


async def test_a_closed_or_invoiced_visit_takes_no_addon(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    canceled = await _staff_visit(as_owner, db, OPENING, "st_owner")
    ok(await as_owner.patch(f"/v1/bookings/{canceled}", json={"status": "canceled"}))
    invoiced = await _staff_visit(as_owner, db, "2026-12-01T19:00:00Z", "st_owner")
    ok(await as_owner.post(f"/v1/invoices/from-booking/{invoiced}", headers=key()), 201)
    for booking_id in (canceled, invoiced):
        res = await as_owner.post(
            f"/v1/bookings/{booking_id}/addons", json={"item_id": SHAMPOO}, headers=key()
        )
        assert res.status_code == 409, booking_id
        assert await _addons(db, booking_id) == []


async def test_an_addon_without_room_after_the_visit_is_refused(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _minutes(db, SHAMPOO, 30)
    first = await _staff_visit(as_owner, db, OPENING, "st_owner")
    await _staff_visit(as_owner, db, "2026-12-01T17:30:00Z", "st_owner")
    before = await _slot(db, first)
    refused = await as_owner.post(
        f"/v1/bookings/{first}/addons", json={"item_id": SHAMPOO}, headers=key()
    )
    assert refused.status_code == 409
    assert refused.json()["error"] == "visit_no_room"
    assert (await _slot(db, first)).ends_at == before.ends_at
    assert await _addons(db, first) == []


async def test_add_on_invoice_lines_carry_the_visit_and_its_member(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking_id = await _staff_visit(as_owner, db, OPENING, "st_diego")
    ok(
        await as_owner.post(
            f"/v1/bookings/{booking_id}/addons", json={"item_id": SHAMPOO}, headers=key()
        ),
        201,
    )
    draft = ok(
        await as_owner.post(f"/v1/invoices/from-booking/{booking_id}", headers=key()), 201
    ).json()
    assert [(ln["item_id"], ln["booking_id"], ln["staff_id"]) for ln in draft["lines"]] == [
        (GROOM, booking_id, None),
        (SHAMPOO, booking_id, "st_diego"),
    ]
