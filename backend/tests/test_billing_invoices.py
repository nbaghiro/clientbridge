import httpx
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice
from clientbridge.models.business import Business
from tests.conftest import Factory, FakeSmsSender
from tests.helpers import client_id, key, ok

BIZ = "bz_birchbark"


async def test_nova_scotia_invoice_uses_current_hst(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(update(Business).where(Business.id == BIZ).values(province="NS"))
    res = await as_owner.post("/v1/invoices", json={"client_id": "cl_amelie", "lines": [_line()]})
    assert res.status_code == 201, res.text
    assert res.json()["tax_total_cents"] == 1400
    assert res.json()["total_cents"] == 11400


def _line(desc: str = "Consultation", qty: float = 1.0, unit: int = 10000) -> dict[str, object]:
    return {"description": desc, "quantity": qty, "unit_amount_cents": unit}


async def test_create_invoice_computes_tax(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await client_id(db)
    res = await as_owner.post("/v1/invoices", json={"client_id": cid, "lines": [_line()]})
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "draft"
    assert body["number"] is None
    assert body["subtotal_cents"] == 10000
    assert body["tax_total_cents"] == 1200  # BC: GST 5% + PST 7%
    assert body["total_cents"] == 11200
    assert body["balance_cents"] == 11200
    assert body["lines"][0]["amount_cents"] == 10000
    assert body["lines"][0]["tax_amount_cents"] == 1200


async def test_a_send_or_reminder_key_reused_on_another_invoice_is_refused(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    cid = await client_id(db, phone="+16045550231")
    first, second = [
        ok(
            await as_owner.post("/v1/invoices", json={"client_id": cid, "lines": [_line()]}), 201
        ).json()["id"]
        for _ in range(2)
    ]
    sent = key()
    ok(await as_owner.post(f"/v1/invoices/{first}/send", headers=sent))
    reused = await as_owner.post(f"/v1/invoices/{second}/send", headers=sent)
    assert reused.status_code == 422 and reused.json()["error"] == "idempotency_key_reused"
    ok(await as_owner.post(f"/v1/invoices/{second}/send", headers=key()))
    remind = key()
    ok(await as_owner.post(f"/v1/invoices/{first}/remind", headers=remind))
    reused = await as_owner.post(f"/v1/invoices/{second}/remind", headers=remind)
    assert reused.status_code == 422 and reused.json()["error"] == "idempotency_key_reused"
    assert len(sms.sent) == 3


async def test_an_invoice_with_money_taken_cannot_be_voided(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await client_id(db, phone="+16045550232")
    body = {"client_id": cid, "lines": [_line()], "send": True}
    inv = ok(await as_owner.post("/v1/invoices", json=body), 201).json()
    cash = {"method": "cash", "amount_cents": 1000}
    ok(await as_owner.post(f"/v1/invoices/{inv['id']}/payments", json=cash), 201)
    refused = await as_owner.post(f"/v1/invoices/{inv['id']}/void")
    assert refused.status_code == 409 and refused.json()["error"] == "invoice_has_payments"


async def test_send_assigns_number_and_texts(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    cid = await client_id(db)
    inv = (await as_owner.post("/v1/invoices", json={"client_id": cid, "lines": [_line()]})).json()
    sent = await as_owner.post(f"/v1/invoices/{inv['id']}/send")
    assert sent.status_code == 200
    body = sent.json()
    assert body["status"] == "sent"
    assert body["number"] is not None
    assert body["issued_at"] is not None
    assert body["due_at"] is not None
    assert len(sms.sent) == 1 and sms.sent[0].to == "+16045550223"


async def test_not_registered_collects_no_tax(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(update(Business).where(Business.id == BIZ).values(tax_registered=False))
    await db.flush()
    cid = await client_id(db)
    body = (await as_owner.post("/v1/invoices", json={"client_id": cid, "lines": [_line()]})).json()
    assert body["tax_total_cents"] == 0
    assert body["total_cents"] == 10000


async def test_only_draft_is_editable(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await client_id(db)
    inv = (await as_owner.post("/v1/invoices", json={"client_id": cid, "lines": [_line()]})).json()
    await as_owner.post(f"/v1/invoices/{inv['id']}/send")
    patched = await as_owner.patch(f"/v1/invoices/{inv['id']}", json={"notes": "late edit"})
    assert patched.status_code == 409


async def test_void_invoice(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await client_id(db)
    inv = (await as_owner.post("/v1/invoices", json={"client_id": cid, "lines": [_line()]})).json()
    voided = await as_owner.post(f"/v1/invoices/{inv['id']}/void")
    assert voided.status_code == 200
    assert voided.json()["status"] == "void"


async def test_unknown_client_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/invoices", json={"client_id": "cl_nope", "lines": [_line()]})
    assert res.status_code == 404


async def test_staff_cannot_create_invoice(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await client_id(db)
    res = await as_staff.post("/v1/invoices", json={"client_id": cid, "lines": [_line()]})
    assert res.status_code == 403


async def test_unauth_cannot_create(unauth: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await client_id(db)
    res = await unauth.post("/v1/invoices", json={"client_id": cid, "lines": [_line()]})
    assert res.status_code == 401


async def test_cannot_invoice_another_business_client(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Rival Co")
    foreign = await factory.client(business=other)
    await db.flush()
    res = await as_owner.post("/v1/invoices", json={"client_id": foreign.id, "lines": [_line()]})
    assert res.status_code == 404


async def test_unknown_invoice_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/invoices/inv_nope/void")
    assert res.status_code == 404


async def test_idempotent_create_replays(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await client_id(db)
    body = {"client_id": cid, "lines": [_line()]}
    headers = {"Idempotency-Key": "inv-test-1"}
    first = await as_owner.post("/v1/invoices", json=body, headers=headers)
    second = await as_owner.post("/v1/invoices", json=body, headers=headers)
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]


async def test_negative_amount_rejected(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await client_id(db)
    bad = {"description": "Refund", "quantity": 1, "unit_amount_cents": -500}
    res = await as_owner.post("/v1/invoices", json={"client_id": cid, "lines": [bad]})
    assert res.status_code == 422


async def test_staff_cannot_send_invoice(as_staff: httpx.AsyncClient) -> None:
    # _assert_admin gates before any lookup, so a bogus id still 403s for staff
    res = await as_staff.post("/v1/invoices/inv_x/send")
    assert res.status_code == 403


async def test_cannot_send_void_invoice(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await client_id(db)
    inv = (await as_owner.post("/v1/invoices", json={"client_id": cid, "lines": [_line()]})).json()
    await as_owner.post(f"/v1/invoices/{inv['id']}/void")
    res = await as_owner.post(f"/v1/invoices/{inv['id']}/send")
    assert res.status_code == 409


async def test_foreign_invoice_404_by_scoping(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Rival Co")
    foreign_client = await factory.client(business=other)
    inv = Invoice(
        id=new_id("invoice"),
        business_id=other.id,
        client_id=foreign_client.id,
        status="draft",
        currency="CAD",
    )
    db.add(inv)
    await db.flush()
    res = await as_owner.post(f"/v1/invoices/{inv.id}/void")
    assert res.status_code == 404
    edited = await as_owner.patch(f"/v1/invoices/{inv.id}", json={"notes": "Mine now"})
    assert edited.status_code == 404
    assert (await as_owner.post(f"/v1/invoices/{inv.id}/send")).status_code == 404
    after = await db.get(Invoice, inv.id, populate_existing=True)
    assert after is not None and after.status == "draft"


async def test_create_and_send_in_one_call(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    cid = await client_id(db)
    res = await as_owner.post(
        "/v1/invoices", json={"client_id": cid, "lines": [_line()], "send": True}
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "sent"
    assert body["number"] is not None and body["pay_token"]
    assert body["balance_cents"] == 11200
    assert any("/i/" in m.body for m in sms.sent)


async def test_create_and_send_needs_a_line(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await client_id(db)
    res = await as_owner.post("/v1/invoices", json={"client_id": cid, "lines": [], "send": True})
    assert res.status_code == 422


async def test_invoice_lines_cannot_be_optional(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await client_id(db)
    line = {**_line(), "optional": True}
    res = await as_owner.post("/v1/invoices", json={"client_id": cid, "lines": [line]})
    assert res.status_code == 422


async def test_composer_tax_class_is_kept(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await client_id(db)
    line = {**_line(), "tax_class": "federal_only"}
    body = (await as_owner.post("/v1/invoices", json={"client_id": cid, "lines": [line]})).json()
    assert body["lines"][0]["tax_class"] == "federal_only"
    assert body["tax_total_cents"] == 500  # GST only


async def test_line_staff_must_be_on_the_team_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.staff(business=await factory.business())
    cid = await client_id(db)
    for staff_id in ("st_nope", other.id):
        line = {"description": "Groom", "unit_amount_cents": 5000, "staff_id": staff_id}
        res = await as_owner.post("/v1/invoices", json={"client_id": cid, "lines": [line]})
        assert res.status_code == 404, res.text
        assert res.json()["message"] == "staff member not found"


async def test_remind_sends_the_reminder_and_keeps_the_invoice(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    cid = await client_id(db)
    inv = (await as_owner.post("/v1/invoices", json={"client_id": cid, "lines": [_line()]})).json()
    await as_owner.post(f"/v1/invoices/{inv['id']}/send")
    res = await as_owner.post(f"/v1/invoices/{inv['id']}/remind")
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "sent"
    assert sms.sent[-1].body.startswith("A reminder")
    assert "$112.00" in sms.sent[-1].body


async def test_remind_refuses_a_draft_and_a_foreign_invoice(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    cid = await client_id(db)
    inv = (await as_owner.post("/v1/invoices", json={"client_id": cid, "lines": [_line()]})).json()
    assert (await as_owner.post(f"/v1/invoices/{inv['id']}/remind")).status_code == 409
    other = await factory.business(name="Rival Co")
    foreign = Invoice(
        id=new_id("invoice"),
        business_id=other.id,
        client_id=(await factory.client(business=other)).id,
        status="sent",
        currency="CAD",
    )
    db.add(foreign)
    await db.flush()
    assert (await as_owner.post(f"/v1/invoices/{foreign.id}/remind")).status_code == 404


async def test_staff_cannot_remind(as_staff: httpx.AsyncClient) -> None:
    assert (await as_staff.post("/v1/invoices/inv_x/remind")).status_code == 403
