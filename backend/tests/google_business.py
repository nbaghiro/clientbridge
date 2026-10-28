import base64

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.integrations.google_business import (
    GoogleAccounts,
    GoogleBusinessError,
    GoogleLocation,
    GoogleLocations,
    GoogleReply,
    GoogleReview,
    GoogleReviews,
    GoogleTokens,
    HttpGoogleBusinessGateway,
)
from clientbridge.integrations.twilio import Sms
from clientbridge.models.messaging import Delivery
from clientbridge.schemas.deliveries import DELIVERY_PAYLOAD, DeliveryPayload, SmsDelivery


class FakeGoogle(HttpGoogleBusinessGateway):
    def __init__(self) -> None:
        super().__init__("test", "secret", "http://test/v1/reviews/google/callback")
        self.reply: GoogleReply | None = None
        self.ambiguous = False
        self.writes = 0

    async def exchange(self, code: str, verifier: str) -> GoogleTokens:
        return GoogleTokens(access_token="access", refresh_token="refresh", expires_in=3600)

    async def refresh(self, refresh_token: str) -> GoogleTokens:
        assert refresh_token == "refresh"
        return GoogleTokens(access_token="access", expires_in=3600)

    async def accounts(self, token: str, page: str | None = None) -> GoogleAccounts:
        return GoogleAccounts.model_validate(
            {"accounts": [{"name": "accounts/1", "accountName": "Owner"}]}
        )

    async def locations(self, token: str, account: str, page: str | None = None) -> GoogleLocations:
        return GoogleLocations(locations=[await self.location(token, "locations/1")])

    async def location(self, token: str, location: str) -> GoogleLocation:
        return GoogleLocation.model_validate(
            {
                "name": "locations/1",
                "title": "Birchbark",
                "metadata": {"newReviewUri": "https://g.page/r/1/review"},
            }
        )

    async def reviews(self, token: str, parent: str, page: str | None = None) -> GoogleReviews:
        return GoogleReviews(
            reviews=[await self.review(token, "review")], totalReviewCount=1, averageRating=5
        )

    async def review(self, token: str, name: str) -> GoogleReview:
        return GoogleReview(
            reviewId="1",
            starRating="FIVE",
            createTime=clock.now(),
            updateTime=clock.now(),
            reviewReply=self.reply,
        )

    async def put_reply(self, token: str, name: str, comment: str) -> GoogleReply:
        self.writes += 1
        self.reply = GoogleReply(comment=comment, updateTime=clock.now())
        if self.ambiguous:
            self.ambiguous = False
            raise GoogleBusinessError("connection closed after write")
        return self.reply

    async def delete_reply(self, token: str, name: str) -> None:
        self.reply = None


class FakeVault:
    async def seal(self, value: str, context: str) -> tuple[bytes, str]:
        return base64.b64encode(f"{context}|{value}".encode()), "test"

    async def open(self, value: bytes, context: str) -> str:
        plain = base64.b64decode(value).decode()
        assert plain.startswith(f"{context}|")
        return plain[len(context) + 1 :]


class FakeFlows:
    def __init__(self) -> None:
        self.data: dict[str, str] = {}

    async def put(self, key: str, value: str, ttl: int = 600) -> None:
        self.data[key] = value

    async def get(self, key: str) -> str | None:
        return self.data.get(key)

    async def pop(self, key: str) -> str | None:
        return self.data.pop(key, None)


async def configure_google_review_profile(db: AsyncSession, enabled: bool = True) -> None:
    from sqlalchemy import select

    from clientbridge.models.reviews import GoogleBusinessConnection

    row = await db.scalar(
        select(GoogleBusinessConnection).where(
            GoogleBusinessConnection.business_id == "bz_birchbark"
        )
    )
    if row is None:
        row = GoogleBusinessConnection(
            id="gbc_test",
            business_id="bz_birchbark",
            connected_by="us_dev",
            state="disconnected",
            generation=1,
        )
        db.add(row)
    row.state = "active" if enabled else "disconnected"
    row.account_name = "accounts/1" if enabled else None
    row.location_name = "locations/1" if enabled else None
    row.refresh_token_ciphertext, row.key_version = await FakeVault().seal(
        "refresh", f"bz_birchbark:{row.id}"
    )
    await db.flush()


async def review_deliveries(db: AsyncSession) -> list[DeliveryPayload]:
    rows = await db.scalars(select(Delivery).where(Delivery.key.startswith("review:")))
    return [DELIVERY_PAYLOAD.validate_python(row.payload) for row in rows]


async def review_texts(db: AsyncSession) -> list[Sms]:
    return [item.message for item in await review_deliveries(db) if isinstance(item, SmsDelivery)]
