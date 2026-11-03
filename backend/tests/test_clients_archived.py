import asyncio
from datetime import UTC, datetime

import httpx
import pytest
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.db import SessionLocal
from clientbridge.core.errors import Conflict, NotFound
from clientbridge.core.ids import new_id
from clientbridge.models.billing import Order
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client
from clientbridge.models.platform import Audit
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.services.clients import assert_client_active, hold_client
from tests.conftest import BIZ, FakeSmsSender
from tests.google_business import configure_google_review_profile
from tests.helpers import enable_payments, key, new_client
from tests.test_programs import program

ST_OWNER = "st_owner"


async def _item(db: AsyncSession, kind: str = "service") -> str:
    found = await db.scalar(
        select(Item.id)
        .where(
            Item.business_id == BIZ,
            Item.kind == kind,
            Item.active.is_(True),
            Item.duration_min.isnot(None),
        )
        .limit(1)
    )
    assert found is not None
    return found


def _booking(client_id: str, item_id: str) -> dict[str, str]:
    return {
        "client_id": client_id,
        "item_id": item_id,
        "staff_id": ST_OWNER,
        "starts_at": "2027-03-01T18:00:00Z",
    }


def _line() -> dict[str, object]:
    return {"description": "Groom", "quantity": 1, "unit_amount_cents": 5000}


def _refused(res: httpx.Response) -> None:
    assert res.status_code == 409, res.text
    assert res.json()["error"] == "client_archived"


async def _archived(api: httpx.AsyncClient, db: AsyncSession) -> str:
    client_id = await new_client(db)
    assert (await api.post(f"/v1/clients/{client_id}/archive")).status_code == 200
    return client_id


