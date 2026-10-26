"""Register exact deposit fixtures, a booking or an enrolment's client, before any intent."""

import argparse
import asyncio
import json
import os
from pathlib import Path
from typing import Literal, cast

import stripe
from pydantic import BaseModel, ConfigDict, TypeAdapter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.db import SessionLocal, engine
from clientbridge.integrations.stripe import close_stripe_client
from clientbridge.models.billing import Invoice, Line
from clientbridge.models.business import Business
from clientbridge.models.clients import Client
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking
from scripts.e2e_stripe_browser import BUSINESS
from scripts.e2e_stripe_setup import cleanup_intent, identity, save, state_path, validate_context


class DepositFixture(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # an enrolment's client books on Connect, which opens the deposit, so the client registers first
    kind: Literal["booking", "enrolment"] = "booking"
    booking: str | None = None
    client: str
    customer: str | None = None
    amount_cents: Literal[2000] = 2000
    currency: Literal["CAD"] = "CAD"
    invoice: str | None = None


def deposit_fixtures(state: dict[str, object], *, complete: bool = False) -> list[DepositFixture]:
    fixtures = TypeAdapter(list[DepositFixture]).validate_python(state.get("deposit_fixtures", []))
    if any(f.kind == "booking" and not f.booking for f in fixtures):
        raise ValueError("a visit deposit fixture names its booking")
    for field in ("booking", "client", "customer"):
        values = [getattr(fixture, field) for fixture in fixtures]
        present = [value for value in values if value]
        # an enrolment may still be unbound when cleanup runs; its customer then has no intent
        expected = (
            [v for f, v in zip(fixtures, values, strict=True) if f.kind == "booking" or v]
            if field == "booking"
            else values
        )
        if len(present) != len(set(present)) or (complete and len(present) != len(expected)):
            raise ValueError("incomplete or duplicate deposit lineage; cannot prove cleanup")
    return fixtures


def load_deposit(state: dict[str, object], booking_id: str) -> DepositFixture:
    matches = [fixture for fixture in deposit_fixtures(state) if fixture.booking == booking_id]
    if len(matches) != 1:
        raise ValueError("booking is not a unique registered deposit fixture")
    return matches[0]


def deposit_tags(run: str, booking: str, client: str) -> dict[str, str]:
    return {
        "clientbridge_qa": "payments",
        "clientbridge_qa_environment": os.environ.get("STRIPE_BROWSER_ENVIRONMENT", "local"),
        "clientbridge_qa_run": run,
        "clientbridge_qa_booking": booking,
        "clientbridge_qa_client": client,
    }


def enrolment_tags(run: str, client: str) -> dict[str, str]:
    return {
        "clientbridge_qa": "payments",
        "clientbridge_qa_environment": os.environ.get("STRIPE_BROWSER_ENVIRONMENT", "local"),
        "clientbridge_qa_run": run,
        "clientbridge_qa_enrolment": client,
        "clientbridge_qa_client": client,
    }


def fixture_tags(run: str, fixture: DepositFixture) -> dict[str, str]:
    """The tags the fixture's customer carries, fixed when it is created."""
    if fixture.kind == "enrolment":
        return enrolment_tags(run, fixture.client)
    if fixture.booking is None:
        raise ValueError("a visit deposit fixture names its booking")
    return deposit_tags(run, fixture.booking, fixture.client)


def validate_deposit_intent(intent: stripe.PaymentIntent, fixture: DepositFixture) -> None:
    metadata = intent.to_dict().get("metadata", {})
    if (
        intent.livemode
        or intent.customer != fixture.customer
        or intent.amount != 2000
        or intent.currency != "cad"
        or metadata.get("booking_id") != fixture.booking
        or metadata.get("business_id") != BUSINESS
        or metadata.get("invoice_id")
    ):
        raise ValueError("deposit customer has unrelated provider intent")


async def validate_booking(db: AsyncSession, fixture: DepositFixture) -> tuple[Booking, Client]:
    if fixture.booking is None:
        raise ValueError("the deposit fixture is not bound to a booking yet")
    booking = await db.get(Booking, fixture.booking)
    client = await db.get(Client, fixture.client)
    if (
        booking is None
        or client is None
        or booking.business_id != BUSINESS
        or client.business_id != BUSINESS
        or booking.client_id != client.id
        or booking.deposit_amount_cents != fixture.amount_cents
        or booking.deleted_at is not None
        or client.deleted_at is not None
    ):
        raise ValueError("deposit booking/client/amount ownership mismatch")
    if fixture.invoice:
        invoice = await db.get(Invoice, fixture.invoice)
        linked = await db.scalar(
            select(Line.id).where(
                Line.invoice_id == fixture.invoice,
                Line.booking_id == fixture.booking,
                Line.business_id == BUSINESS,
            )
        )
        if (
            invoice is None
            or invoice.business_id != BUSINESS
            or invoice.client_id != client.id
            or not linked
        ):
            raise ValueError("deposit invoice is not linked to the exact booking/client")
    return booking, client


async def create_deposit_customer(
    path: Path,
    state: dict[str, object],
    fixture: DepositFixture,
    account: str,
    name: str,
    email: str,
) -> stripe.Customer:
    registered = [f for f in deposit_fixtures(state) if f.client == fixture.client]
    if registered != [fixture] or state.get("account") != account:
        raise ValueError("customer write lacks exact registered deposit lineage")
    save(path, state)
    expected = fixture_tags(str(state["run_id"]), fixture)
    owner = fixture.booking if fixture.kind == "booking" else f"enrolment:{fixture.client}"
    customer = await stripe.Customer.create_async(
        name=name,
        email=email,
        metadata=expected,
        stripe_account=account,
        idempotency_key=f"browser:{state['run_id']}:deposit:{owner}:customer",
    )
    if (
        customer.livemode
        or customer.to_dict().get("metadata") != expected
        or fixture.customer not in (None, customer.id)
    ):
        raise ValueError("deposit customer ownership mismatch")
    return customer


async def register_client(
    db: AsyncSession, path: Path, state: dict[str, object], account: str, client_id: str
) -> DepositFixture:
    """File a client who has never booked as an enrolment fixture, before it books on Connect."""
    fixtures = deposit_fixtures(state)
    client = await db.get(Client, client_id)
    if client is None or client.business_id != BUSINESS or client.deleted_at is not None:
        raise ValueError("client does not belong to the fixture business")
    if client.stripe_customer_id is not None:
        raise ValueError("refusing to adopt pre-existing customer")
    booked = await db.scalar(select(Booking.id).where(Booking.client_id == client_id).limit(1))
    paid = await db.scalar(select(Payment.id).where(Payment.client_id == client_id).limit(1))
    if booked is not None or paid is not None:
        raise ValueError("register an enrolment's client before it books or pays")
    if any(item.client == client_id for item in fixtures) or any(
        item.get("client") == client_id for item in cast(list[dict[str, str]], state["fixtures"])
    ):
        raise ValueError("deposit client already belongs to another fixture")
    fixture = DepositFixture(kind="enrolment", client=client_id)
    fixtures.append(fixture)
    state["deposit_fixtures"] = [item.model_dump(exclude_none=True) for item in fixtures]
    customer = await create_deposit_customer(
        path, state, fixture, account, client.name, client.email or ""
    )
    fixture.customer = customer.id
    state["deposit_fixtures"] = [item.model_dump(exclude_none=True) for item in fixtures]
    save(path, state)
    client.stripe_customer_id = customer.id
    await db.commit()
    return fixture


async def bind_enrolment(
    db: AsyncSession, path: Path, state: dict[str, object], client_id: str, booking_id: str
) -> DepositFixture:
    """Name the enrolment's first day, the booking that carries its deposit."""
    fixtures = deposit_fixtures(state)
    matches = [f for f in fixtures if f.kind == "enrolment" and f.client == client_id]
    if len(matches) != 1 or matches[0].booking not in (None, booking_id):
        raise ValueError("client is not one unbound enrolment fixture")
    fixture = matches[0]
    fixture.booking = booking_id
    booking, _ = await validate_booking(db, fixture)
    if booking.deposit_status not in ("pending", "collected", "applied"):
        raise ValueError("the enrolment's first day carries no deposit")
    state["deposit_fixtures"] = [item.model_dump(exclude_none=True) for item in fixtures]
    deposit_fixtures(state)
    save(path, state)
    return fixture


async def operate(action: str, booking_id: str, invoice_id: str | None) -> dict[str, object]:
    account = await validate_context()
    path = state_path()
    state = json.loads(path.read_text())
    if any(state.get(key) != value for key, value in identity(account).items()):
        raise ValueError("deposit manifest identity mismatch")
    fixtures = deposit_fixtures(state)
    async with SessionLocal() as db:
        business = await db.get(Business, BUSINESS)
        if (
            business is None
            or business.stripe_account_id != account
            or not business.stripe_charges_enabled
        ):
            raise ValueError("isolated business is not bound to ready QA account")
        if action == "register-client":
            fixture = await register_client(db, path, state, account, booking_id)
        elif action == "bind":
            if invoice_id is None:
                raise ValueError("bind needs the client and its first booking")
            fixture = await bind_enrolment(db, path, state, booking_id, invoice_id)
        elif action == "register":
            booking = await db.get(Booking, booking_id)
            if booking is None or booking.business_id != BUSINESS:
                raise ValueError("booking does not belong to fixture business")
            fixture = next((item for item in fixtures if item.booking == booking_id), None)
            if fixture is None:
                fixture = DepositFixture(booking=booking_id, client=booking.client_id)
                _, client = await validate_booking(db, fixture)
                if client.stripe_customer_id is not None:
                    raise ValueError("refusing to adopt pre-existing customer")
                prior = await db.scalar(select(Payment.id).where(Payment.booking_id == booking_id))
                if prior is not None or booking.deposit_status != "pending":
                    raise ValueError("register deposit before any collection attempt")
                if any(item.client == fixture.client for item in fixtures) or any(
                    item.get("client") == fixture.client for item in state.get("fixtures", [])
                ):
                    raise ValueError("deposit client already belongs to another fixture")
                fixtures.append(fixture)
                state["deposit_fixtures"] = [
                    item.model_dump(exclude_none=True) for item in fixtures
                ]
                deposit_fixtures(state)
            _, client = await validate_booking(db, fixture)
            if client.stripe_customer_id not in (None, fixture.customer):
                raise ValueError("registered deposit client customer changed")
            customer = await create_deposit_customer(
                path, state, fixture, account, client.name, client.email or ""
            )
            if client.stripe_customer_id not in (None, customer.id):
                raise ValueError("deposit DB customer ownership mismatch")
            fixture.customer = customer.id
            state["deposit_fixtures"] = [item.model_dump(exclude_none=True) for item in fixtures]
            save(path, state)
            client.stripe_customer_id = customer.id
            await db.commit()
        else:
            fixture = load_deposit(state, booking_id)
            if not fixture.customer or not invoice_id or fixture.invoice not in (None, invoice_id):
                raise ValueError("deposit invoice linkage incomplete or changed")
            fixture.invoice = invoice_id
            await validate_booking(db, fixture)
            state["deposit_fixtures"] = [
                fixture.model_dump(exclude_none=True)
                if item.booking == booking_id
                else item.model_dump(exclude_none=True)
                for item in fixtures
            ]
            save(path, state)
        return {
            "kind": "booking_deposit" if fixture.kind == "booking" else "enrolment_deposit",
            "bookingId": fixture.booking,
            "clientId": fixture.client,
            "account": account,
            "amountCents": fixture.amount_cents,
            "currency": fixture.currency,
        }


async def cleanup_deposits(
    db: AsyncSession, state: dict[str, object], account: str
) -> list[dict[str, object]]:
    fixtures = deposit_fixtures(state, complete=True)
    owned: list[tuple[stripe.PaymentIntent, dict[str, str]]] = []
    for fixture in fixtures:
        if fixture.customer is None:
            raise ValueError("deposit customer missing")
        expected = fixture_tags(str(state["run_id"]), fixture)
        if fixture.booking is None:
            intents = await stripe.PaymentIntent.list_async(
                customer=fixture.customer, stripe_account=account, limit=1
            )
            if intents.data:
                raise ValueError("an unbound enrolment's customer has an intent; bind it first")
            continue
        _, client = await validate_booking(db, fixture)
        if client.stripe_customer_id not in (None, fixture.customer):
            raise ValueError("deposit DB customer changed")
        customer = await stripe.Customer.retrieve_async(fixture.customer, stripe_account=account)
        if (
            customer.livemode
            or customer.id != fixture.customer
            or customer.to_dict().get("metadata") != expected
        ):
            raise ValueError("deposit customer tags changed")
        intents = await stripe.PaymentIntent.list_async(
            customer=customer.id, stripe_account=account
        )
        async for intent in intents.auto_paging_iter():
            validate_deposit_intent(intent, fixture)
            payment = await db.scalar(select(Payment).where(Payment.provider_ref == intent.id))
            if payment is not None and (
                payment.business_id != BUSINESS
                or payment.booking_id != fixture.booking
                or payment.kind != "deposit"
                or payment.invoice_id is not None
            ):
                raise ValueError("deposit provider intent maps to unrelated local payment")
            owned.append((intent, expected))
    for intent, metadata in owned:
        await cleanup_intent(account, intent, metadata, apply=False)
    return [await cleanup_intent(account, intent, metadata) for intent, metadata in owned]


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("register", "link", "register-client", "bind"))
    parser.add_argument("booking_id", help="the booking, or the client for register-client/bind")
    parser.add_argument("invoice_id", nargs="?", help="the invoice, or the booking for bind")
    args = parser.parse_args()
    try:
        print(json.dumps(await operate(args.action, args.booking_id, args.invoice_id)))
    finally:
        await close_stripe_client()
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
