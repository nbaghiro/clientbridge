from pathlib import Path

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.billing import Order
from clientbridge.models.scheduling import Booking
from clientbridge.services import ledger
from tests.conftest import Factory, FakeEmailSender, FakeSmsSender
from tests.helpers import client_id, key, ok

BRUSH = {"description": "Brush", "unit_amount_cents": 2900, "tax_class": "standard"}


async def _cash(api: httpx.AsyncClient, order_id: str, tendered: int) -> dict[str, object]:
    res = await api.post(
        f"/v1/orders/{order_id}/cash", json={"tendered_cents": tendered}, headers=key()
    )
    return {"status": res.status_code, **(res.json() if res.status_code < 500 else {})}


async def test_cash_pays_the_sale_and_gives_change(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    sale = ok(await as_staff.post("/v1/orders", json={"lines": [BRUSH]}), 201).json()
    short = await _cash(as_staff, sale["id"], 100)
    assert short["status"] == 422
    paid = await _cash(as_staff, sale["id"], 5000)
    assert (paid["status"], paid["change_cents"]) == (200, 5000 - sale["total_cents"])
    order = await db.get(Order, sale["id"], populate_existing=True)
    assert order is not None and (await ledger.order_state(db, order))[0] == "paid"
    assert (
        await ledger.balance(
            db, "bz_birchbark", owner_type="business", owner_id="bz_birchbark", category="cash"
        )
        >= sale["total_cents"]
    )
    again = await _cash(as_staff, sale["id"], 5000)
    assert again["status"] == 409


async def test_cash_is_idempotent(as_owner: httpx.AsyncClient) -> None:
    sale = ok(await as_owner.post("/v1/orders", json={"lines": [BRUSH]}), 201).json()
    headers = key()
    body = {"tendered_cents": 4000}
    first = ok(await as_owner.post(f"/v1/orders/{sale['id']}/cash", json=body, headers=headers))
    retry = ok(await as_owner.post(f"/v1/orders/{sale['id']}/cash", json=body, headers=headers))
    assert retry.json()["payment_id"] == first.json()["payment_id"]


async def test_cash_needs_a_login_and_a_sale_of_this_business(
    unauth: httpx.AsyncClient, factory: Factory, db: AsyncSession
) -> None:
    assert (
        await unauth.post("/v1/orders/ord_x/cash", json={"tendered_cents": 1})
    ).status_code == 401


async def test_another_business_sale_is_not_found(
    as_owner: httpx.AsyncClient, factory: Factory, db: AsyncSession
) -> None:
    other = await factory.business()
    owner = await factory.staff(business=other, role="owner")
    order = Order(id=new_id("order"), business_id=other.id, staff_id=owner.id, status="open")
    db.add(order)
    await db.flush()
    for path, body in (
        ("cash", {"tendered_cents": 100}),
        ("receipt", {"channel": "email", "to": "a@b.ca"}),
        ("pay", {}),
    ):
        res = await as_owner.post(f"/v1/orders/{order.id}/{path}", json=body, headers=key())
        assert res.status_code == 404, path


async def test_a_visit_on_the_sale_carries_its_deposit_and_reads_charged(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking = (
        await db.execute(select(Booking).where(Booking.deposit_status == "collected").limit(1))
    ).scalar_one()
    held = await ledger.deposit_held(db, booking)
    assert held > 0
    line = {
        "description": "Visit",
        "unit_amount_cents": 5000,
        "tax_class": "federal_only",
        "booking_id": booking.id,
        "staff_id": booking.staff_id,
    }
    sale = ok(
        await as_owner.post("/v1/orders", json={"client_id": booking.client_id, "lines": [line]}),
        201,
    ).json()
    assert sale["deposit_cents"] == held
    assert sale["due_cents"] == sale["total_cents"] - held
    linked = await db.get(Booking, booking.id, populate_existing=True)
    assert linked is not None and linked.order_id == sale["id"]
    twice = await as_owner.post("/v1/orders", json={"lines": [line]})
    assert twice.status_code == 409
    paid = await _cash(as_owner, sale["id"], sale["due_cents"])
    assert (paid["status"], paid["amount_cents"]) == (200, sale["total_cents"] - held)
    order = await db.get(Order, sale["id"], populate_existing=True)
    assert order is not None and (await ledger.order_state(db, order))[0] == "paid"
    assert await ledger.order_deposit_applied(db, order) == held
    charged = await db.get(Booking, booking.id, populate_existing=True)
    assert charged is not None and charged.charged_at is not None
    assert charged.deposit_status == "applied"
    assert await ledger.deposit_held(db, charged) == 0


async def test_voiding_a_sale_frees_its_visit(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking = (await db.execute(select(Booking).limit(1))).scalar_one()
    line = {"description": "Visit", "unit_amount_cents": 4000, "booking_id": booking.id}
    sale = ok(await as_owner.post("/v1/orders", json={"lines": [line]}), 201).json()
    ok(await as_owner.post(f"/v1/orders/{sale['id']}/void"))
    freed = await db.get(Booking, booking.id, populate_existing=True)
    assert freed is not None and freed.order_id is None


async def test_held_sales_list_open_desk_tickets_with_their_note(
    as_staff: httpx.AsyncClient,
) -> None:
    sale = ok(
        await as_staff.post("/v1/orders", json={"lines": [BRUSH], "note": "Back after lunch"}),
        201,
    ).json()
    held = ok(await as_staff.get("/v1/orders/held")).json()
    mine = next(o for o in held if o["id"] == sale["id"])
    assert (mine["note"], mine["number"]) == ("Back after lunch", sale["number"])
    ok(
        await as_staff.post(
            f"/v1/orders/{sale['id']}/cash", json={"tendered_cents": 9000}, headers=key()
        )
    )
    assert sale["id"] not in [o["id"] for o in ok(await as_staff.get("/v1/orders/held")).json()]


async def test_receipt_by_email_or_text_after_payment(
    as_owner: httpx.AsyncClient,
    unauth: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
) -> None:
    cid = await client_id(db)
    sale = ok(
        await as_owner.post(
            "/v1/orders",
            json={
                "client_id": cid,
                "lines": [{**BRUSH, "staff_id": "st_diego"}],
                "discount": {"kind": "amount", "value": 400, "reason": "Scuffed box"},
            },
        ),
        201,
    ).json()
    early = await as_owner.post(
        f"/v1/orders/{sale['id']}/receipt", json={"channel": "email", "to": "a@b.ca"}
    )
    assert early.status_code == 409
    ok(
        await as_owner.post(
            f"/v1/orders/{sale['id']}/cash",
            json={"tendered_cents": 5000, "tip_cents": 200},
            headers=key(),
        )
    )
    bad = await as_owner.post(
        f"/v1/orders/{sale['id']}/receipt", json={"channel": "email", "to": "nope"}
    )
    assert bad.status_code == 422
    sent = ok(
        await as_owner.post(
            f"/v1/orders/{sale['id']}/receipt", json={"channel": "email", "to": "pat@example.ca"}
        )
    ).json()
    assert (sent["receipt_channel"], sent["receipt_email"]) == ("email", "pat@example.ca")
    mail = next(e for e in email.sent if e.to == "pat@example.ca")
    token = mail.body.rsplit("/r/", 1)[1].strip()
    ok(
        await as_owner.post(
            f"/v1/orders/{sale['id']}/receipt", json={"channel": "sms", "to": "(250) 555-0101"}
        )
    )
    assert any("/r/" in s.body for s in sms.sent)
    page = ok(await unauth.get(f"/receipt/{token}")).json()
    assert page["number"] == sale["number"]
    assert page["served_by"] == ["Diego Alvarez"] or len(page["served_by"]) == 1
    assert (page["discount_cents"], page["discount_reason"]) == (400, "Scuffed box")
    assert page["tip_cents"] == 200
    assert page["payments"][0]["method"] == "cash"
    assert (await unauth.get("/receipt/missing")).status_code == 404


async def test_a_paid_online_order_joins_the_pickup_queue_only_once_paid(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    order = await db.get(Order, "ord_web", populate_existing=True)
    assert order is not None and order.pickup_status is not None
    unpaid = (
        (
            await db.execute(
                select(Order).where(
                    Order.source == "online",
                    Order.pickup_status.is_(None),
                    Order.picked_up_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    for row in unpaid:
        assert (await ledger.order_state(db, row))[0] != "paid"
    refused = await as_staff.post("/v1/orders/ord_none/pickup", json={"status": "ready"})
    assert refused.status_code == 404


def test_staff_read_pickup_orders_and_lines_without_money() -> None:
    rules = (Path(__file__).resolve().parents[2] / "infra/powersync/sync-rules.yaml").read_text()
    staff = rules.split("staff_limited:")[1].split("staff_self:")[0]
    picked = [ln for ln in staff.splitlines() if "FROM orders" in ln or "FROM lines" in ln]
    assert len(picked) == 2
    for rule in picked:
        assert "cents" not in rule and "*" not in rule
    assert "pickup_status IS NOT NULL" in picked[0] and "for_pickup = true" in picked[1]
