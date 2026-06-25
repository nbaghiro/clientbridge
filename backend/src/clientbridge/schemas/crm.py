from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ClientBase(BaseModel):
    name: str
    email: str | None = None
    phone: str | None = None
    tags: list[str] = Field(default_factory=list)
    status: str = "active"
    custom_fields: dict[str, object] = Field(default_factory=dict)


class ClientCreate(ClientBase):
    pass


class ClientUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    tags: list[str] | None = None
    status: str | None = None
    custom_fields: dict[str, object] | None = None


class ClientOut(ClientBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    business_id: str
    lifetime_value_cents: int
    created_at: datetime
    updated_at: datetime
