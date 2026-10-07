from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from clientbridge.core.db import Base
from clientbridge.models.base import PKMixin, TimestampMixin, enum_check

FILING_FREQUENCIES = ("monthly", "quarterly", "annual")


class Business(PKMixin, TimestampMixin, Base):
    __tablename__ = "businesses"
    __table_args__ = (
        # webhooks resolve the business by connected account; unique = one business per account
        Index("ix_businesses_stripe_account", "stripe_account_id", unique=True),
        enum_check("businesses", "status", "active", "closed"),
        enum_check("businesses", "filing_frequency", *FILING_FREQUENCIES),
        CheckConstraint("review_hold_at BETWEEN 0 AND 5", name="ck_businesses_review_hold_at"),
    )

    name: Mapped[str] = mapped_column(String, nullable=False)
    slug: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    locale: Mapped[str] = mapped_column(String, default="en", nullable=False)
    timezone: Mapped[str] = mapped_column(String, default="America/Toronto", nullable=False)
    province: Mapped[str | None] = mapped_column(String)
    gst_hst_number: Mapped[str | None] = mapped_column(String)
    qst_number: Mapped[str | None] = mapped_column(String)
    tax_registered: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    pst_number: Mapped[str | None] = mapped_column(String)
    setup_dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # reviews rated at or below this wait for the owner before they show; 0 publishes everything
    review_hold_at: Mapped[int] = mapped_column(
        SmallInteger, default=3, server_default="3", nullable=False
    )
    google_review_url: Mapped[str | None] = mapped_column(String)
    brand: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict, nullable=False)
    billing_email: Mapped[str | None] = mapped_column(String)
    stripe_account_id: Mapped[str | None] = mapped_column(String)
    stripe_terminal_location_id: Mapped[str | None] = mapped_column(
        String
    )  # minted on first POS use
    stripe_charges_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # KYC mirrored from the Stripe connected account (source of truth), synced via account.updated.
    stripe_payouts_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    stripe_details_submitted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    stripe_requirements: Mapped[dict[str, object]] = mapped_column(
        JSONB, default=dict, nullable=False
    )
    # online booking rules and the cancellation policy; read through schemas.bookings.BookingPolicy
    booking_policy: Mapped[dict[str, object]] = mapped_column(
        JSONB, default=dict, server_default="{}", nullable=False
    )
    status: Mapped[str] = mapped_column(String, default="active", nullable=False)
    # the most staff may take off a sale without an owner's or admin's PIN
    staff_discount_limit_bps: Mapped[int] = mapped_column(
        Integer, default=1500, server_default="1500", nullable=False
    )
    filing_frequency: Mapped[str] = mapped_column(
        String, default="quarterly", server_default="quarterly", nullable=False
    )


class User(PKMixin, TimestampMixin, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String)
    pin_hash: Mapped[str | None] = mapped_column(String)  # approves a staff discount at the desk
    oauth: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict, nullable=False)
    name: Mapped[str | None] = mapped_column(String)
    phone: Mapped[str | None] = mapped_column(String)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Staff(PKMixin, TimestampMixin, Base):
    __tablename__ = "staff"
    __table_args__ = (
        enum_check("staff", "role", "owner", "admin", "staff", "contractor"),
        enum_check("staff", "status", "active", "invited", "removed"),
        enum_check("staff", "rate_type", "percent", "fixed", "hourly"),
        # a percent rate is in basis points, a fixed or hourly rate in cents; never both
        CheckConstraint(
            "(rate_type = 'percent' AND rate_cents IS NULL)"
            " OR (rate_type IN ('fixed', 'hourly') AND rate_bps IS NULL)"
            " OR (rate_type IS NULL AND rate_bps IS NULL AND rate_cents IS NULL)",
            name="ck_staff_rate_unit",
        ),
        UniqueConstraint("business_id", "user_id", name="uq_staff_business_user"),
    )

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id"), index=True, nullable=False
    )
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    role: Mapped[str] = mapped_column(String, nullable=False)
    payee: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    rate_type: Mapped[str | None] = mapped_column(String)
    rate_bps: Mapped[int | None] = mapped_column(Integer)
    rate_cents: Mapped[int | None] = mapped_column(BigInteger)
    retail_rate_bps: Mapped[int | None] = mapped_column(Integer)  # commission on product sales
    # the member's name, copied from their account so every device can show who is who
    name: Mapped[str | None] = mapped_column(String)
    title: Mapped[str | None] = mapped_column(String)
    color: Mapped[str | None] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="active", nullable=False)
    invite_email: Mapped[str | None] = mapped_column(String)
    invite_token: Mapped[str | None] = mapped_column(String)
    invited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    invited_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    # hidden from the public booking page when off; the schedule is unchanged
    bookable_online: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true", nullable=False
    )
