from pydantic import BaseModel, Field

from clientbridge.schemas.public_booking import PublicBookingClient
from clientbridge.schemas.public_common import PublicBrand


class PublicShopItem(BaseModel):
    id: str
    name: str
    description: str | None
    price_cents: int
    currency: str
    image_url: str | None = None
    in_stock: bool = True


class PublicShop(BaseModel):
    business_name: str
    brand: PublicBrand
    items: list[PublicShopItem]
    stripe_account_id: str | None = None


class PublicShopLine(BaseModel):
    item_id: str
    quantity: int = Field(ge=1, le=20)


class PublicShopOrderCreate(BaseModel):
    client: PublicBookingClient
    lines: list[PublicShopLine] = Field(min_length=1, max_length=20)


class PublicShopOrderResult(BaseModel):
    order_id: str
    total_cents: int
    currency: str
    client_secret: str
    stripe_account_id: str