async def test_archived_client_cannot_be_booked_until_restored(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    client_id = await _archived(as_owner, db)
    body = _booking(client_id, await _item(db))
    _refused(await as_owner.post("/v1/bookings", json=body))
    assert await db.scalar(select(Booking.id).where(Booking.client_id == client_id)) is None
    assert (await as_owner.post(f"/v1/clients/{client_id}/restore")).status_code == 200
    created = await as_owner.post("/v1/bookings", json=body)
    assert created.status_code == 201, created.text


async def test_archived_client_refuses_a_repeating_series(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    client_id = await _archived(as_owner, db)
    series = {**_booking(client_id, await _item(db)), "frequency": "week", "count": 2}
    _refused(await as_owner.post("/v1/recurrences", json=series))


@pytest.mark.parametrize("path", ["/v1/invoices", "/v1/estimates"])
async def test_archived_client_refuses_new_documents(
    as_owner: httpx.AsyncClient, db: AsyncSession, path: str
) -> None:
    client_id = await _archived(as_owner, db)
    _refused(await as_owner.post(path, json={"client_id": client_id, "lines": [_line()]}))


async def test_archived_client_refuses_a_new_sale_and_a_sale_moved_to_them(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    client_id = await _archived(as_owner, db)
    _refused(await as_owner.post("/v1/orders", json={"client_id": client_id, "lines": [_line()]}))
    other = await new_client(db)
    sale = await as_owner.post("/v1/orders", json={"client_id": other, "lines": [_line()]})
    assert sale.status_code == 201, sale.text
    _refused(await as_owner.patch(f"/v1/orders/{sale.json()['id']}", json={"client_id": client_id}))
    assert (
        await as_owner.patch(f"/v1/orders/{sale.json()['id']}", json={"note": "x"})
    ).status_code == 200


async def test_an_estimate_for_an_archived_client_is_not_converted(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    client_id = await new_client(db)
    est = await as_owner.post("/v1/estimates", json={"client_id": client_id, "lines": [_line()]})
    estimate_id = est.json()["id"]
    assert (await as_owner.post(f"/v1/estimates/{estimate_id}/send")).status_code == 200
    assert (await as_owner.post(f"/v1/clients/{client_id}/archive")).status_code == 200
    _refused(await as_owner.post(f"/v1/estimates/{estimate_id}/convert"))
    assert (await as_owner.post(f"/v1/clients/{client_id}/restore")).status_code == 200
    assert (await as_owner.post(f"/v1/estimates/{estimate_id}/convert")).status_code == 201


@pytest.mark.usefixtures("google_review_provider")
async def test_an_archived_client_is_not_asked_for_a_review(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    await configure_google_review_profile(db)
    client_id = await _archived(as_owner, db)
    _refused(await as_owner.post("/v1/reviews/request", json={"client_id": client_id}))
    assert sms.sent == []


async def test_new_work_for_a_merged_away_client_is_not_found(db: AsyncSession) -> None:
    client = await db.get(Client, await new_client(db))
    assert client is not None
    client.deleted_at = clock.now()
    await db.flush()
    with pytest.raises(NotFound):
        await assert_client_active(db, client)


async def test_a_sale_already_on_an_archived_client_stays_editable(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    client_id = await new_client(db)
    sale = await as_owner.post("/v1/orders", json={"client_id": client_id, "lines": [_line()]})
    assert (await as_owner.post(f"/v1/clients/{client_id}/archive")).status_code == 200
    same = await as_owner.patch(
        f"/v1/orders/{sale.json()['id']}", json={"client_id": client_id, "note": "keep"}
    )
    assert same.status_code == 200, same.text


async def test_a_booking_made_before_archiving_replays_on_its_key(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    client_id = await new_client(db)
    body = _booking(client_id, await _item(db))
    headers = key()
    first = await as_owner.post("/v1/bookings", json=body, headers=headers)
    assert first.status_code == 201, first.text
    assert (await as_owner.post(f"/v1/clients/{client_id}/archive")).status_code == 200
    again = await as_owner.post("/v1/bookings", json=body, headers=headers)
    assert again.status_code == 201
    assert again.json()["id"] == first.json()["id"]


async def test_archived_client_stays_readable_and_editable(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    client_id = await _archived(as_owner, db)
    renamed = await as_owner.patch(f"/v1/clients/{client_id}", json={"name": "Still Here"})
    assert renamed.status_code == 200 and renamed.json()["name"] == "Still Here"
    note = await as_owner.post(
        "/v1/notes", json={"parent_type": "client", "parent_id": client_id, "body": "Moved away"}
    )
    assert note.status_code == 201, note.text


async def test_archived_client_refuses_a_class_seat_and_a_program(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    client_id = await _archived(as_owner, db)
    slot = Slot(
        id=new_id("slot"),
        business_id=BIZ,
        item_id="it_puppy",
        staff_id=ST_OWNER,
        starts_at=datetime(2027, 3, 6, 18, tzinfo=UTC),
        ends_at=datetime(2027, 3, 6, 19, tzinfo=UTC),
        capacity=2,
        status="scheduled",
    )
    db.add(slot)
    await db.flush()
    _refused(await as_owner.post(f"/v1/classes/{slot.id}/roster", json={"client_id": client_id}))
    camp = await program(as_owner, db)
    _refused(
        await as_owner.post(
            f"/v1/programs/{camp}/enrolments", json={"client_id": client_id}, headers=key()
        )
    )


async def test_archived_client_refuses_a_package_and_a_gift_card(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    client_id = await _archived(as_owner, db)
    _refused(
        await as_owner.post("/v1/packages", json={"client_id": client_id, "item_id": "it_pkg5"})
    )
    _refused(
        await as_owner.post(
            "/v1/gift-cards", json={"amount_cents": 5000, "purchaser_client_id": client_id}
        )
    )


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/v1/forms/send", {"form_id": "frm_satisfaction"}),
        ("/v1/contracts/send", {"contract_id": "con_waiver"}),
    ],
)
async def test_archived_client_is_sent_no_form_or_contract(
    as_owner: httpx.AsyncClient, db: AsyncSession, path: str, body: dict[str, str]
) -> None:
    client_id = await _archived(as_owner, db)
    _refused(await as_owner.post(path, json={**body, "client_id": client_id}))


@pytest.mark.parametrize("path", ["/v1/payments/setup-intent", "/v1/payments/pad-links"])
async def test_archived_client_gets_no_card_or_bank_setup(
    as_owner: httpx.AsyncClient, db: AsyncSession, path: str
) -> None:
    await enable_payments(db)
    client_id = await _archived(as_owner, db)
    _refused(await as_owner.post(f"{path}/{client_id}"))


async def _restored_by_themselves(db: AsyncSession, client_id: str) -> None:
    client = await db.get(Client, client_id, populate_existing=True)
    assert client is not None
    assert (client.status, client.archived_at) == ("active", None)
    restores = await db.scalars(
        select(Audit.action).where(Audit.entity_id == client_id, Audit.action == "client.restore")
    )
    assert list(restores) == ["client.restore"]


async def test_an_archived_client_who_books_online_is_restored(
    as_owner: httpx.AsyncClient, api: httpx.AsyncClient, db: AsyncSession
) -> None:
    phone = "+16045550391"
    client_id = await new_client(db, phone=phone)
    assert (await as_owner.post(f"/v1/clients/{client_id}/archive")).status_code == 200
    booked = await api.post(
        "/book/birchbark",
        json={
            "item_id": "it_groom_sm",
            "staff_id": ST_OWNER,
            "starts_at": "2027-03-02T18:50:00Z",
            "client": {"name": "Back Again", "phone": phone},
        },
    )
    assert booked.status_code == 200, booked.text
    booking = await db.get(Booking, booked.json()["booking_id"])
    assert booking is not None and booking.client_id == client_id
    await _restored_by_themselves(db, client_id)


async def test_an_archived_client_who_orders_online_is_restored(
    as_owner: httpx.AsyncClient, api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    phone = "+16045550392"
    client_id = await new_client(db, phone=phone)
    assert (await as_owner.post(f"/v1/clients/{client_id}/archive")).status_code == 200
    ordered = await api.post(
        "/book/birchbark/shop/orders",
        json={
            "client": {"name": "Back Again", "phone": phone},
            "lines": [{"item_id": "it_shampoo", "quantity": 1}],
        },
        headers=key(),
    )
    assert ordered.status_code == 200, ordered.text
    order = await db.get(Order, ordered.json()["order_id"])
    assert order is not None and order.client_id == client_id
    await _restored_by_themselves(db, client_id)


async def test_an_archive_waits_for_new_work_already_under_way(db: AsyncSession) -> None:
    async with SessionLocal() as work, SessionLocal() as archive:
        client = await work.get(Client, "cl_amelie")
        assert client is not None
        await assert_client_active(work, client)
        archiving = asyncio.create_task(hold_client(archive, client.id))
        await asyncio.sleep(0.3)
        assert not archiving.done()
        await work.commit()
        await asyncio.wait_for(archiving, 5)
        await archive.rollback()


async def test_new_work_waits_for_an_archive_under_way_then_is_refused(db: AsyncSession) -> None:
    client = Client(id=new_id("client"), business_id=BIZ, name="Racing Archive")
    async with SessionLocal() as setup:
        setup.add(Client(id=client.id, business_id=BIZ, name=client.name))
        await setup.commit()
    try:
        async with SessionLocal() as archive, SessionLocal() as work:
            await hold_client(archive, client.id)
            await archive.execute(
                update(Client)
                .where(Client.id == client.id)
                .values(status="inactive", archived_at=clock.now())
            )
            starting = asyncio.create_task(assert_client_active(work, client))
            await asyncio.sleep(0.3)
            assert not starting.done()
            await archive.commit()
            with pytest.raises(Conflict):
                await asyncio.wait_for(starting, 5)
            await work.rollback()
    finally:
        async with SessionLocal() as cleanup:
            await cleanup.execute(delete(Client).where(Client.id == client.id))
            await cleanup.commit()
