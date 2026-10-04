from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ClientStatus = Literal["active", "inactive"]


class ClientBase(BaseModel):
    name: str
    email: str | None = None
    phone: str | None = None
    tags: list[str] = Field(default_factory=list)
    status: ClientStatus = "active"
    custom_fields: dict[str, object] = Field(default_factory=dict)


class ClientCreate(ClientBase):
    pass


class ClientUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    tags: list[str] | None = None
    status: ClientStatus | None = None
    custom_fields: dict[str, object] | None = None


class ClientOut(ClientBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    business_id: str
    created_at: datetime
    updated_at: datetime
