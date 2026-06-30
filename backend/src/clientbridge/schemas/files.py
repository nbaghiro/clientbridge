from pydantic import BaseModel


class FileCreate(BaseModel):
    parent_type: str
    parent_id: str
    kind: str | None = None
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
