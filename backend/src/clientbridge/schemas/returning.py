from datetime import datetime

from pydantic import BaseModel, Field, model_validator


class ReturningRequest(BaseModel):
    email: str | None = Field(default=None, max_length=254, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
    phone: str | None = Field(default=None, max_length=24, pattern=r"^\+?[0-9 ()-]{8,24}$")

    @model_validator(mode="after")
    def _one_contact(self) -> "ReturningRequest":
        if (self.email is None) == (self.phone is None):
            raise ValueError("provide exactly one email or phone")
        return self


class ReturningChallengeOut(BaseModel):
    challenge_id: str


class ReturningVerify(BaseModel):
    challenge_id: str = Field(max_length=100)
    code: str = Field(pattern=r"^\d{6}$")


class ReturningPet(BaseModel):
    id: str
    name: str


class ReturningVisit(BaseModel):
    item_id: str
    staff_id: str
    subject_id: str | None
    starts_at: datetime


class ReturningProfile(BaseModel):
    name: str
    email: str | None
    phone: str | None
    pets: list[ReturningPet]
    last_visit: ReturningVisit | None


class ReturningVerified(BaseModel):
    token: str | None
    profile: ReturningProfile | None
