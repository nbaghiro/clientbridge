"""Visits end to end: what is owed at check-in, then a package and a gift card at checkout."""

from datetime import timedelta

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.ids import new_id
from clientbridge.models.business import Staff
from clientbridge.models.catalog import GiftCard, Item, Package
from clientbridge.models.documents import Form
from clientbridge.models.platform import Audit
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.services import ledger
from clientbridge.services.ledger import Leg
from tests.conftest import BIZ
from tests.helpers import (
    booking,
    earning_status,
    earnings,
    enable_payments,
    gift_card,
    key,
    ok,
    settle,
)
from tests.helpers import package as load_package

MARCUS = "cl_marcus"
BATH = "it_bath"


async def _visit(db: AsyncSession, hours_ago: int) -> str:
    start = clock.now() - timedelta(days=500, hours=hours_ago)
    slot = Slot(
        id=new_id("slot"),
        business_id=BIZ,
        item_id=BATH,
        staff_id="st_owner",
        starts_at=start,
        ends_at=start + timedelta(hours=1),
        capacity=1,
        status="scheduled",
    )
    db.add(slot)
    await db.flush()
    row = Booking(
        id=new_id("booking"),
        business_id=BIZ,
        slot_id=slot.id,
        starts_at=start,
        staff_id="st_owner",
        client_id=MARCUS,
        status="confirmed",
        source="manual",
        price_cents=4500,
    )
    db.add(row)
    await db.flush()
    return row.id


async def _gift_card(db: AsyncSession, cents: int) -> GiftCard:
    card = GiftCard(id=new_id("gift_card"), business_id=BIZ, code="FLOWGIFT", initial_cents=cents)
    card.status = "active"
    db.add(card)
    await db.flush()
    await ledger.post(
        db,
        BIZ,
        event="payment",
        ref=f"test:purchase:{card.id}",
        legs=[
            Leg("business", BIZ, "stripe", cents),
            Leg("gift_card", card.id, "gift_card", -cents),
        ],
        subject=("gift_card", card.id),
    )
    return card


async def test_a_visit_is_checked_in_past_its_form_and_paid_with_gift_card_and_card(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    api = as_owner
    await enable_payments(db)
    await db.execute(
        update(Staff)
        .where(Staff.id == "st_owner")
        .values(payee=True, rate_type="percent", rate_bps=5000, rate_cents=None)
    )
    form = Form(id=new_id("form"), business_id=BIZ, name="Flow intake", send_on="booking")
    db.add(form)
    await db.flush()
    groom, covered = await _visit(db, hours_ago=3), await _visit(db, hours_ago=6)

    owed = ok(await api.get(f"/v1/bookings/{groom}/needs")).json()["needs"]
    assert {"kind": "form", "ref_id": form.id} in [
        {"kind": n["kind"], "ref_id": n["ref_id"]} for n in owed
    ]
    ok(await api.post(f"/v1/bookings/{groom}/check-in"))
    audit = (
        await db.execute(
            select(Audit.changes).where(
                Audit.entity_id == groom, Audit.action == "booking.check_in"
            )
        )
    ).scalar_one()
    outstanding = audit["outstanding"]
    assert isinstance(outstanding, list) and {"kind": "form", "ref_id": form.id} in outstanding

    await db.execute(update(Item).where(Item.id == "it_pkg5").values(covers_item_id=BATH))
    plan = Package(
        id=new_id("package"),
        business_id=BIZ,
        client_id=MARCUS,
        item_id="it_pkg5",
        sessions_total=5,
        status="active",
    )
    db.add(plan)
    await db.flush()
    ok(await api.post(f"/v1/packages/{plan.id}/cover", json={"booking_id": covered}, headers=key()))
    assert (await booking(db, covered)).status == "completed"
    assert await ledger.sessions_used(db, await load_package(db, plan.id)) == 1

    card = await _gift_card(db, 1000)
    line = {"description": "Bath", "unit_amount_cents": 4500, "booking_id": groom}
    sale = ok(await api.post("/v1/orders", json={"client_id": MARCUS, "lines": [line]}), 201).json()
    credited = ok(
        await api.post(
            f"/v1/orders/{sale['id']}/gift-card", json={"code": "FLOWGIFT"}, headers=key()
        )
    ).json()
    assert credited["gift_card_cents"] == 1000 and credited["status"] == "open"
    pay = ok(await api.post(f"/v1/orders/{sale['id']}/pay", json={})).json()
    await settle(api, db, pay["payment_id"])

    paid = await db.get(Booking, groom, populate_existing=True)
    assert paid is not None and paid.status == "completed" and paid.charged_at is not None
    assert await gift_card(db, card.id) == ("active", 0)
    [earning] = await earnings(db, "booking", groom)
    assert await earning_status(db, earning) == "pending"
