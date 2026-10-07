from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

from clientbridge.schemas.public import PublicBrand


class ContractSend(BaseModel):
    contract_id: str
    client_id: str


class SignatureOut(BaseModel):
    id: str
    business_id: str
    contract_id: str
    client_id: str
    status: str
    token: str
    signed_at: datetime | None
    contract_version: int | None


class PublicContractContext(BaseModel):
    contract_name: str
    business_name: str
    brand: PublicBrand
    body: str
    signer_name: str | None
    status: str
    version: int
    signed_at: datetime | None = None
    signer_ip: str | None = None
    method: str | None = None
    typed_name: str | None = None
    strokes: list[list[tuple[float, float]]] | None = None


Stroke = list[tuple[float, float]]


class PublicContractSign(BaseModel):
    typed_name: str = Field(min_length=1, max_length=120, description="The printed name")
    strokes: list[Stroke] | None = Field(
        default=None, max_length=60, description="A drawn signature as points from 0 to 1"
    )
    agreed: bool = Field(description="The client agreed to sign electronically")


class ContractCreate(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40000)]


class ContractVersionCreate(BaseModel):
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40000)]


class ContractOut(BaseModel):
    id: str
    name: str
    body: str
    version: int
    active: bool
