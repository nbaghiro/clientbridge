from pydantic import BaseModel


class PayoutAllocationOut(BaseModel):
    id: str
    staff_id: str
    amount_cents: int
    status: str
