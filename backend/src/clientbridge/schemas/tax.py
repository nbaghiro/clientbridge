from pydantic import BaseModel, ConfigDict


class TaxRateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    jurisdiction: str
    province: str
    rate_bps: int
    name: str
