from datetime import date

from pydantic import BaseModel, Field, field_validator


class EarningOut(BaseModel):
    id: str
    staff_id: str
    subject_type: str | None = Field(description="booking, invoice, order or staff")
    subject_id: str | None
    basis: str | None
    amount_cents: int
    status: str
    kind: str = "earning"


class EarningIdsIn(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=200)


class PayIn(EarningIdsIn):
    through: date | None = Field(
        default=None, description="The last day of work this pay covers, kept on the pay run"
    )


class EarningsOut(BaseModel):
    earnings: list[EarningOut]


class AdjustmentIn(BaseModel):
    staff_id: str
    amount_cents: int = Field(
        ge=-10_000_000, le=10_000_000, description="Positive adds to their pay, negative deducts"
    )
    reason: str = Field(min_length=1, max_length=200)

    @field_validator("reason", mode="before")
    @classmethod
    def _trim_reason(cls, v: object) -> object:
        return v.strip() if isinstance(v, str) else v

    @field_validator("amount_cents")
    @classmethod
    def _not_zero(cls, v: int) -> int:
        if v == 0:
            raise ValueError("an adjustment needs an amount")
        return v
