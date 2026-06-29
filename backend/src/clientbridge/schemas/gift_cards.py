from pydantic import BaseModel, Field


class GiftCardIssue(BaseModel):
    initial_cents: int = Field(gt=0)
    item_id: str | None = None
    recipient: str | None = None
    purchaser_client_id: str | None = None


class GiftCardRedeem(BaseModel):
    code: str = Field(min_length=1)
    amount_cents: int


class GiftCardOut(BaseModel):
    id: str
    code: str
    initial_cents: int
    balance_cents: int
    status: str
