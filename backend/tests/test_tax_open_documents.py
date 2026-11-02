"""Drafts and unaccepted estimates follow the tax settings; issued documents never do."""

import asyncio
from datetime import UTC, date, datetime

import httpx
import pytest
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.db import SessionLocal
from clientbridge.core.ids import new_id
from clientbridge.models.billing import Estimate, Invoice, Line, Order
from clientbridge.models.business import Business
from clientbridge.models.catalog import GiftCard, Item
from clientbridge.models.ledger import Account, Entry
from clientbridge.models.payments import Payment
from clientbridge.models.platform import Audit
from clientbridge.services import billing, ledger
from clientbridge.services.billing import run_reprice_open_documents
from clientbridge.services.ledger import Leg
from tests.conftest import BIZ, OWNER_USER, Factory
from tests.helpers import client_id, enable_payments, key, ok

SHAMPOO = {"description": "Shampoo", "item_id": "it_shampoo", "unit_amount_cents": 2400}
SLUG = "birchbark"
MIDNIGHT_OCT_20_VANCOUVER = datetime(2026, 10, 20, 7, tzinfo=UTC)
NOON_OCT_20_VANCOUVER = datetime(2026, 10, 20, 19, tzinfo=UTC)


async def _documents(api: httpx.AsyncClient, db: AsyncSession) -> tuple[str, str, str, str]:
    cid = await client_id(db)
    body = {"client_id": cid, "lines": [SHAMPOO]}
    draft = ok(await api.post("/v1/invoices", json=body), 201).json()["id"]
    estimate = ok(await api.post("/v1/estimates", json=body), 201).json()["id"]
    sent_estimate = ok(await api.post("/v1/estimates", json={**body, "send": True}), 201).json()
    issued = ok(await api.post("/v1/invoices", json={**body, "send": True}), 201).json()["id"]
    assert sent_estimate["status"] == "sent"
    return draft, estimate, sent_estimate["id"], issued


async def _total(db: AsyncSession, model: type[Invoice] | type[Estimate], row_id: str) -> int:
    row = await db.get_one(model, row_id, populate_existing=True)
    return row.total_cents


async def _tax_ledger(db: AsyncSession) -> int:
    rows = await db.execute(
        select(Entry.amount_cents)
        .join(Account, Account.id == Entry.account_id)
        .where(Account.category == "tax", Account.business_id == BIZ)
    )
    return sum(rows.scalars().all())


