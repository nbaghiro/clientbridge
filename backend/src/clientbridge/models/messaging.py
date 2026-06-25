from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from clientbridge.core.db import Base
from clientbridge.models.base import BusinessScoped, PKMixin, TimestampMixin, enum_check


class Thread(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "threads"
    __table_args__ = (
        enum_check("threads", "channel", "sms", "email", "chat"),
        enum_check("threads", "status", "open", "closed"),
        UniqueConstraint("business_id", "client_id", "channel", name="uq_threads_client_channel"),
        Index("ix_threads_last_message", "business_id", "last_message_at"),
    )

    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), nullable=False)
    channel: Mapped[str] = mapped_column(String, nullable=False)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    unread_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String, default="open", nullable=False)


class Message(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "messages"
    __table_args__ = (
        enum_check("messages", "direction", "in", "out"),
        enum_check("messages", "status", "draft", "queued", "sent", "delivered", "read", "failed"),
        Index("ix_messages_thread", "thread_id", "created_at"),
        Index("ix_messages_broadcast", "broadcast_id"),
    )

    thread_id: Mapped[str] = mapped_column(ForeignKey("threads.id"), nullable=False)
    direction: Mapped[str] = mapped_column(String, nullable=False)
    channel: Mapped[str] = mapped_column(String, nullable=False)
    sender_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    body: Mapped[str | None] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="queued", nullable=False)
    broadcast_id: Mapped[str | None] = mapped_column(ForeignKey("broadcasts.id"))
    provider_ref: Mapped[str | None] = mapped_column(String)
    attachments: Mapped[list[object]] = mapped_column(JSONB, default=list, nullable=False)


class Broadcast(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "broadcasts"
    __table_args__ = (
        enum_check("broadcasts", "channel", "sms", "email"),
        enum_check("broadcasts", "status", "draft", "scheduled", "sending", "sent", "canceled"),
        Index("ix_broadcasts_status", "business_id", "status"),
    )

    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String, nullable=False)
    channel: Mapped[str] = mapped_column(String, nullable=False)
    audience: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict, nullable=False)
    status: Mapped[str] = mapped_column(String, default="draft", nullable=False)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
