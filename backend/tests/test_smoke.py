from fastapi.testclient import TestClient

from clientbridge.core.ids import new_id
from clientbridge.main import app

client = TestClient(app)


def test_health() -> None:
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_new_id_has_prefix() -> None:
    assert new_id("business").startswith("bz_")
    assert new_id("invoice").startswith("inv_")


def test_sync_token_dev() -> None:
    # Unauthenticated in dev → mints a PowerSync token for the dev user.
    res = client.get("/sync/token")
    assert res.status_code == 200
    assert res.json()["token"]
