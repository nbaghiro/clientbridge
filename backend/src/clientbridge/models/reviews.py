from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column

from clientbridge.core.db import Base
from clientbridge.models.base import BusinessScoped, PKMixin, TimestampMixin


class ReviewRequest(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "review_requests"
    __table_args__ = (Index("ix_review_requests_booking", "business_id", "booking_id"),)

    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), nullable=False)
    booking_id: Mapped[str | None] = mapped_column(ForeignKey("bookings.id"))
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
