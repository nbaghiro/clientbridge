from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from clientbridge.core.db import Base
from clientbridge.models.base import BusinessScoped, PKMixin, TimestampMixin, enum_check

REVIEW_OPEN = ("requested", "opened")
REVIEW_SUBMITTED = ("submitted", "published", "hidden")


class Review(PKMixin, BusinessScoped, TimestampMixin, Base):
    """One row per review, from its request (when one was sent) through submission and review."""

    __tablename__ = "reviews"
    __table_args__ = (
        CheckConstraint("rating BETWEEN 1 AND 5", name="ck_reviews_rating"),
        CheckConstraint(
            "status IN ('requested', 'opened') OR rating IS NOT NULL",
            name="ck_reviews_submitted_rating",
        ),
        enum_check("reviews", "status", *REVIEW_OPEN, *REVIEW_SUBMITTED),
        enum_check("reviews", "channel", "sms", "email"),
        UniqueConstraint("token", name="uq_reviews_token"),
        Index("ix_reviews_status_created", "business_id", "status", "created_at"),
        Index(
            "uq_reviews_open_booking",
            "business_id",
            "booking_id",
            unique=True,
            postgresql_where=text("status IN ('requested', 'opened') AND booking_id IS NOT NULL"),
        ),
    )

    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), nullable=False)
    booking_id: Mapped[str | None] = mapped_column(ForeignKey("bookings.id"))
    channel: Mapped[str | None] = mapped_column(String)
    token: Mapped[str | None] = mapped_column(String)  # public review-link key (server-minted)
    status: Mapped[str] = mapped_column(String, default="requested", nullable=False)
    requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    rating: Mapped[int | None] = mapped_column(SmallInteger)
    body: Mapped[str | None] = mapped_column(String)
    response: Mapped[str | None] = mapped_column(String)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sent_to_google: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
