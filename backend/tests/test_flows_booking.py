"""Booking flows: an online booking from deposit to T4A, a no-show, and a recurring series."""

from datetime import datetime, timedelta
from itertools import pairwise

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from tests.flows import (
    SLUG,
    booking,
    business_balance,
    deposit_held,
    deposit_payment,
    earning_status,
    earnings,
    enable_payments,
    invoice,
    key,
    ok,
    settle,
)

GROOM_LG = "it_groom_lg"  # $110 service, 25% deposit
GROOM_SM = "it_groom_sm"
BRUSH = "it_brush"  # $29 product sold as an add-on
AMELIE = "cl_amelie"  # seeded client with a default saved card


async def test_online_booking_from_deposit_to_t4a(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    api = as_owner
    await enable_payments(db)
    pay = ok(
        await api.patch(
            "/v1/staff/st_owner/pay",
            json={"payee": True, "rate_type": "percent", "rate_bps": 4000},
        )
    ).json()
    assert pay["payee"] is True and pay["rate_type"] == "percent"

    # the client books online and is asked for the deposit
    booked = ok(
        await api.post(
            f"/book/{SLUG}",
            json={
                "item_id": GROOM_LG,
                "staff_id": "st_owner",
                "starts_at": "2027-03-02T17:00:00Z",
                "client": {"name": "Online Flow", "email": "online-flow@example.com"},
                "addons": [{"item_id": BRUSH, "quantity": 1}],
            },
        )
    ).json()
    bid = booked["booking_id"]
    assert booked["deposit_client_secret"]
    visit = await booking(db, bid)
    assert (visit.source, visit.deposit_amount_cents, visit.deposit_status) == (
        "online",
        2750,
        "pending",
    )

    # the deposit settles and is held against the booking
    deposit_id = await deposit_payment(db, bid)
    await settle(api, db, deposit_id)
    assert (await booking(db, bid)).deposit_status == "collected"
    assert await deposit_held(db, bid) == 2750

    # the visit happens and is invoiced with its add-on; sending applies the deposit
    done = ok(await api.patch(f"/v1/bookings/{bid}", json={"status": "completed"})).json()
    assert done["status"] == "completed"
    draft = ok(await api.post(f"/v1/invoices/from-booking/{bid}", headers=key()), 201).json()
    assert [(ln["booking_id"], ln["item_id"]) for ln in draft["lines"]] == [
        (bid, GROOM_LG),
        (None, BRUSH),
    ]
    assert draft["status"] == "draft" and draft["subtotal_cents"] == 11000 + 2900
    sent = ok(await api.post(f"/v1/invoices/{draft['id']}/send")).json()
    assert sent["status"] == "sent" and sent["number"] is not None
    assert (await booking(db, bid)).deposit_status == "applied"
    assert await deposit_held(db, bid) == 0
    opened = await invoice(db, draft["id"])
    assert opened.balance_cents == opened.total_cents - 2750
    assert opened.amount_paid_cents == 0

    # the client pays the rest
    intent = ok(await api.post(f"/v1/payments/invoice/{draft['id']}")).json()
    assert intent["amount_cents"] == opened.total_cents - 2750
    await settle(api, db, intent["payment_id"])
    paid = await invoice(db, draft["id"])
    assert (paid.status, paid.balance_cents) == ("paid", 0)
    assert paid.amount_paid_cents == opened.total_cents - 2750
    assert paid.paid_at is not None

    # the groomer's earning accrues once, then is approved and paid out
    [journal] = await earnings(db, "booking", bid)
    assert await earning_status(db, journal) == "pending"
    year = datetime.now().year
    before = {
        r["staff_id"]: r["total_cents"]
        for r in ok(await api.get(f"/v1/reports/t4a?year={year}")).json()
    }
    approved = ok(await api.post(f"/v1/earnings/{journal}/approve")).json()
    assert approved["amount_cents"] == 4400  # 40% of the $110 service line
    assert approved["booking_id"] == bid and approved["status"] == "approved"
    bank = await business_balance(db, "bank")
    assert ok(await api.post(f"/v1/earnings/{journal}/pay")).json()["status"] == "paid"
    assert await business_balance(db, "bank") == bank - 4400
    after = {
        r["staff_id"]: r["total_cents"]
        for r in ok(await api.get(f"/v1/reports/t4a?year={year}")).json()
    }
    assert after["st_owner"] - before.get("st_owner", 0) == 4400


async def test_no_show_forfeits_the_deposit(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    api = as_owner
    await enable_payments(db)
    item = ok(
        await api.post(
            "/v1/items",
            json={
                "kind": "service",
                "name": "Flow Deluxe",
                "price_cents": 12000,
                "duration_min": 60,
                "deposit_type": "fixed",
                "deposit_value": 2000,
            },
        ),
        201,
    ).json()
    created = ok(
        await api.post(
            "/v1/bookings",
            json={
                "client_id": AMELIE,
                "item_id": item["id"],
                "staff_id": "st_priya",
                "starts_at": "2027-06-08T10:00:00Z",
            },
        ),
        201,
    ).json()
    bid = created["id"]
    assert (created["deposit_amount_cents"], created["deposit_status"]) == (2000, "pending")

    collect = ok(await api.post(f"/v1/bookings/{bid}/deposit?payment_method_id=default")).json()
    await settle(api, db, collect["payment_id"])
    assert await deposit_held(db, bid) == 2000
    revenue = await business_balance(db, "revenue")

    marked = ok(await api.patch(f"/v1/bookings/{bid}", json={"status": "no_show"})).json()
    assert (marked["status"], marked["deposit_status"]) == ("no_show", "forfeited")
    assert await deposit_held(db, bid) == 0
    assert await business_balance(db, "revenue") - revenue == -2000  # the deposit is earned
    again = ok(await api.patch(f"/v1/bookings/{bid}", json={"status": "no_show"})).json()
    assert again["deposit_status"] == "forfeited"


async def test_recurring_series_create_and_cancel(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    api = as_owner
    series = ok(
        await api.post(
            "/v1/schedules",
            json={
                "client_id": AMELIE,
                "item_id": GROOM_SM,
                "staff_id": "st_priya",
                "starts_at": "2027-04-05T17:00:00Z",
                "frequency": "week",
                "count": 4,
            },
        ),
        201,
    ).json()
    assert (series["created"], series["skipped"]) == (4, 0)
    starts = [datetime.fromisoformat(o["starts_at"]) for o in series["occurrences"]]
    assert [b - a for a, b in pairwise(starts)] == [timedelta(days=7)] * 3
    ids = [o["booking_id"] for o in series["occurrences"]]

    canceled = ok(await api.patch(f"/v1/bookings/{ids[1]}", json={"status": "canceled"})).json()
    assert canceled["status"] == "canceled"
    assert [(await booking(db, b)).status for b in ids] == [
        "confirmed",
        "canceled",
        "confirmed",
        "confirmed",
    ]

    # the canceled occurrence frees its slot for someone else
    rebook = await api.post(
        "/v1/bookings",
        json={
            "client_id": "cl_marcus",
            "item_id": GROOM_SM,
            "staff_id": "st_priya",
            "starts_at": series["occurrences"][1]["starts_at"],
        },
    )
    assert rebook.status_code == 201, rebook.text
    clash = await api.post(
        "/v1/bookings",
        json={
            "client_id": "cl_marcus",
            "item_id": GROOM_SM,
            "staff_id": "st_priya",
            "starts_at": series["occurrences"][2]["starts_at"],
        },
    )
    assert clash.status_code == 409
