from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Header, Query

from clientbridge.core.deps import CurrentPrincipal, DbSession, EmailDep, SmsDep
from clientbridge.schemas.messaging import (
    BroadcastOut,
    BroadcastSend,
    ConversationPage,
    MessageOut,
    MessageSend,
    ThreadOut,
)
from clientbridge.services.messaging import MessageService

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


@router.post("/broadcasts/{broadcast_id}/cancel", response_model=BroadcastOut)
async def cancel_broadcast(
    broadcast_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    sms: SmsDep,
    email: EmailDep,
) -> BroadcastOut:
    return await MessageService(db, principal, sms, email).cancel_broadcast(broadcast_id)


@router.post("/threads/{thread_id}/read", response_model=ThreadOut)
async def mark_thread_read(
    thread_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    sms: SmsDep,
    email: EmailDep,
) -> ThreadOut:
    return await MessageService(db, principal, sms, email).mark_thread_read(thread_id)


@router.get("/threads/{thread_id}/messages", response_model=ConversationPage)
async def thread_messages(
    thread_id: str,
    before: datetime,
    principal: CurrentPrincipal,
    db: DbSession,
    sms: SmsDep,
    email: EmailDep,
    before_id: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> ConversationPage:
    service = MessageService(db, principal, sms, email)
    return await service.conversation(thread_id, before, before_id, limit)
