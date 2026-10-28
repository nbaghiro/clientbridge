from pydantic import BaseModel, Field


class ConsentExport(BaseModel):
    filename: str
    content: str = Field(description="CSV: one row per consent record, newest last per client")