async def test_open_documents_follow_registration_and_issued_invoices_keep_their_tax(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    draft, estimate, sent_estimate, issued = await _documents(as_owner, db)
    off = await as_owner.patch("/v1/business", json={"tax_registered": False}, headers=key())
    ok(off)
    assert await _total(db, Invoice, draft) == 2400
    assert await _total(db, Estimate, estimate) == 2400
    assert await _total(db, Estimate, sent_estimate) == 2400
    assert await _total(db, Invoice, issued) == 2688
    line = (await db.execute(select(Line).where(Line.invoice_id == draft))).scalar_one()
    assert line.tax_amount_cents == 0
    audit = (
        await db.execute(
            select(Audit).where(Audit.entity_id == draft, Audit.action == "invoice.repriced")
        )
    ).scalar_one()
    assert audit.changes == {"old": 2688, "new": 2400}
    assert (
        await db.execute(
            select(Audit).where(Audit.business_id == BIZ, Audit.action == "business.tax_registered")
        )
    ).scalar_one().changes == {"old": True, "new": False}

    ok(await as_owner.patch("/v1/business", json={"tax_registered": True}, headers=key()))
    assert await _total(db, Invoice, draft) == 2688
    assert await _total(db, Estimate, sent_estimate) == 2688
    assert await _total(db, Invoice, issued) == 2688


async def test_staff_and_client_see_the_same_sent_estimate_total(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await client_id(db)
    sent = ok(
        await as_owner.post(
            "/v1/estimates", json={"client_id": cid, "lines": [SHAMPOO], "send": True}
        ),
        201,
    ).json()
    ok(await as_owner.patch("/v1/business", json={"tax_registered": False}, headers=key()))
    page = ok(await as_owner.get(f"/estimate/{sent['view_token']}")).json()
    assert page["total_cents"] == await _total(db, Estimate, sent["id"]) == 2400


async def test_an_accepted_estimate_keeps_its_total(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await client_id(db)
    sent = ok(
        await as_owner.post(
            "/v1/estimates", json={"client_id": cid, "lines": [SHAMPOO], "send": True}
        ),
        201,
    ).json()
    ok(await as_owner.post(f"/estimate/{sent['view_token']}/accept", json={"line_ids": []}))
    ok(await as_owner.patch("/v1/business", json={"tax_registered": False}, headers=key()))
    assert await _total(db, Estimate, sent["id"]) == 2688


async def test_a_registration_date_reprices_open_documents(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    draft, _, sent_estimate, _ = await _documents(as_owner, db)
    later = {"tax_registered_on": "2026-10-20"}
    ok(await as_owner.patch("/v1/business", json=later, headers=key()))
    assert await _total(db, Invoice, draft) == 2400
    assert await _total(db, Estimate, sent_estimate) == 2400
    assert (
        await db.execute(
            select(Audit).where(
                Audit.business_id == BIZ, Audit.action == "business.tax_registered_on"
            )
        )
    ).scalar_one().changes == {"old": None, "new": "2026-10-20"}


async def test_the_nightly_job_applies_a_registration_date_that_starts_today(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    draft, _, sent_estimate, issued = await _documents(as_owner, db)
    later = {"tax_registered_on": "2026-10-20"}
    ok(await as_owner.patch("/v1/business", json=later, headers=key()))
    await run_reprice_open_documents(db, NOON_OCT_20_VANCOUVER)
    assert await _total(db, Invoice, draft) == 2400
    assert await run_reprice_open_documents(db, MIDNIGHT_OCT_20_VANCOUVER) >= 1
    assert await _total(db, Invoice, draft) == 2688
    assert await _total(db, Estimate, sent_estimate) == 2688
    assert await _total(db, Invoice, issued) == 2688
    audit = (
        (
            await db.execute(
                select(Audit)
                .where(Audit.entity_id == draft, Audit.action == "invoice.repriced")
                .order_by(Audit.created_at.desc(), Audit.id.desc())
            )
        )
        .scalars()
        .first()
    )
    assert audit is not None and audit.performed_by is None


async def test_changing_the_timezone_reprices_open_documents(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    clock.travel(datetime(2026, 10, 14, 5, tzinfo=UTC))
    draft, *_ = await _documents(as_owner, db)
    ok(
        await as_owner.patch(
            "/v1/business", json={"tax_registered_on": "2026-10-14"}, headers=key()
        )
    )
    assert await _total(db, Invoice, draft) == 2400
    ok(await as_owner.patch("/v1/business", json={"timezone": "America/Halifax"}, headers=key()))
    assert await _total(db, Invoice, draft) == 2688


async def test_a_slug_conflict_with_a_tax_change_is_a_conflict_and_changes_nothing(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    taken = await db.scalar(select(Business.slug).where(Business.id != BIZ).limit(1))
    res = await as_owner.patch(
        "/v1/business", json={"slug": taken, "tax_registered": False}, headers=key()
    )
    assert res.status_code == 409 and res.json()["error"] == "slug_taken"
    assert (await db.get_one(Business, BIZ, populate_existing=True)).tax_registered


async def test_public_pages_say_which_items_are_taxable(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(update(Item).where(Item.id == "it_shampoo").values(tax_class="exempt"))
    await db.flush()
    shop = (await api.get(f"/book/{SLUG}/shop")).json()
    by_id = {i["id"]: i["taxable"] for i in shop["items"]}
    assert by_id["it_shampoo"] is False and by_id["it_brush"] is True
    page = (await api.get(f"/book/{SLUG}/services")).json()
    assert all(s["taxable"] for s in page["services"])


async def _held_ticket(api: httpx.AsyncClient) -> dict[str, object]:
    return ok(await api.post("/v1/orders", json={"lines": [SHAMPOO]}), 201).json()


async def test_a_held_ticket_follows_the_settings_and_is_charged_the_new_total(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    held = await _held_ticket(as_owner)
    assert held["total_cents"] == 2688
    ok(await as_owner.patch("/v1/business", json={"tax_registered": False}, headers=key()))
    order = await db.get_one(Order, str(held["id"]), populate_existing=True)
    assert (order.tax_total_cents, order.total_cents) == (0, 2400)
    audit = (await db.execute(select(Audit).where(Audit.entity_id == order.id))).scalars().all()
    assert [a.changes for a in audit if a.action == "order.repriced"] == [
        {"old": 2688, "new": 2400}
    ]
    before = await _tax_ledger(db)
    paid = ok(
        await as_owner.post(
            f"/v1/orders/{order.id}/cash", json={"tendered_cents": 2400}, headers=key()
        )
    ).json()
    assert paid["amount_cents"] == 2400
    assert await _tax_ledger(db) == before


async def test_a_ticket_with_a_live_or_settled_payment_keeps_its_amount(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    charging = await _held_ticket(as_owner)
    ok(await as_owner.post(f"/v1/orders/{charging['id']}/pay", json={}))
    settled = await _held_ticket(as_owner)
    ok(
        await as_owner.post(
            f"/v1/orders/{settled['id']}/cash", json={"tendered_cents": 2688}, headers=key()
        )
    )
    ok(await as_owner.patch("/v1/business", json={"tax_registered": False}, headers=key()))
    assert (
        await db.get_one(Order, str(charging["id"]), populate_existing=True)
    ).total_cents == 2688
    assert (await db.get_one(Order, str(settled["id"]), populate_existing=True)).total_cents == 2688


async def _gift_card(db: AsyncSession) -> GiftCard:
    card = GiftCard(id=new_id("gift_card"), business_id=BIZ, code="TAXHOLD1", initial_cents=1000)
    card.status = "active"
    db.add(card)
    await db.flush()
    await ledger.post(
        db,
        BIZ,
        event="payment",
        ref=f"test:purchase:{card.id}",
        legs=[Leg("business", BIZ, "stripe", 1000), Leg("gift_card", card.id, "gift_card", -1000)],
        subject=("gift_card", card.id),
    )
    return card


async def test_a_ticket_with_a_gift_card_applied_keeps_its_amount(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    card = await _gift_card(db)
    held = await _held_ticket(as_owner)
    path = f"/v1/orders/{held['id']}/gift-card"
    ok(await as_owner.post(path, json={"code": card.code}, headers=key()))
    ok(await as_owner.patch("/v1/business", json={"tax_registered": False}, headers=key()))
    order = await db.get_one(Order, str(held["id"]), populate_existing=True)
    assert order.total_cents == 2688


async def test_a_ticket_whose_gift_card_came_off_follows_the_settings_again(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    card = await _gift_card(db)
    held = await _held_ticket(as_owner)
    path = f"/v1/orders/{held['id']}/gift-card"
    ok(await as_owner.post(path, json={"code": card.code}, headers=key()))
    ok(await as_owner.patch(f"/v1/orders/{held['id']}", json={"lines": [SHAMPOO]}))
    ok(await as_owner.patch("/v1/business", json={"tax_registered": False}, headers=key()))
    order = await db.get_one(Order, str(held["id"]), populate_existing=True)
    assert order.total_cents == 2400


async def test_a_held_ticket_is_charged_at_the_settings_in_force_when_it_is_paid(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    held = await _held_ticket(as_owner)
    await db.execute(update(Business).where(Business.id == BIZ).values(tax_registered=False))
    await db.flush()
    paid = ok(
        await as_owner.post(
            f"/v1/orders/{held['id']}/cash", json={"tendered_cents": 2400}, headers=key()
        )
    ).json()
    assert paid["amount_cents"] == 2400
    audit = (await db.execute(select(Audit).where(Audit.entity_id == held["id"]))).scalars()
    assert [a.changes for a in audit if a.action == "order.repriced"] == [
        {"old": 2688, "new": 2400}
    ]


async def test_a_ticket_held_before_a_registration_date_is_taxed_after_it(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    ok(
        await as_owner.patch(
            "/v1/business", json={"tax_registered_on": "2026-10-20"}, headers=key()
        )
    )
    held = await _held_ticket(as_owner)
    assert held["total_cents"] == 2400
    await run_reprice_open_documents(db, MIDNIGHT_OCT_20_VANCOUVER)
    assert (await db.get_one(Order, str(held["id"]), populate_existing=True)).total_cents == 2688


async def _sent_estimate(api: httpx.AsyncClient, db: AsyncSession) -> dict[str, str]:
    cid = await client_id(db)
    body = {"client_id": cid, "lines": [SHAMPOO], "send": True}
    return ok(await api.post("/v1/estimates", json=body), 201).json()


async def test_a_declined_estimate_shows_staff_and_the_client_its_stored_total(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    sent = await _sent_estimate(as_owner, db)
    ok(await as_owner.post(f"/estimate/{sent['view_token']}/decline", json={}))
    ok(await as_owner.patch("/v1/business", json={"tax_registered": False}, headers=key()))
    page = ok(await as_owner.get(f"/estimate/{sent['view_token']}")).json()
    assert page["total_cents"] == await _total(db, Estimate, sent["id"]) == 2688
    assert page["taxes"] != []


async def test_a_converted_estimate_stays_with_its_invoice(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    sent = await _sent_estimate(as_owner, db)
    converted = ok(await as_owner.post(f"/v1/estimates/{sent['id']}/convert"), 201).json()
    assert converted["total_cents"] == 2688
    ok(await as_owner.patch("/v1/business", json={"tax_registered": False}, headers=key()))
    page = ok(await as_owner.get(f"/estimate/{sent['view_token']}")).json()
    assert page["total_cents"] == await _total(db, Estimate, sent["id"]) == 2688


async def test_sending_a_draft_estimate_prices_it_at_todays_settings(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await client_id(db)
    draft = ok(
        await as_owner.post("/v1/estimates", json={"client_id": cid, "lines": [SHAMPOO]}), 201
    ).json()
    await db.execute(update(Business).where(Business.id == BIZ).values(tax_registered=False))
    await db.flush()
    sent = ok(await as_owner.post(f"/v1/estimates/{draft['id']}/send", headers=key())).json()
    assert sent["total_cents"] == 2400


async def test_the_nightly_job_skips_a_business_with_nothing_starting(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    draft, *_ = await _documents(as_owner, db)
    await db.execute(update(Invoice).where(Invoice.id == draft).values(total_cents=1))
    await db.flush()
    await run_reprice_open_documents(db, MIDNIGHT_OCT_20_VANCOUVER)
    assert await _total(db, Invoice, draft) == 1


async def test_the_nightly_job_catches_up_on_a_date_it_missed(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    draft, *_ = await _documents(as_owner, db)
    ok(
        await as_owner.patch(
            "/v1/business", json={"tax_registered_on": "2026-10-18"}, headers=key()
        )
    )
    await run_reprice_open_documents(db, MIDNIGHT_OCT_20_VANCOUVER)
    assert await _total(db, Invoice, draft) == 2688


async def _stale_ticket(db: AsyncSession, biz: str) -> str:
    order = Order(id=new_id("order"), business_id=biz, staff_id="st_owner", total_cents=1)
    db.add(order)
    await db.flush()
    db.add(
        Line(
            id=new_id("line"),
            business_id=biz,
            order_id=order.id,
            description="Shampoo",
            unit_amount_cents=2400,
            amount_cents=2400,
        )
    )
    await db.flush()
    return order.id


async def test_one_failure_doesnt_stop_the_nightly_job_for_other_businesses(
    db: AsyncSession, factory: Factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    first, failing, last = [await factory.business() for _ in range(3)]
    tickets: dict[str, str] = {}
    for business in (first, failing, last):
        business.tax_registered = True
        business.tax_registered_on = date(2026, 10, 20)
        tickets[business.id] = await _stale_ticket(db, business.id)
    real = billing.reprice_open_documents

    async def at_midnight(session: AsyncSession, now: datetime, hour: int) -> list[Business]:
        return [first, failing, last]

    async def flaky(
        session: AsyncSession, biz: str, performed_by: str | None, at: datetime | None = None
    ) -> None:
        if biz == failing.id:
            raise RuntimeError("boom")
        await real(session, biz, performed_by, at)

    monkeypatch.setattr(billing, "businesses_at_hour", at_midnight)
    monkeypatch.setattr(billing, "reprice_open_documents", flaky)
    assert await run_reprice_open_documents(db, MIDNIGHT_OCT_20_VANCOUVER) == 2
    totals = {
        biz: (await db.get_one(Order, order_id, populate_existing=True)).total_cents
        for biz, order_id in tickets.items()
    }
    assert totals == {first.id: 2688, failing.id: 1, last.id: 2688}


async def test_a_tax_change_leaves_other_businesses_documents_alone(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    other.tax_registered = True
    ticket = await _stale_ticket(db, other.id)
    ok(await as_owner.patch("/v1/business", json={"tax_registered": False}, headers=key()))
    assert (await db.get_one(Order, ticket, populate_existing=True)).total_cents == 1


async def test_a_card_charge_prices_the_ticket_at_the_settings_in_force(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    held = await _held_ticket(as_owner)
    await db.execute(update(Business).where(Business.id == BIZ).values(tax_registered=False))
    await db.flush()
    ok(await as_owner.post(f"/v1/orders/{held['id']}/pay", json={}))
    payment = (await db.execute(select(Payment).where(Payment.order_id == held["id"]))).scalar_one()
    assert payment.amount_cents == 2400


async def test_a_payment_started_while_a_reprice_waits_keeps_the_ticket_amount(
    db: AsyncSession,
) -> None:
    async with SessionLocal() as setup:
        order_id = await _stale_ticket(setup, BIZ)
        await setup.commit()
    locked = asyncio.Event()

    async def charge() -> None:
        async with SessionLocal() as session:
            await session.execute(select(Order.id).where(Order.id == order_id).with_for_update())
            locked.set()
            await asyncio.sleep(0.2)
            session.add(
                Payment(
                    id=new_id("payment"),
                    business_id=BIZ,
                    order_id=order_id,
                    kind="payment",
                    amount_cents=1,
                    method="card",
                    provider="stripe",
                    status="pending",
                )
            )
            await session.commit()

    async def reprice() -> None:
        await asyncio.wait_for(locked.wait(), 5)
        async with SessionLocal() as session:
            await billing.reprice_ticket(session, BIZ, order_id, OWNER_USER)
            await session.commit()

    try:
        await asyncio.gather(charge(), reprice())
        async with SessionLocal() as check:
            assert (await check.get_one(Order, order_id)).total_cents == 1
    finally:
        async with SessionLocal() as cleanup:
            await cleanup.execute(delete(Audit).where(Audit.entity_id == order_id))
            await cleanup.execute(delete(Payment).where(Payment.order_id == order_id))
            await cleanup.execute(delete(Line).where(Line.order_id == order_id))
            await cleanup.execute(delete(Order).where(Order.id == order_id))
            await cleanup.commit()
