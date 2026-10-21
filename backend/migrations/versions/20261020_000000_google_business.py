"""Store Google authorization and reply intent without importing review content."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cb0026"
down_revision: str | None = "cb0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "google_business_connections",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("business_id", sa.String(), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("connected_by", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("account_name", sa.String(), nullable=True),
        sa.Column("location_name", sa.String(), nullable=True),
        sa.Column("refresh_token_ciphertext", sa.LargeBinary(), nullable=True),
        sa.Column("key_version", sa.String(), nullable=True),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("generation", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_code", sa.String(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index(
        "ix_google_business_connections_business_id", "google_business_connections", ["business_id"]
    )
    op.create_table(
        "google_business_operations",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("business_id", sa.String(), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column(
            "connection_id",
            sa.String(),
            sa.ForeignKey("google_business_connections.id"),
            nullable=False,
        ),
        sa.Column("actor_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("generation", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("review_name", sa.String(), nullable=False),
        sa.Column("request_hash", sa.String(), nullable=False),
        sa.Column("idempotency_key", sa.String(), nullable=False),
        sa.Column("request_ciphertext", sa.LargeBinary(), nullable=True),
        sa.Column("key_version", sa.String(), nullable=True),
        sa.Column("expected_reply_revision", sa.String(), nullable=True),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_code", sa.String(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index(
        "ix_google_business_operations_business_id", "google_business_operations", ["business_id"]
    )
    op.create_unique_constraint(
        "uq_google_connection_business", "google_business_connections", ["business_id"]
    )
    op.create_index(
        "uq_google_active_location",
        "google_business_connections",
        ["location_name"],
        unique=True,
        postgresql_where=sa.text("state = 'active'"),
    )
    op.create_check_constraint(
        "ck_google_connection_generation", "google_business_connections", "generation > 0"
    )
    op.create_check_constraint(
        "ck_google_business_connections_state",
        "google_business_connections",
        "state IN ('selecting', 'active', 'reconnect_required', 'disconnected')",
    )
    op.create_unique_constraint(
        "uq_google_operation_key",
        "google_business_operations",
        ["business_id", "kind", "idempotency_key"],
    )
    op.create_index("ix_google_operations_due", "google_business_operations", ["state", "next_at"])
    op.create_check_constraint(
        "ck_google_operation_generation", "google_business_operations", "generation > 0"
    )
    op.create_check_constraint(
        "ck_google_operation_attempts", "google_business_operations", "attempts >= 0"
    )
    op.create_check_constraint(
        "ck_google_business_operations_kind",
        "google_business_operations",
        "kind IN ('reply_put', 'reply_delete')",
    )
    op.create_check_constraint(
        "ck_google_business_operations_state",
        "google_business_operations",
        "state IN ('queued', 'running', 'confirmed', 'failed', 'unknown', 'canceled')",
    )

    op.drop_column("businesses", "google_review_url")


def downgrade() -> None:
    raise RuntimeError(
        "Google connection removal requires explicit credential and operation cleanup"
    )
