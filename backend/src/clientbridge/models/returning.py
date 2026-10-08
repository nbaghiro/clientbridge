from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from clientbridge.core.db import Base
from clientbridge.models.base import BusinessScoped, PKMixin


class ReturningChallenge(PKMixin, BusinessScoped, Base):
    """Server-only mailbox proof; neither verification codes nor session secrets are stored raw."""

    __tablename__ = "returning_challenges"
    __table_args__ = (
        Index("ix_returning_destination", "business_id", "destination_hash", "created_at"),
        Index("ix_returning_session", "session_hash", unique=True),
    )

    client_id: Mapped[str | None] = mapped_column(ForeignKey("clients.id"))
    destination_hash: Mapped[str] = mapped_column(String, nullable=False)
    code_hash: Mapped[str] = mapped_column(String, nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    session_hash: Mapped[str | None] = mapped_column(String)
    session_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
