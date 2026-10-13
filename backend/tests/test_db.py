"""The transaction() helper: the outermost block commits, inner blocks are savepoints."""

import asyncio
import uuid
from collections.abc import AsyncIterator

import pytest
from pydantic import BaseModel
from sqlalchemy import delete, insert, select
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Insert

from clientbridge.core.command import Command, run_command
from clientbridge.core.db import SessionLocal, transaction
from clientbridge.core.deps import Principal
from clientbridge.core.errors import Conflict
from clientbridge.core.ids import new_id
from clientbridge.models.clients import Client
from clientbridge.models.ledger import Account, Entry
from tests.conftest import BIZ, OWNER_USER


class Boom(Exception):
    pass


def _tag() -> str:
    return f"tx-{uuid.uuid4().hex}"


def _atomic(session: AsyncSession) -> bool:
    return bool(session.info.get("atomic"))


def _client(name: str) -> Client:
    return Client(id=new_id("client"), business_id=BIZ, name=name, tags=[], custom_fields={})


def _duplicate(client_id: str, name: str) -> Insert:
    """An insert Postgres refuses on the primary key, bypassing the identity map."""
    return insert(Client).values(
        id=client_id, business_id=BIZ, name=name, tags=[], custom_fields={}
    )


async def _add(db: AsyncSession, name: str) -> Client:
    client = _client(name)
    db.add(client)
    await db.flush()
    return client


async def _committed(tag: str) -> set[str]:
    """What another connection can see: only what the outermost block has committed."""
    async with SessionLocal() as other:
        rows = await other.execute(select(Client.name).where(Client.name.like(f"{tag}%")))
        return {name.removeprefix(f"{tag} ") for name in rows.scalars()}


async def _seen(db: AsyncSession, tag: str) -> set[str]:
    rows = await db.execute(select(Client.name).where(Client.name.like(f"{tag}%")))
    return {name.removeprefix(f"{tag} ") for name in rows.scalars()}


@pytest.fixture
async def tag(db: AsyncSession) -> AsyncIterator[str]:
    """A unique name prefix for rows written through real sessions, deleted afterwards."""
    tag = _tag()
    yield tag
    async with SessionLocal() as cleanup:
        await cleanup.execute(delete(Client).where(Client.name.like(f"{tag}%")))
        await cleanup.commit()


@pytest.fixture
async def session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


async def test_the_outer_block_commits_on_a_clean_exit(tag: str, session: AsyncSession) -> None:
    async with transaction(session):
        await _add(session, f"{tag} a")
        assert await _committed(tag) == set()
    assert await _committed(tag) == {"a"}
    assert _atomic(session) is False


async def test_the_outer_block_rolls_back_on_an_error_and_keeps_its_type(
    tag: str, session: AsyncSession
) -> None:
    with pytest.raises(Boom):
        async with transaction(session):
            await _add(session, f"{tag} a")
            raise Boom
    assert await _committed(tag) == set()
    assert await _seen(session, tag) == set()
    assert _atomic(session) is False


async def test_a_return_from_inside_the_block_still_commits(
    tag: str, session: AsyncSession
) -> None:
    async def write() -> str:
        async with transaction(session):
            client = await _add(session, f"{tag} a")
            return client.id

    client_id = await write()
    assert await _committed(tag) == {"a"}
    async with SessionLocal() as other:
        assert await other.get(Client, client_id) is not None


async def test_an_inner_block_is_released_into_the_outer_commit(
    tag: str, session: AsyncSession
) -> None:
    async with transaction(session):
        await _add(session, f"{tag} outer")
        async with transaction(session):
            await _add(session, f"{tag} inner")
            assert _atomic(session) is True
        assert await _committed(tag) == set()  # the savepoint release is not a commit
    assert await _committed(tag) == {"outer", "inner"}


async def test_a_caught_inner_error_keeps_the_outer_work(tag: str, session: AsyncSession) -> None:
    async with transaction(session):
        await _add(session, f"{tag} before")
        with pytest.raises(Boom):
            async with transaction(session):
                await _add(session, f"{tag} inner")
                raise Boom
        assert await _seen(session, tag) == {"before"}
        await _add(session, f"{tag} after")
    assert await _committed(tag) == {"before", "after"}


async def test_an_uncaught_inner_error_rolls_back_everything(
    tag: str, session: AsyncSession
) -> None:
    with pytest.raises(Boom):
        async with transaction(session):
            await _add(session, f"{tag} outer")
            async with transaction(session):
                await _add(session, f"{tag} inner")
                raise Boom
    assert await _committed(tag) == set()
    assert _atomic(session) is False


async def test_an_outer_error_after_a_clean_inner_takes_the_inner_with_it(
    tag: str, session: AsyncSession
) -> None:
    with pytest.raises(Boom):
        async with transaction(session):
            async with transaction(session):
                await _add(session, f"{tag} inner")
            await _add(session, f"{tag} outer")
            raise Boom
    assert await _committed(tag) == set()


