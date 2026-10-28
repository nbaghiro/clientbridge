"""Approving and paying several staff earnings in one command, all or none."""

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import timedelta
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import Connection, event, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.db import engine
from clientbridge.core.ids import new_id
from clientbridge.models.business import Business, Staff
from clientbridge.models.ledger import Entry
from clientbridge.services import ledger
from clientbridge.services.earnings import load_earning
from clientbridge.services.ledger import Leg
from tests.conftest import BIZ, Factory, FakeIdentityProvider, session_token
from tests.helpers import key


async def _earning(
    db: AsyncSession, *, business_id: str = BIZ, staff_id: str = "st_diego", cents: int = 4000
) -> str:
    journal = await ledger.post(
        db,
        business_id,
        event="earning",
        ref=f"earning:{new_id('booking')}:0",
        legs=[
            Leg("business", business_id, "staff_cost", cents),
            Leg("staff", staff_id, "payable", -cents, "pending"),
        ],
        subject=("booking", new_id("booking")),
    )
    assert journal is not None
    return journal


async def _status(db: AsyncSession, journal: str, business_id: str = BIZ) -> str:
    earning = await load_earning(db, business_id, journal)
    assert earning is not None
    return earning.status


async def test_approve_then_pay_several(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    ids = [await _earning(db), await _earning(db, cents=2500)]
    approved = await as_owner.post("/v1/earnings/approve", json={"ids": ids})
    assert approved.status_code == 200, approved.text
    assert [e["status"] for e in approved.json()["earnings"]] == ["approved", "approved"]
    paid = await as_owner.post("/v1/earnings/pay", json={"ids": ids})
    assert paid.status_code == 200, paid.text
    assert {e["amount_cents"] for e in paid.json()["earnings"]} == {4000, 2500}
    assert [await _status(db, i) for i in ids] == ["paid", "paid"]


async def test_one_not_ready_moves_none_409(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    ready, done = await _earning(db), await _earning(db)
    for path in ("approve", "pay"):
        assert (
            await as_owner.post(f"/v1/earnings/{path}", json={"ids": [done]})
        ).status_code == 200
    assert (await as_owner.post("/v1/earnings/approve", json={"ids": [ready]})).status_code == 200
    res = await as_owner.post("/v1/earnings/pay", json={"ids": [ready, done]})
    assert res.status_code == 409
    assert res.json()["error"] == "earning_moved"
    assert await _status(db, ready) == "approved"
    assert await _status(db, done) == "paid"


async def test_empty_list_422(as_owner: httpx.AsyncClient) -> None:
    assert (await as_owner.post("/v1/earnings/approve", json={"ids": []})).status_code == 422


async def test_unknown_earning_404(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    journal = await _earning(db)
    res = await as_owner.post("/v1/earnings/approve", json={"ids": [journal, "jrn_missing"]})
    assert res.status_code == 404
    assert await _status(db, journal) == "pending"


async def test_other_business_earning_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    staff = await factory.staff(business=other)
    journal = await _earning(db, business_id=other.id, staff_id=staff.id)
    assert (await as_owner.post("/v1/earnings/approve", json={"ids": [journal]})).status_code == 404
    assert await _status(db, journal, other.id) == "pending"


async def test_staff_cannot_approve_403(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    journal = await _earning(db)
    assert (await as_staff.post("/v1/earnings/approve", json={"ids": [journal]})).status_code == 403
    assert await _status(db, journal) == "pending"


async def test_unauthenticated_401(unauth: httpx.AsyncClient) -> None:
    assert (await unauth.post("/v1/earnings/pay", json={"ids": ["jrn_x"]})).status_code == 401


async def test_replayed_approval_posts_once(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    ids = [await _earning(db), await _earning(db)]
    headers = {"Idempotency-Key": "bulk-approve-1"}
    first = await as_owner.post("/v1/earnings/approve", json={"ids": ids}, headers=headers)
    again = await as_owner.post("/v1/earnings/approve", json={"ids": ids}, headers=headers)
    assert first.status_code == again.status_code == 200
    assert first.json() == again.json()
    assert await ledger.journal_for(db, BIZ, f"approval:{ids[0]}:0") is not None
    assert await ledger.journal_for(db, BIZ, f"approval:{ids[0]}:1") is None


async def test_repeated_ids_count_once(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    journal = await _earning(db)
    res = await as_owner.post("/v1/earnings/approve", json={"ids": [journal, journal]})
    assert res.status_code == 200
    assert len(res.json()["earnings"]) == 1


async def test_approving_twice_409(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    journal = await _earning(db)
    assert (await as_owner.post("/v1/earnings/approve", json={"ids": [journal]})).status_code == 200
    assert (await as_owner.post("/v1/earnings/approve", json={"ids": [journal]})).status_code == 409


async def test_paying_a_pending_earning_approves_it_on_the_way(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    journal = await _earning(db)
    res = await as_owner.post("/v1/earnings/pay", json={"ids": [journal], "through": "2026-10-10"})
    assert res.status_code == 200, res.text
    assert await _status(db, journal) == "paid"
    refs = await db.execute(
        select(Entry.event, Entry.meta)
        .where(Entry.source_id == journal, Entry.owner_type == "staff")
        .order_by(Entry.event)
    )
    stages = {event: meta for event, meta in refs.tuples().all()}
    assert set(stages) == {"approval", "staff_payment"}
    assert stages["staff_payment"]["through"] == "2026-10-10"
    assert str(stages["staff_payment"]["run"]).startswith("prun_")


async def test_one_pay_shares_a_run(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    ids = [await _earning(db), await _earning(db, cents=100)]
    assert (await as_owner.post("/v1/earnings/pay", json={"ids": ids})).status_code == 200
    runs = await db.execute(
        select(Entry.meta["run"].astext)
        .where(Entry.source_id.in_(ids), Entry.event == "staff_payment")
        .distinct()
    )
    assert len(runs.scalars().all()) == 1


async def test_a_pay_that_comes_to_less_than_nothing_409(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    deduction = await _earning(db, cents=-500)
    await db.commit()  # a refused request rolls back; keep the setup
    res = await as_owner.post("/v1/earnings/pay", json={"ids": [deduction]})
    assert res.status_code == 409
    assert res.json()["error"] == "pay_negative"
    assert await _status(db, deduction) == "pending"
    earning = await _earning(db, cents=800)
    res = await as_owner.post("/v1/earnings/pay", json={"ids": [deduction, earning]})
    assert res.status_code == 200, res.text
    assert [await _status(db, i) for i in (deduction, earning)] == ["paid", "paid"]


async def test_staff_cannot_pay_403(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    journal = await _earning(db)
    await db.commit()  # a refused request rolls back; keep the setup
    assert (await as_staff.post("/v1/earnings/pay", json={"ids": [journal]})).status_code == 403
    assert await _status(db, journal) == "pending"


async def test_other_business_earning_cannot_be_paid_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    staff = await factory.staff(business=other)
    journal = await _earning(db, business_id=other.id, staff_id=staff.id)
    await db.commit()  # a refused request rolls back; keep the setup
    assert (await as_owner.post("/v1/earnings/pay", json={"ids": [journal]})).status_code == 404
    assert await _status(db, journal, other.id) == "pending"


async def test_replayed_payment_pays_once(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    ids = [await _earning(db), await _earning(db, cents=1500)]
    assert (await as_owner.post("/v1/earnings/approve", json={"ids": ids})).status_code == 200
    bank = await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category="bank")
    headers = {"Idempotency-Key": "bulk-pay-1"}
    first = await as_owner.post("/v1/earnings/pay", json={"ids": ids}, headers=headers)
    again = await as_owner.post("/v1/earnings/pay", json={"ids": ids}, headers=headers)
    assert first.status_code == again.status_code == 200
    assert first.json() == again.json()
    after = await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category="bank")
    assert after == bank - 5500


async def _bank(db: AsyncSession) -> int:
    return await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category="bank")


async def test_undo_pay_then_approval_and_move_forward_again(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    journal = await _earning(db)
    bank = await _bank(db)
    for path in ("approve", "pay"):
        assert (
            await as_owner.post(f"/v1/earnings/{path}", json={"ids": [journal]})
        ).status_code == 200
    unpaid = await as_owner.post("/v1/earnings/unpay", json={"ids": [journal]})
    assert unpaid.status_code == 200, unpaid.text
    assert unpaid.json()["earnings"][0]["status"] == "approved"
    assert await _bank(db) == bank
    unapproved = await as_owner.post("/v1/earnings/unapprove", json={"ids": [journal]})
    assert unapproved.status_code == 200, unapproved.text
    assert await _status(db, journal) == "pending"
    for path in ("approve", "pay"):
        assert (
            await as_owner.post(f"/v1/earnings/{path}", json={"ids": [journal]})
        ).status_code == 200
    assert await _status(db, journal) == "paid"
    assert await _bank(db) == bank - 4000


async def test_undo_needs_the_stage_it_undoes_409(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    journal = await _earning(db)
    assert (
        await as_owner.post("/v1/earnings/unapprove", json={"ids": [journal]})
    ).status_code == 409
    assert (await as_owner.post("/v1/earnings/approve", json={"ids": [journal]})).status_code == 200
    assert (await as_owner.post("/v1/earnings/unpay", json={"ids": [journal]})).status_code == 409
    assert (await as_owner.post("/v1/earnings/pay", json={"ids": [journal]})).status_code == 200
    assert (
        await as_owner.post("/v1/earnings/unapprove", json={"ids": [journal]})
    ).status_code == 409
    assert await _status(db, journal) == "paid"


async def test_staff_cannot_undo_403(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    journal = await _earning(db)
    for path in ("unapprove", "unpay"):
        assert (
            await as_staff.post(f"/v1/earnings/{path}", json={"ids": [journal]})
        ).status_code == 403


async def test_replayed_undo_pays_back_once(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    journal = await _earning(db)
    for path in ("approve", "pay"):
        assert (
            await as_owner.post(f"/v1/earnings/{path}", json={"ids": [journal]})
        ).status_code == 200
    bank = await _bank(db)
    headers = {"Idempotency-Key": "bulk-unpay-1"}
    first = await as_owner.post("/v1/earnings/unpay", json={"ids": [journal]}, headers=headers)
    again = await as_owner.post("/v1/earnings/unpay", json={"ids": [journal]}, headers=headers)
    assert first.status_code == again.status_code == 200
    assert await _bank(db) == bank + 4000


async def _t4a(as_owner: httpx.AsyncClient, staff_id: str) -> int:
    year = clock.today(ZoneInfo("America/Vancouver")).year
    res = await as_owner.get(f"/v1/reports/t4a.csv?year={year}")
    assert res.status_code == 200, res.text
    rows = [line.split(",") for line in res.text.splitlines()[1:]]
    return sum(int(row[-1]) for row in rows if row[0] == staff_id)


async def test_undone_pay_leaves_the_t4a(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await db.execute(update(Staff).where(Staff.id == "st_diego").values(role="contractor"))
    journal = await _earning(db, cents=7300)
    before = await _t4a(as_owner, "st_diego")
    for path in ("approve", "pay"):
        assert (
            await as_owner.post(f"/v1/earnings/{path}", json={"ids": [journal]})
        ).status_code == 200
    assert await _t4a(as_owner, "st_diego") == before + 7300
    assert (await as_owner.post("/v1/earnings/unpay", json={"ids": [journal]})).status_code == 200
    assert await _t4a(as_owner, "st_diego") == before


async def test_owner_adds_a_bonus_and_a_deduction(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    bonus = await as_owner.post(
        "/v1/earnings/adjustments",
        json={"staff_id": "st_diego", "amount_cents": 5000, "reason": " Holiday bonus "},
        headers=key(),
    )
    assert bonus.status_code == 201, bonus.text
    assert (bonus.json()["amount_cents"], bonus.json()["status"]) == (5000, "pending")
    deduction = await as_owner.post(
        "/v1/earnings/adjustments",
        json={"staff_id": "st_diego", "amount_cents": -2000, "reason": "Chair rent"},
        headers=key(),
    )
    assert deduction.json()["amount_cents"] == -2000
    ids = [bonus.json()["id"], deduction.json()["id"]]
    for path in ("approve", "pay"):
        assert (await as_owner.post(f"/v1/earnings/{path}", json={"ids": ids})).status_code == 200
    rows = await db.execute(
        select(Entry.meta).where(Entry.journal_id == ids[0], Entry.owner_type == "staff")
    )
    assert rows.scalar_one() == {"basis": "adjustment", "reason": "Holiday bonus"}


async def test_an_adjustment_needs_an_amount_and_a_reason_422(as_owner: httpx.AsyncClient) -> None:
    for body in (
        {"staff_id": "st_diego", "amount_cents": 0, "reason": "Nothing"},
        {"staff_id": "st_diego", "amount_cents": 100, "reason": "  "},
        {"staff_id": "st_diego", "amount_cents": 100_000_01, "reason": "Too much"},
    ):
        res = await as_owner.post("/v1/earnings/adjustments", json=body, headers=key())
        assert res.status_code == 422


async def test_an_adjustment_needs_an_idempotency_key_422(as_owner: httpx.AsyncClient) -> None:
    body = {"staff_id": "st_diego", "amount_cents": 100, "reason": "Bonus"}
    assert (await as_owner.post("/v1/earnings/adjustments", json=body)).status_code == 422


async def test_staff_cannot_add_an_adjustment_403(as_staff: httpx.AsyncClient) -> None:
    res = await as_staff.post(
        "/v1/earnings/adjustments",
        json={"staff_id": "st_diego", "amount_cents": 100, "reason": "x"},
        headers=key(),
    )
    assert res.status_code == 403


async def test_an_adjustment_for_another_business_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    staff = await factory.staff(business=other, role="staff")
    await db.commit()  # a refused request rolls back; keep the setup
    res = await as_owner.post(
        "/v1/earnings/adjustments",
        json={"staff_id": staff.id, "amount_cents": 100, "reason": "x"},
        headers=key(),
    )
    assert res.status_code == 404


async def test_a_replayed_adjustment_posts_once(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    body = {"staff_id": "st_diego", "amount_cents": 1234, "reason": "Training day"}
    headers = {"Idempotency-Key": "adjust-1"}
    first = await as_owner.post("/v1/earnings/adjustments", json=body, headers=headers)
    again = await as_owner.post("/v1/earnings/adjustments", json=body, headers=headers)
    assert first.status_code == again.status_code == 201
    assert first.json() == again.json()


async def _clawback(db: AsyncSession, of: str, cents: int) -> str:
    journal = await ledger.post(
        db,
        BIZ,
        event="earning",
        ref=f"earning:{of}:clawback:0",
        legs=[
            Leg("business", BIZ, "staff_cost", -cents),
            Leg("staff", "st_diego", "payable", cents, "pending"),
        ],
        meta={"basis": "clawback", "of": of},
    )
    assert journal is not None
    return journal


async def test_a_pay_settles_the_clawbacks_of_paid_earnings(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    paid = await _earning(db, cents=1000)
    assert (await as_owner.post("/v1/earnings/pay", json={"ids": [paid]})).status_code == 200
    back = await _clawback(db, paid, 400)
    waiting = await _earning(db, cents=900)
    later = await _clawback(db, waiting, 100)
    fresh = await _earning(db, cents=600)
    res = await as_owner.post("/v1/earnings/pay", json={"ids": [fresh]})
    assert res.status_code == 200, res.text
    assert sorted(e["id"] for e in res.json()["earnings"]) == sorted([fresh, back])
    assert await _status(db, back) == "paid"
    assert await _status(db, later) == "pending"  # it travels with its own earning


async def test_an_admin_cannot_move_or_adjust_their_own_pay_403(
    api: httpx.AsyncClient,
    db: AsyncSession,
    factory: Factory,
    identities: FakeIdentityProvider,
) -> None:
    biz = await db.get(Business, BIZ)
    assert biz is not None
    user = await factory.user()
    admin = await factory.staff(business=biz, user=user, role="admin")
    api.headers.update({"X-Session-Token": await session_token(identities, factory.db, user.id)})
    own = await _earning(db, staff_id=admin.id)
    other = await _earning(db)
    await db.commit()  # a refused request rolls back; keep the setup
    res = await api.post("/v1/earnings/approve", json={"ids": [own, other]})
    assert (res.status_code, res.json()["error"]) == (403, "own_pay")
    res = await api.post(
        "/v1/earnings/adjustments",
        json={"staff_id": admin.id, "amount_cents": 100, "reason": "Raise"},
        headers=key(),
    )
    assert res.status_code == 403
    assert (await api.post("/v1/earnings/approve", json={"ids": [other]})).status_code == 200


async def test_undo_needs_a_known_earning_of_this_business(
    as_owner: httpx.AsyncClient, unauth: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    staff = await factory.staff(business=other, role="staff")
    theirs = await _earning(db, business_id=other.id, staff_id=staff.id)
    await db.commit()  # a refused request rolls back; keep the setup
    for path in ("unapprove", "unpay"):
        for ids in (["ent_missing"], [theirs]):
            res = await as_owner.post(f"/v1/earnings/{path}", json={"ids": ids})
            assert res.status_code == 404, (path, ids)
    as_owner.headers.pop("X-Session-Token")
    assert (await unauth.post("/v1/earnings/unpay", json={"ids": [theirs]})).status_code == 401


async def test_an_undo_is_dated_when_it_is_made(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    journal = await _earning(db)
    assert (await as_owner.post("/v1/earnings/pay", json={"ids": [journal]})).status_code == 200
    start = clock.now()
    clock.travel(start + timedelta(days=90))
    try:
        assert (
            await as_owner.post("/v1/earnings/unpay", json={"ids": [journal]})
        ).status_code == 200
        dates = await db.execute(
            select(Entry.ref, Entry.occurred_at).where(
                Entry.source_id == journal,
                Entry.event == "staff_payment",
                Entry.owner_type == "staff",
            )
        )
        by_ref = dict(dates.tuples().all())
        assert by_ref[f"staff_payment:{journal}:0:undo"] - by_ref[f"staff_payment:{journal}:0"] >= (
            timedelta(days=89)
        )
    finally:
        clock.travel(start)


async def test_a_run_csv_nets_out_a_payment_undone_days_later(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    kept, undone = await _earning(db), await _earning(db, cents=1500)
    assert (
        await as_owner.post("/v1/earnings/pay", json={"ids": [kept, undone]})
    ).status_code == 200
    run = (
        await db.execute(
            select(Entry.meta["run"].astext)
            .where(Entry.source_id == kept, Entry.event == "staff_payment")
            .limit(1)
        )
    ).scalar_one()
    day = clock.now().astimezone(ZoneInfo("America/Vancouver")).date()
    start = clock.now()
    clock.travel(start + timedelta(days=3))
    try:
        assert (
            await as_owner.post("/v1/earnings/unpay", json={"ids": [undone]})
        ).status_code == 200
    finally:
        clock.travel(start)
    res = await as_owner.get(f"/v1/reports/staff-pay.csv?start={day}&end={day}&run={run}")
    assert res.status_code == 200, res.text
    rows = [line.split(",") for line in res.text.strip().splitlines()[1:]]
    assert sum(int(row[-1]) for row in rows) == 4000


async def test_a_fully_clawed_back_earning_settles_at_nothing(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    earning = await _earning(db)
    assert (await as_owner.post("/v1/earnings/approve", json={"ids": [earning]})).status_code == 200
    clawback = await ledger.post(
        db,
        BIZ,
        event="earning",
        ref=f"earning:{earning}:clawback:0",
        legs=[
            Leg("business", BIZ, "staff_cost", -4000),
            Leg("staff", "st_diego", "payable", 4000, "pending"),
        ],
        meta={"basis": "clawback", "of": earning},
    )
    assert clawback is not None
    bank = await _bank(db)
    res = await as_owner.post("/v1/earnings/pay", json={"ids": [earning]})
    assert res.status_code == 200, res.text
    assert [await _status(db, j) for j in (earning, clawback)] == ["paid", "paid"]
    assert await _bank(db) == bank


@contextmanager
def _counting() -> Iterator[list[str]]:
    seen: list[str] = []

    def count(_conn: Connection, _cursor: object, statement: str, *_: object) -> None:
        seen.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", count)
    try:
        yield seen
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", count)


async def _settled_clawbacks(as_owner: httpx.AsyncClient, db: AsyncSession, n: int) -> None:
    for _ in range(n):
        earning = await _earning(db, cents=200)
        await ledger.post(
            db,
            BIZ,
            event="earning",
            ref=f"earning:{earning}:clawback:0",
            legs=[
                Leg("business", BIZ, "staff_cost", -100),
                Leg("staff", "st_diego", "payable", 100, "pending"),
            ],
            meta={"basis": "clawback", "of": earning},
        )
        assert (await as_owner.post("/v1/earnings/pay", json={"ids": [earning]})).status_code == 200


async def _pay_queries(as_owner: httpx.AsyncClient, db: AsyncSession) -> int:
    earning = await _earning(db)
    with _counting() as seen:
        res = await as_owner.post("/v1/earnings/pay", json={"ids": [earning]})
    assert res.status_code == 200, res.text
    return len(seen)


async def test_a_pay_reads_as_much_however_long_the_history(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _settled_clawbacks(as_owner, db, 2)
    short = await _pay_queries(as_owner, db)
    await _settled_clawbacks(as_owner, db, 10)
    assert await _pay_queries(as_owner, db) == short
