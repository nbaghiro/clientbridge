from datetime import datetime

from pydantic import BaseModel, Field


class ReturningRequest(BaseModel):
    phone: str = Field(max_length=24, pattern=r"^\+?[0-9 ()-]{8,24}$")


class ReturningChallengeOut(BaseModel):
    challenge_id: str


class ReturningVerify(BaseModel):
    challenge_id: str = Field(max_length=100)
    code: str = Field(pattern=r"^\d{6}$")


class ReturningSubject(BaseModel):
    id: str
    name: str


class ReturningVisit(BaseModel):
    item_id: str
    staff_id: str
    subject_id: str | None
    starts_at: datetime


class ReturningProfile(BaseModel):
    name: str
    phone: str | None
    subjects: list[ReturningSubject]
    last_visit: ReturningVisit | None


class ReturningVerified(BaseModel):
    token: str | None
    profile: ReturningProfile | None
