"""The command() helper: atomic, audited, idempotent mutations."""

from collections.abc import Awaitable, Callable

import pytest
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal
from clientbridge.core.errors import Conflict
from clientbridge.core.ids import new_id
from clientbridge.models.crm import Client
from clientbridge.models.platform import AuditLog, IdempotencyKey
from tests.conftest import Factory


class _Out(BaseModel):
    id: str
    name: str


async def _principal(factory: Factory) -> Principal:
    biz = await factory.business()
    user = await factory.user()
    staff = await factory.staff(business=biz, user=user, role="owner")
    return Principal(user_id=user.id, business_id=biz.id, staff_id=staff.id, role="owner")


def _make_client(name: str = "Cmd Client") -> Callable[[Command], Awaitable[_Out]]:
    async def run(cmd: Command) -> _Out:
        client = Client(
            id=new_id("client"),
            business_id=cmd.principal.business_id,
            name=name,
            tags=[],
            custom_fields={},
        )
        cmd.db.add(client)
        await cmd.db.flush()
        cmd.record(
            "client.create", entity_type="client", entity_id=client.id, changes={"name": name}
        )
        return _Out(id=client.id, name=client.name)

    return run


async def _audits(db: AsyncSession, business_id: str) -> list[AuditLog]:
    return list(
        (await db.execute(select(AuditLog).where(AuditLog.business_id == business_id)))
        .scalars()
        .all()
    )


async def _clients(db: AsyncSession, business_id: str) -> list[Client]:
    return list(
        (await db.execute(select(Client).where(Client.business_id == business_id))).scalars().all()
    )


async def test_command_commits_and_records_audit(db: AsyncSession, factory: Factory) -> None:
    principal = await _principal(factory)

    out = await run_command(
        db,
        principal,
        action="client.create",
        run=_make_client(),
        response_model=_Out,
    )

    assert await db.get(Client, out.id) is not None
    audits = await _audits(db, principal.business_id)
    assert [a.action for a in audits] == ["client.create"]
    assert audits[0].actor_user_id == principal.user_id
    assert audits[0].entity_id == out.id
    assert audits[0].changes == {"name": "Cmd Client"}


async def test_idempotency_replays_without_reexecuting(db: AsyncSession, factory: Factory) -> None:
    principal = await _principal(factory)
    calls: list[int] = []

    async def run(cmd: Command) -> _Out:
        calls.append(1)
        client = Client(
            id=new_id("client"),
            business_id=cmd.principal.business_id,
            name="Once",
            tags=[],
            custom_fields={},
        )
        cmd.db.add(client)
        await cmd.db.flush()
        cmd.record("client.create", entity_type="client", entity_id=client.id)
        return _Out(id=client.id, name=client.name)

    first = await run_command(
        db, principal, action="client.create", run=run, response_model=_Out, idempotency_key="k1"
    )
    second = await run_command(
        db, principal, action="client.create", run=run, response_model=_Out, idempotency_key="k1"
    )

    assert len(calls) == 1  # body executed exactly once
    assert second.id == first.id  # the stored response was replayed
    assert len(await _clients(db, principal.business_id)) == 1
    assert len(await _audits(db, principal.business_id)) == 1


async def test_distinct_keys_execute_separately(db: AsyncSession, factory: Factory) -> None:
    principal = await _principal(factory)
    a = await run_command(
        db,
        principal,
        action="client.create",
        run=_make_client("A"),
        response_model=_Out,
        idempotency_key="k1",
    )
    b = await run_command(
        db,
        principal,
        action="client.create",
        run=_make_client("B"),
        response_model=_Out,
        idempotency_key="k2",
    )
    assert a.id != b.id
    assert len(await _clients(db, principal.business_id)) == 2


async def test_same_key_different_action_is_independent(db: AsyncSession, factory: Factory) -> None:
    principal = await _principal(factory)
    a = await run_command(
        db,
        principal,
        action="client.create",
        run=_make_client("A"),
        response_model=_Out,
        idempotency_key="shared",
    )
    b = await run_command(
        db,
        principal,
        action="client.archive",
        run=_make_client("B"),
        response_model=_Out,
        idempotency_key="shared",
    )
    assert a.id != b.id  # scope is part of the key — no cross-action collision


async def test_command_rolls_back_on_error(db: AsyncSession, factory: Factory) -> None:
    principal = await _principal(factory)

    async def boom(cmd: Command) -> _Out:
        client = Client(
            id=new_id("client"),
            business_id=cmd.principal.business_id,
            name="Doomed",
            tags=[],
            custom_fields={},
        )
        cmd.db.add(client)
        await cmd.db.flush()
        cmd.record("client.create", entity_type="client", entity_id=client.id)
        raise Conflict("nope")

    with pytest.raises(Conflict):
        await run_command(
            db,
            principal,
            action="client.create",
            run=boom,
            response_model=_Out,
            idempotency_key="k1",
        )

    # nothing committed: no audit row, and no idempotency key (so a retry re-executes)
    assert await _audits(db, principal.business_id) == []
    keys = (
        (await db.execute(select(IdempotencyKey).where(IdempotencyKey.scope == "client.create")))
        .scalars()
        .all()
    )
    assert list(keys) == []
