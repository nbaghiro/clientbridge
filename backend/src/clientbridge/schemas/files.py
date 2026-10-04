from typing import Literal

from pydantic import BaseModel

FileParent = Literal["business", "client", "subject", "item", "signature", "form_response"]
FileKind = Literal["logo", "image", "photo", "signature", "attachment"]


class FileCreate(BaseModel):
    parent_type: FileParent
    parent_id: str
    kind: FileKind | None = None
    content_type: str | None = None
    size: int | None = None


class FileOut(BaseModel):
    id: str
    business_id: str
    parent_type: str
    parent_id: str
    kind: str | None
    s3_key: str
    content_type: str | None
    size: int | None


class FileUpload(BaseModel):
    file: FileOut
    upload_url: str


class FileDownload(BaseModel):
    url: str


class PublicFileCreate(BaseModel):
    content_type: str | None = None
    size: int | None = None


class PublicFileUpload(BaseModel):
    file_id: str
    upload_url: str
