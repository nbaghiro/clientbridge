from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.config import get_settings
from clientbridge.core.errors import NotFound
from clientbridge.core.scoping import scoped
from clientbridge.integrations.s3 import FileStorage
from clientbridge.models.platform import File

# The only files served without auth: what a business shows customers, never client data.
PUBLIC_MEDIA = {("item", "image"), ("business", "logo")}


def media_url(file_id: str) -> str:
    return f"{get_settings().api_base_url}/media/{file_id}"


async def public_media_location(db: AsyncSession, storage: FileStorage, file_id: str) -> str:
    file = await db.get(File, file_id)
    if file is None or (file.parent_type, file.purpose) not in PUBLIC_MEDIA:
        raise NotFound("not found")
    return storage.presign_download(file.s3_key)


async def item_images(
    db: AsyncSession, business_id: str, item_ids: Sequence[str]
) -> dict[str, str]:
    """Each item's latest image as a public media URL."""
    rows = await db.execute(
        scoped(File, business_id)
        .where(File.parent_type == "item", File.purpose == "image", File.parent_id.in_(item_ids))
        .order_by(File.created_at)
    )
    return {file.parent_id: media_url(file.id) for file in rows.scalars().all()}
