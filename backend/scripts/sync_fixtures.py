import asyncio
from datetime import time, timedelta
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.config import get_settings
from clientbridge.core.db import SessionLocal, engine
from clientbridge.models.billing import Invoice, Line, Order
from clientbridge.models.business import Business, Staff, User
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client
from clientbridge.models.ledger import Account, Entry
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking, Hours, Slot
from scripts.demo_context import run_email, run_id
from scripts.tier import DATABASE


def sync_identity(role: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"clientbridge-sync:{get_settings().run_namespace}:{role}"))


def require_run() -> None:
    """Sync fixtures live in the tier's database under a run's namespace, never anywhere else."""
    if not get_settings().run_namespace or engine.url.database != DATABASE:
        raise RuntimeError("sync fixtures need RUN_NAMESPACE and the test tier's database")


async def seed() -> None:
    require_run()
    async with SessionLocal() as db:
        for name in ("first", "second", "foreign"):
            db.add(
                Business(
                    id=run_id(f"bz_{name}"),
                    name=name,
                    slug=f"sync-{name}-{get_settings().run_namespace}",
                    gst_hst_number="private-tax-number",
                )
            )
        for role in ("owner", "admin", "staff", "contractor", "multi", "foreign", "removed"):
            db.add(
                User(
                    id=run_id(f"us_{role}"),
                    identity_id=sync_identity(role),
                    email=run_email(f"{role}@sync.test"),
                    name=role,
                )
            )
        await db.flush()
        for name in ("first", "second", "foreign"):
            db.add(
                Client(
                    id=run_id(f"cl_{name}"),
                    business_id=run_id(f"bz_{name}"),
                    name=name,
                    stripe_customer_id=f"private-provider-{name}",
                )
            )
        for role in ("owner", "admin", "staff", "contractor", "multi", "foreign"):
            business = "foreign" if role == "foreign" else "first"
            db.add(
                Staff(
                    id=run_id(f"st_{role}"),
                    business_id=run_id(f"bz_{business}"),
                    user_id=run_id(f"us_{role}"),
                    role="owner" if role in ("multi", "foreign") else role,
                    status="active",
                    rate_cents=3456,
                    rate_type="hourly",
                    invite_token=f"private-invite-{role}",
                )
            )
        db.add(
            Staff(
                id=run_id("st_second"),
                business_id=run_id("bz_second"),
                user_id=run_id("us_multi"),
                role="staff",
                status="active",
            )
        )
        # a former member gets no access, but their name still reaches their old business
        db.add(
            Staff(
                id=run_id("st_removed"),
                business_id=run_id("bz_first"),
                user_id=run_id("us_removed"),
                role="staff",
                status="removed",
                rate_cents=3456,
                rate_type="hourly",
            )
        )
        await db.flush()
        for staff, business in (
            ("owner", "first"),
            ("staff", "first"),
            ("second", "second"),
            ("foreign", "foreign"),
        ):
            db.add(
                Hours(
                    id=run_id(f"av_{staff}"),
                    business_id=run_id(f"bz_{business}"),
                    staff_id=run_id(f"st_{staff}"),
                    basis="recurring",
                    weekday=1,
                    start_time=time(9),
                    end_time=time(17),
                    available=True,
                    note="server baseline",
                )
            )
        await financial(db)
        await db.commit()
    await engine.dispose()


async def financial(db: AsyncSession) -> None:
    """One row of each owner-only or self-only record type, so the replica check covers them."""
    today = clock.now().replace(hour=15, minute=0, second=0, microsecond=0)
    start = today + timedelta(days=7)
    db.add(
        Item(id=run_id("it_first"), business_id=run_id("bz_first"), kind="service", name="Groom")
    )
    db.add(
        Invoice(
            id=run_id("inv_first"),
            business_id=run_id("bz_first"),
            client_id=run_id("cl_first"),
            status="sent",
        )
    )
    db.add(
        Order(
            id=run_id("ord_first"),
            business_id=run_id("bz_first"),
            staff_id=run_id("st_staff"),
            source="online",
        )
    )
    for staff in ("owner", "staff"):
        db.add(
            Account(
                id=run_id(f"ac_{staff}"),
                business_id=run_id("bz_first"),
                owner_type="staff",
                owner_id=run_id(f"st_{staff}"),
                category="payable",
            )
        )
    db.add(
        Account(
            id=run_id("ac_revenue"),
            business_id=run_id("bz_first"),
            owner_type="business",
            owner_id=run_id("bz_first"),
            category="revenue",
        )
    )
    await db.flush()
    for staff in ("owner", "staff"):
        db.add(
            Slot(
                id=run_id(f"sl_{staff}"),
                business_id=run_id("bz_first"),
                item_id=run_id("it_first"),
                staff_id=run_id(f"st_{staff}"),
                starts_at=start,
                ends_at=start + timedelta(hours=1),
            )
        )
    db.add(
        Payment(
            id=run_id("pay_first"),
            business_id=run_id("bz_first"),
            client_id=run_id("cl_first"),
            invoice_id=run_id("inv_first"),
            amount_cents=4200,
            method="card",
            provider="stripe",
            provider_ref=run_id("private-provider-payment"),
            status="succeeded",
        )
    )
    db.add(
        Line(
            id=run_id("ln_pickup"),
            business_id=run_id("bz_first"),
            order_id=run_id("ord_first"),
            description="Shampoo",
            unit_amount_cents=2400,
            amount_cents=2400,
            for_pickup=True,
        )
    )
    for leg, (account, owner_type, owner, cents) in enumerate(
        (
            (run_id("ac_staff"), "staff", run_id("st_staff"), 1500),
            (run_id("ac_revenue"), "business", run_id("bz_first"), -1500),
        )
    ):
        db.add(
            Entry(
                id=run_id(f"en_{leg}"),
                business_id=run_id("bz_first"),
                journal_id=run_id("jr_earning"),
                account_id=account,
                owner_type=owner_type,
                owner_id=owner,
                amount_cents=cents,
                event="earning",
                ref=run_id("earning:fixture"),
                leg=leg,
            )
        )
    await db.flush()
    # older than the device history window, so no identity receives it
    db.add(
        Slot(
            id=run_id("sl_archive"),
            business_id=run_id("bz_first"),
            item_id=run_id("it_first"),
            staff_id=run_id("st_owner"),
            starts_at=start - timedelta(days=3 * 365),
            ends_at=start - timedelta(days=3 * 365) + timedelta(hours=1),
        )
    )
    await db.flush()
    for staff in ("owner", "staff"):
        db.add(
            Booking(
                id=run_id(f"bk_{staff}"),
                business_id=run_id("bz_first"),
                slot_id=run_id(f"sl_{staff}"),
                starts_at=start,
                staff_id=run_id(f"st_{staff}"),
                client_id=run_id("cl_first"),
                status="confirmed",
                price_cents=6000,
                manage_token=run_id(f"private-manage-{staff}"),
            )
        )
    db.add(
        Booking(
            id=run_id("bk_archive"),
            business_id=run_id("bz_first"),
            slot_id=run_id("sl_archive"),
            starts_at=start - timedelta(days=3 * 365),
            staff_id=run_id("st_owner"),
            client_id=run_id("cl_first"),
            status="completed",
            price_cents=6000,
        )
    )


if __name__ == "__main__":
    asyncio.run(seed())
