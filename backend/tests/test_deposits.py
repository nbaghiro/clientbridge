import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice
from clientbridge.models.catalog import Item
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking

BIZ = "bz_birchbark"
ST_OWNER = "st_owner"


async def _client_and_item(db: AsyncSession) -> tuple[str, str]:
    client_id = (
        (await db.execute(select(Client.id).where(Client.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    item_id = (
        (
            await db.execute(
                select(Item.id)
                .where(Item.business_id == BIZ, Item.duration_min.isnot(None))
                .limit(1)
            )
        )
        .scalars()
        .first()
    )
    assert client_id and item_id
    return client_id, item_id


def _booking(client_id: str, item_id: str, starts: str) -> dict[str, str]:
    return {
        "client_id": client_id,
        "item_id": item_id,
        "staff_id": ST_OWNER,
        "starts_at": starts,
    }


async def test_booking_flags_deposit_required(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid, iid = await _client_and_item(db)
    await db.execute(
        update(Item).where(Item.id == iid).values(deposit_type="percent", deposit_value=20)
    )
    await db.flush()
    res = await as_owner.post("/v1/bookings", json=_booking(cid, iid, "2027-04-01T10:00:00Z"))
    assert res.status_code == 201, res.text
    bk = (await db.execute(select(Booking).where(Booking.id == res.json()["id"]))).scalar_one()
    assert bk.deposit_required is True


async def test_booking_no_deposit_when_item_has_none(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid, iid = await _client_and_item(db)
    await db.execute(update(Item).where(Item.id == iid).values(deposit_type="none"))
    await db.flush()
    res = await as_owner.post("/v1/bookings", json=_booking(cid, iid, "2027-04-02T10:00:00Z"))
    assert res.status_code == 201
    bk = (await db.execute(select(Booking).where(Booking.id == res.json()["id"]))).scalar_one()
    assert bk.deposit_required is False


async def _enable(db: AsyncSession) -> None:
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_account_id="acct_test", stripe_charges_enabled=True)
    )
    await db.flush()


async def _invoice(db: AsyncSession, *, total: int = 10000) -> str:
    cid = (
        (await db.execute(select(Client.id).where(Client.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert cid
    inv = Invoice(
        id=new_id("invoice"),
        business_id=BIZ,
        client_id=cid,
        number=9800,
        status="sent",
        currency="CAD",
        subtotal_cents=total,
        tax_total_cents=0,
        total_cents=total,
        balance_cents=total,
    )
    db.add(inv)
    await db.flush()
    return inv.id


async def test_card_deposit_is_marked_kind_deposit(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
    inv_id = await _invoice(db)
    res = await as_owner.post(f"/v1/payments/invoice/{inv_id}?amount_cents=2000&deposit=true")
    assert res.status_code == 200, res.text
    pay = (
        await db.execute(select(Payment).where(Payment.id == res.json()["payment_id"]))
    ).scalar_one()
    assert pay.kind == "deposit" and pay.amount_cents == 2000


async def test_interac_deposit_is_marked_kind_deposit(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    inv_id = await _invoice(db, total=8000)
    res = await as_owner.post(
        f"/v1/payments/invoice/{inv_id}/interac?amount_cents=3000&deposit=true"
    )
    assert res.status_code == 200, res.text
    pay = (
        await db.execute(select(Payment).where(Payment.id == res.json()["payment_id"]))
    ).scalar_one()
    assert pay.kind == "deposit" and pay.method == "interac"
