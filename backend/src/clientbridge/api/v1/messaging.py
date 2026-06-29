from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession, EmailDep, SmsDep
from clientbridge.schemas.messaging import (
    BroadcastOut,
    BroadcastSend,
    MessageOut,
    MessageSend,
    ThreadOut,
)
from clientbridge.services.message_service import MessageService

router = APIRouter(tags=["messaging"])


@router.post("/messages", response_model=MessageOut)
async def send_message(
    body: MessageSend,
    principal: CurrentPrincipal,
    db: DbSession,
    sms: SmsDep,
    email: EmailDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> MessageOut:
    return await MessageService(db, principal, sms, email).send_message(body, idempotency_key)


@router.post("/broadcasts", response_model=BroadcastOut)
async def send_broadcast(
    body: BroadcastSend,
    principal: CurrentPrincipal,
    db: DbSession,
    sms: SmsDep,
    email: EmailDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> BroadcastOut:
    return await MessageService(db, principal, sms, email).send_broadcast(body, idempotency_key)


@router.post("/threads/{thread_id}/read", response_model=ThreadOut)
async def mark_thread_read(
    thread_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    sms: SmsDep,
    email: EmailDep,
) -> ThreadOut:
    return await MessageService(db, principal, sms, email).mark_thread_read(thread_id)
