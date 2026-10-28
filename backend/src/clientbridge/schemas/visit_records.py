from datetime import datetime

from pydantic import BaseModel, Field

from clientbridge.core.mirrors import Mirror
from clientbridge.models.documents import VisitRecord
from clientbridge.schemas.forms import PublicFormField


class VisitRecordCreate(Mirror):
    mirrors = VisitRecord

    form_id: str
    booking_id: str
    answers: dict[str, object] = Field(default_factory=dict)
    amends: str | None = Field(
        default=None, description="An earlier record on the same visit that this one corrects"
    )


class VisitRecordOut(Mirror):
    """A record staff wrote on a visit, read back with the questions it answered."""

    mirrors = VisitRecord

    id: str
    form_id: str
    form_name: str
    client_id: str | None
    booking_id: str
    visit_at: datetime
    service: str
    written_at: datetime
    fields: list[PublicFormField]
    answers: dict[str, object]
    author_staff_id: str | None
    author_name: str | None
    amends: str | None = Field(default=None, description="The record this one corrects")


class VisitRecords(BaseModel):
    records: list[VisitRecordOut]
