from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from clientbridge.schemas.subjects import SubjectAttributes, SubjectKind

ClientStatus = Literal["active", "inactive"]
ContactChannel = Literal["sms", "email"]
MergeSide = Literal["kept", "other"]


class ClientBase(BaseModel):
    name: str = Field(min_length=1)
    email: str | None = None
    phone: str | None = None
    tags: list[str] = Field(default_factory=list)
    status: ClientStatus = "active"
    custom_fields: dict[str, object] = Field(default_factory=dict)
    preferred_channel: ContactChannel = "sms"


class FirstSubject(BaseModel):
    kind: SubjectKind = "pet"
    name: str = Field(min_length=1)
    attributes: SubjectAttributes = Field(default_factory=SubjectAttributes)


class ClientCreate(ClientBase):
    marketing_consent: bool = Field(
        default=False, description="Record that the client agreed to news and offers"
    )
    subject: FirstSubject | None = None


class ClientUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    email: str | None = None
    phone: str | None = None
    tags: list[str] | None = None
    status: ClientStatus | None = None
    custom_fields: dict[str, object] | None = None
    preferred_channel: ContactChannel | None = None
    marketing_consent: bool | None = None


class ClientOut(ClientBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    business_id: str
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ClientIds(BaseModel):
    client_ids: list[str] = Field(min_length=1, max_length=200)


class ClientTags(ClientIds):
    set: dict[str, bool] = Field(
        min_length=1, description="Each tag to add (true) or remove (false) on every client"
    )


class BulkResult(BaseModel):
    count: int


class ClientMerge(BaseModel):
    from_client_id: str
    fields: dict[Literal["name", "phone", "email"], MergeSide] = Field(default_factory=dict)
