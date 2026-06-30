from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from clientbridge.core.db import Base
from clientbridge.models.base import PKMixin, TimestampMixin


class Business(PKMixin, TimestampMixin, Base):
    __tablename__ = "businesses"
    __table_args__ = (
        # webhooks resolve the business by connected account; unique = one business per account
        Index("ix_businesses_stripe_account", "stripe_account_id", unique=True),
    )

    name: Mapped[str] = mapped_column(String, nullable=False)
    slug: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    parent_business_id: Mapped[str | None] = mapped_column(ForeignKey("businesses.id"))
    locale: Mapped[str] = mapped_column(String, default="en", nullable=False)
    timezone: Mapped[str] = mapped_column(String, default="America/Toronto", nullable=False)
    province: Mapped[str | None] = mapped_column(String)
    gst_hst_number: Mapped[str | None] = mapped_column(String)
    qst_number: Mapped[str | None] = mapped_column(String)
    is_tax_registered: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    brand: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict, nullable=False)
    plan: Mapped[str | None] = mapped_column(String)
    billing_email: Mapped[str | None] = mapped_column(String)
    stripe_customer_id: Mapped[str | None] = mapped_column(String)
    stripe_account_id: Mapped[str | None] = mapped_column(String)
    stripe_terminal_location_id: Mapped[str | None] = mapped_column(
        String
    )  # minted on first POS use
    stripe_charges_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    payout_schedule: Mapped[str] = mapped_column(String, default="weekly", nullable=False)
    status: Mapped[str] = mapped_column(String, default="active", nullable=False)


class User(PKMixin, TimestampMixin, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String)
    oauth: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict, nullable=False)
    name: Mapped[str | None] = mapped_column(String)
    phone: Mapped[str | None] = mapped_column(String)
    avatar_url: Mapped[str | None] = mapped_column(String)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Staff(PKMixin, TimestampMixin, Base):
    __tablename__ = "staff"

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id"), index=True, nullable=False
    )
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    role: Mapped[str] = mapped_column(String, nullable=False)
    is_payee: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    payout_ref: Mapped[str | None] = mapped_column(String)
    default_rate: Mapped[float | None] = mapped_column()
    rate_type: Mapped[str | None] = mapped_column(String)
    title: Mapped[str | None] = mapped_column(String)
    color: Mapped[str | None] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="active", nullable=False)
    invite_email: Mapped[str | None] = mapped_column(String)
    invite_token: Mapped[str | None] = mapped_column(String)
