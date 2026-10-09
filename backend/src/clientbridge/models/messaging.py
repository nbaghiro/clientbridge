from datetime import datetime
from typing import Literal

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from clientbridge.core.db import Base
from clientbridge.models.base import BusinessScoped, PKMixin, TimestampMixin, enum_check
from clientbridge.models.clients import Channel

ThreadChannel = Literal["sms", "email", "chat"]
ThreadStatus = Literal["open", "closed"]
Direction = Literal["in", "out"]
MessageStatus = Literal["draft", "queued", "sent", "delivered", "read", "failed"]
BroadcastStatus = Literal["draft", "scheduled", "sending", "sent", "canceled"]


class Thread(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "threads"
    __table_args__ = (
        enum_check("threads", "channel", ThreadChannel),
        enum_check("threads", "status", ThreadStatus),
        UniqueConstraint("business_id", "client_id", "channel", name="uq_threads_client_channel"),
    )

    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), nullable=False)
    channel: Mapped[ThreadChannel] = mapped_column(String, nullable=False)
    status: Mapped[ThreadStatus] = mapped_column(String, default="open", nullable=False)


class Message(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "messages"
    __table_args__ = (
        enum_check("messages", "direction", Direction),
        enum_check("messages", "status", MessageStatus),
        Index("ix_messages_thread", "thread_id", "created_at"),
        Index("ix_messages_broadcast", "broadcast_id"),
    )

    thread_id: Mapped[str] = mapped_column(ForeignKey("threads.id"), nullable=False)
    direction: Mapped[Direction] = mapped_column(String, nullable=False)
    channel: Mapped[str] = mapped_column(String, nullable=False)
    sent_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    body: Mapped[str | None] = mapped_column(String)
    status: Mapped[MessageStatus] = mapped_column(String, default="queued", nullable=False)
    broadcast_id: Mapped[str | None] = mapped_column(ForeignKey("broadcasts.id"))
    provider_ref: Mapped[str | None] = mapped_column(String)


class Broadcast(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "broadcasts"
    __table_args__ = (
        enum_check("broadcasts", "channel", Channel),
        enum_check("broadcasts", "status", BroadcastStatus),
        Index("ix_broadcasts_status", "business_id", "status"),
    )

    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String, nullable=False)
    channel: Mapped[Channel] = mapped_column(String, nullable=False)
    body: Mapped[str | None] = mapped_column(
        String
    )  # rendered at send (kept for a scheduled fan-out)
    audience: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict, nullable=False)
    status: Mapped[BroadcastStatus] = mapped_column(String, default="draft", nullable=False)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    recipient_count: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    excluded_count: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
