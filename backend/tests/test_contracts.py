import secrets

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.errors import TooManyRequests
from clientbridge.core.ids import new_id
from clientbridge.core.ratelimit import RateLimiter, public_contract_rate_limit
from clientbridge.main import app
from clientbridge.models.crm import Client
from clientbridge.models.documents import Contract, Signature
from clientbridge.models.platform import File
from tests.conftest import Factory, FakeEmailSender

BIZ = "bz_birchbark"
WAIVER = "con_waiver"  # seeded contract


async def _a_client(db: AsyncSession) -> str:
    cid = (
        (await db.execute(select(Client.id).where(Client.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert cid
    return cid


async def _fresh_client(db: AsyncSession, *, email: str = "sign@example.ca") -> str:
    client = Client(
        id=new_id("client"),
        business_id=BIZ,
        name="Sign Client",
        email=email,
        tags=[],
        custom_fields={},
    )
    db.add(client)
    await db.flush()
    return client.id


async def _a_signature(db: AsyncSession, *, contract_id: str = WAIVER) -> str:
    signature = Signature(
        id=new_id("signature"),
        business_id=BIZ,
        contract_id=contract_id,
        client_id=await _a_client(db),
        status="pending",
        token=secrets.token_urlsafe(16),
    )
    db.add(signature)
    await db.flush()
    assert signature.token
    return signature.token


async def _a_file(db: AsyncSession, *, business_id: str = BIZ) -> str:
    file = File(
        id=new_id("file"),
        business_id=business_id,
        parent_type="signature",
        parent_id="sig_x",
        s3_key=f"{business_id}/{new_id('file')}",
    )
    db.add(file)
    await db.flush()
    return file.id


async def test_send_creates_pending_and_notifies(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    cid = await _fresh_client(db)
    res = await as_owner.post("/v1/contracts/send", json={"contract_id": WAIVER, "client_id": cid})
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "pending" and body["token"]
    row = (await db.execute(select(Signature).where(Signature.id == body["id"]))).scalar_one()
    assert row.business_id == BIZ and row.status == "pending"
    assert any(f"/contract/{body['token']}" in m.body for m in email.sent)


async def test_send_unknown_contract_404(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _a_client(db)
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
    cid = await _a_client(db)
    res = await as_staff.post("/v1/contracts/send", json={"contract_id": WAIVER, "client_id": cid})
    assert res.status_code == 403


async def test_send_is_tenant_isolated(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Rival Contracts")
    contract = Contract(id=new_id("contract"), business_id=other.id, name="Theirs", body="x")
    db.add(contract)
    await db.flush()
    cid = await _a_client(db)
    res = await as_owner.post(
        "/v1/contracts/send", json={"contract_id": contract.id, "client_id": cid}
    )
    assert res.status_code == 404


async def test_public_get_returns_context(api: httpx.AsyncClient, db: AsyncSession) -> None:
    token = await _a_signature(db)
    body = (await api.get(f"/contract/{token}")).json()
    assert body["contract_name"] and body["status"] == "pending"
    assert body["brand"]["primary"] == "#3F5E80"  # brand exposed on the contract surface
    assert "authorize" in body["body"] and body["signer_name"]


async def test_public_sign_records_snapshot_and_ip(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    token = await _a_signature(db)
    res = await api.post(f"/contract/{token}/sign", json={"typed_name": "Jane Doe"})
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "signed"
    row = (await db.execute(select(Signature).where(Signature.token == token))).scalar_one()
    contract = (await db.execute(select(Contract).where(Contract.id == WAIVER))).scalar_one()
    assert row.status == "signed" and row.signed_at is not None and row.ip
    assert row.signed_body is not None
    assert contract.body in row.signed_body and "Jane Doe" in row.signed_body


async def test_public_sign_with_image(api: httpx.AsyncClient, db: AsyncSession) -> None:
    token = await _a_signature(db)
    image_id = await _a_file(db)
    res = await api.post(f"/contract/{token}/sign", json={"signature_image_id": image_id})
    assert res.status_code == 200, res.text
    row = (await db.execute(select(Signature).where(Signature.token == token))).scalar_one()
    assert row.signature_image_id == image_id


async def test_public_sign_cross_tenant_image_404(
    api: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    token = await _a_signature(db)
    other = await factory.business(name="Rival Images")
    foreign = await _a_file(db, business_id=other.id)
    res = await api.post(f"/contract/{token}/sign", json={"signature_image_id": foreign})
    assert res.status_code == 404


async def test_public_second_sign_409(api: httpx.AsyncClient, db: AsyncSession) -> None:
    token = await _a_signature(db)
    assert (await api.post(f"/contract/{token}/sign", json={})).status_code == 200
    assert (await api.post(f"/contract/{token}/sign", json={})).status_code == 409


async def test_public_decline_then_sign_409(api: httpx.AsyncClient, db: AsyncSession) -> None:
    token = await _a_signature(db)
    declined = await api.post(f"/contract/{token}/decline")
    assert declined.status_code == 200 and declined.json()["status"] == "declined"
    assert (await api.post(f"/contract/{token}/sign", json={})).status_code == 409


async def test_public_upload_then_sign_with_image(api: httpx.AsyncClient, db: AsyncSession) -> None:
    token = await _a_signature(db)
    up = await api.post(f"/contract/{token}/upload", json={"content_type": "image/png"})
    assert up.status_code == 200, up.text
    fid = up.json()["file_id"]
    assert up.json()["upload_url"]  # presigned PUT target
    row = (await db.execute(select(File).where(File.id == fid))).scalar_one()
    assert row.business_id == BIZ  # the public upload is scoped to the token's business
    signed = await api.post(f"/contract/{token}/sign", json={"signature_image_id": fid})
    assert signed.status_code == 200, signed.text
    sig = (await db.execute(select(Signature).where(Signature.token == token))).scalar_one()
    assert sig.signature_image_id == fid


async def test_public_upload_unknown_token_404(api: httpx.AsyncClient) -> None:
    assert (await api.post("/contract/nope/upload", json={})).status_code == 404


async def test_public_unknown_token_404(api: httpx.AsyncClient) -> None:
    assert (await api.get("/contract/nope")).status_code == 404
    assert (await api.post("/contract/nope/sign", json={})).status_code == 404
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
