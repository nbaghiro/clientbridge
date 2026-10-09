from pydantic import BaseModel

from clientbridge.core.mirrors import Mirror
from clientbridge.models.platform import File, FileParent, FilePurpose


class FileCreate(Mirror):
    mirrors = File

    parent_type: FileParent
    parent_id: str
    purpose: FilePurpose | None = None
    content_type: str | None = None
    size: int | None = None


class FileOut(Mirror):
    mirrors = File

    id: str
    business_id: str
    parent_type: FileParent
    parent_id: str
    purpose: FilePurpose | None
    s3_key: str
    content_type: str | None
    size: int | None


class FileUpload(BaseModel):
    file: FileOut
    upload_url: str


class PublicFileCreate(Mirror):
    mirrors = File

    content_type: str | None = None
    size: int | None = None


class PublicFileUpload(BaseModel):
    file_id: str
    upload_url: str
