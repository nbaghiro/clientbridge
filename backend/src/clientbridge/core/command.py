"""The command surface: one atomic, audited, optionally idempotent mutation."""

import hashlib
import json
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from typing import overload

from pydantic import BaseModel
from pydantic_core import to_jsonable_python
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.deps import Principal
from clientbridge.core.errors import Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.models.platform import Audit, IdempotencyKey

type Request = BaseModel | Mapping[str, object]


def request_hash(request: Request) -> str:
    """SHA-256 of the canonical JSON of a request: sorted keys, no whitespace."""
    canonical = json.dumps(to_jsonable_python(request), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


async def replay(
    db: AsyncSession, business_id: str, scope: str, key: str, request: Request
) -> dict[str, object] | None:
    """The stored response for a repeated key, refusing a key reused with a different request."""
    prior = await db.scalar(
        scoped(IdempotencyKey, business_id).where(
            IdempotencyKey.scope == scope, IdempotencyKey.key == key
        )
    )
    if prior is None:
        return None
    if prior.request_hash is not None and prior.request_hash != request_hash(request):
        raise Unprocessable(
            "idempotency key was already used with a different request",
            code="idempotency_key_reused",
        )
    return prior.response


def remember(
    db: AsyncSession,
    business_id: str,
    scope: str,
    key: str,
    request: Request,
    response: dict[str, object],
) -> None:
    db.add(
        IdempotencyKey(
            id=new_id("idempotency_key"),
            business_id=business_id,
            scope=scope,
            key=key,
            request_hash=request_hash(request),
            response=response,
        )
    )


@dataclass(frozen=True)
class PublicPrincipal:
    business_id: str
    user_id: None = None


@dataclass
class Command:
    """The working context of one command: the session, the actor, and the audit trail it builds."""

    db: AsyncSession
    principal: Principal | PublicPrincipal
    audits: list[Audit] = field(default_factory=list)

    def record(
        self,
        action: str,
        *,
        entity_type: str,
        entity_id: str,
        changes: dict[str, object] | None = None,
    ) -> None:
        """Record a mutation; persisted to `audits` inside the command's transaction."""
        self.audits.append(
            Audit(
                id=new_id("audit"),
                business_id=self.principal.business_id,
                performed_by=self.principal.user_id,
                action=action,
                entity_type=entity_type,
                entity_id=entity_id,
                changes=changes or {},
            )
        )


@overload
async def run_command[T: BaseModel](
    db: AsyncSession,
    principal: Principal | PublicPrincipal,
    *,
    action: str,
    run: Callable[[Command], Awaitable[T]],
    response_model: type[T],
) -> T: ...


@overload
async def run_command[T: BaseModel](
    db: AsyncSession,
    principal: Principal | PublicPrincipal,
    *,
    action: str,
    run: Callable[[Command], Awaitable[T]],
    response_model: type[T],
    idempotency_key: str | None,
    request: Request,
) -> T: ...


async def run_command[T: BaseModel](
    db: AsyncSession,
    principal: Principal | PublicPrincipal,
    *,
    action: str,
    run: Callable[[Command], Awaitable[T]],
    response_model: type[T],
    idempotency_key: str | None = None,
    request: Request | None = None,
) -> T:
    """Run `run` once per idempotency key and request, committing mutation, audit and response."""
    if idempotency_key is not None:
        prior = await replay(
            db, principal.business_id, action, idempotency_key, {} if request is None else request
        )
        if prior is not None:
            return response_model.model_validate(prior)

    cmd = Command(db, principal)
    try:
        result = await run(cmd)
        db.add_all(cmd.audits)
        if idempotency_key is not None:
            remember(
                db,
                principal.business_id,
                action,
                idempotency_key,
                {} if request is None else request,
                result.model_dump(mode="json"),
            )
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    return result
