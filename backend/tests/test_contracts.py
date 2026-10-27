import secrets

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.config import get_settings
from clientbridge.core.errors import TooManyRequests
from clientbridge.core.ids import new_id
from clientbridge.core.ratelimit import RateLimiter, public_contract_rate_limit
from clientbridge.main import app
from clientbridge.models.documents import Contract, Signature
from tests.conftest import Factory, FakeSmsSender
from tests.helpers import client_id, new_client

BIZ = "bz_birchbark"
WAIVER = "con_waiver"  # seeded contract

SIGN = {"typed_name": "Jane Doe", "agreed": True, "version": 2}


async def _a_signature(db: AsyncSession, *, contract_id: str = WAIVER) -> str:
    signature = Signature(
        id=new_id("signature"),
        business_id=BIZ,
        contract_id=contract_id,
        client_id=await client_id(db),
        status="pending",
        token=secrets.token_urlsafe(16),
    )
    db.add(signature)
    await db.flush()
    assert signature.token
    return signature.token


async def test_send_creates_pending_and_notifies(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    cid = await new_client(db)
    res = await as_owner.post("/v1/contracts/send", json={"contract_id": WAIVER, "client_id": cid})
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "pending" and body["token"]
    row = (await db.execute(select(Signature).where(Signature.id == body["id"]))).scalar_one()
    assert row.business_id == BIZ and row.status == "pending"
    assert any(f"/contract/{body['token']}" in m.body for m in sms.sent)


async def test_send_unknown_contract_404(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await client_id(db)
    res = await as_owner.post(
        "/v1/contracts/send", json={"contract_id": "con_nope", "client_id": cid}
    )
    assert res.status_code == 404


async def test_send_unknown_client_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
        "/v1/contracts/send", json={"contract_id": WAIVER, "client_id": "cl_nope"}
    )
    assert res.status_code == 404


async def test_send_requires_admin(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await client_id(db)
    res = await as_staff.post("/v1/contracts/send", json={"contract_id": WAIVER, "client_id": cid})
    assert res.status_code == 403


async def test_send_is_tenant_isolated(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Rival Contracts")
    contract = Contract(id=new_id("contract"), business_id=other.id, name="Theirs", body="x")
    db.add(contract)
    await db.flush()
    cid = await client_id(db)
    res = await as_owner.post(
        "/v1/contracts/send", json={"contract_id": contract.id, "client_id": cid}
    )
    assert res.status_code == 404


async def test_public_get_returns_context(api: httpx.AsyncClient, db: AsyncSession) -> None:
    token = await _a_signature(db)
    body = (await api.get(f"/contract/{token}")).json()
    assert body["contract_name"] and body["status"] == "pending"
    assert body["brand"]["primary"] == "#2E4A3F"  # brand exposed on the contract surface
    assert "authorize" in body["body"] and body["signer_name"]


async def test_public_sign_records_snapshot_and_ip(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    token = await _a_signature(db)
    res = await api.post(f"/contract/{token}/sign", json=SIGN)
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "signed"
    row = (await db.execute(select(Signature).where(Signature.token == token))).scalar_one()
    contract = (await db.execute(select(Contract).where(Contract.id == WAIVER))).scalar_one()
    assert row.status == "signed" and row.signed_at is not None and row.ip
    assert row.signed_body == contract.body and row.signer_name == "Jane Doe"
    assert res.json()["body"] == contract.body


async def test_a_spoofed_forwarded_entry_does_not_change_the_signer_ip(
    api: httpx.AsyncClient, db: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "trusted_proxy_hops", 2)
    token = await _a_signature(db)
    res = await api.post(
        f"/contract/{token}/sign",
        json=SIGN,
        headers={"X-Forwarded-For": "6.6.6.6, 203.0.113.7, 130.211.0.1"},
    )
    assert res.status_code == 200, res.text
    row = (await db.execute(select(Signature).where(Signature.token == token))).scalar_one()
    assert row.ip == "203.0.113.7"


async def test_public_second_sign_409(api: httpx.AsyncClient, db: AsyncSession) -> None:
    token = await _a_signature(db)
    assert (await api.post(f"/contract/{token}/sign", json=SIGN)).status_code == 200
    assert (await api.post(f"/contract/{token}/sign", json=SIGN)).status_code == 409


async def test_public_decline_then_sign_409(api: httpx.AsyncClient, db: AsyncSession) -> None:
    token = await _a_signature(db)
    declined = await api.post(f"/contract/{token}/decline")
    assert declined.status_code == 200 and declined.json()["status"] == "declined"
    assert (await api.post(f"/contract/{token}/sign", json=SIGN)).status_code == 409


async def test_public_unknown_token_404(api: httpx.AsyncClient) -> None:
    assert (await api.get("/contract/nope")).status_code == 404
    assert (await api.post("/contract/nope/sign", json=SIGN)).status_code == 404
    assert (await api.post("/contract/nope/decline")).status_code == 404


async def test_public_get_is_rate_limited(api: httpx.AsyncClient, db: AsyncSession) -> None:
    rl = RateLimiter(limit=1, window_s=60.0)

    def limited() -> None:
        if not rl.check("x", 0.0):
            raise TooManyRequests("slow down")

    app.dependency_overrides[public_contract_rate_limit] = limited
    token = await _a_signature(db)
    assert (await api.get(f"/contract/{token}")).status_code == 200
    assert (await api.get(f"/contract/{token}")).status_code == 429


async def test_sign_rejects_a_version_the_client_has_not_seen(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    token = await _a_signature(db)
    seen = (await api.get(f"/contract/{token}")).json()
    contract = await db.get(Contract, WAIVER)
    assert contract is not None
    contract.body = "replacement terms"
    contract.version += 1
    await db.commit()
    response = await api.post(f"/contract/{token}/sign", json=SIGN | {"version": seen["version"]})
    assert response.status_code == 409
    signature = await db.scalar(select(Signature).where(Signature.token == token))
    assert signature is not None and signature.status == "pending"
    assert signature.signed_body is None
