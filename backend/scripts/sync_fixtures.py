import asyncio
from datetime import time

from clientbridge.core.db import SessionLocal, engine
from clientbridge.models.business import Business, Staff, User
from clientbridge.models.clients import Client
from clientbridge.models.scheduling import Hours


async def seed() -> None:
    if engine.url.database != "clientbridge_test_sync":
        raise RuntimeError("sync fixtures require the isolated verification database")
    async with SessionLocal() as db:
        for name in ("first", "second", "foreign"):
            db.add(
                Business(
                    id=f"bz_{name}",
                    name=name,
                    slug=f"sync-{name}",
                    gst_hst_number="private-tax-number",
                )
            )
        for role in ("owner", "admin", "staff", "contractor", "multi", "foreign"):
            db.add(User(id=f"us_{role}", email=f"{role}@sync.test", name=role))
        await db.flush()
        for name in ("first", "second", "foreign"):
            db.add(
                Client(
                    id=f"cl_{name}",
                    business_id=f"bz_{name}",
                    name=name,
                    stripe_customer_id=f"private-provider-{name}",
                )
            )
        for role in ("owner", "admin", "staff", "contractor", "multi", "foreign"):
            business = "foreign" if role == "foreign" else "first"
            db.add(
                Staff(
                    id=f"st_{role}",
                    business_id=f"bz_{business}",
                    user_id=f"us_{role}",
                    name=role,
                    role="owner" if role in ("multi", "foreign") else role,
                    status="active",
                    rate_cents=3456,
                    rate_type="hourly",
                    invite_token=f"private-invite-{role}",
                )
            )
        db.add(
            Staff(
                id="st_second",
                business_id="bz_second",
                user_id="us_multi",
                name="multi",
                role="staff",
                status="active",
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
                    id=f"av_{staff}",
                    business_id=f"bz_{business}",
                    staff_id=f"st_{staff}",
                    basis="recurring",
                    weekday=1,
                    start_time=time(9),
                    end_time=time(17),
                    available=True,
                    note="server baseline",
                )
            )
        await db.commit()
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed())
