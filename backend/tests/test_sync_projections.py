"""Replication is a reviewed column allowlist, independent of model expansion."""

import pytest
from scripts.gen_sync_schema import gen_table, synced_columns
from sqlalchemy import Column, String

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
        "reviews": {"token"},
        "responses": {"token"},
    }
    for table, columns in denied.items():
        assert columns.isdisjoint(projections[table]), table
    assert {"sessions", "tokens", "sync_receipts", "commands"}.isdisjoint(projections)


def test_new_model_column_is_excluded_by_default() -> None:
    table = Base.metadata.tables["clients"]
    column = Column("unreviewed_secret", String)
    table.append_column(column)
    try:
        projection = synced_columns()["clients"]
        assert "unreviewed_secret" not in projection
        assert "unreviewed_secret" not in gen_table("clients", projection)
    finally:
        table._columns.remove(column)


@pytest.mark.parametrize("projection", ["*", "id, unknown_secret", "id, name AS label"])
def test_unsupported_projections_fail_closed(projection: str) -> None:
    with pytest.raises(ValueError):
        synced_columns(f"    data:\n      - SELECT {projection} FROM clients")


def test_parameter_columns_are_not_replica_columns() -> None:
    rules = """
    parameters:
      - SELECT invite_token FROM staff
    data:
      - SELECT id, name FROM staff WHERE business_id = bucket.business_id
      - SELECT id, rate_cents FROM staff WHERE business_id = bucket.business_id
"""
    assert synced_columns(rules) == {"staff": ["id", "name", "rate_cents"]}


def test_required_share_capabilities_remain_available() -> None:
    projections = synced_columns()
    for table, column in (
        ("invoices", "pay_token"),
        ("estimates", "view_token"),
        ("signatures", "token"),
    ):
        assert column in projections[table]
