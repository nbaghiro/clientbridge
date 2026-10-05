"""Server-only auth tables; not business-scoped and never synced."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from clientbridge.core.db import Base
from clientbridge.models.base import PKMixin, enum_check


class AuthSession(PKMixin, Base):
    """One refresh-token family per login; replaying a rotated token revokes the family."""

    __tablename__ = "sessions"
    __table_args__ = (
        Index("ix_sessions_user", "user_id"),
        Index("ix_sessions_family", "family_id"),
    )

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    family_id: Mapped[str] = mapped_column(String, nullable=False)
    token_hash: Mapped[str] = mapped_column(String, nullable=False)
    device: Mapped[str | None] = mapped_column(String)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class AuthToken(PKMixin, Base):
    """A single-use, expiring token for password reset / email verification."""

    __tablename__ = "tokens"
    __table_args__ = (
        enum_check("tokens", "purpose", "reset", "verify"),
        Index("ix_tokens_user", "user_id"),
    )

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    purpose: Mapped[str] = mapped_column(String, nullable=False)
    token_hash: Mapped[str] = mapped_column(String, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
