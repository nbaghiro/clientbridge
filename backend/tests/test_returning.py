import re
from datetime import timedelta

import httpx
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.ids import new_id
from clientbridge.models.business import Business
from clientbridge.models.clients import Client, Subject
from clientbridge.models.returning import ReturningChallenge
from clientbridge.models.scheduling import Booking, Slot
from tests.conftest import BIZ, Factory, FakeEmailSender, FakeSmsSender

SLUG = "birchbark"
PHONE = "+12505550197"


async def _client(db: AsyncSession) -> Client:
    client = await db.get(Client, "cl_amelie")
    assert client is not None
    client.phone = PHONE
    await db.flush()
    return client


async def _request(
    api: httpx.AsyncClient, sms: FakeSmsSender, phone: str = PHONE, slug: str = SLUG
) -> tuple[str, str]:
    result = await api.post(f"/book/{slug}/returning/request", json={"phone": phone})
    assert result.status_code == 200, result.text
    assert set(result.json()) == {"challenge_id"}
    assert sms.sent[-1].to == phone
    code = re.search(r"\b\d{6}\b", sms.sent[-1].body)
    assert code is not None
    return result.json()["challenge_id"], code.group()


async def _verify(
    api: httpx.AsyncClient, challenge: str, code: str, slug: str = SLUG
) -> httpx.Response:
    return await api.post(
        f"/book/{slug}/returning/verify", json={"challenge_id": challenge, "code": code}
    )


async def _book(api: httpx.AsyncClient, **extra: object) -> httpx.Response:
    slots = await api.get(
        f"/book/{SLUG}/slots",
        params={"item_id": "it_groom_sm", "staff_id": "st_owner", "date": "2027-03-02"},
    )
    start = slots.json()["slots"][0]["starts_at"]
    return await api.post(
        f"/book/{SLUG}",
        json={
            "item_id": "it_groom_sm",
            "staff_id": "st_owner",
            "starts_at": start,
            "client": {"name": "Forged contact", "phone": "+16045550123"},
            **extra,
        },
        headers={"Idempotency-Key": "returning-booking"},
    )


