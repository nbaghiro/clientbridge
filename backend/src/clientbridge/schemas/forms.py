from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

from clientbridge.core.mirrors import Mirror
from clientbridge.models.documents import (
    DocumentParent,
    FieldInput,
    Form,
    FormField,
    FormResponse,
    ResponseStatus,
    SendOn,
)
from clientbridge.schemas.public import PublicBrand


class FormSend(Mirror):
    mirrors = FormResponse

    form_id: str
    client_id: str


class FormResponseOut(Mirror):
    mirrors = FormResponse

    id: str
    business_id: str
    form_id: str
    client_id: str | None
    status: ResponseStatus
    token: str
    submitted_at: datetime | None


class PublicFormField(Mirror):
    mirrors = FormField

    id: str
    input: FieldInput
    name: str
    label: str
    help: str | None
    required: bool
    options: list[object]
    position: int


class FormDefinition(BaseModel):
    provenance: Literal["issued", "reconstructed"]
    name: str
    require_signature: bool
    fields: list[PublicFormField]


class FormSignature(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    agreed: Literal[True]
    strokes: list[list[tuple[float, float]]] | None = Field(default=None, max_length=60)


class PublicFormContext(BaseModel):
    form_name: str
    business_name: str
    brand: PublicBrand
    timezone: str = Field(description="The business's IANA time zone, which its times are shown in")
    completed: bool
    require_signature: bool
    fields: list[PublicFormField]


class PublicFormSubmit(Mirror):
    mirrors = FormResponse

    answers: dict[str, object]
    signature: FormSignature | None = None


class FormFieldIn(Mirror):
    mirrors = FormField

    id: str | None = Field(default=None, description="An existing question keeps its answer key")
    input: FieldInput
    label: str = Field(min_length=1, max_length=200)
    help: str | None = Field(default=None, max_length=300)
    required: bool = False
    options: list[str] = Field(default_factory=list, max_length=30)


class FormSave(Mirror):
    mirrors = Form

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    require_signature: bool = False
    send_on: SendOn = "manual"
    active: bool = True
    fields: list[FormFieldIn] = Field(min_length=1, max_length=60)


class FormOut(Mirror):
    mirrors = Form

    id: str
    name: str
    require_signature: bool
    send_on: SendOn
    active: bool
    fields: list[PublicFormField]


class FormAnswersOut(Mirror):
    """A submitted response read back with the questions it was answered against."""

    mirrors = FormResponse

    id: str
    form_id: str
    form_name: str
    client_id: str | None
    parent_type: DocumentParent | None
    parent_id: str | None
    submitted_at: datetime | None
    fields: list[PublicFormField]
    answers: dict[str, object]
    signer_name: str | None = Field(default=None, description="Who signed the form")
