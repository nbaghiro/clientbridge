from pydantic import BaseModel


class EarningOut(BaseModel):
    id: str
    staff_id: str
    booking_id: str | None
    order_id: str | None = None
    amount_cents: int
    status: str
