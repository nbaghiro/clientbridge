from datetime import datetime
from typing import Literal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from clientbridge.core.db import Base
from clientbridge.models.base import BusinessScoped, PKMixin, TimestampMixin, enum_check

ItemKind = Literal["service", "class", "product", "package", "subscription", "gift"]
DepositType = Literal["none", "fixed", "percent"]
TaxClass = Literal["standard", "federal_only", "exempt"]
Frequency = Literal["day", "week", "month", "year"]
PackageStatus = Literal["active", "used", "expired", "canceled", "pending"]
SubscriptionStatus = Literal["active", "paused", "canceled", "past_due"]
GiftCardStatus = Literal["active", "expired", "void", "pending"]
StockReason = Literal["sale", "refund", "restock", "correction"]


BOOKABLE_KINDS: tuple[ItemKind, ...] = ("service", "class")
ENTITLEMENT_KINDS: tuple[ItemKind, ...] = ("gift", "package", "subscription")


class Item(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "items"
    __table_args__ = (
        enum_check("items", "kind", ItemKind),
        enum_check("items", "deposit_type", DepositType),
        enum_check("items", "tax_class", TaxClass),
        enum_check("items", "frequency", Frequency),
        CheckConstraint(
            "online_bookable = false OR kind IN ('service', 'class')",
            name="ck_items_online_bookable_kind",
        ),
        CheckConstraint(
            "variant_parent_id IS NULL OR (kind = 'product' AND variant_parent_id != id)",
            name="ck_items_variant_kind",
        ),
        CheckConstraint("track_stock = false OR kind = 'product'", name="ck_items_stock_kind"),
        CheckConstraint(
            "sell_online = false OR kind = 'product'", name="ck_items_sell_online_kind"
        ),
        CheckConstraint("addon = false OR kind = 'product'", name="ck_items_addon_kind"),
        Index("ix_items_business_kind_active", "business_id", "kind", "active"),
        Index(
            "ux_items_business_sku",
            "business_id",
            "sku",
            unique=True,
            postgresql_where=text("sku IS NOT NULL"),
        ),
    )

    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    kind: Mapped[ItemKind] = mapped_column(String, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(String)
    variant_parent_id: Mapped[str | None] = mapped_column(ForeignKey("items.id"))
    variant_label: Mapped[str | None] = mapped_column(String)
    price_cents: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="CAD", nullable=False)
    duration_min: Mapped[int | None] = mapped_column(Integer)
    capacity: Mapped[int | None] = mapped_column(Integer)
    category: Mapped[str | None] = mapped_column(String)
    color: Mapped[str | None] = mapped_column(String)
    online_bookable: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sell_online: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    buffer_before_min: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    buffer_after_min: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    deposit_type: Mapped[DepositType] = mapped_column(String, default="none", nullable=False)
    deposit_value: Mapped[float | None] = mapped_column(Numeric)
    interval: Mapped[int | None] = mapped_column(Integer)
    frequency: Mapped[Frequency | None] = mapped_column(String)
    session_count: Mapped[int | None] = mapped_column(Integer)
    validity_days: Mapped[int | None] = mapped_column(Integer)
    covers_item_id: Mapped[str | None] = mapped_column(ForeignKey("items.id"))  # package visits
    visits_per_period: Mapped[int | None] = mapped_column(Integer)  # membership visits included
    member_discount_bps: Mapped[int | None] = mapped_column(Integer)  # members' retail discount
    gift_amounts: Mapped[list[int] | None] = mapped_column(ARRAY(BigInteger))  # suggested cents
    stripe_price_id: Mapped[str | None] = mapped_column(String)  # cached recurring Price
    tax_class: Mapped[TaxClass] = mapped_column(String, default="standard", nullable=False)
    sku: Mapped[str | None] = mapped_column(String)
    cost_cents: Mapped[int | None] = mapped_column(BigInteger)
    track_stock: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    stock_on_hand: Mapped[int | None] = mapped_column(Integer)  # cached from inventory
    low_stock_at: Mapped[int | None] = mapped_column(Integer)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # offered while booking online; addon_for lists the services it shows with (empty = all)
    addon: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
    addon_for: Mapped[list[str]] = mapped_column(
        ARRAY(String), default=list, server_default="{}", nullable=False
    )
    custom_fields: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict, nullable=False)


class Package(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "packages"
    __table_args__ = (
        enum_check("packages", "status", PackageStatus),
        Index("ix_packages_client_status", "business_id", "client_id", "status"),
    )

    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), nullable=False)
    item_id: Mapped[str] = mapped_column(ForeignKey("items.id"), nullable=False)
    sessions_total: Mapped[int] = mapped_column(Integer, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[PackageStatus] = mapped_column(String, default="active", nullable=False)
    payment_id: Mapped[str | None] = mapped_column(ForeignKey("payments.id"))


class Subscription(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "subscriptions"
    __table_args__ = (
        enum_check("subscriptions", "status", SubscriptionStatus),
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
    status: Mapped[SubscriptionStatus] = mapped_column(String, default="active", nullable=False)
    current_period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    payment_method_id: Mapped[str | None] = mapped_column(ForeignKey("payment_methods.id"))
    provider_ref: Mapped[str | None] = mapped_column(String)


class GiftCard(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "gift_cards"
    __table_args__ = (
        UniqueConstraint("business_id", "code", name="uq_gift_cards_business_code"),
        enum_check("gift_cards", "status", GiftCardStatus),
    )

    code: Mapped[str] = mapped_column(String, nullable=False)
    item_id: Mapped[str | None] = mapped_column(ForeignKey("items.id"))
    initial_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    purchaser_client_id: Mapped[str | None] = mapped_column(ForeignKey("clients.id"))
    recipient: Mapped[str | None] = mapped_column(String)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[GiftCardStatus] = mapped_column(String, default="active", nullable=False)
    payment_id: Mapped[str | None] = mapped_column(ForeignKey("payments.id"))


class StockMovement(PKMixin, BusinessScoped, TimestampMixin, Base):
    """One signed stock change, keyed on its line so a re-delivered payment moves stock once."""

    __tablename__ = "inventory"
    __table_args__ = (
        enum_check("inventory", "reason", StockReason),
        Index(
            "ux_inventory_line_reason",
            "line_id",
            "reason",
            unique=True,
            postgresql_where=text("line_id IS NOT NULL"),
        ),
        Index("ix_inventory_item", "business_id", "item_id"),
    )

    item_id: Mapped[str] = mapped_column(ForeignKey("items.id"), nullable=False)
    line_id: Mapped[str | None] = mapped_column(ForeignKey("lines.id"))
    reason: Mapped[StockReason] = mapped_column(String, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_cost_cents: Mapped[int | None] = mapped_column(BigInteger)
    note: Mapped[str | None] = mapped_column(String)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
