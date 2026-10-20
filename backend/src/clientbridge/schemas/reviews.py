from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from clientbridge.core.mirrors import Mirror
from clientbridge.models.reviews import ReviewRequest


class ReviewRequestCreate(Mirror):
    mirrors = ReviewRequest

    client_id: str
    booking_id: str | None = None


class ReviewRequestOut(Mirror):
    mirrors = ReviewRequest

    id: str
    business_id: str
    client_id: str
    booking_id: str | None
    requested_at: datetime


class GoogleReviewAvailability(BaseModel):
    state: Literal["unavailable", "disconnected", "selecting", "active", "reconnect_required"] = (
        "unavailable"
    )
    connection_id: str | None = None
    generation: int = 0
    location: GoogleLocationChoice | None = None
    can_request: bool = False


class GoogleLocationChoice(BaseModel):
    name: str
    title: str


class GoogleChoices(BaseModel):
    choices: list[GoogleLocationChoice]
    next_page_token: str | None = None


class GoogleAuthorizationStart(BaseModel):
    platform: Literal["web", "native"]


class GoogleAuthorizationOut(BaseModel):
    authorization_url: str
    flow_token: str = Field(min_length=20, max_length=200)


class GoogleAuthorizationComplete(BaseModel):
    flow_token: str = Field(min_length=20, max_length=200)


class GoogleAuthorizationResult(BaseModel):
    state: Literal["pending", "complete", "failed"]


class GoogleLocationSelect(BaseModel):
    account_name: str
    location_name: str
    generation: int = Field(ge=1)


class GoogleDisconnect(BaseModel):
    generation: int = Field(ge=1)


class GoogleReplyCreate(BaseModel):
    review_id: str = Field(min_length=1, max_length=200, pattern=r"^[A-Za-z0-9_-]+$")
    comment: str | None = Field(default=None, max_length=4096)
    expected_reply_revision: str | None = None


class GoogleOperationOut(BaseModel):
    id: str
    state: Literal["queued", "running", "confirmed", "failed", "unknown", "canceled"]
