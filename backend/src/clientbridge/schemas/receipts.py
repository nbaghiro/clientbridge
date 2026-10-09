from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field


class OperationIdentity(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Literal[2]
    device_id: UUID
    operation_id: UUID
    business_id: str = Field(min_length=1, max_length=200)
    created_at: AwareDatetime
