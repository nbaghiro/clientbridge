"""The command() helper: atomic, audited, idempotent mutations."""

from collections.abc import Awaitable, Callable

import pytest
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal
from clientbridge.core.errors import Conflict, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.models.clients import Client
from clientbridge.models.platform import Audit, IdempotencyKey
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


async def _audits(db: AsyncSession, business_id: str) -> list[Audit]:
    return list(
        (await db.execute(select(Audit).where(Audit.business_id == business_id))).scalars().all()
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
    assert audits[0].performed_by == principal.user_id
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
        db,
        principal,
        action="client.create",
        run=run,
        response_model=_Out,
        idempotency_key="k1",
        request={"name": "Once"},
    )
    second = await run_command(
        db,
        principal,
        action="client.create",
        run=run,
        response_model=_Out,
        idempotency_key="k1",
        request={"name": "Once"},
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
        request={},
    )
    b = await run_command(
        db,
        principal,
        action="client.create",
        run=_make_client("B"),
        response_model=_Out,
        idempotency_key="k2",
        request={},
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
        request={},
    )
    b = await run_command(
        db,
        principal,
        action="client.archive",
        run=_make_client("B"),
        response_model=_Out,
        idempotency_key="shared",
        request={},
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
            request={},
        )

    # nothing committed: no audit row, and no idempotency key (so a retry re-executes)
    assert await _audits(db, principal.business_id) == []
    keys = (
        (await db.execute(select(IdempotencyKey).where(IdempotencyKey.scope == "client.create")))
        .scalars()
        .all()
    )
    assert list(keys) == []


async def test_same_key_with_a_different_request_is_refused(
    db: AsyncSession, factory: Factory
) -> None:
    principal = await _principal(factory)
    await run_command(
        db,
        principal,
        action="client.create",
        run=_make_client("A"),
        response_model=_Out,
        idempotency_key="k1",
        request={"name": "A"},
    )
    with pytest.raises(Unprocessable) as refused:
        await run_command(
            db,
            principal,
            action="client.create",
            run=_make_client("B"),
            response_model=_Out,
            idempotency_key="k1",
            request={"name": "B"},
        )
    assert refused.value.code == "idempotency_key_reused"
    assert [c.name for c in await _clients(db, principal.business_id)] == ["A"]


async def test_request_order_does_not_change_the_hash(db: AsyncSession, factory: Factory) -> None:
    principal = await _principal(factory)
    first = await run_command(
        db,
        principal,
        action="client.create",
        run=_make_client("A"),
        response_model=_Out,
        idempotency_key="k1",
        request={"name": "A", "tags": ["x"]},
    )
    again = await run_command(
        db,
        principal,
        action="client.create",
        run=_make_client("A"),
        response_model=_Out,
        idempotency_key="k1",
        request={"tags": ["x"], "name": "A"},
    )
    assert again == first


async def test_a_key_stored_without_a_hash_replays(db: AsyncSession, factory: Factory) -> None:
    principal = await _principal(factory)
    db.add(
        IdempotencyKey(
            id=new_id("idempotency_key"),
            business_id=principal.business_id,
            scope="client.create",
            key="legacy",
            response={"id": "cl_legacy", "name": "Legacy"},
        )
    )
    await db.flush()
    out = await run_command(
        db,
        principal,
        action="client.create",
        run=_make_client("New"),
        response_model=_Out,
        idempotency_key="legacy",
        request={"name": "New"},
    )
    assert out == _Out(id="cl_legacy", name="Legacy")
    assert await _clients(db, principal.business_id) == []


async def test_a_key_never_replays_in_another_business(db: AsyncSession, factory: Factory) -> None:
    first, second = await _principal(factory), await _principal(factory)
    a = await run_command(
        db,
        first,
        action="client.create",
        run=_make_client("A"),
        response_model=_Out,
        idempotency_key="shared",
        request={"name": "A"},
    )
    b = await run_command(
        db,
        second,
        action="client.create",
        run=_make_client("A"),
        response_model=_Out,
        idempotency_key="shared",
        request={"name": "A"},
    )
    assert a.id != b.id
    assert [c.id for c in await _clients(db, second.business_id)] == [b.id]
