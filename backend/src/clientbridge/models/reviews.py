from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from clientbridge.core.db import Base
from clientbridge.models.base import BusinessScoped, PKMixin, TimestampMixin, enum_check


class Review(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "reviews"
    __table_args__ = (
        CheckConstraint("rating BETWEEN 1 AND 5", name="ck_reviews_rating"),
        enum_check("reviews", "status", "published", "hidden", "pending"),
        Index("ix_reviews_status_created", "business_id", "status", "created_at"),
    )

    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), nullable=False)
    booking_id: Mapped[str | None] = mapped_column(ForeignKey("bookings.id"))
    rating: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    body: Mapped[str | None] = mapped_column(String)
    response: Mapped[str | None] = mapped_column(String)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sent_to_google: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[str] = mapped_column(String, default="published", nullable=False)


class ReviewRequest(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "review_requests"
    __table_args__ = (
        enum_check("review_requests", "channel", "sms", "email"),
        enum_check("review_requests", "status", "sent", "opened", "completed", "expired"),
        UniqueConstraint("token", name="uq_review_requests_token"),
        Index("ix_review_requests_status", "business_id", "status"),
        # At most one open (sent/opened) request per booking — backstops the dedup guard.
        Index(
            "uq_review_requests_open_booking",
            "business_id",
            "booking_id",
            unique=True,
            postgresql_where=text("status IN ('sent', 'opened') AND booking_id IS NOT NULL"),
        ),
    )

    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), nullable=False)
    booking_id: Mapped[str | None] = mapped_column(ForeignKey("bookings.id"))
    channel: Mapped[str] = mapped_column(String, nullable=False)
    token: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, default="sent", nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reminder_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    review_id: Mapped[str | None] = mapped_column(ForeignKey("reviews.id"))