async def test_three_levels_roll_back_only_the_failing_leaf(
    tag: str, session: AsyncSession
) -> None:
    async with transaction(session):
        await _add(session, f"{tag} outer")
        async with transaction(session):
            await _add(session, f"{tag} middle")
            with pytest.raises(Boom):
                async with transaction(session):
                    await _add(session, f"{tag} leaf")
                    raise Boom
            assert await _seen(session, tag) == {"outer", "middle"}
    assert await _committed(tag) == {"outer", "middle"}


async def test_a_failing_middle_takes_its_clean_leaf_with_it(
    tag: str, session: AsyncSession
) -> None:
    async with transaction(session):
        await _add(session, f"{tag} outer")
        with pytest.raises(Boom):
            async with transaction(session):
                await _add(session, f"{tag} middle")
                async with transaction(session):
                    await _add(session, f"{tag} leaf")
                raise Boom
        assert await _seen(session, tag) == {"outer"}
    assert await _committed(tag) == {"outer"}


async def test_sibling_savepoints_are_independent(tag: str, session: AsyncSession) -> None:
    async with transaction(session):
        with pytest.raises(Boom):
            async with transaction(session):
                await _add(session, f"{tag} first")
                raise Boom
        async with transaction(session):
            await _add(session, f"{tag} second")
        with pytest.raises(Boom):
            async with transaction(session):
                await _add(session, f"{tag} third")
                raise Boom
    assert await _committed(tag) == {"second"}


async def test_the_marker_is_cleared_after_an_outer_error(tag: str, session: AsyncSession) -> None:
    with pytest.raises(Boom):
        async with transaction(session):
            raise Boom
    assert _atomic(session) is False
    async with transaction(session):  # outermost again, so this commits
        await _add(session, f"{tag} again")
    assert await _committed(tag) == {"again"}


async def test_cancellation_rolls_back_the_outer_block(tag: str, session: AsyncSession) -> None:
    with pytest.raises(asyncio.CancelledError):
        async with transaction(session):
            await _add(session, f"{tag} a")
            raise asyncio.CancelledError
    assert await _committed(tag) == set()
    assert _atomic(session) is False


async def test_cancellation_inside_an_inner_block_unwinds_both(
    tag: str, session: AsyncSession
) -> None:
    with pytest.raises(asyncio.CancelledError):
        async with transaction(session):
            await _add(session, f"{tag} outer")
            async with transaction(session):
                await _add(session, f"{tag} inner")
                raise asyncio.CancelledError
    assert await _committed(tag) == set()
    assert _atomic(session) is False


async def test_a_query_before_the_helper_still_makes_it_the_outermost(
    tag: str, session: AsyncSession
) -> None:
    assert await _seen(session, tag) == set()  # the session has autobegun by now
    assert session.in_transaction()
    async with transaction(session):
        await _add(session, f"{tag} a")
        async with transaction(session):  # and this is still a savepoint, not a second commit
            await _add(session, f"{tag} b")
            assert await _committed(tag) == set()
    assert await _committed(tag) == {"a", "b"}


async def test_a_database_error_inside_an_inner_block_leaves_the_session_usable(
    tag: str, session: AsyncSession
) -> None:
    async with transaction(session):
        first = await _add(session, f"{tag} a")
        with pytest.raises(IntegrityError):
            async with transaction(session):
                await session.execute(_duplicate(first.id, f"{tag} dup"))
        await _add(session, f"{tag} b")
    assert await _committed(tag) == {"a", "b"}


async def test_a_database_error_in_the_outer_block_leaves_the_session_usable(
    tag: str, session: AsyncSession
) -> None:
    async with transaction(session):
        first = await _add(session, f"{tag} a")
    with pytest.raises(IntegrityError):
        async with transaction(session):
            await session.execute(_duplicate(first.id, f"{tag} dup"))
    async with transaction(session):
        await _add(session, f"{tag} b")
    assert await _committed(tag) == {"a", "b"}
    assert _atomic(session) is False


async def _unbalanced_entry(session: AsyncSession) -> Entry:
    """One leg with no counterpart: the deferred entries_balanced trigger refuses it at commit."""
    account = (
        await session.execute(select(Account).where(Account.business_id == BIZ).limit(1))
    ).scalar_one()
    return Entry(
        id=new_id("entry"),
        business_id=BIZ,
        journal_id=new_id("journal"),
        account_id=account.id,
        owner_type=account.owner_type,
        owner_id=account.owner_id,
        amount_cents=1,
        currency=account.currency,
        event="payment",
        ref=f"tx-test:{uuid.uuid4().hex}",
        leg=0,
        meta={},
    )


