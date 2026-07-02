from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from clientbridge.core.db import Base
from clientbridge.models.base import BusinessScoped, PKMixin, TimestampMixin, enum_check


class Item(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "items"
    __table_args__ = (
        enum_check(
            "items", "kind", "service", "class", "product", "package", "subscription", "gift"
        ),
        enum_check("items", "deposit_type", "none", "fixed", "percent"),
        Index("ix_items_business_kind_active", "business_id", "kind", "active"),
    )

    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    kind: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(String)
    price_cents: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="CAD", nullable=False)
    duration_min: Mapped[int | None] = mapped_column(Integer)
    capacity: Mapped[int | None] = mapped_column(Integer)
    category: Mapped[str | None] = mapped_column(String)
    color: Mapped[str | None] = mapped_column(String)
    online_bookable: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    buffer_before_min: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    buffer_after_min: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    deposit_type: Mapped[str] = mapped_column(String, default="none", nullable=False)
    deposit_value: Mapped[float | None] = mapped_column(Numeric)
    interval: Mapped[int | None] = mapped_column(Integer)
    frequency: Mapped[str | None] = mapped_column(String)
    session_count: Mapped[int | None] = mapped_column(Integer)
    validity_days: Mapped[int | None] = mapped_column(Integer)
    pack: Mapped[str | None] = mapped_column(String)
    stripe_price_id: Mapped[str | None] = mapped_column(String)  # cached recurring Price
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    custom_fields: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict, nullable=False)


class Package(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "packages"
    __table_args__ = (
        enum_check("packages", "status", "active", "used", "expired", "canceled", "pending"),
        Index("ix_packages_client_status", "business_id", "client_id", "status"),
    )

    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), nullable=False)
    item_id: Mapped[str] = mapped_column(ForeignKey("items.id"), nullable=False)
    sessions_total: Mapped[int] = mapped_column(Integer, nullable=False)
    sessions_used: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String, default="active", nullable=False)
    payment_id: Mapped[str | None] = mapped_column(ForeignKey("payments.id"))


class Subscription(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "subscriptions"
    __table_args__ = (
        enum_check("subscriptions", "status", "active", "paused", "canceled", "past_due"),
        Index("ix_subscriptions_client_status", "business_id", "client_id", "status"),
        Index("ix_subscriptions_provider_ref", "provider_ref", unique=True),
        Index(
            "ix_subscriptions_active_unique",
            "business_id",
            "client_id",
            "item_id",
            unique=True,
            postgresql_where=text("status IN ('active', 'paused')"),
        ),
    )

    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), nullable=False)
    item_id: Mapped[str] = mapped_column(ForeignKey("items.id"), nullable=False)
    status: Mapped[str] = mapped_column(String, default="active", nullable=False)
    current_period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    payment_method_id: Mapped[str | None] = mapped_column(ForeignKey("payment_methods.id"))
    provider_ref: Mapped[str | None] = mapped_column(String)
    trial_end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class GiftCard(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "gift_cards"
    __table_args__ = (
        UniqueConstraint("business_id", "code", name="uq_gift_cards_business_code"),
        enum_check("gift_cards", "status", "active", "redeemed", "expired", "void", "pending"),
    )

    code: Mapped[str] = mapped_column(String, nullable=False)
    item_id: Mapped[str | None] = mapped_column(ForeignKey("items.id"))
    initial_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    balance_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    purchaser_client_id: Mapped[str | None] = mapped_column(ForeignKey("clients.id"))
    recipient: Mapped[str | None] = mapped_column(String)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String, default="active", nullable=False)
    payment_id: Mapped[str | None] = mapped_column(ForeignKey("payments.id"))