async def test_phone_proof_reveals_only_verified_profile(
    api: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    client = await _client(db)
    challenge, code = await _request(api, sms, PHONE)
    stored = await db.get(ReturningChallenge, challenge)
    assert stored is not None and stored.code_hash != code
    response = await _verify(api, challenge, code)
    assert response.status_code == 200, response.text
    profile = response.json()["profile"]
    assert profile["name"] == client.name
    assert profile["phone"] == PHONE
    assert profile["subjects"]
    assert "custom_fields" not in profile
    assert response.json()["token"]
    assert stored.session_hash != response.json()["token"]
    assert (await _verify(api, challenge, code)).status_code == 401


async def test_unknown_and_ambiguous_numbers_have_same_request_response(
    api: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender, factory: Factory
) -> None:
    await _client(db)
    other = await db.get(Client, "cl_jordan")
    if other is None:
        business = await factory.business()
        other = await factory.client(business=business)
        other.business_id = BIZ
    other.phone = PHONE
    await db.flush()
    challenge, code = await _request(api, sms)
    assert (await _verify(api, challenge, code)).json() == {"token": None, "profile": None}
    challenge, code = await _request(api, sms, "+16045550999")
    assert (await _verify(api, challenge, code)).json() == {"token": None, "profile": None}
    assert len(sms.sent) == 2


async def test_bad_codes_lock_after_five_and_expired_codes_fail(
    api: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    await _client(db)
    challenge, code = await _request(api, sms)
    wrong = "111111" if code != "111111" else "222222"
    for _ in range(5):
        assert (await _verify(api, challenge, wrong)).status_code == 401
    assert (await _verify(api, challenge, code)).status_code == 401
    challenge, code = await _request(api, sms)
    row = await db.get(ReturningChallenge, challenge)
    assert row is not None
    row.expires_at = clock.now() - timedelta(seconds=1)
    await db.flush()
    assert (await _verify(api, challenge, code)).status_code == 401
    assert (await _verify(api, "unknown", code)).status_code == 401


async def test_destination_limit_is_case_insensitive_and_input_is_validated(
    api: httpx.AsyncClient, sms: FakeSmsSender
) -> None:
    for _ in range(3):
        await _request(api, sms)
    assert (
        await api.post(f"/book/{SLUG}/returning/request", json={"phone": PHONE})
    ).status_code == 429
    assert (
        await api.post(f"/book/{SLUG}/returning/request", json={"phone": "bad"})
    ).status_code == 422
    assert (await _verify(api, "unknown", "12")).status_code == 422
    assert (
        await api.post("/book/missing/returning/request", json={"phone": PHONE})
    ).status_code == 404
    assert (await _verify(api, "unknown", "123456", "missing")).status_code == 404


async def test_challenge_and_session_are_tenant_bound(
    api: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender, factory: Factory
) -> None:
    business = await factory.business()
    business.sms_number = "+12365550291"
    client = await factory.client(business=business)
    client.phone = PHONE
    await db.flush()
    challenge, code = await _request(api, sms, slug=business.slug)
    assert (await _verify(api, challenge, code)).status_code == 401
    verified = await _verify(api, challenge, code, business.slug)
    assert verified.status_code == 200
    assert (await _book(api, returning_token=verified.json()["token"])).status_code == 401


async def test_verified_booking_binds_client_and_pet_not_forged_contact(
    api: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    client = await _client(db)
    pet = Subject(id=new_id("subject"), business_id=BIZ, client_id=client.id, name="Known pet")
    db.add(pet)
    await db.flush()
    challenge, code = await _request(api, sms)
    verified = await _verify(api, challenge, code)
    booked = await _book(api, returning_token=verified.json()["token"], subject_id=pet.id)
    assert booked.status_code == 200, booked.text
    booking = await db.get(Booking, booked.json()["booking_id"])
    assert booking is not None and booking.client_id == client.id and booking.subject_id == pet.id
    assert client.name != "Forged contact" and client.phone == PHONE
    slot = await db.get(Slot, booking.slot_id)
    assert slot is not None
    replay = await _book(
        api,
        returning_token=verified.json()["token"],
        subject_id=pet.id,
        starts_at=slot.starts_at.isoformat(),
    )
    assert replay.json()["booking_id"] == booking.id


async def test_client_only_business_books_a_returning_client_without_their_old_pet(
    api: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    client = await _client(db)
    pet = Subject(id=new_id("subject"), business_id=BIZ, client_id=client.id, name="Old pet")
    db.add(pet)
    await db.execute(update(Business).where(Business.id == BIZ).values(subject=None))
    await db.flush()
    challenge, code = await _request(api, sms)
    verified = await _verify(api, challenge, code)
    booked = await _book(api, returning_token=verified.json()["token"], subject_id=pet.id)
    assert booked.status_code == 200, booked.text
    booking = await db.get(Booking, booked.json()["booking_id"])
    assert booking is not None and booking.client_id == client.id
    assert booking.subject_id is None


async def test_a_deleted_pet_cannot_be_booked_by_its_id(
    api: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    client = await _client(db)
    pet = Subject(
        id=new_id("subject"),
        business_id=BIZ,
        client_id=client.id,
        name="Gone pet",
        deleted_at=clock.now(),
    )
    db.add(pet)
    await db.flush()
    gone = pet.id
    online = select(func.count()).select_from(Booking).where(Booking.client_id == client.id)
    before = await db.scalar(online)
    challenge, code = await _request(api, sms)
    verified = await _verify(api, challenge, code)
    booked = await _book(api, returning_token=verified.json()["token"], subject_id=gone)
    assert booked.status_code == 422
    assert await db.scalar(online) == before
    profile = verified.json()["profile"]
    assert gone not in {s["id"] for s in profile["subjects"]}


async def test_existing_pet_requires_proof_and_belongs_to_verified_client(
    api: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    await _client(db)
    await db.commit()
    assert (await _book(api, subject_id="sj_luna")).status_code == 401
    challenge, code = await _request(api, sms)
    verified = await _verify(api, challenge, code)
    assert (
        await _book(api, returning_token=verified.json()["token"], subject_id="not-my-pet")
    ).status_code == 422
    row = await db.get(ReturningChallenge, challenge)
    assert row is not None
    row.session_expires_at = clock.now() - timedelta(seconds=1)
    await db.flush()
    assert (await _book(api, returning_token=verified.json()["token"])).status_code == 401


async def test_changed_or_archived_identity_invalidates_proof(
    api: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    client = await _client(db)
    challenge, code = await _request(api, sms)
    client.phone = "+16045550101"
    await db.flush()
    assert (await _verify(api, challenge, code)).json()["profile"] is None
    client.phone = PHONE
    challenge, code = await _request(api, sms)
    verified = await _verify(api, challenge, code)
    client.deleted_at = clock.now()
    await db.flush()
    assert (await _book(api, returning_token=verified.json()["token"])).status_code == 401


async def test_previous_completed_visit_is_available_only_after_proof(
    api: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    client = await _client(db)
    slots = (await db.execute(select(Slot).where(Slot.id == "ses_groom_mon"))).scalars().all()
    if not slots:
        slots = (
            (
                await db.execute(
                    select(Slot).where(Slot.business_id == BIZ).order_by(Slot.id).limit(1)
                )
            )
            .scalars()
            .all()
        )
    slot = slots[0]
    booking = Booking(
        id=new_id("booking"),
        business_id=BIZ,
        slot_id=slot.id,
        starts_at=slot.starts_at,
        staff_id=slot.staff_id,
        client_id=client.id,
        status="completed",
        source="manual",
        completed_at=clock.now(),
    )
    db.add(booking)
    await db.flush()
    challenge, code = await _request(api, sms)
    verified = await _verify(api, challenge, code)
    visit = verified.json()["profile"]["last_visit"]
    assert visit["item_id"] == slot.item_id and visit["staff_id"] == slot.staff_id


async def test_phone_only_regular_verifies_by_sms_and_phone_normalizes(
    api: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender, email: FakeEmailSender
) -> None:
    client = await _client(db)
    client.phone = "(250) 555-0197"
    await db.flush()
    request = await api.post(f"/book/{SLUG}/returning/request", json={"phone": "+12505550197"})
    assert request.status_code == 200, request.text
    assert sms.sent[-1].to == "+12505550197" and not email.sent
    code = re.search(r"\b\d{6}\b", sms.sent[-1].body)
    assert code is not None
    verified = await _verify(api, request.json()["challenge_id"], code.group())
    assert verified.status_code == 200 and verified.json()["profile"]["name"] == client.name
    assert (await _book(api, returning_token=verified.json()["token"])).status_code == 200
    for _ in range(2):
        assert (
            await api.post(f"/book/{SLUG}/returning/request", json={"phone": "2505550197"})
        ).status_code == 200
    assert (
        await api.post(f"/book/{SLUG}/returning/request", json={"phone": "+1 (250) 555-0197"})
    ).status_code == 429


async def test_phone_validation_and_nonexistent_phone_do_not_disclose_clients(
    api: httpx.AsyncClient, sms: FakeSmsSender
) -> None:
    for payload in (
        {},
        {},
        {"phone": "nonsense"},
        {"phone": "123456789012"},
    ):
        assert (await api.post(f"/book/{SLUG}/returning/request", json=payload)).status_code == 422
    response = await api.post(f"/book/{SLUG}/returning/request", json={"phone": "+442079460987"})
    assert response.status_code == 200
    code = re.search(r"\b\d{6}\b", sms.sent[-1].body)
    assert code is not None
    assert (await _verify(api, response.json()["challenge_id"], code.group())).json() == {
        "profile": None,
        "token": None,
    }


async def test_unassigned_sms_does_not_create_a_challenge(
    api: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    from clientbridge.models.business import Business

    business = await db.get(Business, BIZ)
    assert business is not None
    business.sms_number = None
    await db.commit()
    response = await api.post(f"/book/{SLUG}/returning/request", json={"phone": "+16045550123"})
    assert response.status_code == 503
    assert list(await db.scalars(select(ReturningChallenge))) == []
    assert sms.sent == []
