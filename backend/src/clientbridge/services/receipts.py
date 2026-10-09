import hashlib
import json
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.errors import Conflict, Forbidden, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.models.business import Staff
from clientbridge.models.platform import SyncReceipt
from clientbridge.schemas.receipts import OperationIdentity


async def reserve_receipt(
    request: OperationIdentity,
    payload: dict[str, object],
    result: dict[str, int],
    user_id: str,
    db: AsyncSession,
) -> dict[str, int] | None:
    now = datetime.now(UTC)
    if request.created_at < now - timedelta(days=90):
        raise Conflict("upload is outside the 90-day retry horizon", code="upload_expired")
    if request.created_at > now + timedelta(minutes=5):
        raise Unprocessable("upload time is in the future", code="upload_clock_skew")
    member = await db.scalar(
        scoped(Staff, request.business_id).where(Staff.user_id == user_id, Staff.status == "active")
    )
    if member is None:
        raise Forbidden("not a member of that business")
    payload_hash = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    receipt_id = await db.scalar(
        pg_insert(SyncReceipt)
        .values(
            id=new_id("sync_receipt"),
            user_id=user_id,
            device_id=str(request.device_id),
            operation_id=str(request.operation_id),
            business_id=request.business_id,
            payload_hash=payload_hash,
            version=request.version,
            result=result,
        )
        .on_conflict_do_nothing(constraint="uq_sync_receipt_operation")
        .returning(SyncReceipt.id)
    )
    if receipt_id is not None:
        return None
    receipt = await db.scalar(
        scoped(SyncReceipt, request.business_id).where(
            SyncReceipt.user_id == user_id,
            SyncReceipt.device_id == str(request.device_id),
            SyncReceipt.operation_id == str(request.operation_id),
        )
    )
    if receipt is None or receipt.payload_hash != payload_hash:
        raise Conflict("upload identity was reused with different content", code="upload_mismatch")
    return receipt.result


async def run_prune_receipts(db: AsyncSession, now: datetime) -> int:
    rows = await db.scalars(
        select(SyncReceipt.id)
        .where(SyncReceipt.created_at < now - timedelta(days=90))
        .order_by(SyncReceipt.created_at, SyncReceipt.id)
        .limit(1000)
        .with_for_update(skip_locked=True)
    )
    ids = list(rows)
    if ids:
        await db.execute(delete(SyncReceipt).where(SyncReceipt.id.in_(ids)))
    await db.commit()
    return len(ids)
