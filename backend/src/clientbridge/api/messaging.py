from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Header, Query

from clientbridge.core.deps import CurrentPrincipal, DbSession, EmailDep, JobsDep, PushDep, SmsDep
from clientbridge.schemas.messaging import (
    BroadcastOut,
    BroadcastSend,
    ConversationPage,
    MessageOut,
    MessageSend,
    ThreadOut,
)
from clientbridge.services.deliveries import send_queued
from clientbridge.services.messaging import MessageService

router = APIRouter(tags=["messaging"])


@router.post("/messages", response_model=MessageOut)
async def send_message(
    body: MessageSend,
    principal: CurrentPrincipal,
    db: DbSession,
    sms: SmsDep,
    email: EmailDep,
    push: PushDep,
    jobs: JobsDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> MessageOut:
    service = MessageService(db, principal)
    sent = await service.send_message(body, idempotency_key)
    await send_queued(db, email, sms, push, jobs)
    return await service.message(sent.id)


@router.post("/broadcasts", response_model=BroadcastOut)
async def send_broadcast(
    body: BroadcastSend,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> BroadcastOut:
    return await MessageService(db, principal).send_broadcast(body, idempotency_key)


@router.post("/broadcasts/{broadcast_id}/cancel", response_model=BroadcastOut)
async def cancel_broadcast(
    broadcast_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
) -> BroadcastOut:
    return await MessageService(db, principal).cancel_broadcast(broadcast_id)


@router.post("/threads/{thread_id}/read", response_model=ThreadOut)
async def mark_thread_read(
    thread_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
) -> ThreadOut:
    return await MessageService(db, principal).mark_thread_read(thread_id)


@router.get("/threads/{thread_id}/messages", response_model=ConversationPage)
async def thread_messages(
    thread_id: str,
    before: datetime,
    principal: CurrentPrincipal,
    db: DbSession,
    before_id: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> ConversationPage:
    service = MessageService(db, principal)
    return await service.conversation(thread_id, before, before_id, limit)
