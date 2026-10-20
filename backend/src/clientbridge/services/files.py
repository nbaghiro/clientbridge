import asyncio
from collections.abc import Iterable, Sequence
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.command import Command, run_command
from clientbridge.core.config import get_settings
from clientbridge.core.deps import Principal, assert_can_act_as, assert_role, is_manager
from clientbridge.core.errors import Conflict, Forbidden, NotFound, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.integrations.s3 import FileStorage
from clientbridge.models.business import Business, Staff
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client
from clientbridge.models.platform import File, FileParent
from clientbridge.models.scheduling import Booking
from clientbridge.schemas.business import BrandInput
from clientbridge.schemas.files import FileCreate, FileLink, FileOut, FilePhotoCleared, FileUpload

_DEFAULT_CONTENT_TYPE = "application/octet-stream"
# an upload whose bytes never arrived is removed after this long
PENDING_UPLOAD_TTL = timedelta(hours=24)


class FileService:
    """Logos, images, job photos and form uploads; server-minted rows keep keys unforgeable."""

    def __init__(self, db: AsyncSession, principal: Principal, storage: FileStorage) -> None:
        self.db = db
        self.principal = principal
        self.storage = storage
        self.biz = principal.business_id

    async def create(self, data: FileCreate, idempotency_key: str | None = None) -> FileUpload:
        if (data.parent_type, data.purpose) in PUBLIC_MEDIA:
            await self._assert_public_parent(data)
        if data.parent_type == "booking":
            if data.purpose != "photo" or not (data.content_type or "").startswith("image/"):
                raise Unprocessable("a booking takes only photos", code="invalid_request")
            await self._visible_booking(data.parent_id)
        if data.parent_type in PEOPLE:
            if data.purpose != "photo" or not (data.content_type or "").startswith("image/"):
                raise Unprocessable(
                    "a client or team member takes only a photo", code="invalid_request"
                )
            await self._assert_person(data.parent_type, data.parent_id)

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
            self.db,
            self.principal,
            action="file.create",
            run=run,
            response_model=FileUpload,
            idempotency_key=idempotency_key,
            request=data,
        )

    async def complete(self, file_id: str) -> FileOut:
        file = (
            await self.db.execute(scoped(File, self.biz).where(File.id == file_id))
        ).scalar_one_or_none()
        if file is None:
            raise NotFound("file not found")
        if (file.parent_type, file.purpose) in PUBLIC_MEDIA:
            assert_role(
                self.principal,
                "owner",
                "admin",
                message="only an owner or admin can set public images",
            )
        if (file.parent_type, file.purpose) in PEOPLE_PHOTOS:
            return await self._complete_photo(file)
        out = await confirm_upload(file, self.storage)
        await self.db.commit()
        return out

    async def _complete_photo(self, file: File) -> FileOut:
        """Confirm a client or team photo and drop the one it replaces, keeping one per person."""
        await self._assert_person(file.parent_type, file.parent_id)
        replaced: list[File] = []

        async def run(cmd: Command) -> FileOut:
            out = await confirm_upload(file, self.storage)
            replaced.extend(
                await self._photos_of(file.parent_type, file.parent_id, besides=file.id)
            )
            for old in replaced:
                await self.db.delete(old)
                cmd.record("file.delete", entity_type="file", entity_id=old.id)
            cmd.record("file.complete", entity_type="file", entity_id=file.id)
            return out

        out = await run_command(
            self.db, self.principal, action="file.complete", run=run, response_model=FileOut
        )
        await self._delete_objects(replaced)
        return out

    async def clear_photo(
        self, parent_type: FileParent, parent_id: str, idempotency_key: str | None = None
    ) -> FilePhotoCleared:
        """Remove a client's or team member's photo; clearing one that has none is a no-op."""
        if parent_type not in PEOPLE:
            raise Unprocessable(
                "only a client or team photo can be removed", code="invalid_request"
            )
        await self._assert_person(parent_type, parent_id)
        removed: list[File] = []

        async def run(cmd: Command) -> FilePhotoCleared:
            removed.extend(await self._photos_of(parent_type, parent_id))
            for old in removed:
                await self.db.delete(old)
                cmd.record("file.delete", entity_type="file", entity_id=old.id)
            return FilePhotoCleared(removed=len(removed))

        result = await run_command(
            self.db,
            self.principal,
            action="file.clear_photo",
            run=run,
            response_model=FilePhotoCleared,
            idempotency_key=idempotency_key,
            request={"parent_type": parent_type, "parent_id": parent_id},
        )
        await self._delete_objects(removed)
        return result

    async def _photos_of(self, parent_type: str, parent_id: str, besides: str = "") -> list[File]:
        rows = await self.db.scalars(
            scoped(File, self.biz).where(
                File.parent_type == parent_type,
                File.parent_id == parent_id,
                File.purpose == "photo",
                File.id != besides,
            )
        )
        return list(rows.all())

    async def _delete_objects(self, files: Sequence[File]) -> None:
        for file in files:
            await asyncio.to_thread(self.storage.delete, file.s3_key)

    async def link(self, file_id: str) -> FileLink:
        """A short-lived download link for a job photo on a booking the caller can see."""
        file = (
            await self.db.execute(
                scoped(File, self.biz).where(File.id == file_id, File.uploaded_at.is_not(None))
            )
        ).scalar_one_or_none()
        if file is None:
            raise NotFound("file not found")
        if file.parent_type == "booking":
            await self._visible_booking(file.parent_id)
        elif (file.parent_type, file.purpose) not in PEOPLE_PHOTOS:
            raise NotFound("file not found")
        return FileLink(url=self.storage.presign_download(file.s3_key))

    async def _assert_person(self, parent_type: str, parent_id: str) -> None:
        """A client of this business, or a user on its team whom the caller may set a photo for."""
        if parent_type == "client":
            client = await self.db.scalar(
                scoped(Client, self.biz, soft_delete=True).where(Client.id == parent_id)
            )
            if client is None:
                raise NotFound("client not found")
            return
        member = await self.db.scalar(
            scoped(Staff, self.biz).where(Staff.user_id == parent_id, Staff.status != "removed")
        )
        if member is None:
            raise NotFound("user not found")
        if parent_id != self.principal.user_id and not is_manager(self.principal.role):
            raise Forbidden("only an owner or admin can set another member's photo")

    async def _visible_booking(self, booking_id: str) -> None:
        booking = (
            await self.db.execute(
                scoped(Booking, self.biz, soft_delete=True).where(Booking.id == booking_id)
            )
        ).scalar_one_or_none()
        if booking is None:
            raise NotFound("booking not found")
        assert_can_act_as(self.principal, booking.staff_id)

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
    """Create a File row and its presigned upload URL, keyed by the resolved business."""
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


