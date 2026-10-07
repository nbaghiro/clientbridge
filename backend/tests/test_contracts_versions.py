import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.documents import Contract, Signature
from tests.conftest import Factory, FakeEmailSender
from tests.helpers import client_id, key, ok

BIZ = "bz_birchbark"
WAIVER = "con_waiver"
DRAWN = [[[0.1, 0.5], [0.2, 0.4], [0.3, 0.6]], [[0.5, 0.5], [0.8, 0.45]]]


async def _send(
    api: httpx.AsyncClient, db: AsyncSession, contract_id: str = WAIVER
) -> dict[str, object]:
    body = {"contract_id": contract_id, "client_id": await client_id(db, email="sign@example.ca")}
    return dict(ok(await api.post("/v1/contracts/send", json=body), 201).json())


async def test_create_a_contract(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    headers = key()
    body = {"name": "Boarding agreement", "body": "1. Drop-off\nBy 10 a.m."}
    out = ok(await as_owner.post("/v1/contracts", json=body, headers=headers), 201).json()
    assert (out["version"], out["active"]) == (1, True)
    again = ok(await as_owner.post("/v1/contracts", json=body, headers=headers), 201).json()
    assert again["id"] == out["id"]
    assert (await as_owner.post("/v1/contracts", json={"name": "x", "body": ""})).status_code == 422


async def test_new_text_is_a_new_version_and_signed_copies_keep_theirs(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    before = (await db.execute(select(Contract).where(Contract.id == WAIVER))).scalar_one()
    old_body, old_version = before.body, before.version
    sent = await _send(as_owner, db)
    assert sent["contract_version"] == old_version
    ok(
        await as_owner.post(
            f"/contract/{sent['token']}/sign", json={"typed_name": "Pat", "agreed": True}
        )
    )

    out = ok(
        await as_owner.post(f"/v1/contracts/{WAIVER}/versions", json={"body": "New terms"})
    ).json()
    assert (out["version"], out["body"]) == (old_version + 1, "New terms")
    signed = ok(await as_owner.get(f"/contract/{sent['token']}")).json()
    assert signed["version"] == old_version and old_body in signed["body"]
    later = await _send(as_owner, db)
    assert later["contract_version"] == old_version + 1


async def test_version_replay_publishes_once(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    before = (await db.execute(select(Contract.version).where(Contract.id == WAIVER))).scalar_one()
    url, headers = f"/v1/contracts/{WAIVER}/versions", key()
    first = ok(await as_owner.post(url, json={"body": "Replayed terms"}, headers=headers)).json()
    again = ok(await as_owner.post(url, json={"body": "Replayed terms"}, headers=headers)).json()
    assert again == first and first["version"] == before + 1


async def test_unchanged_text_is_refused(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    body = (await db.execute(select(Contract.body).where(Contract.id == WAIVER))).scalar_one()
    res = await as_owner.post(f"/v1/contracts/{WAIVER}/versions", json={"body": f"  {body} "})
    assert res.status_code == 409


async def test_staff_cannot_write_contracts(as_staff: httpx.AsyncClient) -> None:
    assert (
        await as_staff.post("/v1/contracts", json={"name": "A", "body": "B"})
    ).status_code == 403
    res = await as_staff.post(f"/v1/contracts/{WAIVER}/versions", json={"body": "B"})
    assert res.status_code == 403


async def test_versions_are_tenant_scoped(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Rival Contracts")
    theirs = Contract(id=new_id("contract"), business_id=other.id, name="Theirs", body="Old")
    db.add(theirs)
    await db.flush()
    res = await as_owner.post(f"/v1/contracts/{theirs.id}/versions", json={"body": "Mine now"})
    assert res.status_code == 404
    await db.refresh(theirs)
    assert theirs.body == "Old"


async def test_resend_a_waiting_request(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    sent = await _send(as_owner, db)
    before = len(email.sent)
    headers = key()
    ok(await as_owner.post(f"/v1/signatures/{sent['id']}/resend", headers=headers))
    ok(await as_owner.post(f"/v1/signatures/{sent['id']}/resend", headers=headers))
    assert len(email.sent) == before + 1  # the replay does not send again
    ok(
        await as_owner.post(
            f"/contract/{sent['token']}/sign", json={"typed_name": "Pat", "agreed": True}
        )
    )
    assert (await as_owner.post(f"/v1/signatures/{sent['id']}/resend")).status_code == 409


async def test_staff_cannot_resend(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    signature = await _pending(db)
    assert (await as_staff.post(f"/v1/signatures/{signature.id}/resend")).status_code == 403


async def test_resend_is_tenant_scoped(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Rival Signatures")
    client = await factory.client(business=other)
    theirs = Contract(id=new_id("contract"), business_id=other.id, name="Theirs", body="Old")
    db.add(theirs)
    await db.flush()
    signature = await _pending(db, business_id=other.id, contract_id=theirs.id, client=client.id)
    assert (await as_owner.post(f"/v1/signatures/{signature.id}/resend")).status_code == 404


async def _pending(
    db: AsyncSession,
    *,
    business_id: str = BIZ,
    contract_id: str = WAIVER,
    client: str | None = None,
) -> Signature:
    signature = Signature(
        id=new_id("signature"),
        business_id=business_id,
        contract_id=contract_id,
        client_id=client or await client_id(db),
        status="pending",
        token=new_id("signature"),
    )
    db.add(signature)
    await db.flush()
    return signature


async def test_opening_and_drawing_are_recorded(api: httpx.AsyncClient, db: AsyncSession) -> None:
    signature = await _pending(db)
    token = signature.token
    ok(await api.get(f"/contract/{token}"))
    await db.refresh(signature)
    assert signature.opened_at is not None

    body = {"typed_name": "Pat Doe", "strokes": DRAWN, "agreed": True}
    out = ok(await api.post(f"/contract/{token}/sign", json=body)).json()
    assert (out["method"], out["typed_name"], out["status"]) == ("drawn", "Pat Doe", "signed")
    assert out["strokes"] == DRAWN and out["signer_ip"]
    await db.refresh(signature)
    assert signature.method == "drawn" and signature.contract_version is not None


async def test_signing_needs_agreement_and_a_real_drawing(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    signature = await _pending(db)
    url = f"/contract/{signature.token}/sign"
    no_consent = await api.post(url, json={"typed_name": "Pat", "agreed": False})
    assert no_consent.status_code == 422
    empty = await api.post(url, json={"typed_name": "Pat", "strokes": [[]], "agreed": True})
    assert empty.status_code == 422
    off_page = {"typed_name": "Pat", "strokes": [[[4.0, 0.5]]], "agreed": True}
    assert (await api.post(url, json=off_page)).status_code == 422
    assert (await api.post(url, json={"typed_name": "", "agreed": True})).status_code == 422
    await db.refresh(signature)
    assert signature.status == "pending"


async def test_publish_to_an_unknown_contract_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/contracts/con_nope/versions", json={"body": "Terms"})
    assert res.status_code == 404


@pytest.mark.parametrize(
    "path", ["/v1/contracts", f"/v1/contracts/{WAIVER}/versions", "/v1/signatures/sig_x/resend"]
)
async def test_writes_need_a_session_401(unauth: httpx.AsyncClient, path: str) -> None:
    res = await unauth.post(path, json={"name": "A", "body": "B"})
    assert res.status_code == 401
