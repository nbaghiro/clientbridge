"""Server-only auth infrastructure (refresh-token families + one-time tokens).

NOT business-scoped and NOT referenced by the sync rules → never reaches a client (excluded from the
generated AppSchema). A future hardening could move these to a `private` schema + a `FOR TABLES IN
SCHEMA public` publication so they aren't replicated into PowerSync's server-side storage either.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from clientbridge.core.db import Base
from clientbridge.models.base import PKMixin, enum_check


class AuthSession(PKMixin, Base):
    """One refresh-token family per login/device. Rotation swaps `token_hash`; replay of an old or
    revoked hash → revoke the whole family."""

    __tablename__ = "auth_sessions"
    __table_args__ = (
        Index("ix_auth_sessions_user", "user_id"),
        Index("ix_auth_sessions_family", "family_id"),
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

    __tablename__ = "auth_tokens"
    __table_args__ = (
        enum_check("auth_tokens", "purpose", "reset", "verify"),
        Index("ix_auth_tokens_user", "user_id"),
    )

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    purpose: Mapped[str] = mapped_column(String, nullable=False)
    token_hash: Mapped[str] = mapped_column(String, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
