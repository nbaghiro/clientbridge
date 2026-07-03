import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from clientbridge.core.config import Settings
from clientbridge.core.ids import new_id
from clientbridge.main import app

client = TestClient(app)


def test_prod_requires_real_secrets() -> None:
    # Fail closed: a non-dev env with the public dev jwt secret / empty stripe secret must refuse.
    with pytest.raises(ValidationError):
        Settings(env="prod")
    assert Settings(env="dev").env == "dev"  # dev keeps the convenient defaults


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
