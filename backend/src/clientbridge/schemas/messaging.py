from datetime import datetime
from typing import Annotated

from pydantic import Field, StringConstraints

from clientbridge.core.mirrors import Mirror
from clientbridge.models.clients import Channel
from clientbridge.models.messaging import (
    Broadcast,
    BroadcastStatus,
    Direction,
    Message,
    MessageStatus,
    Thread,
    ThreadStatus,
)


class MessageSend(Mirror):
    mirrors = Message

    client_id: str
    channel: Channel
    body: str


class MessageOut(Mirror):
    mirrors = Message

    id: str
    thread_id: str
    direction: Direction
    channel: Channel
    body: str | None
    status: MessageStatus


class BroadcastSend(Mirror):
    mirrors = Broadcast

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    channel: Channel
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)]
    audience: dict[str, object] = Field(
        default_factory=dict, description='{}, {"all": true} or {"tags": [...]}'
    )
    scheduled_at: datetime | None = Field(
        default=None, description="A future time schedules the broadcast instead of sending now"
    )


class BroadcastOut(Mirror):
    mirrors = Broadcast

    id: str
    name: str
    channel: Channel
    status: BroadcastStatus
    recipient_count: int
    excluded_count: int = Field(description="Audience members left out: no consent or no contact")


class ThreadOut(Mirror):
    mirrors = Thread

    id: str
    unread_count: int
    status: ThreadStatus
