from fastapi.testclient import TestClient

from clientbridge.core.ids import new_id
from clientbridge.main import app

client = TestClient(app)


def test_health():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_new_id_has_prefix():
    assert new_id("business").startswith("bz_")
    assert new_id("invoice").startswith("inv_")
