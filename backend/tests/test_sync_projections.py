"""Replication is a reviewed column allowlist, independent of model expansion."""

import json
from pathlib import Path

import pytest
from scripts.gen_sync_schema import SYNC_STREAMS, gen_table, stream_columns, synced_columns
from sqlalchemy import Column, MetaData, String

from clientbridge.core.db import Base


def test_sensitive_server_fields_are_not_projected() -> None:
    projections = synced_columns()
    denied = {
        "staff": {"invite_token"},
        "clients": {"stripe_customer_id"},
        "items": {"stripe_price_id"},
        "files": {"s3_key"},
        "bookings": {"manage_token"},
        "orders": {"status_token", "receipt_token"},
        "payments": {"provider_ref"},
        "payment_methods": {"provider_ref"},
        "subscriptions": {"provider_ref"},
        "messages": {"provider_ref"},
        "responses": {"token"},
    }
    for table, columns in denied.items():
        assert columns.isdisjoint(projections[table]), table
    assert {"sessions", "tokens", "sync_receipts", "commands"}.isdisjoint(projections)
    assert sorted(projections["users"]) == ["id", "name"]


def test_new_model_column_is_excluded_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    metadata = MetaData()
    for table in Base.metadata.tables.values():
        table.to_metadata(metadata)
    metadata.tables["clients"].append_column(Column("unreviewed_secret", String))
    monkeypatch.setattr(Base, "metadata", metadata)
    projection = synced_columns()["clients"]
    assert "unreviewed_secret" not in projection
    assert "unreviewed_secret" not in gen_table("clients", projection)


@pytest.mark.parametrize("projection", ["*", "id, unknown_secret", "id, name AS label"])
def test_unsupported_projections_fail_closed(projection: str) -> None:
    with pytest.raises(ValueError):
        synced_columns(f"  team:\n    queries:\n      - SELECT {projection} FROM clients")


def test_stream_cte_columns_are_not_replica_columns() -> None:
    rules = """
streams:
  team:
    with:
      member: SELECT invite_token FROM staff WHERE user_id = auth.user_id()
    queries:
      - SELECT id, title FROM staff WHERE business_id IN member
      - SELECT id, rate_cents FROM staff WHERE business_id IN member
"""
    assert synced_columns(rules) == {"staff": ["id", "title", "rate_cents"]}


def test_required_share_capabilities_remain_available() -> None:
    projections = synced_columns()
    for table, column in (
        ("invoices", "pay_token"),
        ("estimates", "view_token"),
        ("signatures", "token"),
    ):
        assert column in projections[table]


SNAPSHOT = Path(__file__).parent / "fixtures" / "sync_projections.json"
# what owner and admin may read and nobody else: pay, tax registration and billing contacts
OWNER_ONLY = {
    "gift_cards": {"code"},
    "staff": {"payee", "rate_type", "rate_bps", "rate_cents", "retail_rate_bps"},
    "businesses": {
        "gst_hst_number",
        "qst_number",
        "pst_number",
        "billing_email",
        "review_requests_enabled",
    },
}
LIMITED_STREAMS = (
    "business_shared",
    "staff_limited",
    "staff_self",
    "history_shared",
    "history_self",
)


def projection_errors(streams: dict[str, dict[str, list[str]]]) -> list[str]:
    reviewed = json.loads(SNAPSHOT.read_text())
    errors = []
    for stream in sorted(streams.keys() | reviewed.keys()):
        tables = streams.get(stream, {})
        approved = reviewed.get(stream, {})
        for table in sorted(tables.keys() | approved.keys()):
            for column in sorted(set(tables.get(table, [])) - set(approved.get(table, []))):
                errors.append(f"{stream}.{table}.{column} is not in the reviewed snapshot")
            for column in sorted(set(approved.get(table, [])) - set(tables.get(table, []))):
                errors.append(f"{stream}.{table}.{column} was removed; update the snapshot")
    for stream in LIMITED_STREAMS:
        for table, columns in OWNER_ONLY.items():
            for column in sorted(columns & set(streams.get(stream, {}).get(table, []))):
                errors.append(f"{stream}.{table}.{column} reaches members who are not owner/admin")
    return errors


def test_projections_match_the_reviewed_snapshot() -> None:
    assert projection_errors(stream_columns()) == []


def test_an_over_broad_rule_change_is_reported() -> None:
    rules = SYNC_STREAMS.read_text().replace(
        "SELECT id, hours_revision, business_id, user_id, role,",
        "SELECT id, hours_revision, rate_cents, business_id, user_id, role,",
        1,
    )
    assert rules != SYNC_STREAMS.read_text()
    assert projection_errors(stream_columns(rules)) == [
        "staff_limited.staff.rate_cents is not in the reviewed snapshot",
        "staff_limited.staff.rate_cents reaches members who are not owner/admin",
    ]


def test_treatment_notes_never_reach_a_device() -> None:
    queries = [line for line in SYNC_STREAMS.read_text().splitlines() if " FROM responses " in line]
    assert queries
    assert all(line.rstrip().endswith("AND token IS NOT NULL") for line in queries)
