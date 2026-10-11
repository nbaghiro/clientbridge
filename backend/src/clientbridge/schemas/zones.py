from pydantic import BaseModel, Field


class ZonesOut(BaseModel):
    version: str = Field(description="The tzdata release the offsets come from")
    zones: dict[str, list[tuple[int, int]]] = Field(
        description="Per supported zone, each UTC offset as (UTC second it starts, minutes)"
    )
