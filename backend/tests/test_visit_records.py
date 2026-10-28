from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.catalog import Item
from clientbridge.models.documents import Form, FormResponse, VisitRecord
from clientbridge.models.platform import Audit
from clientbridge.models.scheduling import Booking, Slot
from tests.conftest import BIZ, OWNER_USER, STAFF_USER, Factory, FakeIdentityProvider, session_token
from tests.helpers import key, ok

SOAP = {
    "name": "SOAP note",
    "send_on": "manual",
    "fields": [
        {"input": "longtext", "label": "Subjective", "required": True},
        {"input": "longtext", "label": "Objective"},
        {"input": "select", "label": "Pressure", "options": ["Light", "Medium", "Firm"]},
    ],
}


async def _soap(api: httpx.AsyncClient) -> dict[str, str]:
    """The form's id and its answer keys, by label."""
    form = ok(await api.post("/v1/forms", json=SOAP, headers=key()), 201).json()
    return {"id": form["id"], **{f["label"]: f["name"] for f in form["fields"]}}


async def _visit(db: AsyncSession, staff_id: str = "st_diego") -> Booking:
    return (
        await db.execute(
            select(Booking)
            .where(
                Booking.business_id == BIZ,
                Booking.staff_id == staff_id,
                Booking.deleted_at.is_(None),
            )
            .order_by(Booking.id)
            .limit(1)
        )
    ).scalar_one()


async def _write(
    api: httpx.AsyncClient, form: dict[str, str], booking_id: str, subjective: str, **extra: str
) -> httpx.Response:
    body = {
        "form_id": form["id"],
        "booking_id": booking_id,
        "answers": {form["Subjective"]: subjective, form["Pressure"]: "Firm"},
        **extra,
    }
    return await api.post("/v1/visit-records", json=body, headers=key())


async def _reads(db: AsyncSession, record_id: str) -> int:
    count = await db.execute(
        select(func.count())
        .select_from(Audit)
        .where(Audit.action == "visit_record.read", Audit.entity_id == record_id)
    )
    return count.scalar_one()


