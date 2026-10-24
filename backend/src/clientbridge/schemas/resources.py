from datetime import datetime
from typing import Annotated

from pydantic import Field, StringConstraints

from clientbridge.core.mirrors import Mirror
from clientbridge.models.scheduling import Resource

ResourceName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class ResourceCreate(Mirror):
    mirrors = Resource

    name: ResourceName = Field(description="Unique in the business, in any case")


class ResourceUpdate(Mirror):
    mirrors = Resource

    name: ResourceName | None = None
    active: bool | None = Field(
        default=None, description="False offers it for no new visit; booked visits keep it"
    )


class ResourceOut(Mirror):
    mirrors = Resource

    id: str
    business_id: str
    name: str
    active: bool
    created_at: datetime
    updated_at: datetime
    upcoming: int = Field(description="Visits and sessions still ahead that hold it")
