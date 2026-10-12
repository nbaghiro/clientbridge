"""Ory Kratos owns credentials and sessions: link users to identities, drop the auth tables."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "cb0003"
down_revision: str | None = "cb0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index("ix_tokens_user", table_name="tokens")
    op.drop_table("tokens")
    op.drop_index("ix_sessions_user", table_name="sessions")
    op.drop_index("ix_sessions_family", table_name="sessions")
    op.drop_table("sessions")
    op.add_column("users", sa.Column("identity_id", sa.Uuid(as_uuid=False), nullable=False))
    op.add_column("users", sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True))
    op.create_unique_constraint("users_identity_id_key", "users", ["identity_id"])
    op.drop_column("users", "password_hash")
    op.drop_column("users", "oauth")
    op.drop_column("users", "email_verified_at")


def downgrade() -> None:
    op.add_column(
        "users", sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "users",
        sa.Column(
            "oauth",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
    )
    op.alter_column("users", "oauth", server_default=None)
    op.add_column("users", sa.Column("password_hash", sa.String(), nullable=True))
    op.drop_constraint("users_identity_id_key", "users", type_="unique")
    op.drop_column("users", "last_seen_at")
    op.drop_column("users", "identity_id")
    op.create_table(
        "sessions",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("family_id", sa.String(), nullable=False),
        sa.Column("token_hash", sa.String(), nullable=False),
        sa.Column("device", sa.String(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("replay_attempt_id", sa.String(), nullable=True),
        sa.Column("replay_ciphertext", sa.String(), nullable=True),
        sa.Column("replay_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("replay_session_id", sa.String(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("id", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sessions_family", "sessions", ["family_id"], unique=False)
    op.create_index("ix_sessions_user", "sessions", ["user_id"], unique=False)
    op.create_table(
        "tokens",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("purpose", sa.String(), nullable=False),
        sa.Column("token_hash", sa.String(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("id", sa.String(), nullable=False),
        sa.CheckConstraint("purpose IN ('reset', 'verify')", name="ck_tokens_purpose"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tokens_user", "tokens", ["user_id"], unique=False)
