"""The command surface (#3): the path every server-authoritative POST runs through.

A command is one atomic, audited, optionally-idempotent mutation. The service does the work and
records audit entries on the `Command`; `run_command` owns the transaction — replaying a stored
response for a repeated `Idempotency-Key`, persisting the audit trail, and committing (or rolling
back) as a unit.
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.deps import Principal
from clientbridge.core.ids import new_id
from clientbridge.models.platform import AuditLog, IdempotencyKey


@dataclass
class Command:
    """The working context of one command: the session, the actor, and the audit trail it builds."""

    db: AsyncSession
    principal: Principal
    audits: list[AuditLog] = field(default_factory=list)

    def record(
        self,
        action: str,
        *,
        entity_type: str,
        entity_id: str,
        changes: dict[str, object] | None = None,
    ) -> None:
        """Record a mutation; persisted to `audit_logs` inside the command's transaction."""
        self.audits.append(
            AuditLog(
                id=new_id("audit_log"),
                business_id=self.principal.business_id,
                actor_user_id=self.principal.user_id,
                action=action,
                entity_type=entity_type,
                entity_id=entity_id,
                changes=changes or {},
            )
        )


async def run_command[T: BaseModel](
    db: AsyncSession,
    principal: Principal,
    *,
    action: str,
    run: Callable[[Command], Awaitable[T]],
    response_model: type[T],
    idempotency_key: str | None = None,
) -> T:
    """Run `run` as one atomic, audited command.

    With an `idempotency_key`, a repeat (same business + action + key) returns the stored response
    without re-executing. Otherwise: run the body, persist its audit entries, store the response for
    replay, and commit. Any exception rolls the whole unit back.
    """
    if idempotency_key is not None:
        prior = (
            await db.execute(
                select(IdempotencyKey).where(
                    IdempotencyKey.business_id == principal.business_id,
                    IdempotencyKey.scope == action,
                    IdempotencyKey.key == idempotency_key,
                )
            )
        ).scalar_one_or_none()
        if prior is not None:
            return response_model.model_validate(prior.response)

    cmd = Command(db, principal)
    try:
        result = await run(cmd)
        db.add_all(cmd.audits)
        if idempotency_key is not None:
            db.add(
                IdempotencyKey(
                    id=new_id("idempotency_key"),
                    business_id=principal.business_id,
                    scope=action,
                    key=idempotency_key,
                    response=result.model_dump(mode="json"),
                )
            )
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    return result
