from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.config import get_settings
from clientbridge.core.deps import Principal
from clientbridge.core.errors import Forbidden, NotFound
from clientbridge.integrations.payments import GatewayEvent, PaymentGateway
from clientbridge.models.identity import Business
from clientbridge.models.platform import WebhookEvent
from clientbridge.schemas.payments import ConnectStatus, OnboardingLink


class PaymentService:
    def __init__(self, db: AsyncSession, principal: Principal, gateway: PaymentGateway) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id
        self.gateway = gateway

    async def start_onboarding(self, idempotency_key: str | None) -> OnboardingLink:
        self._assert_admin()
        business = await self._business()
        settings = get_settings()

        async def run(cmd: Command) -> OnboardingLink:
            if business.stripe_account_id is None:
                business.stripe_account_id = await self.gateway.create_connected_account(
                    business_name=business.name, email=business.billing_email
                )
                await self.db.flush()
                cmd.record("connect.account_created", entity_type="business", entity_id=business.id)
            url = await self.gateway.create_account_link(
                business.stripe_account_id,
                refresh_url=f"{settings.web_base_url}/settings/payments?refresh=1",
                return_url=f"{settings.web_base_url}/settings/payments?done=1",
            )
            cmd.record("connect.onboard", entity_type="business", entity_id=business.id)
            return OnboardingLink(url=url, charges_enabled=business.stripe_charges_enabled)

        return await run_command(
            self.db,
            self.principal,
            action="connect.onboard",
            run=run,
            response_model=OnboardingLink,
            idempotency_key=idempotency_key,
        )

    async def status(self) -> ConnectStatus:
        self._assert_admin()
        business = await self._business()
        return ConnectStatus(
            connected=business.stripe_account_id is not None,
            charges_enabled=business.stripe_charges_enabled,
        )

    def _assert_admin(self) -> None:
        if self.principal.role not in ("owner", "admin"):
            raise Forbidden("only an owner or admin can manage payments")

    async def _business(self) -> Business:
        row = await self.db.get(Business, self.biz)
        if row is None:
            raise NotFound("business not found")
        return row


async def process_stripe_event(
    db: AsyncSession, gateway: PaymentGateway, payload: bytes, signature: str
) -> str:
    """Verify + dedup + dispatch a Stripe webhook (surface #4). Raises WebhookVerificationError on a
    bad signature. A repeated event id is a no-op; on a dispatch error nothing commits, so Stripe
    retries and reprocesses."""
    event = gateway.verify_webhook(payload, signature)
    seen = (
        await db.execute(select(WebhookEvent.id).where(WebhookEvent.id == event.id))
    ).scalar_one_or_none()
    if seen is not None:
        return "duplicate"
    record = WebhookEvent(
        id=event.id, provider="stripe", type=event.type, payload=event.data, status="pending"
    )
    db.add(record)
    await _dispatch(db, event)
    record.status = "processed"
    record.processed_at = datetime.now(UTC)
    await db.commit()
    return "processed"


async def _dispatch(db: AsyncSession, event: GatewayEvent) -> None:
    if event.type == "account.updated":
        account_id = event.data.get("id")
        if isinstance(account_id, str):
            await db.execute(
                update(Business)
                .where(Business.stripe_account_id == account_id)
                .values(stripe_charges_enabled=bool(event.data.get("charges_enabled")))
            )
