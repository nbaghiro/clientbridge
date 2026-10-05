"""Values that are read rather than stored: estimate expiry, a spent gift card, package use."""

from datetime import UTC, date, datetime, timedelta

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.billing import Estimate
from clientbridge.models.catalog import GiftCard, Package
from clientbridge.services import ledger
from clientbridge.services.billing import estimate_status
from clientbridge.services.ledger import Leg
from clientbridge.tasks.maintenance import run_expiry_sweeps
from tests.conftest import BIZ


async def test_a_sent_estimate_past_its_date_reads_expired_and_cannot_be_accepted(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    created = await as_owner.post(
        "/v1/estimates",
        json={
            "client_id": "cl_amelie",
            "valid_until": "2020-01-31",
            "lines": [{"description": "Quote", "quantity": 1, "unit_amount_cents": 5000}],
        },
    )
    est = created.json()
    sent = (await as_owner.post(f"/v1/estimates/{est['id']}/send")).json()
    assert sent["status"] == "expired"
    accept = await as_owner.post(f"/v1/estimates/{est['id']}/accept")
    assert accept.status_code == 409
    assert (await as_owner.post(f"/v1/estimates/{est['id']}/convert")).status_code == 409
    row = await db.get(Estimate, est["id"])
    assert row is not None and row.status == "sent"
    assert estimate_status(row, date(2020, 1, 31)) == "sent"


async def test_a_spent_gift_card_reads_redeemed_and_is_not_swept(db: AsyncSession) -> None:
    card = GiftCard(
        id=new_id("gift_card"),
        business_id=BIZ,
        code="SPENTCARD001",
        initial_cents=2000,
        status="active",
        expires_at=datetime(2019, 12, 31, tzinfo=UTC),
    )
    db.add(card)
    await db.flush()
    await ledger.post(
        db,
        BIZ,
        event="payment",
        ref=f"test:purchase:{card.id}",
        legs=[
            Leg("business", BIZ, "stripe", 2000),
            Leg("gift_card", card.id, "gift_card", -2000),
        ],
        subject=("gift_card", card.id),
    )
    await ledger.post_redemption(db, card, 2000)
    assert ledger.gift_card_status(card, await ledger.gift_card_balance(db, card)) == "redeemed"
    await run_expiry_sweeps(db, datetime(2020, 1, 1, tzinfo=UTC))
    await db.refresh(card)
    assert card.status == "active"
    assert await ledger.journal_for(db, BIZ, f"breakage:{card.id}") is None


async def test_a_session_worth_nothing_still_counts_as_used(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    pkg = Package(
        id=new_id("package"),
        business_id=BIZ,
        client_id="cl_marcus",
        item_id="it_pkg5",
        sessions_total=2,
        status="active",
        expires_at=datetime.now(UTC) + timedelta(days=30),
    )
    db.add(pkg)
    await db.flush()
    first = (await as_owner.post(f"/v1/packages/{pkg.id}/consume")).json()
    assert (first["sessions_used"], first["status"]) == (1, "active")
    second = (await as_owner.post(f"/v1/packages/{pkg.id}/consume")).json()
    assert (second["sessions_used"], second["status"]) == (2, "used")
    assert await ledger.sessions_used(db, pkg) == 2
