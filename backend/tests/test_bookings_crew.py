from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice, Line
from clientbridge.models.business import Staff
from clientbridge.models.catalog import Item
from clientbridge.models.platform import Audit
from clientbridge.models.scheduling import Booking, Hours, Slot
from clientbridge.services.business import staff_names
from clientbridge.services.earnings import ensure_earnings, load_earning, reverse_earnings
from clientbridge.services.payments import resolve_tip
from tests.clock import FROZEN
from tests.conftest import (
    BIZ,
    OWNER_USER,
    Factory,
    FakeIdentityProvider,
    session_token,
)
from tests.helpers import client_id, earnings, key, ok

GROOM = "it_groom_sm"  # 75 minutes, 10 after
OPENING = "2026-12-01T16:00:00Z"  # 9 a.m. Tuesday in Vancouver
NOON = "2026-12-01T20:00:00Z"
WEDNESDAY = "2026-12-02T17:00:00Z"
DIEGO, PRIYA, OWNER = "st_diego", "st_priya", "st_owner"


def _at(iso: str) -> datetime:
    return datetime.fromisoformat(iso)


async def _visit(
    api: httpx.AsyncClient, db: AsyncSession, staff: str = DIEGO, starts: str = OPENING
) -> str:
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
    return str(ok(res, 201).json()["id"])


async def _blocks(db: AsyncSession, booking_id: str) -> list[tuple[str | None, datetime, datetime]]:
    rows = await db.execute(
        select(Hours.staff_id, Hours.starts_at, Hours.ends_at)
        .where(Hours.note == f"booking:{booking_id}")
        .order_by(Hours.staff_id)
        .execution_options(populate_existing=True)
    )
    return [(s, a, b) for s, a, b in rows.tuples() if a is not None and b is not None]


