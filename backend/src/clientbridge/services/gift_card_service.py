import secrets

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal
from clientbridge.core.errors import Conflict, Forbidden, NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.models.catalog import GiftCard
from clientbridge.schemas.gift_cards import GiftCardIssue, GiftCardOut, GiftCardRedeem

_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"  # base32, no easily-confused 0/1/8/9


def _gift_code() -> str:
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(12))


class GiftCardService:
    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def issue_gift_card(
        self, data: GiftCardIssue, idempotency_key: str | None = None
    ) -> GiftCardOut:
        self._assert_admin()

        async def run(cmd: Command) -> GiftCardOut:
            card = GiftCard(
                id=new_id("gift_card"),
                business_id=self.biz,
                code=_gift_code(),
                item_id=data.item_id,
                initial_cents=data.initial_cents,
                balance_cents=data.initial_cents,
                purchaser_client_id=data.purchaser_client_id,
                recipient=data.recipient,
                status="active",
            )
            self.db.add(card)
            try:
                await self.db.flush()  # (business_id, code) is unique — a collision is a rare retry
            except IntegrityError as exc:
                raise Conflict("gift card code collision — please retry") from exc
            cmd.record("gift_card.issue", entity_type="gift_card", entity_id=card.id)
            return _out(card)

        return await run_command(
            self.db,
            self.principal,
            action="gift_card.issue",
            run=run,
            response_model=GiftCardOut,
            idempotency_key=idempotency_key,
        )

    async def redeem_gift_card(
        self, data: GiftCardRedeem, idempotency_key: str | None = None
    ) -> GiftCardOut:
        self._assert_admin()
        card = await self._by_code(data.code)

        async def run(cmd: Command) -> GiftCardOut:
            if card.status != "active":
                raise Conflict("only an active gift card can be redeemed")
            if data.amount_cents <= 0 or data.amount_cents > card.balance_cents:
                raise Conflict("invalid redemption amount")
            card.balance_cents -= data.amount_cents
            if card.balance_cents == 0:
                card.status = "redeemed"
            await self.db.flush()
            cmd.record("gift_card.redeem", entity_type="gift_card", entity_id=card.id)
            return _out(card)

        return await run_command(
            self.db,
            self.principal,
            action="gift_card.redeem",
            run=run,
            response_model=GiftCardOut,
            idempotency_key=idempotency_key,
        )

    def _assert_admin(self) -> None:
        if self.principal.role not in ("owner", "admin"):
            raise Forbidden("only an owner or admin can manage gift cards")

    async def _by_code(self, code: str) -> GiftCard:
        row = (
            await self.db.execute(scoped(GiftCard, self.biz).where(GiftCard.code == code))
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("gift card not found")
        return row


def _out(card: GiftCard) -> GiftCardOut:
    return GiftCardOut(
        id=card.id,
        code=card.code,
        initial_cents=card.initial_cents,
        balance_cents=card.balance_cents,
        status=card.status,
    )
