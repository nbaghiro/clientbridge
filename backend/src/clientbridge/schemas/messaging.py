from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from clientbridge.core.mirrors import Mirror
from clientbridge.models.messaging import (
    Broadcast,
    BroadcastStatus,
    Direction,
    Message,
    MessageStatus,
    Thread,
    ThreadStatus,
)
from clientbridge.schemas.clients import Tag

TextBody = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]


class MessageSend(Mirror):
    mirrors = Message

    client_id: str
    body: TextBody
    booking_id: str | None = Field(
        default=None, description="A visit the note is about; its page link is added to the body"
    )


class MessageOut(Mirror):
    mirrors = Message

    id: str
    thread_id: str
    direction: Direction
    body: str | None
    status: MessageStatus


class ConversationMessage(Mirror):
    mirrors = Message

    id: str
    direction: Direction
    body: str | None
    status: MessageStatus
    created_at: datetime
    author: str | None


class ConversationPage(BaseModel):
    messages: list[ConversationMessage]
    more: bool


class BroadcastAudience(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    all: bool = False
    tags: list[Annotated[Tag, StringConstraints(min_length=1)]] = Field(
        default_factory=list[str],
        max_length=100,
        description="The clients carrying any of these tags; none means every client",
    )

    @model_validator(mode="after")
    def _all_or_tags(self) -> "BroadcastAudience":
        if self.all and self.tags:
            raise ValueError("an audience is every client or a set of tags, not both")
        return self


class BroadcastSend(Mirror):
    mirrors = Broadcast

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)]
    audience: BroadcastAudience = Field(default_factory=BroadcastAudience)
    scheduled_at: datetime | None = Field(
        default=None, description="A future time schedules the broadcast instead of sending now"
    )


class BroadcastOut(Mirror):
    mirrors = Broadcast

    id: str
    name: str
    status: BroadcastStatus
    recipient_count: int
    excluded_count: int = Field(description="Audience members left out: no consent or no contact")
    scheduled_at: datetime | None = Field(
        description="When a scheduled broadcast goes out, moved past the business's quiet hours"
    )


class ThreadOut(Mirror):
    mirrors = Thread

    id: str
    unread_count: int
    status: ThreadStatus
