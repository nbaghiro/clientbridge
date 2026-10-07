from pydantic import BaseModel, Field


class EarningOut(BaseModel):
    id: str
    staff_id: str
    booking_id: str | None
    order_id: str | None = None
    amount_cents: int
    status: str
    kind: str = "earning"


class EarningIdsIn(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=200)


class EarningsOut(BaseModel):
    earnings: list[EarningOut]
