from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal
from clientbridge.core.errors import NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.integrations.s3 import FileStorage
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
        async def run(cmd: Command) -> FileUpload:
            file = File(
                id=new_id("file"),
                business_id=self.biz,
                parent_type=data.parent_type,
                parent_id=data.parent_id,
                kind=data.kind,
                s3_key=f"{self.biz}/{new_id('file')}",
                content_type=data.content_type,
                size=data.size,
            )
            self.db.add(file)
            await self.db.flush()
            cmd.record("file.create", entity_type="file", entity_id=file.id)
            url = self.storage.presign_upload(
                file.s3_key, data.content_type or _DEFAULT_CONTENT_TYPE
            )
            return FileUpload(file=_file_out(file), upload_url=url)

        return await run_command(
            self.db, self.principal, action="file.create", run=run, response_model=FileUpload
        )

    async def download_url(self, file_id: str) -> FileDownload:
        file = (
            await self.db.execute(scoped(File, self.biz).where(File.id == file_id))
        ).scalar_one_or_none()
        if file is None:
            raise NotFound("file not found")
        return FileDownload(url=self.storage.presign_download(file.s3_key))


def _file_out(file: File) -> FileOut:
    return FileOut(
        id=file.id,
        business_id=file.business_id,
        parent_type=file.parent_type,
        parent_id=file.parent_id,
        kind=file.kind,
        s3_key=file.s3_key,
        content_type=file.content_type,
        size=file.size,
    )
