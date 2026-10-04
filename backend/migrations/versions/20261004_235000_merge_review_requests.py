"""merge review_requests into reviews: one row per review from request to moderation

Revision ID: 8f2d5b7a1c94
Revises: 6c4a9e2d8b13
Create Date: 2026-10-04 23:50:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "8f2d5b7a1c94"
down_revision: str | None = "6c4a9e2d8b13"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.add_column("reviews", sa.Column("channel", sa.String(), nullable=True))
    op.add_column("reviews", sa.Column("token", sa.String(), nullable=True))
    op.add_column("reviews", sa.Column("requested_at", _TS, nullable=True))
    op.add_column("reviews", sa.Column("submitted_at", _TS, nullable=True))
    op.alter_column("reviews", "rating", nullable=True)
    op.drop_constraint("ck_reviews_status", "reviews", type_="check")

    op.execute("UPDATE reviews SET submitted_at = created_at")
    op.execute("UPDATE reviews SET status = 'submitted' WHERE status = 'pending'")
    op.execute(
        """
        UPDATE reviews r SET channel = q.channel, token = q.token, requested_at = q.sent_at
        FROM review_requests q WHERE q.review_id = r.id
        """
    )
    # an unanswered request becomes a review row awaiting its rating; an expired one is dropped
    op.execute(
        """
        INSERT INTO reviews (id, business_id, client_id, booking_id, channel, token, status,
                             requested_at, sent_to_google, created_at, updated_at)
        SELECT id, business_id, client_id, booking_id, channel, token,
               CASE status WHEN 'sent' THEN 'requested' ELSE 'opened' END,
               sent_at, false, created_at, updated_at
        FROM review_requests
        WHERE review_id IS NULL AND status IN ('sent', 'opened')
        """
    )

    op.create_check_constraint(
        "ck_reviews_status",
        "reviews",
        "status IN ('requested', 'opened', 'submitted', 'published', 'hidden')",
    )
    op.create_check_constraint("ck_reviews_channel", "reviews", "channel IN ('sms', 'email')")
    op.create_check_constraint(
        "ck_reviews_submitted_rating",
        "reviews",
        "status IN ('requested', 'opened') OR rating IS NOT NULL",
    )
    op.create_unique_constraint("uq_reviews_token", "reviews", ["token"])
    op.create_index(
        "uq_reviews_open_booking",
        "reviews",
        ["business_id", "booking_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('requested', 'opened') AND booking_id IS NOT NULL"),
    )
    op.drop_table("review_requests")


def downgrade() -> None:
    op.create_table(
        "review_requests",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("business_id", sa.String(), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("client_id", sa.String(), sa.ForeignKey("clients.id"), nullable=False),
        sa.Column("booking_id", sa.String(), sa.ForeignKey("bookings.id"), nullable=True),
        sa.Column("channel", sa.String(), nullable=False),
        sa.Column("token", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("sent_at", _TS, nullable=True),
        sa.Column("review_id", sa.String(), sa.ForeignKey("reviews.id"), nullable=True),
        sa.Column("created_at", _TS, server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", _TS, server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("channel IN ('sms', 'email')", name="ck_review_requests_channel"),
        sa.CheckConstraint(
            "status IN ('sent', 'opened', 'completed', 'expired')",
            name="ck_review_requests_status",
        ),
        sa.UniqueConstraint("token", name="uq_review_requests_token"),
    )
    op.create_index("ix_review_requests_business_id", "review_requests", ["business_id"])
    op.create_index("ix_review_requests_status", "review_requests", ["business_id", "status"])
    op.create_index(
        "uq_review_requests_open_booking",
        "review_requests",
        ["business_id", "booking_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('sent', 'opened') AND booking_id IS NOT NULL"),
    )
    op.execute(
        """
        INSERT INTO review_requests (id, business_id, client_id, booking_id, channel, token, status,
                                     sent_at, review_id, created_at, updated_at)
        SELECT CASE WHEN rating IS NULL THEN id ELSE 'rvr_' || substr(id, 4) END,
               business_id, client_id, booking_id, channel, token,
               CASE status WHEN 'requested' THEN 'sent' WHEN 'opened' THEN 'opened'
                           ELSE 'completed' END,
               requested_at, CASE WHEN rating IS NULL THEN NULL ELSE id END, created_at, updated_at
        FROM reviews WHERE token IS NOT NULL
        """
    )
    op.execute("DELETE FROM reviews WHERE rating IS NULL")

    op.drop_index("uq_reviews_open_booking", table_name="reviews")
    op.drop_constraint("uq_reviews_token", "reviews", type_="unique")
    op.drop_constraint("ck_reviews_submitted_rating", "reviews", type_="check")
    op.drop_constraint("ck_reviews_channel", "reviews", type_="check")
    op.drop_constraint("ck_reviews_status", "reviews", type_="check")
    op.execute("UPDATE reviews SET status = 'pending' WHERE status = 'submitted'")
    op.create_check_constraint(
        "ck_reviews_status", "reviews", "status IN ('published', 'hidden', 'pending')"
    )
    op.alter_column("reviews", "rating", nullable=False)
    op.drop_column("reviews", "submitted_at")
    op.drop_column("reviews", "requested_at")
    op.drop_column("reviews", "token")
    op.drop_column("reviews", "channel")
