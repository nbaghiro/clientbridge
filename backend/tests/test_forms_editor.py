from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.catalog import Item
from clientbridge.models.documents import Form, FormField, FormResponse
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.services.forms import run_intake_forms
from clientbridge.services.notifications import Notifier
from tests.conftest import Factory, FakeEmailSender, FakePushSender, FakeSmsSender
from tests.helpers import key, new_client, ok

BIZ = "bz_birchbark"

INTAKE = {
    "name": "New client intake",
    "send_on": "booking",
    "require_signature": True,
    "fields": [
        {"input": "text", "label": "Pet's name", "required": True},
        {"input": "select", "label": "Size", "options": ["Small", "Large", " "]},
        {"input": "file", "label": "Vaccination record"},
    ],
}


async def test_create_a_form(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    out = ok(await as_owner.post("/v1/forms", json=INTAKE, headers=key()), 201).json()
    assert (out["send_on"], out["require_signature"], out["active"]) == ("booking", True, True)
    assert [f["name"] for f in out["fields"]] == ["pet_s_name", "size", "vaccination_record"]
    assert out["fields"][1]["options"] == ["Small", "Large"]  # blank choices drop out
    assert [f["position"] for f in out["fields"]] == [0, 1, 2]


async def test_create_replays_on_the_same_key(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    headers = key()
    first = ok(await as_owner.post("/v1/forms", json=INTAKE, headers=headers), 201).json()
    second = ok(await as_owner.post("/v1/forms", json=INTAKE, headers=headers), 201).json()
    assert first["id"] == second["id"]
    count = await db.execute(select(Form).where(Form.name == "New client intake"))
    assert len(count.scalars().all()) == 1


async def test_edit_keeps_answer_keys_and_drops_removed_questions(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    out = ok(await as_owner.post("/v1/forms", json=INTAKE), 201).json()
    pet, size, _ = out["fields"]
    edited = ok(
        await as_owner.patch(
            f"/v1/forms/{out['id']}",
            json={
                "name": "Intake",
                "send_on": "manual",
                "fields": [
                    {
                        "id": size["id"],
                        "input": "select",
                        "label": "Coat size",
                        "options": ["S", "L"],
                    },
                    {"id": pet["id"], "input": "text", "label": "Name of your pet"},
                    {"input": "text", "label": "Pet's name"},
                ],
            },
        )
    ).json()
    assert edited["send_on"] == "manual" and edited["require_signature"] is False
    assert [f["id"] for f in edited["fields"][:2]] == [size["id"], pet["id"]]
    assert [f["name"] for f in edited["fields"]] == ["size", "pet_s_name", "pet_s_name_2"]
    rows = await db.execute(select(FormField.id).where(FormField.form_id == out["id"]))
    assert len(rows.scalars().all()) == 3  # the vaccination question is gone


async def test_choice_questions_need_two_choices(as_owner: httpx.AsyncClient) -> None:
    body = {"name": "Thin", "fields": [{"input": "select", "label": "Pick", "options": ["One"]}]}
    assert (await as_owner.post("/v1/forms", json=body)).status_code == 422
    assert (
        await as_owner.post("/v1/forms", json={"name": "Empty", "fields": []})
    ).status_code == 422


async def test_staff_cannot_edit_forms(as_staff: httpx.AsyncClient) -> None:
    assert (await as_staff.post("/v1/forms", json=INTAKE)).status_code == 403
    assert (await as_staff.patch("/v1/forms/frm_satisfaction", json=INTAKE)).status_code == 403


async def test_edit_is_tenant_scoped(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Rival Forms")
    form = Form(id=new_id("form"), business_id=other.id, name="Theirs")
    db.add(form)
    await db.flush()
    assert (await as_owner.patch(f"/v1/forms/{form.id}", json=INTAKE)).status_code == 404


async def _response(db: AsyncSession) -> str:
    response = FormResponse(
        id=new_id("form_response"),
        business_id=BIZ,
        form_id="frm_satisfaction",
        status="draft",
        token=new_id("form_response"),
    )
    db.add(response)
    await db.flush()
    assert response.token
    return response.token


async def test_upload_limits(api: httpx.AsyncClient, db: AsyncSession) -> None:
    token = await _response(db)
    url = f"/form/{token}/upload"
    good = await api.post(url, json={"content_type": "image/heic", "size": 9_000_000})
    assert good.status_code == 200
    too_big = await api.post(url, json={"content_type": "image/png", "size": 11 * 1024 * 1024})
    assert too_big.status_code == 422
    wrong = await api.post(url, json={"content_type": "application/zip", "size": 100})
    assert wrong.status_code == 422
    assert (await api.post(url, json={"content_type": "image/png"})).status_code == 422


async def test_opening_the_link_is_recorded(api: httpx.AsyncClient, db: AsyncSession) -> None:
    token = await _response(db)
    ok(await api.get(f"/form/{token}"))
    row = (await db.execute(select(FormResponse).where(FormResponse.token == token))).scalar_one()
    assert row.opened_at is not None


async def _book(db: AsyncSession, client_id: str, created_at: datetime) -> str:
    item = (await db.execute(select(Item).where(Item.business_id == BIZ).limit(1))).scalar_one()
    slot = Slot(
        id=new_id("slot"),
        business_id=BIZ,
        item_id=item.id,
        staff_id="st_owner",
        starts_at=created_at + timedelta(days=3),
        ends_at=created_at + timedelta(days=3, hours=1),
        capacity=1,
        status="scheduled",
    )
    db.add(slot)
    await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=BIZ,
        slot_id=slot.id,
        staff_id="st_owner",
        client_id=client_id,
        status="confirmed",
        source="online",
        price_cents=5000,
        created_at=created_at,
    )
    db.add(booking)
    await db.flush()
    return booking.id


async def test_intake_goes_once_to_each_new_client(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
) -> None:
    form = ok(await as_owner.post("/v1/forms", json=INTAKE), 201).json()
    now = datetime.now(UTC)
    newcomer = await new_client(db, name="New Pup", email="newpup@example.ca")
    regular = await new_client(db, name="Old Pal", email="oldpal@example.ca")
    first_booking = await _book(db, newcomer, now - timedelta(hours=2))
    await _book(db, regular, now - timedelta(days=60))
    await _book(db, regular, now - timedelta(hours=1))
    notifier = Notifier(email, sms, push)

    assert await run_intake_forms(db, notifier, now) == 1
    sent = (
        (await db.execute(select(FormResponse).where(FormResponse.form_id == form["id"])))
        .scalars()
        .all()
    )
    assert [(r.client_id, r.parent_id) for r in sent] == [(newcomer, first_booking)]
    assert any(m.to == "newpup@example.ca" for m in email.sent)
    assert await run_intake_forms(db, notifier, now) == 0  # never twice


async def test_manual_forms_are_not_sent_by_the_job(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
) -> None:
    form = ok(await as_owner.post("/v1/forms", json={**INTAKE, "send_on": "manual"}), 201).json()
    now = datetime.now(UTC)
    await _book(db, await new_client(db, name="Walk In"), now - timedelta(hours=1))
    await run_intake_forms(db, Notifier(email, sms, push), now)
    rows = await db.execute(select(FormResponse).where(FormResponse.form_id == form["id"]))
    assert rows.scalars().all() == []
