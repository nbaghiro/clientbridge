"""Print a token for each Connect page of a demo business as JSON, minting any a row lacks."""

import argparse
import asyncio
import json
import secrets

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.db import SessionLocal, engine
from clientbridge.core.ids import new_id
from clientbridge.models.billing import Estimate, Invoice, Order
from clientbridge.models.business import Business
from clientbridge.models.clients import Client
from clientbridge.models.documents import Contract, Form, FormResponse, Signature
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.services import ledger
from clientbridge.services.consents import prefs_token
from clientbridge.services.forms import snapshot_form

type Tokened = Invoice | Estimate | Order | Booking | FormResponse | Signature


async def _minted[T: Tokened](db: AsyncSession, query: Select[tuple[T]], column: str) -> str | None:
    """A page the business has no row for, such as a shop order, is left out of the links."""
    row = (await db.execute(query.limit(1))).scalars().first()
    if row is None:
        return None
    if getattr(row, column) is None:
        setattr(row, column, secrets.token_urlsafe(16))
    return str(getattr(row, column))


async def _open_invoice(db: AsyncSession, biz: str) -> str:
    sent = select(Invoice).where(Invoice.business_id == biz, Invoice.status == "sent")
    for invoice in (await db.execute(sent.order_by(Invoice.id))).scalars():
        if await ledger.invoice_balance(db, invoice) > 0:
            token = invoice.pay_token or secrets.token_urlsafe(16)
            invoice.pay_token = token
            return token
    raise SystemExit("no seeded invoice with a balance")


async def _form_draft(db: AsyncSession, biz: str, client_id: str) -> str:
    draft = select(FormResponse).where(
        FormResponse.business_id == biz,
        FormResponse.status == "draft",
        FormResponse.token.is_not(None),
    )
    found = (await db.execute(draft.limit(1))).scalars().first()
    if found is not None and found.token is not None:
        return found.token
    form = (await db.execute(select(Form).where(Form.business_id == biz).limit(1))).scalar_one()
    response = FormResponse(
        definition=await snapshot_form(db, form),
        id=new_id("form_response"),
        business_id=biz,
        form_id=form.id,
        client_id=client_id,
        status="draft",
        token=secrets.token_urlsafe(16),
    )
    db.add(response)
    return str(response.token)


async def _pending_signature(db: AsyncSession, biz: str, client_id: str) -> str:
    pending = select(Signature).where(
        Signature.business_id == biz,
        Signature.status == "pending",
        Signature.token.is_not(None),
    )
    found = (await db.execute(pending.limit(1))).scalars().first()
    if found is not None and found.token is not None:
        return found.token
    contract = (
        await db.execute(select(Contract).where(Contract.business_id == biz).limit(1))
    ).scalar_one()
    signature = Signature(
        id=new_id("signature"),
        business_id=biz,
        contract_id=contract.id,
        client_id=client_id,
        status="pending",
        contract_version=contract.version,
        token=secrets.token_urlsafe(16),
    )
    db.add(signature)
    return str(signature.token)


async def main(biz: str) -> None:
    now = clock.now()
    async with SessionLocal() as db:
        client = (
            await db.execute(
                select(Client).where(Client.business_id == biz, Client.email.is_not(None)).limit(1)
            )
        ).scalar_one()
        business = await db.get(Business, biz)
        if business is None:
            raise SystemExit(f"no seeded business {biz}")
        links = {
            "slug": business.slug,
            "invoice": await _open_invoice(db, biz),
            "estimate": await _minted(
                db,
                select(Estimate)
                .where(Estimate.business_id == biz, Estimate.status == "sent")
                .order_by(Estimate.id),
                "view_token",
            ),
            "receipt": await _minted(
                db,
                select(Order)
                .where(Order.business_id == biz, Order.number.is_not(None))
                .order_by(Order.number.desc(), Order.id),
                "receipt_token",
            ),
            "order": await _minted(
                db,
                select(Order)
                .where(Order.business_id == biz, Order.source == "online")
                .order_by(Order.created_at.desc()),
                "status_token",
            ),
            "manage": await _minted(
                db,
                select(Booking)
                .join(Slot, Slot.id == Booking.slot_id)
                .where(
                    Booking.business_id == biz,
                    Booking.source == "online",
                    Booking.status == "confirmed",
                    Booking.deleted_at.is_(None),
                    Slot.starts_at > now,
                )
                .order_by(Slot.starts_at.desc(), Booking.id),
                "manage_token",
            ),
            "form": await _form_draft(db, biz, client.id),
            "contract": await _pending_signature(db, biz, client.id),
            "prefs": prefs_token(client.id),
        }
        await db.commit()
    await engine.dispose()
    print(json.dumps({page: token for page, token in links.items() if token is not None}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--business", default="bz_birchbark")
    asyncio.run(main(parser.parse_args().business))
