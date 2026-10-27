from datetime import date, datetime, timedelta
from typing import Literal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from clientbridge.core import clock
from clientbridge.core.db import Base
from clientbridge.models.base import PKMixin, TimestampMixin, enum_check

BusinessStatus = Literal["active", "closed"]
FilingFrequency = Literal["monthly", "quarterly", "annual"]
ProvinceCode = Literal["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]
StaffRole = Literal["owner", "admin", "staff", "contractor"]
StaffStatus = Literal["active", "invited", "removed"]
RateType = Literal["percent", "fixed", "hourly"]
Plan = Literal["premium", "team"]
PlanStatus = Literal["trialing", "active", "past_due", "lapsed"]
SubjectKind = Literal["pet", "student", "property", "site", "vehicle"]
# kinds whose visits go to the subject's address: a property, a site or a parked vehicle
PLACE_KINDS: frozenset[SubjectKind] = frozenset({"property", "site", "vehicle"})

TRIAL_DAYS = 14
POSTAL_CODE_CHECK = "postal_code ~ '^[A-Z][0-9][A-Z] [0-9][A-Z][0-9]$'"
LEGAL_PHONE_CHECK = "legal_phone ~ '^\\+[1-9][0-9]{6,14}$'"


def trial_end() -> datetime:
    return clock.now() + timedelta(days=TRIAL_DAYS)


class Business(PKMixin, TimestampMixin, Base):
    __tablename__ = "businesses"
    __table_args__ = (
        # webhooks resolve the business by connected account; unique = one business per account
        Index("ix_businesses_stripe_account", "stripe_account_id", unique=True),
        enum_check("businesses", "status", BusinessStatus),
        enum_check("businesses", "filing_frequency", FilingFrequency),
        enum_check("businesses", "plan", Plan, nullable=True),
        enum_check("businesses", "plan_status", PlanStatus),
        enum_check("businesses", "subject", SubjectKind, nullable=True),
        CheckConstraint(POSTAL_CODE_CHECK, name="ck_businesses_postal_code"),
        CheckConstraint(LEGAL_PHONE_CHECK, name="ck_businesses_legal_phone"),
    )

    name: Mapped[str] = mapped_column(String, nullable=False)
    slug: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    timezone: Mapped[str] = mapped_column(String, default="America/Toronto", nullable=False)
    province: Mapped[ProvinceCode | None] = mapped_column(String)
    # the legal address and phone, kept apart from the public profile in `brand`
    unit: Mapped[str | None] = mapped_column(String)
    street_number: Mapped[str | None] = mapped_column(String)
    street_name: Mapped[str | None] = mapped_column(String)
    city: Mapped[str | None] = mapped_column(String)
    postal_code: Mapped[str | None] = mapped_column(String)
    legal_phone: Mapped[str | None] = mapped_column(String)
    gst_hst_number: Mapped[str | None] = mapped_column(String)
    qst_number: Mapped[str | None] = mapped_column(String)
    tax_registered: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # null while unregistered, or registered with no known start (registered throughout)
    tax_registered_on: Mapped[date | None] = mapped_column(Date)
    pst_number: Mapped[str | None] = mapped_column(String)
    setup_dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_requests_enabled: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true", nullable=False
    )
    brand: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict, nullable=False)
    billing_email: Mapped[str | None] = mapped_column(String)
    sms_number: Mapped[str | None] = mapped_column(String, unique=True)
    stripe_account_id: Mapped[str | None] = mapped_column(String)
    stripe_terminal_location_id: Mapped[str | None] = mapped_column(
        String
    )  # minted on first POS use
    stripe_charges_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # KYC mirrored from the Stripe connected account (source of truth) on its account events.
    stripe_payouts_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    stripe_requirements: Mapped[dict[str, object]] = mapped_column(
        JSONB, default=dict, nullable=False
    )
    # online booking rules and the cancellation policy; read through schemas.bookings.BookingPolicy
    booking_policy: Mapped[dict[str, object]] = mapped_column(
        JSONB, default=dict, server_default="{}", nullable=False
    )
    status: Mapped[BusinessStatus] = mapped_column(String, default="active", nullable=False)
    filing_frequency: Mapped[FilingFrequency] = mapped_column(
        String, default="quarterly", server_default="quarterly", nullable=False
    )
    plan: Mapped[Plan | None] = mapped_column(String)
    # trial expiry is read against trial_ends_at, so no job has to flip a trialing business
    plan_status: Mapped[PlanStatus] = mapped_column(
        String, default="trialing", server_default="trialing", nullable=False
    )
    trial_ends_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=trial_end, nullable=False
    )
    stripe_subscription_id: Mapped[str | None] = mapped_column(String)
    # what a booking is for besides the client; NULL books only the client
    subject: Mapped[SubjectKind | None] = mapped_column(String)


class User(PKMixin, TimestampMixin, Base):
    __tablename__ = "users"

    # the auth service owns credentials, sessions and verification; this row is the profile
    identity_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    name: Mapped[str | None] = mapped_column(String)
    phone: Mapped[str | None] = mapped_column(String)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Staff(PKMixin, TimestampMixin, Base):
    __tablename__ = "staff"
    __table_args__ = (
        enum_check("staff", "role", StaffRole),
        enum_check("staff", "status", StaffStatus),
        enum_check("staff", "rate_type", RateType),
        # a percent rate is in basis points, a fixed or hourly rate in cents; never both
        CheckConstraint(
            "(rate_type = 'percent' AND rate_cents IS NULL)"
            " OR (rate_type IN ('fixed', 'hourly') AND rate_bps IS NULL)"
            " OR (rate_type IS NULL AND rate_bps IS NULL AND rate_cents IS NULL)",
            name="ck_staff_rate_unit",
        ),
        UniqueConstraint("business_id", "user_id", name="uq_staff_business_user"),
        CheckConstraint("hours_revision >= 0", name="ck_staff_hours_revision"),
        Index("ix_staff_invited_by", "invited_by"),
        Index("ix_staff_user_id", "user_id"),
    )

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id"), index=True, nullable=False
    )
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    hours_revision: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    role: Mapped[StaffRole] = mapped_column(String, nullable=False)
    payee: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    rate_type: Mapped[RateType | None] = mapped_column(String)
    rate_bps: Mapped[int | None] = mapped_column(Integer)
    rate_cents: Mapped[int | None] = mapped_column(BigInteger)
    retail_rate_bps: Mapped[int | None] = mapped_column(Integer)  # commission on product sales
    title: Mapped[str | None] = mapped_column(String)
    color: Mapped[str | None] = mapped_column(String)
    status: Mapped[StaffStatus] = mapped_column(String, default="active", nullable=False)
    invite_email: Mapped[str | None] = mapped_column(String)
    invite_token: Mapped[str | None] = mapped_column(String)
    invited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    invited_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    # hidden from the public booking page when off; the schedule is unchanged
    bookable_online: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true", nullable=False
    )
