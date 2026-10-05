from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.config import get_settings
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.integrations.s3 import FileStorage
from clientbridge.models.catalog import Item
from clientbridge.models.platform import File
from clientbridge.schemas.files import FileCreate, FileDownload, FileOut, FileUpload

_DEFAULT_CONTENT_TYPE = "application/octet-stream"


class FileService:
    """Files back signature images + attachments. Any active member may create/read them (the
    team-level sync policy files used to carry); the row is server-minted so the s3 key can't be
    forged, and the upload/download URLs are short-lived presigned ones."""

    def __init__(self, db: AsyncSession, principal: Principal, storage: FileStorage) -> None:
        self.db = db
        self.principal = principal
        self.storage = storage
        self.biz = principal.business_id

    async def create(self, data: FileCreate) -> FileUpload:
        if (data.parent_type, data.purpose) in PUBLIC_MEDIA:
            await self._assert_public_parent(data)

        async def run(cmd: Command) -> FileUpload:
            result = await mint_upload(
                self.db,
                self.storage,
                business_id=self.biz,
                parent_type=data.parent_type,
                parent_id=data.parent_id,
                purpose=data.purpose,
                content_type=data.content_type,
                size=data.size,
            )
            cmd.record("file.create", entity_type="file", entity_id=result.file.id)
            return result

        return await run_command(
            self.db, self.principal, action="file.create", run=run, response_model=FileUpload
        )

    async def _assert_public_parent(self, data: FileCreate) -> None:
        assert_role(
            self.principal, "owner", "admin", message="only an owner or admin can set public images"
        )
        if data.parent_type == "business":
            found = data.parent_id == self.biz
        else:
            found = (
                await self.db.execute(scoped(Item, self.biz).where(Item.id == data.parent_id))
            ).scalar_one_or_none() is not None
        if not found:
            raise NotFound(f"{data.parent_type} not found")

    async def download_url(self, file_id: str) -> FileDownload:
        file = (
            await self.db.execute(scoped(File, self.biz).where(File.id == file_id))
        ).scalar_one_or_none()
        if file is None:
            raise NotFound("file not found")
        return FileDownload(url=self.storage.presign_download(file.s3_key))


async def mint_upload(
    db: AsyncSession,
    storage: FileStorage,
    *,
    business_id: str,
    parent_type: str,
    parent_id: str,
    purpose: str | None = None,
    content_type: str | None = None,
    size: int | None = None,
) -> FileUpload:
    """Mint a server-keyed File row + its short-lived presigned upload URL. Principal-less so both
    the authed command path and the token-gated public surfaces share one minting rule — the s3 key
    is always derived from the resolved business, never the caller."""
    file = File(
        id=new_id("file"),
        business_id=business_id,
        parent_type=parent_type,
        parent_id=parent_id,
        purpose=purpose,
        s3_key=f"{business_id}/{new_id('file')}",
        content_type=content_type,
        size=size,
    )
    db.add(file)
    await db.flush()
    url = storage.presign_upload(file.s3_key, content_type or _DEFAULT_CONTENT_TYPE)
    return FileUpload(file=_file_out(file), upload_url=url)


def _file_out(file: File) -> FileOut:
    return FileOut(
        id=file.id,
        business_id=file.business_id,
        parent_type=file.parent_type,
        parent_id=file.parent_id,
        purpose=file.purpose,
        s3_key=file.s3_key,
        content_type=file.content_type,
        size=file.size,
    )


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