async def test_a_failure_at_commit_time_rolls_back_and_re_raises(
    tag: str, session: AsyncSession
) -> None:
    entry = await _unbalanced_entry(session)
    with pytest.raises(DBAPIError, match="does not balance"):
        async with transaction(session):
            await _add(session, f"{tag} a")
            session.add(entry)
            await session.flush()
    assert await _committed(tag) == set()
    assert _atomic(session) is False
    async with SessionLocal() as other:
        assert await other.get(Entry, entry.id) is None
    async with transaction(session):
        await _add(session, f"{tag} b")
    assert await _committed(tag) == {"b"}


async def test_a_savepoint_release_cannot_hide_a_deferred_violation(
    tag: str, session: AsyncSession
) -> None:
    entry = await _unbalanced_entry(session)
    with pytest.raises(DBAPIError, match="does not balance"):
        async with transaction(session):
            await _add(session, f"{tag} outer")
            async with transaction(session):  # exits cleanly: deferred triggers wait for the commit
                session.add(entry)
                await session.flush()
    assert await _committed(tag) == set()
    async with SessionLocal() as other:
        assert await other.get(Entry, entry.id) is None


async def test_objects_added_in_a_rolled_back_inner_block_leave_the_session(
    tag: str, session: AsyncSession
) -> None:
    async with transaction(session):
        kept = await _add(session, f"{tag} kept")
        with pytest.raises(Boom):
            async with transaction(session):
                lost = await _add(session, f"{tag} lost")
                raise Boom
        assert lost not in session
        assert await session.get(Client, lost.id) is None
        assert kept in session
        assert await session.get(Client, kept.id) is kept
    assert await _committed(tag) == {"kept"}


async def test_the_marker_is_per_session(tag: str) -> None:
    async with SessionLocal() as one, SessionLocal() as two:
        async with transaction(one):
            await _add(one, f"{tag} one")
            async with transaction(two):  # a different session: outermost there, so it commits
                await _add(two, f"{tag} two")
                assert _atomic(one) is True
                assert _atomic(two) is True
            assert await _committed(tag) == {"two"}
            assert _atomic(two) is False
        assert await _committed(tag) == {"one", "two"}


async def test_concurrent_outer_blocks_on_separate_sessions_each_commit(tag: str) -> None:
    async def write(n: int) -> None:
        async with SessionLocal() as session, transaction(session):
            await _add(session, f"{tag} {n}")
            await asyncio.sleep(0.01)

    await asyncio.gather(*(write(n) for n in range(8)))
    assert await _committed(tag) == {str(n) for n in range(8)}


async def test_a_failing_sibling_task_does_not_touch_another_session(tag: str) -> None:
    async def good() -> None:
        async with SessionLocal() as session, transaction(session):
            await _add(session, f"{tag} good")
            await asyncio.sleep(0.05)

    async def bad() -> None:
        async with SessionLocal() as session, transaction(session):
            await _add(session, f"{tag} bad")
            await asyncio.sleep(0.01)
            raise Boom

    results = await asyncio.gather(good(), bad(), return_exceptions=True)
    assert isinstance(results[1], Boom)
    assert await _committed(tag) == {"good"}


class _Out(BaseModel):
    id: str


_PRINCIPAL = Principal(user_id=OWNER_USER, business_id=BIZ, staff_id="st_owner", role="owner")


async def test_run_command_inside_a_block_is_a_savepoint(tag: str, session: AsyncSession) -> None:
    async def make(cmd: Command) -> _Out:
        client = await _add(cmd.db, f"{tag} command")
        return _Out(id=client.id)

    async with transaction(session):
        await _add(session, f"{tag} outer")
        out = await run_command(
            session, _PRINCIPAL, action="client.create", run=make, response_model=_Out
        )
        assert await _committed(tag) == set()  # the command's own commit waited for the outer block
        assert await session.get(Client, out.id) is not None
    assert await _committed(tag) == {"outer", "command"}


async def test_a_failing_command_inside_a_block_rolls_back_only_itself(
    tag: str, session: AsyncSession
) -> None:
    async def refuse(cmd: Command) -> _Out:
        await _add(cmd.db, f"{tag} command")
        raise Conflict("nope")

    async with transaction(session):
        await _add(session, f"{tag} outer")
        with pytest.raises(Conflict):
            await run_command(
                session, _PRINCIPAL, action="client.create", run=refuse, response_model=_Out
            )
        assert await _seen(session, tag) == {"outer"}
    assert await _committed(tag) == {"outer"}


async def test_the_rolled_back_fixture_session_nests_the_same_way(db: AsyncSession) -> None:
    tag = _tag()
    async with transaction(db):
        await _add(db, f"{tag} outer")
        with pytest.raises(Boom):
            async with transaction(db):
                await _add(db, f"{tag} inner")
                raise Boom
        async with transaction(db):
            await _add(db, f"{tag} kept")
    assert await _seen(db, tag) == {"outer", "kept"}
    assert _atomic(db) is False
    with pytest.raises(Boom):
        async with transaction(db):
            await _add(db, f"{tag} gone")
            raise Boom
    assert await _seen(db, tag) == {"outer", "kept"}
