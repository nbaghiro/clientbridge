from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from clientbridge.models.business import Plan, PlanStatus

PlanInterval = Literal["month", "year"]
PlanAccess = Literal["trial", "active", "past_due", "lapsed"]


class PlanChoice(BaseModel):
    model_config = ConfigDict(extra="forbid")

    plan: Plan
    interval: PlanInterval


class PlanPriceOut(BaseModel):
    plan: Plan | None = Field(description="The tier, or none for the Premium seat item")
    interval: PlanInterval
    amount_cents: int


class PlanOut(BaseModel):
    access: PlanAccess = Field(description="What the business may do now: trial, active, ...")
    plan: Plan | None
    plan_status: PlanStatus
    trial_ends_at: datetime
    managed: bool = Field(description="Whether a Stripe subscription bills this business")
    interval: PlanInterval | None = None
    seats: int = Field(description="Billed seats now: active staff and unexpired invites")
    seat_cap: int
    current_period_end: datetime | None = None
    cancel_at_period_end: bool = False
    currency: str
    prices: list[PlanPriceOut]


class PlanLink(BaseModel):
    url: str
