from typing import Literal

from pydantic import BaseModel, Field

Category = Literal["room", "station", "equipment"]


class ResourceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    category: Category = "station"
    capacity: int = Field(default=1, ge=1, le=100)
    active: bool = True


class ResourcePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    category: Category | None = None
    capacity: int | None = Field(default=None, ge=1, le=100)
    active: bool | None = Field(
        default=None, description="Off keeps existing bookings and hides it from new ones"
    )


class ResourceOut(BaseModel):
    id: str
    business_id: str
    name: str
    category: str
    capacity: int
    active: bool
    upcoming: int = Field(description="Upcoming visits that hold it")
