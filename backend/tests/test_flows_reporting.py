"""Reports and the dashboard move by exactly what a paid visit adds."""

from datetime import date, timedelta

import httpx
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.clients import Client
from clientbridge.models.payments import PaymentMethod
from tests.conftest import BIZ
from tests.helpers import card_pay, earnings, enable_payments, key, ok, settle

OWNER_BOOKING = "bk_016"  # seeded upcoming visit for st_owner (a payee)


async def _reports(api: httpx.AsyncClient) -> dict[str, object]:
    end = date.today() + timedelta(days=1)
    summary = ok(await api.get(f"/v1/reports/summary?start=2000-01-01&end={end}")).json()
    return {
        "income": summary["income"],
        "gst": summary["gst_hst"],
        "t4a": {r["staff_id"]: r["total_cents"] for r in summary["t4a"]},
        "sales": {
            r["item_id"]: (r["quantity"], r["sales_cents"], r["tax_cents"])
            for r in summary["sales_by_item"]
        },
    }


async def test_report_totals_follow_a_paid_visit(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    api = as_owner
    await enable_payments(db)
    before = await _reports(api)

    inv = ok(await api.post(f"/v1/invoices/from-booking/{OWNER_BOOKING}", headers=key()), 201)
    invoice = ok(await api.post(f"/v1/invoices/{inv.json()['id']}/send")).json()
    item_id = invoice["lines"][0]["item_id"]
    await settle(api, db, await card_pay(api, db, invoice["id"]))
    [journal] = await earnings(db, "booking", OWNER_BOOKING)
    ok(await api.post("/v1/earnings/approve", json={"ids": [journal]}))
    paid = ok(await api.post("/v1/earnings/pay", json={"ids": [journal]})).json()
    earned = paid["earnings"][0]["amount_cents"]

    after = await _reports(api)
    income_before, income_after = before["income"], after["income"]
    assert isinstance(income_before, dict) and isinstance(income_after, dict)
    assert (
        income_after["received_cents"] - income_before["received_cents"] == invoice["total_cents"]
    )
    assert income_after["net_cents"] - income_before["net_cents"] == invoice["subtotal_cents"]
    assert (
        income_after["by_method"]["card"] - income_before["by_method"].get("card", 0)
        == invoice["total_cents"]
    )

    gst_before, gst_after = before["gst"], after["gst"]
    assert isinstance(gst_before, dict) and isinstance(gst_after, dict)
    subtotal = invoice["subtotal_cents"]
    assert (
        gst_after["tax_collected_cents"] - gst_before["tax_collected_cents"] == subtotal * 5 // 100
    )
    assert gst_after["pst_cents"] - gst_before["pst_cents"] == subtotal * 7 // 100
    assert gst_after["taxable_sales_cents"] - gst_before["taxable_sales_cents"] == subtotal

    t4a_before, t4a_after = before["t4a"], after["t4a"]
    assert isinstance(t4a_before, dict) and isinstance(t4a_after, dict)
    assert t4a_after["st_owner"] - t4a_before.get("st_owner", 0) == earned

    sales_before, sales_after = before["sales"], after["sales"]
    assert isinstance(sales_before, dict) and isinstance(sales_after, dict)
    qty, cents, tax = sales_before.get(item_id, (0, 0, 0))
    assert sales_after[item_id] == (qty + 1, cents + subtotal, tax + invoice["tax_total_cents"])


async def test_dashboard_figures_follow_an_invoice(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    api = as_owner
    await enable_payments(db)
    start = ok(await api.get("/v1/dashboard/summary")).json()

    draft = ok(
        await api.post(
            "/v1/invoices",
            json={
                "client_id": "cl_amelie",
                "lines": [{"description": "Dash", "unit_amount_cents": 10000}],
            },
        ),
        201,
    ).json()
    unsent = ok(await api.get("/v1/dashboard/summary")).json()
    assert unsent["awaiting_payment_cents"] == start["awaiting_payment_cents"]
    ok(await api.post(f"/v1/invoices/{draft['id']}/send"))
    sent = ok(await api.get("/v1/dashboard/summary")).json()
    assert sent["awaiting_payment_cents"] - start["awaiting_payment_cents"] == 11200
    assert sent["gst_hst_set_aside_cents"] - start["gst_hst_set_aside_cents"] == 1200

    await db.execute(
        update(Client).where(Client.id == "cl_amelie").values(stripe_customer_id="cus_dash")
    )
    card = PaymentMethod(
        id=new_id("payment_method"),
        business_id=BIZ,
        client_id="cl_amelie",
        method="card",
        provider="stripe",
        provider_ref="pm_dash",
        status="active",
    )
    db.add(card)
    await db.flush()
    body = {"method": "card", "amount_cents": 4000, "payment_method_id": card.id}
    part = ok(await api.post(f"/v1/invoices/{draft['id']}/payments", json=body), 201).json()
    await settle(api, db, part["payment_id"])
    partial = ok(await api.get("/v1/dashboard/summary")).json()
    assert partial["awaiting_payment_cents"] - start["awaiting_payment_cents"] == 7200
    assert partial["today_revenue_cents"] - start["today_revenue_cents"] == 4000

    rest = {"payment_id": await card_pay(api, db, draft["id"])}
    await settle(api, db, rest["payment_id"])
    paid = ok(await api.get("/v1/dashboard/summary")).json()
    assert paid["awaiting_payment_cents"] == start["awaiting_payment_cents"]
    assert paid["today_revenue_cents"] - start["today_revenue_cents"] == 11200
    assert paid["gst_hst_set_aside_cents"] - start["gst_hst_set_aside_cents"] == 1200
    assert paid["gst_hst_filing_due"] == start["gst_hst_filing_due"]

    ok(await api.post(f"/v1/payments/{rest['payment_id']}/refund", json={"amount_cents": 1000}))
    refunded = ok(await api.get("/v1/dashboard/summary")).json()
    assert refunded["today_revenue_cents"] - start["today_revenue_cents"] == 10200
