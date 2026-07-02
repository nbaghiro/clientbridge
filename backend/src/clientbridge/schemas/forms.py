from datetime import datetime

from pydantic import BaseModel

from clientbridge.schemas.public_common import PublicBrand


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
    type: str
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
