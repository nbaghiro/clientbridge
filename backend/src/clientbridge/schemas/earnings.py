from pydantic import BaseModel


class EarningOut(BaseModel):
    id: str
    staff_id: str
    booking_id: str | None
    amount_cents: int
    status: str
