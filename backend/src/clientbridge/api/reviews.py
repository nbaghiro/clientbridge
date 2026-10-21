from typing import Annotated

from fastapi import APIRouter, Depends, Header
from fastapi.responses import RedirectResponse

from clientbridge.core.deps import (
    CurrentIdentity,
    CurrentPrincipal,
    DbSession,
    EmailDep,
    PushDep,
    SmsDep,
)
from clientbridge.integrations.google_business import (
    GoogleBusinessGateway,
    GoogleFlowStore,
    GoogleReviews,
    GoogleSecretStore,
    get_google_business_gateway,
    get_google_flow_store,
    get_google_secret_store,
)
from clientbridge.schemas.reviews import (
    GoogleAuthorizationComplete,
    GoogleAuthorizationOut,
    GoogleAuthorizationResult,
    GoogleAuthorizationStart,
    GoogleChoices,
    GoogleDisconnect,
    GoogleLocationSelect,
    GoogleOperationOut,
    GoogleReplyCreate,
    GoogleReviewAvailability,
    ReviewRequestCreate,
    ReviewRequestOut,
)
from clientbridge.services.notifications import Notifier
from clientbridge.services.reviews import (
    GoogleReviewService,
    ReviewService,
    complete_google_callback,
)

router = APIRouter(prefix="/reviews", tags=["reviews"])


@router.post("/request", response_model=ReviewRequestOut, status_code=201)
async def request_review(
    body: ReviewRequestCreate,
    principal: CurrentPrincipal,
    db: DbSession,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> ReviewRequestOut:
    return await ReviewService(db, principal).request_review(
        body, idempotency_key, Notifier(email, sms, push)
    )


GoogleGatewayDep = Annotated[GoogleBusinessGateway, Depends(get_google_business_gateway)]
GoogleVaultDep = Annotated[GoogleSecretStore, Depends(get_google_secret_store)]
GoogleFlowsDep = Annotated[GoogleFlowStore, Depends(get_google_flow_store)]


def google_service(
    db: DbSession,
    principal: CurrentPrincipal,
    gateway: GoogleGatewayDep,
    vault: GoogleVaultDep,
    flows: GoogleFlowsDep,
) -> GoogleReviewService:
    return GoogleReviewService(db, principal, gateway, vault, flows)


GoogleServiceDep = Annotated[GoogleReviewService, Depends(google_service)]


@router.post("/google/authorization", response_model=GoogleAuthorizationOut)
async def google_authorization(
    body: GoogleAuthorizationStart, identity: CurrentIdentity, service: GoogleServiceDep
) -> GoogleAuthorizationOut:
    return await service.start(identity.session_id, body.platform)


@router.get("/google/callback", response_class=RedirectResponse)
async def google_callback(
    gateway: GoogleGatewayDep,
    vault: GoogleVaultDep,
    flows: GoogleFlowsDep,
    state: str,
    code: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    destination = await complete_google_callback(state, code, error, gateway, vault, flows)
    return RedirectResponse(
        destination,
        status_code=303,
        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"},
    )


@router.post("/google/authorization/complete", response_model=GoogleAuthorizationResult)
async def google_authorization_complete(
    body: GoogleAuthorizationComplete, identity: CurrentIdentity, service: GoogleServiceDep
) -> GoogleAuthorizationResult:
    return await service.complete(body.flow_token, identity.session_id)


@router.get("/google/accounts", response_model=GoogleChoices)
async def google_accounts(
    service: GoogleServiceDep, page_token: str | None = None
) -> GoogleChoices:
    return await service.accounts(page_token)


@router.get("/google/locations", response_model=GoogleChoices)
async def google_locations(
    service: GoogleServiceDep, account_name: str, page_token: str | None = None
) -> GoogleChoices:
    return await service.locations(account_name, page_token)


@router.post("/google/location", response_model=GoogleReviewAvailability)
async def google_select(
    body: GoogleLocationSelect, service: GoogleServiceDep
) -> GoogleReviewAvailability:
    return await service.select(body.account_name, body.location_name, body.generation)


@router.post("/google/disconnect", response_model=GoogleReviewAvailability)
async def google_disconnect(
    body: GoogleDisconnect, service: GoogleServiceDep
) -> GoogleReviewAvailability:
    return await service.disconnect(body.generation)


@router.get("/google/reviews", response_model=GoogleReviews, response_model_by_alias=False)
async def google_reviews(service: GoogleServiceDep, page_token: str | None = None) -> GoogleReviews:
    return await service.reviews(page_token)


@router.get("/google", response_model=GoogleReviewAvailability)
async def google_status(service: GoogleServiceDep) -> GoogleReviewAvailability:
    return await service.status()


@router.post("/google/replies", response_model=GoogleOperationOut)
async def google_reply(
    body: GoogleReplyCreate,
    service: GoogleServiceDep,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key")],
) -> GoogleOperationOut:
    return await service.submit_reply(body, idempotency_key, remove=False)


@router.post("/google/replies/delete", response_model=GoogleOperationOut)
async def google_reply_delete(
    body: GoogleReplyCreate,
    service: GoogleServiceDep,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key")],
) -> GoogleOperationOut:
    return await service.submit_reply(body, idempotency_key, remove=True)


@router.get("/google/operations/{operation_id}", response_model=GoogleOperationOut)
async def google_operation(operation_id: str, service: GoogleServiceDep) -> GoogleOperationOut:
    return await service.operation(operation_id)
