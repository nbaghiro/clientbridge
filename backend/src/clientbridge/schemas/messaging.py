from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Channel = Literal["sms", "email"]


class MessageSend(BaseModel):
    client_id: str
    channel: Channel
    body: str


class MessageOut(BaseModel):
    id: str
    thread_id: str
    direction: str
    channel: str
    body: str | None
    status: str


class BroadcastSend(BaseModel):
    name: str
    channel: Channel
    body: str
    audience: dict[str, object] = Field(
        default_factory=dict
    )  # {} | {"all": true} | {"tags": [...]}
    scheduled_at: datetime | None = None  # a future time → create scheduled, don't send now


class BroadcastOut(BaseModel):
    id: str
    name: str
    channel: str
    status: str
    recipient_count: int


class ThreadOut(BaseModel):
    id: str
    unread_count: int
    status: str