async def test_the_practitioner_writes_a_final_record_that_only_they_and_managers_read(
    as_owner: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    form = await _soap(as_owner)
    booking = await _visit(db)
    as_owner.headers["X-Session-Token"] = await session_token(identities, db, STAFF_USER)
    note = ok(await _write(as_owner, form, booking.id, "Tight left trapezius"), 201).json()
    assert (note["booking_id"], note["author_staff_id"]) == (booking.id, "st_diego")
    assert note["answers"][form["Subjective"]] == "Tight left trapezius"
    assert [f["label"] for f in note["fields"]] == ["Subjective", "Objective", "Pressure"]
    assert note["id"].startswith("vr_") and note["written_at"]
    row = await db.get(VisitRecord, note["id"])
    assert row is not None and row.booking_id == booking.id
    assert row.signature["user_id"] == STAFF_USER
    assert await db.get(FormResponse, note["id"]) is None
    written = await db.execute(
        select(Audit).where(Audit.action == "visit_record.write", Audit.entity_id == note["id"])
    )
    assert written.scalar_one().performed_by == STAFF_USER

    own = ok(await as_owner.get(f"/v1/visit-records?booking_id={booking.id}")).json()
    assert [n["id"] for n in own["records"]] == [note["id"]]
    assert await _reads(db, note["id"]) == 1
    ok(await as_owner.get(f"/v1/visit-records/{note['id']}"))
    assert await _reads(db, note["id"]) == 2

    as_owner.headers["X-Session-Token"] = await session_token(identities, db, "us_priya")
    other = await as_owner.get(f"/v1/visit-records?booking_id={booking.id}")
    assert other.status_code == 403
    assert (await as_owner.get(f"/v1/visit-records/{note['id']}")).status_code == 403
    mine = ok(await as_owner.get(f"/v1/visit-records?client_id={booking.client_id}"))
    assert note["id"] not in [n["id"] for n in mine.json()["records"]]
    assert await _reads(db, note["id"]) == 2

    as_owner.headers["X-Session-Token"] = await session_token(identities, db, OWNER_USER)
    history = ok(await as_owner.get(f"/v1/visit-records?client_id={booking.client_id}"))
    seen = next(n for n in history.json()["records"] if n["id"] == note["id"])
    assert seen["visit_at"] and seen["service"]
    assert await _reads(db, note["id"]) == 3


async def test_an_amendment_is_a_further_record_on_the_same_visit(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    form = await _soap(as_owner)
    booking = await _visit(db, "st_owner")
    first = ok(await _write(as_owner, form, booking.id, "Neck pain"), 201).json()
    fixed = ok(
        await _write(as_owner, form, booking.id, "Neck and shoulder pain", amends=first["id"]), 201
    ).json()
    assert fixed["amends"] == first["id"]
    notes = ok(await as_owner.get(f"/v1/visit-records?booking_id={booking.id}")).json()
    assert [n["id"] for n in notes["records"]] == [first["id"], fixed["id"]]
    elsewhere = await _visit(db, "st_diego")
    stray = await _write(as_owner, form, elsewhere.id, "Wrong visit", amends=first["id"])
    assert stray.status_code == 404


async def test_a_record_needs_a_manual_form_and_valid_answers(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    form = await _soap(as_owner)
    booking = await _visit(db, "st_owner")
    bid, cid = booking.id, booking.client_id
    missing = await as_owner.post(
        "/v1/visit-records",
        json={"form_id": form["id"], "booking_id": bid, "answers": {}},
    )
    assert missing.status_code == 422
    intake = ok(
        await as_owner.post("/v1/forms", json={**SOAP, "send_on": "booking"}, headers=key()), 201
    ).json()
    refused = await _write(as_owner, {**form, "id": intake["id"]}, bid, "x")
    assert (refused.status_code, refused.json()["error"]) == (422, "form_not_fillable")
    unknown = await as_owner.post(
        "/v1/visit-records",
        json={"form_id": "frm_missing", "booking_id": bid, "answers": {}},
    )
    assert unknown.status_code == 404
    both = await as_owner.get(f"/v1/visit-records?booking_id={bid}&client_id={cid}")
    assert both.status_code == 422
    assert (await as_owner.get("/v1/visit-records/missing")).status_code == 404
    assert (await as_owner.get("/v1/forms/responses/missing")).status_code == 404
    gone = await as_owner.get("/v1/visit-records?client_id=cl_missing")
    assert gone.status_code == 404


async def test_staff_write_records_only_on_their_own_visits(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    form = await as_staff.get("/v1/visit-records?booking_id=missing")
    assert form.status_code == 404
    booking = await _visit(db, "st_owner")
    res = await as_staff.post(
        "/v1/visit-records",
        json={"form_id": "frm_satisfaction", "booking_id": booking.id, "answers": {}},
    )
    assert res.status_code == 403


async def test_records_are_final_and_replay_their_key(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    form = await _soap(as_owner)
    booking = await _visit(db, "st_owner")
    body = {
        "form_id": form["id"],
        "booking_id": booking.id,
        "answers": {form["Subjective"]: "Low back"},
    }
    headers = key()
    first = ok(await as_owner.post("/v1/visit-records", json=body, headers=headers), 201)
    again = ok(await as_owner.post("/v1/visit-records", json=body, headers=headers), 201)
    assert first.json()["id"] == again.json()["id"]
    note = first.json()["id"]
    assert (await as_owner.patch(f"/v1/visit-records/{note}", json={})).status_code == 405
    assert (await as_owner.delete(f"/v1/visit-records/{note}")).status_code == 405
    assert (await as_owner.get(f"/v1/forms/responses/{note}")).status_code == 404
    resubmit = await as_owner.post(f"/form/{note}", json={"answers": {}})
    assert resubmit.status_code == 404


async def test_a_client_form_reads_back_for_managers_only(
    as_owner: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    response = (
        await db.execute(
            select(FormResponse)
            .where(FormResponse.business_id == BIZ, FormResponse.status == "submitted")
            .limit(1)
        )
    ).scalar_one()
    read = ok(await as_owner.get(f"/v1/forms/responses/{response.id}")).json()
    assert read["answers"] == response.answers and "author_staff_id" not in read
    assert await _reads(db, response.id) == 0
    as_owner.headers["X-Session-Token"] = await session_token(identities, db, STAFF_USER)
    assert (await as_owner.get(f"/v1/forms/responses/{response.id}")).status_code == 403


async def test_another_business_booking_is_not_found(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    form = await _soap(as_owner)
    other = await factory.business()
    client = await factory.client(business=other)
    staff = await factory.staff(business=other)
    item = Item(id=new_id("item"), business_id=other.id, kind="service", name="Massage")
    db.add(item)
    await db.flush()
    start = datetime(2027, 3, 2, 18, tzinfo=UTC)
    slot = Slot(
        id=new_id("slot"),
        business_id=other.id,
        item_id=item.id,
        staff_id=staff.id,
        starts_at=start,
        ends_at=start + timedelta(hours=1),
        capacity=1,
    )
    db.add(slot)
    await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=other.id,
        slot_id=slot.id,
        starts_at=start,
        staff_id=staff.id,
        client_id=client.id,
    )
    db.add(booking)
    await db.flush()
    assert (await _write(as_owner, form, booking.id, "x")).status_code == 404
    read = await as_owner.get(f"/v1/visit-records?booking_id={booking.id}")
    assert read.status_code == 404
    other_form = Form(id=new_id("form"), business_id=other.id, name="SOAP note")
    db.add(other_form)
    await db.flush()
    theirs = VisitRecord(
        id=new_id("visit_record"),
        business_id=other.id,
        form_id=other_form.id,
        client_id=client.id,
        booking_id=booking.id,
        definition={},
        answers={},
        signature={"staff_id": staff.id},
    )
    db.add(theirs)
    await db.flush()
    assert (await as_owner.get(f"/v1/visit-records/{theirs.id}")).status_code == 404
    assert (await as_owner.get(f"/v1/visit-records?client_id={client.id}")).status_code == 404
    amended = await _write(as_owner, form, (await _visit(db, "st_owner")).id, "x", amends=theirs.id)
    assert amended.status_code == 404


async def test_a_record_holds_no_file_and_a_reused_key_needs_the_same_body(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    upload = {"input": "file", "label": "Scan"}
    form = ok(
        await as_owner.post(
            "/v1/forms", json={**SOAP, "fields": [*SOAP["fields"], upload]}, headers=key()
        ),
        201,
    ).json()
    names = {f["label"]: f["name"] for f in form["fields"]}
    booking = await _visit(db, "st_owner")
    body = {"form_id": form["id"], "booking_id": booking.id}
    scan = {**body, "answers": {names["Subjective"]: "Hip", names["Scan"]: "fl_x"}}
    refused = await as_owner.post("/v1/visit-records", json=scan, headers=key())
    assert refused.status_code == 422
    headers = key()
    hip = {**body, "answers": {names["Subjective"]: "Hip"}}
    ok(await as_owner.post("/v1/visit-records", json=hip, headers=headers), 201)
    changed = {**body, "answers": {names["Subjective"]: "Knee"}}
    reused = await as_owner.post("/v1/visit-records", json=changed, headers=headers)
    assert reused.status_code == 422
    neither = await as_owner.get("/v1/visit-records")
    assert neither.status_code == 422
