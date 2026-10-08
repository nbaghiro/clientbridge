"""Print a token for each Connect page of the demo business as JSON, minting any a row lacks."""

import asyncio
import json
import secrets
from datetime import UTC, datetime

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.db import SessionLocal, engine
from clientbridge.core.ids import new_id
from clientbridge.models.billing import Estimate, Invoice, Order
from clientbridge.models.clients import Client
from clientbridge.models.documents import Contract, Form, FormResponse, Signature
from clientbridge.models.reviews import Review
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.services import ledger
from clientbridge.services.consents import prefs_token

BIZ = "bz_birchbark"

type Tokened = Invoice | Estimate | Order | Review | Booking | FormResponse | Signature


async def _minted[T: Tokened](db: AsyncSession, query: Select[tuple[T]], column: str) -> str:
    row = (await db.execute(query.limit(1))).scalars().first()
    if row is None:
        raise SystemExit(f"no seeded row for {column}")
    if getattr(row, column) is None:
        setattr(row, column, secrets.token_urlsafe(16))
    return str(getattr(row, column))


async def _open_invoice(db: AsyncSession) -> str:
    sent = select(Invoice).where(Invoice.business_id == BIZ, Invoice.status == "sent")
    for invoice in (await db.execute(sent.order_by(Invoice.id))).scalars():
        if await ledger.invoice_balance(db, invoice) > 0:
            invoice.pay_token = invoice.pay_token or secrets.token_urlsafe(16)
            return invoice.pay_token
    raise SystemExit("no seeded invoice with a balance")


async def _form_draft(db: AsyncSession, client_id: str) -> str:
    draft = select(FormResponse).where(
        FormResponse.business_id == BIZ,
        FormResponse.status == "draft",
        FormResponse.token.is_not(None),
    )
    found = (await db.execute(draft.limit(1))).scalars().first()
    if found is not None and found.token is not None:
        return found.token
    form = (await db.execute(select(Form).where(Form.business_id == BIZ).limit(1))).scalar_one()
    response = FormResponse(
        id=new_id("form_response"),
        business_id=BIZ,
        form_id=form.id,
        client_id=client_id,
        status="draft",
        token=secrets.token_urlsafe(16),
    )
    db.add(response)
    return str(response.token)


async def _pending_signature(db: AsyncSession, client_id: str) -> str:
    pending = select(Signature).where(
        Signature.business_id == BIZ,
        Signature.status == "pending",
        Signature.token.is_not(None),
    )
    found = (await db.execute(pending.limit(1))).scalars().first()
    if found is not None and found.token is not None:
        return found.token
    contract = (
        await db.execute(select(Contract).where(Contract.business_id == BIZ).limit(1))
    ).scalar_one()
    signature = Signature(
        id=new_id("signature"),
        business_id=BIZ,
        contract_id=contract.id,
        client_id=client_id,
        status="pending",
        contract_version=contract.version,
        token=secrets.token_urlsafe(16),
    )
    db.add(signature)
    return str(signature.token)


async def main() -> None:
    now = datetime.now(UTC)
    async with SessionLocal() as db:
        client = (
            await db.execute(
                select(Client).where(Client.business_id == BIZ, Client.email.is_not(None)).limit(1)
            )
        ).scalar_one()
        links = {
            "slug": "birchbark",
            "invoice": await _open_invoice(db),
            "estimate": await _minted(
                db,
                select(Estimate)
                .where(Estimate.business_id == BIZ, Estimate.status == "sent")
                .order_by(Estimate.id),
                "view_token",
            ),
            "receipt": await _minted(
                db,
                select(Order)
                .where(Order.business_id == BIZ, Order.number.is_not(None))
                .order_by(Order.number.desc(), Order.id),
                "receipt_token",
            ),
            "order": await _minted(
                db,
                select(Order)
                .where(Order.business_id == BIZ, Order.source == "online")
                .order_by(Order.created_at.desc()),
                "status_token",
            ),
            "review": await _minted(
                db,
                select(Review).where(
                    Review.business_id == BIZ, Review.status.in_(("requested", "opened"))
                ),
                "token",
            ),
            "manage": await _minted(
                db,
                select(Booking)
                .join(Slot, Slot.id == Booking.slot_id)
                .where(
                    Booking.business_id == BIZ,
                    Booking.source == "online",
                    Booking.status == "confirmed",
                    Booking.deleted_at.is_(None),
                    Slot.starts_at > now,
                )
                .order_by(Slot.starts_at.desc(), Booking.id),
                "manage_token",
            ),
            "form": await _form_draft(db, client.id),
            "contract": await _pending_signature(db, client.id),
            "prefs": prefs_token(client.id),
        }
        await db.commit()
    await engine.dispose()
    print(json.dumps(links))


if __name__ == "__main__":
    asyncio.run(main())
