from typing import Literal

from pydantic import BaseModel

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
