from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from clientbridge.core.mirrors import Mirror
from clientbridge.models.business import SubjectKind
from clientbridge.models.clients import Subject


class PetAttributes(BaseModel):
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


class StudentAttributes(BaseModel):
    model_config = ConfigDict(extra="allow")

    birthday: date | None = None
    grade: str | None = Field(default=None, max_length=40)
    school: str | None = None
    allergies: str | None = None


class PropertyAttributes(BaseModel):
    model_config = ConfigDict(extra="allow")

    address: str | None = Field(default=None, max_length=200)
    rooms: int | None = Field(default=None, ge=0, le=100)
    access: str | None = None
    pets: str | None = None


Building = Literal["house", "townhouse", "apartment", "retail", "office", "warehouse"]


class Equipment(BaseModel):
    model: str = Field(min_length=1, max_length=80)
    serial: str | None = Field(default=None, max_length=80)
    location: str | None = Field(default=None, max_length=80)
    installed_on: date | None = None
    warranty_until: date | None = None


class SiteAttributes(BaseModel):
    model_config = ConfigDict(extra="allow")

    address: str | None = Field(default=None, max_length=200)
    building: Building | None = None
    access: str | None = Field(default=None, max_length=1000)
    pets: str | None = Field(default=None, max_length=200)
    internet: str | None = Field(default=None, max_length=200)
    recorder_location: str | None = Field(default=None, max_length=200)
    equipment: list[Equipment] | None = Field(default=None, max_length=100)


# keys another kind uses are kept unvalidated, so changing the business's kind loses nothing
ATTRIBUTES: dict[SubjectKind, type[BaseModel]] = {
    "pet": PetAttributes,
    "student": StudentAttributes,
    "property": PropertyAttributes,
    "site": SiteAttributes,
}


class SubjectCreate(Mirror):
    mirrors = Subject

    client_id: str
    name: str = Field(min_length=1)
    attributes: dict[str, object] = Field(
        default_factory=dict, description="Validated against the business's subject kind"
    )


class SubjectUpdate(Mirror):
    mirrors = Subject

    name: str | None = Field(default=None, min_length=1)
    attributes: dict[str, object] | None = None


class SubjectOut(Mirror):
    mirrors = Subject
    model_config = ConfigDict(from_attributes=True)

    id: str
    business_id: str
    client_id: str
    name: str
    attributes: dict[str, object]
    created_at: datetime
    updated_at: datetime