async def _window(db: AsyncSession, booking_id: str) -> tuple[datetime, datetime]:
    slot = (
        await db.execute(
            select(Slot)
            .join(Booking, Booking.slot_id == Slot.id)
            .where(Booking.id == booking_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    return slot.starts_at, slot.ends_at


async def _add(api: httpx.AsyncClient, booking_id: str, staff: str = PRIYA) -> httpx.Response:
    return await api.post(
        f"/v1/bookings/{booking_id}/crew", json={"staff_id": staff}, headers=key()
    )


async def _as(db: AsyncSession, identities: FakeIdentityProvider, user_id: str) -> dict[str, str]:
    return {
        "X-Session-Token": await session_token(identities, db, user_id),
        "X-Business-Id": BIZ,
    }


async def test_a_helper_is_blocked_for_the_visit_and_labelled_with_the_job(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking_id = await _visit(as_owner, db)
    headers = key()
    first = await as_owner.post(
        f"/v1/bookings/{booking_id}/crew", json={"staff_id": PRIYA}, headers=headers
    )
    again = await as_owner.post(
        f"/v1/bookings/{booking_id}/crew", json={"staff_id": PRIYA}, headers=headers
    )
    crew = ok(first, 201).json()
    assert ok(again, 201).json() == crew
    assert crew["lead_id"] == DIEGO and crew["can_edit"] is True
    assert [m["staff_id"] for m in crew["members"]] == [PRIYA]
    starts, ends = await _window(db, booking_id)
    assert await _blocks(db, booking_id) == [(PRIYA, starts, ends)]
    block = (
        await db.execute(select(Hours).where(Hours.note == f"booking:{booking_id}"))
    ).scalar_one()
    assert block.basis == "exception" and block.available is False
    assert block.reason == f"Full Groom — Small Dog · {crew['client_name']}"
    slots = ok(
        await as_owner.get(
            "/book/birchbark/slots",
            params={"item_id": GROOM, "staff_id": PRIYA, "date": "2026-12-01"},
        )
    ).json()["slots"]
    assert all(_at(s["ends_at"]) <= starts or _at(s["starts_at"]) >= ends for s in slots)
    twice = await _add(as_owner, booking_id)
    assert twice.status_code == 409 and twice.json()["error"] == "crew_member"
    lead = await _add(as_owner, booking_id, DIEGO)
    assert lead.status_code == 409 and lead.json()["error"] == "crew_member"
    assert len(await _blocks(db, booking_id)) == 1


async def test_only_a_manager_changes_the_crew_and_the_lead_reads_it(
    as_staff: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    owner = await _as(db, identities, OWNER_USER)
    own = await _visit(as_staff, db)
    refused = await _add(as_staff, own)
    assert refused.status_code == 403 and refused.json()["error"] == "forbidden"
    assert await _blocks(db, own) == []
    ok(
        await as_staff.post(f"/v1/bookings/{own}/crew", json={"staff_id": PRIYA}, headers=owner),
        201,
    )
    read = ok(await as_staff.get(f"/v1/bookings/{own}/crew")).json()
    assert [m["staff_id"] for m in read["members"]] == [PRIYA] and read["can_edit"] is False
    assert (await as_staff.delete(f"/v1/bookings/{own}/crew/{PRIYA}")).status_code == 403
    assert len(await _blocks(db, own)) == 1
    removed = await as_staff.delete(f"/v1/bookings/{own}/crew/{PRIYA}", headers=owner)
    assert ok(removed).json()["members"] == []
    assert await _blocks(db, own) == []
    missing = await as_staff.delete(f"/v1/bookings/{own}/crew/{PRIYA}", headers=owner)
    assert missing.status_code == 404


async def test_the_crew_reads_the_job_and_others_do_not(
    as_staff: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    owner = await _as(db, identities, OWNER_USER)
    priya = await _as(db, identities, "us_priya")
    booking_id = ok(
        await as_staff.post(
            "/v1/bookings",
            json={
                "client_id": await client_id(db),
                "item_id": GROOM,
                "staff_id": OWNER,
                "starts_at": OPENING,
                "notify": False,
            },
            headers=owner,
        ),
        201,
    ).json()["id"]
    assert (await as_staff.get(f"/v1/bookings/{booking_id}/crew")).status_code == 403
    ok(
        await as_staff.post(
            f"/v1/bookings/{booking_id}/crew", json={"staff_id": PRIYA}, headers=owner
        ),
        201,
    )
    job = ok(await as_staff.get(f"/v1/bookings/{booking_id}/crew", headers=priya)).json()
    assert job["service"] == "Full Groom — Small Dog" and job["can_edit"] is False
    assert job["lead_id"] == OWNER and job["starts_at"] is not None
    assert (await as_staff.get(f"/v1/bookings/{booking_id}/crew")).status_code == 403


async def test_crew_needs_a_signed_in_member(unauth: httpx.AsyncClient) -> None:
    assert (await unauth.get("/v1/bookings/bk_x/crew")).status_code == 401
    assert (await _add(unauth, "bk_x")).status_code == 401


async def test_a_busy_or_away_helper_is_refused(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking_id = await _visit(as_owner, db)
    await _visit(as_owner, db, PRIYA, "2026-12-01T16:30:00Z")
    busy = await _add(as_owner, booking_id)
    assert busy.status_code == 409 and busy.json()["error"] == "crew_busy"
    later = await _visit(as_owner, db, DIEGO, NOON)
    ok(
        await as_owner.post(
            "/v1/time-off",
            json={
                "staff_id": PRIYA,
                "starts_at": "2026-12-01T19:00:00Z",
                "ends_at": "2026-12-01T23:00:00Z",
                "reason": "Dentist",
            },
            headers=key(),
        ),
        201,
    )
    away = await _add(as_owner, later)
    assert away.status_code == 409 and away.json()["error"] == "crew_busy"
    assert await _blocks(db, booking_id) == [] and await _blocks(db, later) == []


async def test_only_a_member_who_offers_the_service_can_help(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    booking_id = await _visit(as_owner, db)
    other = await factory.business()
    stranger = await factory.staff(business=other, role="staff")
    missing = await _add(as_owner, booking_id, stranger.id)
    assert missing.status_code == 404
    assert (await _add(as_owner, "bk_nope")).status_code == 404
    await db.execute(update(Item).where(Item.id == GROOM).values(staff_ids=[DIEGO, OWNER]))
    await db.flush()
    refused = await _add(as_owner, booking_id)
    assert refused.status_code == 422 and refused.json()["error"] == "service_not_offered"
    assert await _blocks(db, booking_id) == []


async def test_a_class_or_closed_visit_takes_no_crew(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    seat = ok(
        await as_owner.post(
            "/v1/bookings",
            json={
                "client_id": await client_id(db),
                "item_id": "it_puppy",
                "staff_id": OWNER,
                "starts_at": "2026-12-01T18:00:00Z",
                "notify": False,
            },
        ),
        201,
    ).json()["id"]
    canceled = await _visit(as_owner, db, DIEGO, NOON)
    ok(await as_owner.patch(f"/v1/bookings/{canceled}", json={"status": "canceled"}))
    for booking_id in (seat, canceled):
        res = await _add(as_owner, booking_id)
        assert res.status_code == 409, booking_id
        assert await _blocks(db, booking_id) == []


async def test_the_crew_moves_resizes_and_leaves_with_the_visit(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking_id = await _visit(as_owner, db)
    ok(await _add(as_owner, booking_id), 201)
    ok(await as_owner.patch(f"/v1/bookings/{booking_id}", json={"starts_at": WEDNESDAY}))
    assert await _blocks(db, booking_id) == [(PRIYA, *await _window(db, booking_id))]
    longer = (_at(WEDNESDAY) + timedelta(minutes=120)).isoformat()
    ok(await as_owner.patch(f"/v1/bookings/{booking_id}", json={"ends_at": longer}))
    assert await _blocks(db, booking_id) == [(PRIYA, _at(WEDNESDAY), _at(longer))]
    await db.execute(update(Item).where(Item.id == "it_shampoo").values(duration_min=15))
    await db.flush()
    ok(
        await as_owner.post(
            f"/v1/bookings/{booking_id}/addons", json={"item_id": "it_shampoo"}, headers=key()
        ),
        201,
    )
    assert await _blocks(db, booking_id) == [(PRIYA, *await _window(db, booking_id))]
    ok(await as_owner.patch(f"/v1/bookings/{booking_id}", json={"staff_id": OWNER}))
    assert [b[0] for b in await _blocks(db, booking_id)] == [PRIYA]
    ok(await as_owner.patch(f"/v1/bookings/{booking_id}", json={"status": "canceled"}))
    assert await _blocks(db, booking_id) == []


async def test_a_move_the_helper_cannot_follow_is_refused(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking_id = await _visit(as_owner, db)
    ok(await _add(as_owner, booking_id), 201)
    await _visit(as_owner, db, PRIYA, WEDNESDAY)
    before = await _blocks(db, booking_id)
    verdict = ok(
        await as_owner.post(f"/v1/bookings/{booking_id}/check", json={"starts_at": WEDNESDAY})
    ).json()
    assert verdict["ok"] is False and verdict["problem"] == "crew"
    refused = await as_owner.patch(f"/v1/bookings/{booking_id}", json={"starts_at": WEDNESDAY})
    assert refused.status_code == 409 and refused.json()["error"] == "crew_busy"
    assert await _blocks(db, booking_id) == before


async def test_completion_keeps_the_blocks_and_time_off_cannot_drop_them(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking_id = await _visit(as_owner, db, DIEGO, "2026-10-13T16:00:00Z")
    clock.travel(_at("2026-10-13T15:00:00Z"))
    ok(await _add(as_owner, booking_id), 201)
    clock.travel(FROZEN)
    ok(await as_owner.patch(f"/v1/bookings/{booking_id}", json={"status": "completed"}))
    assert len(await _blocks(db, booking_id)) == 1
    block = (
        await db.execute(select(Hours.id).where(Hours.note == f"booking:{booking_id}"))
    ).scalar_one()
    refused = await as_owner.delete(f"/v1/time-off/{block}")
    assert refused.status_code == 409 and refused.json()["error"] == "crew_block"
    assert len(await _blocks(db, booking_id)) == 1


async def test_the_client_moves_the_visit_only_where_the_helper_can_follow(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking_id = await _visit(as_owner, db)
    ok(await _add(as_owner, booking_id), 201)
    token = await db.get(Booking, booking_id)
    assert token is not None and token.manage_token is not None
    manage = f"/manage/{token.manage_token}"
    await _visit(as_owner, db, PRIYA, WEDNESDAY)
    slots = ok(await as_owner.get(f"{manage}/slots", params={"date": "2026-12-02"})).json()
    starts = [_at(s["starts_at"]) for s in slots["slots"]]
    assert starts and _at(WEDNESDAY) not in starts
    target = starts[0]
    blocked = await as_owner.post(
        f"{manage}/reschedule", json={"starts_at": WEDNESDAY}, headers=key()
    )
    assert blocked.status_code == 409
    ok(
        await as_owner.post(
            f"{manage}/reschedule", json={"starts_at": target.isoformat()}, headers=key()
        )
    )
    assert await _blocks(db, booking_id) == [(PRIYA, *await _window(db, booking_id))]
    ok(await as_owner.post(f"{manage}/cancel", headers=key()))
    assert await _blocks(db, booking_id) == []


async def test_a_series_change_and_cancel_carry_the_crew(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    series = ok(
        await as_owner.post(
            "/v1/recurrences",
            json={
                "client_id": await client_id(db),
                "item_id": GROOM,
                "staff_id": DIEGO,
                "starts_at": "2026-12-01T17:00:00Z",
                "frequency": "week",
                "count": 2,
                "confirmation": "none",
            },
        ),
        201,
    ).json()
    first, second = (o["booking_id"] for o in series["occurrences"])
    ok(await _add(as_owner, first), 201)
    ok(await _add(as_owner, second), 201)
    await _visit(as_owner, db, PRIYA, "2026-12-08T18:30:00Z")
    changed = ok(
        await as_owner.patch(
            f"/v1/recurrences/{series['id']}", json={"scope": "all", "time": "11:00"}
        )
    ).json()
    assert changed["moved"] == [first]
    assert [s["booking_id"] for s in changed["skipped"]] == [second]
    assert await _blocks(db, first) == [(PRIYA, *await _window(db, first))]
    assert await _blocks(db, second) == [(PRIYA, *await _window(db, second))]
    ok(await as_owner.post(f"/v1/recurrences/{series['id']}/cancel", json={}))
    assert await _blocks(db, first) == [] and await _blocks(db, second) == []


async def test_a_member_who_leaves_comes_off_the_crews_ahead(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking_id = await _visit(as_owner, db)
    ok(await _add(as_owner, booking_id), 201)
    ok(await as_owner.post(f"/v1/staff/{PRIYA}/remove", json={"future": "cancel"}, headers=key()))
    assert await _blocks(db, booking_id) == []


async def test_each_crew_member_earns_an_even_share_at_their_own_rate(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(
        update(Staff)
        .where(Staff.id == PRIYA)
        .values(payee=True, rate_type="percent", rate_bps=5000, rate_cents=None)
    )
    await db.flush()
    booking_id = await _visit(as_owner, db)
    ok(await _add(as_owner, booking_id), 201)
    draft = ok(
        await as_owner.post(f"/v1/invoices/from-booking/{booking_id}", headers=key()), 201
    ).json()
    invoice = await db.get(Invoice, draft["id"])
    assert invoice is not None
    await ensure_earnings(db, invoice)
    shares: dict[str, int] = {}
    for journal in await earnings(db, "booking", booking_id):
        earning = await load_earning(db, BIZ, journal)
        assert earning is not None
        shares[earning.staff_id] = earning.amount_cents
    # a $75 visit in two even shares: Diego at 45% and Priya at 50%
    assert shares == {DIEGO: round(3750 * 0.45), PRIYA: 1875}
    lines = list(await db.scalars(select(Line).where(Line.invoice_id == invoice.id)))
    tip = await resolve_tip(db, BIZ, 1001, None, lines, OWNER)
    assert dict(tip.split) == {DIEGO: 501, PRIYA: 500}


async def test_a_helper_s_pending_earning_is_reversed_after_they_leave_the_crew(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(
        update(Staff)
        .where(Staff.id == PRIYA)
        .values(payee=True, rate_type="percent", rate_bps=5000, rate_cents=None)
    )
    await db.flush()
    booking_id = await _visit(as_owner, db)
    ok(await _add(as_owner, booking_id), 201)
    draft = ok(
        await as_owner.post(f"/v1/invoices/from-booking/{booking_id}", headers=key()), 201
    ).json()
    invoice = await db.get(Invoice, draft["id"])
    assert invoice is not None
    await ensure_earnings(db, invoice)
    ok(await as_owner.delete(f"/v1/bookings/{booking_id}/crew/{PRIYA}"))
    await reverse_earnings(db, invoice)
    statuses: dict[str, str] = {}
    for journal in await earnings(db, "booking", booking_id):
        earning = await load_earning(db, BIZ, journal)
        if earning is not None:
            statuses[earning.staff_id] = earning.status
    assert statuses == {DIEGO: "reversed", PRIYA: "reversed"}


async def test_another_business_s_visit_is_out_of_reach(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    lead = await factory.staff(business=other, role="staff")
    client = await factory.client(business=other)
    db.add(
        Item(id="it_rival_cut", business_id=other.id, kind="service", name="Cut", duration_min=60)
    )
    slot = Slot(
        id=new_id("slot"),
        business_id=other.id,
        item_id="it_rival_cut",
        staff_id=lead.id,
        starts_at=datetime(2026, 12, 1, 16, tzinfo=UTC),
        ends_at=datetime(2026, 12, 1, 17, tzinfo=UTC),
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
        staff_id=lead.id,
        client_id=client.id,
        status="confirmed",
        source="manual",
    )
    db.add(booking)
    await db.flush()
    assert (await as_owner.get(f"/v1/bookings/{booking.id}/crew")).status_code == 404
    assert (await _add(as_owner, booking.id)).status_code == 404
    assert (await as_owner.delete(f"/v1/bookings/{booking.id}/crew/{PRIYA}")).status_code == 404


async def _audits(db: AsyncSession, booking_id: str, action: str) -> int:
    rows = await db.scalars(
        select(Audit.id).where(Audit.entity_id == booking_id, Audit.action == action)
    )
    return len(rows.all())


async def test_a_key_replays_a_crew_change_once_and_only_for_the_same_member(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking_id = await _visit(as_owner, db)
    url = f"/v1/bookings/{booking_id}/crew"
    adding = key()
    first = ok(await as_owner.post(url, json={"staff_id": PRIYA}, headers=adding), 201).json()
    assert ok(await as_owner.post(url, json={"staff_id": PRIYA}, headers=adding), 201).json() == (
        first
    )
    other = await as_owner.post(url, json={"staff_id": OWNER}, headers=adding)
    assert other.status_code == 422 and other.json()["error"] == "idempotency_key_reused"
    assert await _audits(db, booking_id, "booking.crew_add") == 1
    removing = key()
    removed = ok(await as_owner.delete(f"{url}/{PRIYA}", headers=removing)).json()
    assert ok(await as_owner.delete(f"{url}/{PRIYA}", headers=removing)).json() == removed
    assert removed["members"] == []
    elsewhere = await as_owner.delete(f"{url}/{OWNER}", headers=removing)
    assert elsewhere.status_code == 422 and elsewhere.json()["error"] == "idempotency_key_reused"
    assert (await as_owner.delete(f"{url}/{PRIYA}", headers=key())).status_code == 404
    assert await _audits(db, booking_id, "booking.crew_remove") == 1
    assert await _blocks(db, booking_id) == []


async def test_a_started_visit_takes_no_new_helper(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking_id = await _visit(as_owner, db)
    ok(await _add(as_owner, booking_id, OWNER), 201)
    clock.travel(_at(OPENING) + timedelta(minutes=10))
    late = await _add(as_owner, booking_id)
    assert late.status_code == 409 and late.json()["error"] == "visit_started"
    assert [b[0] for b in await _blocks(db, booking_id)] == [OWNER]
    ok(await as_owner.delete(f"/v1/bookings/{booking_id}/crew/{OWNER}", headers=key()))
    assert await _blocks(db, booking_id) == []


async def test_documents_name_every_member_of_the_crew(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    names = await staff_names(db, BIZ, [DIEGO, PRIYA])
    crew = [name for name in (names.get(DIEGO), names.get(PRIYA)) if name is not None]
    assert len(crew) == 2
    billed = await _visit(as_owner, db)
    ok(await _add(as_owner, billed), 201)
    draft = ok(await as_owner.post(f"/v1/invoices/from-booking/{billed}", headers=key()), 201)
    invoice = ok(await as_owner.post(f"/v1/invoices/{draft.json()['id']}/send")).json()
    pay = ok(await as_owner.get(f"/pay/{invoice['pay_token']}")).json()
    assert pay["tip_for"] == [n.split()[0] for n in crew]
    ok(
        await as_owner.post(
            f"/v1/invoices/{invoice['id']}/payments",
            json={"method": "cash", "amount_cents": invoice["total_cents"]},
            headers=key(),
        ),
        201,
    )
    receipt = ok(await as_owner.get(f"/v1/bookings/{billed}/receipt")).json()
    assert receipt["served_by"] == crew and receipt["practitioner"] == names[DIEGO]
    sold = await _visit(as_owner, db, starts=WEDNESDAY)
    ok(await _add(as_owner, sold), 201)
    line = {"description": "Groom", "unit_amount_cents": 7500, "booking_id": sold}
    sale = ok(
        await as_owner.post("/v1/orders", json={"client_id": await client_id(db), "lines": [line]}),
        201,
    ).json()
    ok(
        await as_owner.post(
            f"/v1/orders/{sale['id']}/cash",
            json={"tendered_cents": sale["due_cents"]},
            headers=key(),
        )
    )
    desk = ok(await as_owner.get(f"/v1/bookings/{sold}/receipt")).json()
    assert desk["source"] == "sale" and desk["served_by"] == crew
