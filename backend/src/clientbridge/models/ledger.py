from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from clientbridge.core.db import Base
from clientbridge.models.base import BusinessScoped, PKMixin, TimestampMixin, enum_check

OWNER_TYPES = ("business", "client", "staff", "platform", "gift_card", "package")
ACCOUNT_CATEGORIES = (
    "stripe",
    "bank",
    "cash",
    "receivable",
    "tax",
    "gift_card",
    "deposit",
    "deferred",
    "payable",
    "revenue",
    "fee_revenue",
    "processing_fee",
    "platform_fee",
    "staff_cost",
)
ENTRY_EVENTS = (
    "invoice",
    "sale",
    "payment",
    "fee",
    "refund",
    "dispute",
    "payout",
    "redemption",
    "consumption",
    "forfeit",
    "application",
    "breakage",
    "remittance",
    "earning",
    "approval",
    "staff_payment",
    "adjustment",
    "reversal",
    "tip",
)


class Account(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "accounts"
    __table_args__ = (
        enum_check("accounts", "owner_type", *OWNER_TYPES),
        enum_check("accounts", "category", *ACCOUNT_CATEGORIES),
        Index(
            "ux_accounts_identity",
            "business_id",
            "owner_type",
            "owner_id",
            "category",
            "code",
            "currency",
            unique=True,
        ),
    )

    owner_type: Mapped[str] = mapped_column(String, nullable=False)
    owner_id: Mapped[str] = mapped_column(String, nullable=False)
    category: Mapped[str] = mapped_column(String, nullable=False)
    code: Mapped[str] = mapped_column(String, default="", nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="CAD", nullable=False)
    balance_cents: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)


class Entry(PKMixin, BusinessScoped, Base):
    __tablename__ = "entries"
    __table_args__ = (
        enum_check("entries", "event", *ENTRY_EVENTS),
        Index("ux_entries_ref_leg", "ref", "leg", unique=True),
        Index("ix_entries_journal", "journal_id"),
        Index("ix_entries_account", "account_id", "occurred_at"),
        Index("ix_entries_owner", "owner_type", "owner_id"),
        Index("ix_entries_subject", "subject_type", "subject_id"),
        Index("ix_entries_source", "source_type", "source_id"),
    )

    journal_id: Mapped[str] = mapped_column(String, nullable=False)
    account_id: Mapped[str] = mapped_column(
        ForeignKey("accounts.id", ondelete="RESTRICT"), nullable=False
    )
    # copied from the account so sync rules can slice a party's own entries (rows never change)
    owner_type: Mapped[str] = mapped_column(String, nullable=False)
    owner_id: Mapped[str] = mapped_column(String, nullable=False)
    amount_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="CAD", nullable=False)
    event: Mapped[str] = mapped_column(String, nullable=False)
    source_type: Mapped[str | None] = mapped_column(String)
    source_id: Mapped[str | None] = mapped_column(String)
    subject_type: Mapped[str | None] = mapped_column(String)
    subject_id: Mapped[str | None] = mapped_column(String)
    ref: Mapped[str] = mapped_column(String, nullable=False)
    leg: Mapped[int] = mapped_column(Integer, nullable=False)
    meta: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    available_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
