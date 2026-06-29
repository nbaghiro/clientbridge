from pydantic import BaseModel, Field


class PackagePurchase(BaseModel):
    client_id: str = Field(min_length=1)
    item_id: str = Field(min_length=1)


class PackageOut(BaseModel):
    id: str
    client_id: str
    item_id: str
    sessions_total: int
    sessions_used: int
    status: str
