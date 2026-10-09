from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from clientbridge.core.mirrors import Mirror
from clientbridge.models.clients import Subject, SubjectKind


class SubjectAttributes(BaseModel):
    """The typed details of a subject; keys a kind doesn't use stay empty, unknown keys are kept."""

    model_config = ConfigDict(extra="allow")

    species: Literal["dog", "cat", "other"] | None = None
    breed: str | None = None
    weight_kg: float | None = Field(default=None, gt=0, lt=200)
    birthday: date | None = None
    sex: Literal["female", "male"] | None = None
    temperament: str | None = Field(default=None, max_length=40)
    coat: str | None = None
    allergies: str | None = None
    vet: str | None = None
    rabies_until: date | None = None
    style: str | None = None


class SubjectCreate(Mirror):
    mirrors = Subject

    client_id: str
    kind: SubjectKind = "pet"
    name: str = Field(min_length=1)
    attributes: SubjectAttributes = Field(default_factory=SubjectAttributes)


class SubjectUpdate(Mirror):
    mirrors = Subject

    name: str | None = Field(default=None, min_length=1)
    attributes: SubjectAttributes | None = None


class SubjectOut(Mirror):
    mirrors = Subject
    model_config = ConfigDict(from_attributes=True)

    id: str
    business_id: str
    client_id: str
    kind: SubjectKind
    name: str
    attributes: dict[str, object]
    created_at: datetime
    updated_at: datetime