async def confirm_upload(file: File, storage: FileStorage) -> FileOut:
    """Mark a file uploaded once its bytes are in storage at the size it was created with."""
    if file.uploaded_at is None:
        stored = await asyncio.to_thread(storage.head, file.s3_key)
        if stored is None:
            raise Conflict("the file has not finished uploading", code="upload_missing")
        if file.size is not None and stored != file.size:
            raise Unprocessable("the uploaded file is not the size that was declared")
        file.uploaded_at = clock.now()
    return _file_out(file)


async def run_prune_pending_files(db: AsyncSession, storage: FileStorage, now: datetime) -> int:
    stale = (
        await db.scalars(
            select(File)
            .where(File.uploaded_at.is_(None), File.created_at < now - PENDING_UPLOAD_TTL)
            .limit(500)
        )
    ).all()
    for file in stale:
        await asyncio.to_thread(storage.delete, file.s3_key)
        await db.delete(file)
    await db.commit()
    return len(stale)


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
        uploaded_at=file.uploaded_at,
    )


# The only files served without auth: what a business shows customers, never client data.
PUBLIC_MEDIA = {("item", "image"), ("business", "logo"), ("business", "image")}
PEOPLE: frozenset[str] = frozenset({"client", "user"})
PEOPLE_PHOTOS = {("client", "photo"), ("user", "photo")}


def media_url(file_id: str) -> str:
    return f"{get_settings().api_base_url}/media/{file_id}"


async def public_media_location(db: AsyncSession, storage: FileStorage, file_id: str) -> str:
    file = await db.get(File, file_id)
    if file is None or file.uploaded_at is None:
        raise NotFound("not found")
    shown = (file.parent_type, file.purpose) in PUBLIC_MEDIA or (
        (file.parent_type, file.purpose) == ("user", "photo")
        and file.id in (await team_photos(db, file.business_id)).values()
    )
    if not shown:
        raise NotFound("not found")
    return storage.presign_download(file.s3_key)


async def team_photos(db: AsyncSession, business_id: str) -> dict[str, str]:
    """The current photo of each member the business shows on its public profile, by staff id."""
    business = await db.get(Business, business_id)
    shown = BrandInput.model_validate(business.brand or {}).public_staff_ids if business else []
    if not shown:
        return {}
    members = await db.execute(
        scoped(Staff, business_id)
        .with_only_columns(Staff.id, Staff.user_id)
        .where(Staff.id.in_(shown), Staff.status == "active", Staff.bookable_online.is_(True))
    )
    by_user = {user_id: staff_id for staff_id, user_id in members.tuples().all() if user_id}
    photos = await latest_photos(db, business_id, "user", by_user.keys())
    return {by_user[user_id]: file_id for user_id, file_id in photos.items()}


async def latest_photos(
    db: AsyncSession, business_id: str, parent_type: str, parent_ids: Iterable[str]
) -> dict[str, str]:
    """Each parent's newest uploaded photo, by parent id."""
    wanted = list(parent_ids)
    if not wanted:
        return {}
    rows = await db.execute(
        scoped(File, business_id)
        .with_only_columns(File.parent_id, File.id)
        .where(
            File.parent_type == parent_type,
            File.purpose == "photo",
            File.parent_id.in_(wanted),
            File.uploaded_at.is_not(None),
        )
        .order_by(File.created_at, File.id)
    )
    return dict(rows.tuples().all())


async def item_images(
    db: AsyncSession, business_id: str, item_ids: Sequence[str]
) -> dict[str, str]:
    """Each item's latest image as a public media URL."""
    rows = await db.execute(
        scoped(File, business_id)
        .where(
            File.parent_type == "item",
            File.purpose == "image",
            File.parent_id.in_(item_ids),
            File.uploaded_at.is_not(None),
        )
        .order_by(File.created_at)
    )
    return {file.parent_id: media_url(file.id) for file in rows.scalars().all()}
