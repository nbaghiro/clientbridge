from typing import Annotated

from fastapi import APIRouter, Depends, Request

from clientbridge.core.deps import DbSession, GatewayDep
from clientbridge.core.ratelimit import (
    _client_ip,
    public_contract_rate_limit,
    public_form_rate_limit,
    public_pay_rate_limit,
    public_review_rate_limit,
)
from clientbridge.schemas.contracts import PublicContractContext, PublicContractSign
from clientbridge.schemas.forms import PublicFormContext, PublicFormSubmit
from clientbridge.schemas.payments import InteracRequest, PublicCardIntent, PublicInvoice
from clientbridge.schemas.reviews import PublicReviewContext, PublicReviewSubmit
from clientbridge.services.public_contract_service import PublicContractService
from clientbridge.services.public_form_service import PublicFormService
from clientbridge.services.public_pay_service import PublicPayService
from clientbridge.services.public_review_service import PublicReviewService

router = APIRouter(prefix="/pay", tags=["public-pay"])

RateLimited = Annotated[None, Depends(public_pay_rate_limit)]
ReviewRateLimited = Annotated[None, Depends(public_review_rate_limit)]
FormRateLimited = Annotated[None, Depends(public_form_rate_limit)]
ContractRateLimited = Annotated[None, Depends(public_contract_rate_limit)]


@router.get("/{token}", response_model=PublicInvoice)
async def public_invoice(token: str, db: DbSession, gateway: GatewayDep) -> PublicInvoice:
    return await PublicPayService(db, gateway).invoice(token)


@router.post("/{token}/card", response_model=PublicCardIntent)
async def public_pay_card(
    token: str, db: DbSession, gateway: GatewayDep, _: RateLimited
) -> PublicCardIntent:
    return await PublicPayService(db, gateway).pay_card(token)


@router.post("/{token}/interac", response_model=InteracRequest)
async def public_pay_interac(
    token: str, db: DbSession, gateway: GatewayDep, _: RateLimited
) -> InteracRequest:
    return await PublicPayService(db, gateway).pay_interac(token)


review_router = APIRouter(prefix="/review", tags=["public-review"])


@review_router.get("/{token}", response_model=PublicReviewContext)
async def public_review_context(
    token: str, db: DbSession, _: ReviewRateLimited
) -> PublicReviewContext:
    return await PublicReviewService(db).context(token)


@review_router.post("/{token}", response_model=PublicReviewContext)
async def public_review_submit(
    token: str, body: PublicReviewSubmit, db: DbSession, _: ReviewRateLimited
) -> PublicReviewContext:
    return await PublicReviewService(db).submit(token, body)


form_router = APIRouter(prefix="/form", tags=["public-form"])


@form_router.get("/{token}", response_model=PublicFormContext)
async def public_form_context(token: str, db: DbSession, _: FormRateLimited) -> PublicFormContext:
    return await PublicFormService(db).context(token)


@form_router.post("/{token}", response_model=PublicFormContext)
async def public_form_submit(
    token: str, body: PublicFormSubmit, db: DbSession, _: FormRateLimited
) -> PublicFormContext:
    return await PublicFormService(db).submit(token, body)


contract_router = APIRouter(prefix="/contract", tags=["public-contract"])


@contract_router.get("/{token}", response_model=PublicContractContext)
async def public_contract_context(
    token: str, db: DbSession, _: ContractRateLimited
) -> PublicContractContext:
    return await PublicContractService(db).context(token)


@contract_router.post("/{token}/sign", response_model=PublicContractContext)
async def public_contract_sign(
    token: str,
    body: PublicContractSign,
    request: Request,
    db: DbSession,
    _: ContractRateLimited,
) -> PublicContractContext:
    return await PublicContractService(db).sign(token, body, _client_ip(request))


@contract_router.post("/{token}/decline", response_model=PublicContractContext)
async def public_contract_decline(
    token: str, db: DbSession, _: ContractRateLimited
) -> PublicContractContext:
    return await PublicContractService(db).decline(token)
