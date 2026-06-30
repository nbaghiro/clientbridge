from datetime import datetime

from pydantic import BaseModel


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


class PublicContractContext(BaseModel):
    contract_name: str
    business_name: str
    body: str
    signer_name: str | None
    status: str


class PublicContractSign(BaseModel):
    signature_image_id: str | None = None
    typed_name: str | None = None
