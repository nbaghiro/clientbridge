from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

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
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    channel: Channel
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)]
    audience: dict[str, object] = Field(
        default_factory=dict, description='{}, {"all": true} or {"tags": [...]}'
    )
    scheduled_at: datetime | None = Field(
        default=None, description="A future time schedules the broadcast instead of sending now"
    )


class BroadcastOut(BaseModel):
    id: str
    name: str
    channel: str
    status: str
    recipient_count: int
    excluded_count: int = Field(description="Audience members left out: no consent or no contact")


class ThreadOut(BaseModel):
    id: str
    unread_count: int
    status: str
