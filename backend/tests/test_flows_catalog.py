"""Create, edit and archive one catalog item of every kind."""

import httpx
import pytest

from tests.helpers import ok

KINDS: dict[str, dict[str, object]] = {
    "service": {"duration_min": 45, "deposit_type": "fixed", "deposit_value": 1500},
    "class": {"duration_min": 60, "capacity": 8},
    "product": {"sku": "FLOW-SKU-1", "cost_cents": 900, "track_stock": True, "sell_online": True},
    "package": {"session_count": 4, "validity_days": 90},
    "subscription": {"interval": 1, "frequency": "month"},
    "gift": {},
}


@pytest.mark.parametrize("kind", list(KINDS))
async def test_create_edit_and_archive_each_kind(as_owner: httpx.AsyncClient, kind: str) -> None:
    fields = KINDS[kind]
    created = ok(
        await as_owner.post(
            "/v1/items",
            json={"kind": kind, "name": f"Flow {kind}", "price_cents": 4000, **fields},
        ),
        201,
    ).json()
    assert created["kind"] == kind and created["active"] is True
    assert {k: created[k] for k in fields} == fields
    assert created["online_bookable"] is (kind in ("service", "class"))

    edited = ok(
        await as_owner.patch(
            f"/v1/items/{created['id']}", json={"name": f"Renamed {kind}", "price_cents": 5000}
        )
    ).json()
    assert (edited["name"], edited["price_cents"]) == (f"Renamed {kind}", 5000)

    ok(await as_owner.delete(f"/v1/items/{created['id']}"), 204)
    archived = ok(await as_owner.get(f"/v1/items/{created['id']}")).json()
    assert archived["active"] is False
