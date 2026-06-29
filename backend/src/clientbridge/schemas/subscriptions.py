from datetime import datetime

from pydantic import BaseModel, Field


class SubscriptionCreate(BaseModel):
    client_id: str = Field(min_length=1)
    item_id: str = Field(min_length=1)
    payment_method_id: str = Field(min_length=1)


class SubscriptionOut(BaseModel):
    id: str
    client_id: str
    item_id: str
    status: str
    current_period_start: datetime | None
    current_period_end: datetime | None
