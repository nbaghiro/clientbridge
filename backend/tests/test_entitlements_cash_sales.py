"""Packages and gift cards paid in cash at the desk: settled on the spot, no Stripe needed."""

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.catalog import GiftCard, Package
from clientbridge.models.payments import Payment
from clientbridge.services import ledger
from tests.conftest import Factory
from tests.helpers import business_balance, client_id, enable_payments, key, ok, owner_balance

PKG_ITEM = "it_pkg5"
PKG_TAXED = 21000


async def test_cash_package_is_active_with_its_value_deferred(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db, account=None)
    cid = await client_id(db)
    cash = await business_balance(db, "cash")
    out = ok(
        await as_owner.post(
            "/v1/packages",
            json={"client_id": cid, "item_id": PKG_ITEM, "cash": True},
            headers=key(),
        ),
        201,
    ).json()
    assert out["client_secret"] is None
    pkg = (await db.execute(select(Package).where(Package.id == out["package_id"]))).scalar_one()
    assert pkg.status == "active"
    row = (await db.execute(select(Payment).where(Payment.id == out["payment_id"]))).scalar_one()
    assert (row.provider, row.method, row.status) == ("manual", "cash", "succeeded")
    assert await business_balance(db, "cash") == cash + PKG_TAXED
    assert await owner_balance(db, "package", pkg.id, "deferred") == -20000


async def test_cash_gift_card_is_active_with_its_balance(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await client_id(db)
    body = {"purchaser_client_id": cid, "amount_cents": 7500, "recipient": "Dana", "cash": True}
    out = ok(await as_owner.post("/v1/gift-cards", json=body, headers=key()), 201).json()
    card = (
        await db.execute(select(GiftCard).where(GiftCard.id == out["gift_card_id"]))
    ).scalar_one()
    assert card.status == "active"
    assert await ledger.gift_card_balance(db, card) == 7500


async def test_cash_and_card_together_are_refused(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await client_id(db)
    body = {"client_id": cid, "item_id": PKG_ITEM, "cash": True, "payment_method_id": "default"}
    assert (await as_owner.post("/v1/packages", json=body)).status_code == 422


async def test_staff_cannot_sell_for_cash(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await client_id(db)
    body = {"purchaser_client_id": cid, "amount_cents": 5000, "cash": True}
    assert (await as_staff.post("/v1/gift-cards", json=body)).status_code == 403


async def test_foreign_client_is_not_found(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    client = await factory.client(business=other)
    body = {"client_id": client.id, "item_id": PKG_ITEM, "cash": True}
    assert (await as_owner.post("/v1/packages", json=body)).status_code == 404


async def test_same_key_sells_once(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await client_id(db)
    headers = key()
    body = {"purchaser_client_id": cid, "amount_cents": 2500, "cash": True}
    first = ok(await as_owner.post("/v1/gift-cards", json=body, headers=headers), 201).json()
    again = ok(await as_owner.post("/v1/gift-cards", json=body, headers=headers), 201).json()
    assert first == again


async def test_cash_package_refund_is_by_hand_and_voids_it(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await client_id(db)
    out = ok(
        await as_owner.post(
            "/v1/packages", json={"client_id": cid, "item_id": PKG_ITEM, "cash": True}
        ),
        201,
    ).json()
    part = await as_owner.post(
        f"/v1/payments/{out['payment_id']}/refund", json={"amount_cents": 100}
    )
    assert part.status_code == 409
    done = ok(await as_owner.post(f"/v1/payments/{out['payment_id']}/refund", json={})).json()
    assert done["credit_note"].startswith("CN-P-")
    pkg = (await db.execute(select(Package).where(Package.id == out["package_id"]))).scalar_one()
    await db.refresh(pkg)
    assert pkg.status == "canceled"
