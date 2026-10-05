"""Connect the demo business to a verified Stripe test-mode account.

The seed runs this whenever backend/.env has a test secret key (STRIPE_SECRET_KEY=sk_test_...). It
reuses the account it created before (found by metadata), so reruns don't pile up accounts. The
identity and bank values are Stripe's documented test values, which verify instantly.
"""

import asyncio
import time

import stripe
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.config import get_settings
from clientbridge.core.db import SessionLocal, engine
from clientbridge.integrations.payments import get_payment_gateway
from clientbridge.models.identity import Business
from clientbridge.services.business import apply_account_status

BIZ = "bz_birchbark"
DEMO_TAG = {"clientbridge_demo": BIZ}

_ACCOUNT: dict[str, object] = {
    "type": "custom",
    "country": "CA",
    "email": "hello@birchbarkpets.ca",
    "business_type": "individual",
    "metadata": DEMO_TAG,
    "capabilities": {"card_payments": {"requested": True}, "transfers": {"requested": True}},
    "business_profile": {
        "name": "Birchbark Pet Studio",
        "mcc": "7299",
        "url": "https://birchbarkpets.ca",
        "product_description": "Pet grooming and daycare",
    },
    "individual": {
        "first_name": "Hannah",
        "last_name": "Wong",
        "email": "hannah@birchbarkpets.ca",
        "phone": "+16045550123",
        "dob": {"day": 1, "month": 1, "year": 1901},
        "id_number": "000000000",
        "address": {
            "line1": "address_full_match",
            "city": "Victoria",
            "state": "BC",
            "postal_code": "V8W 1A1",
            "country": "CA",
        },
    },
    "external_account": {
        "object": "bank_account",
        "country": "CA",
        "currency": "cad",
        "routing_number": "11000-000",
        "account_number": "000123456789",
    },
}


def demo_account_id() -> str:
    for account in stripe.Account.list(limit=100).auto_paging_iter():
        metadata = account.to_dict().get("metadata") or {}
        if isinstance(metadata, dict) and metadata.get("clientbridge_demo") == BIZ:
            return str(account.id)
    params = {**_ACCOUNT, "tos_acceptance": {"date": int(time.time()), "ip": "127.0.0.1"}}
    return str(stripe.Account.create(**params).id)  # type: ignore[arg-type]  # loose Stripe kwargs


async def connect_demo_business(session: AsyncSession) -> str | None:
    """Point the demo business at its test account; None (no-op) without a test-mode key."""
    key = get_settings().stripe_secret_key
    if not key.startswith("sk_test_"):
        return None
    stripe.api_key = key
    account_id = demo_account_id()
    business = await session.get(Business, BIZ)
    if business is None:
        return None
    business.stripe_account_id = account_id
    apply_account_status(business, await get_payment_gateway().get_account(account_id))
    await session.commit()
    return account_id


async def main() -> None:
    async with SessionLocal() as session:
        account_id = await connect_demo_business(session)
    await engine.dispose()
    if account_id is None:
        print("no sk_test_ key in backend/.env; the demo stays unconnected")
    else:
        print(f"demo business connected to {account_id}")


if __name__ == "__main__":
    asyncio.run(main())
