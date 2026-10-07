from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from clientbridge.schemas.public import PublicBrand


class FormSend(BaseModel):
    form_id: str
    client_id: str


class FormResponseOut(BaseModel):
    id: str
    business_id: str
    form_id: str
    client_id: str | None
    status: str
    token: str
    submitted_at: datetime | None


class PublicFormField(BaseModel):
    id: str
    input: str
    name: str
    label: str
    help: str | None
    required: bool
    options: list[object]
    validation: dict[str, object]
    position: int


class PublicFormContext(BaseModel):
    form_name: str
    business_name: str
    brand: PublicBrand
    completed: bool
    fields: list[PublicFormField]


class PublicFormSubmit(BaseModel):
    answers: dict[str, object]


EditorInput = Literal[
    "text",
    "longtext",
    "email",
    "phone",
    "number",
    "date",
    "select",
    "multiselect",
    "checkbox",
    "file",
]


class FormFieldIn(BaseModel):
    id: str | None = Field(default=None, description="An existing question keeps its answer key")
    input: EditorInput
    label: str = Field(min_length=1, max_length=200)
    help: str | None = Field(default=None, max_length=300)
    required: bool = False
    options: list[str] = Field(default_factory=list, max_length=30)


class FormSave(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    require_signature: bool = False
    send_on: Literal["booking", "manual"] = "manual"
    active: bool = True
    fields: list[FormFieldIn] = Field(min_length=1, max_length=60)


class FormOut(BaseModel):
    id: str
    name: str
    require_signature: bool
    send_on: str
    active: bool
    fields: list[PublicFormField]
