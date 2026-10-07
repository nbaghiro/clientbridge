from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import RedirectResponse

from clientbridge.core.deps import DbSession, EmailDep, GatewayDep, PushDep, SmsDep, StorageDep
from clientbridge.core.ratelimit import (
    _client_ip,
    public_booking_rate_limit,
    public_contract_rate_limit,
    public_form_rate_limit,
    public_pay_rate_limit,
    public_prefs_rate_limit,
    public_review_rate_limit,
)
from clientbridge.schemas.billing import (
    PublicEstimate,
    PublicEstimateAccept,
    PublicEstimateDecline,
)
from clientbridge.schemas.consents import (
    PublicPreferences,
    PublicPreferencesUpdate,
    PublicUnsubscribe,
)
from clientbridge.schemas.contracts import PublicContractContext, PublicContractSign
from clientbridge.schemas.files import PublicFileCreate, PublicFileUpload
from clientbridge.schemas.forms import PublicFormContext, PublicFormSubmit
from clientbridge.schemas.orders import PublicReceipt
from clientbridge.schemas.payments import (
    InteracRequest,
    PublicCardIntent,
    PublicInvoice,
    PublicPayIn,
)
from clientbridge.schemas.public import (
    ManageCancelResult,
    ManagedBooking,
    ManageReschedule,
    PublicBookingCreate,
    PublicBookingPage,
    PublicBookingResult,
    PublicDays,
    PublicShop,
    PublicShopOrderCreate,
    PublicShopOrderResult,
    PublicSlots,
)
from clientbridge.schemas.reviews import PublicReviewContext, PublicReviewSubmit
from clientbridge.services.files import public_media_location
from clientbridge.services.notifications import Notifier
from clientbridge.services.public import (
    PublicBookingService,
    PublicContractService,
    PublicEstimateService,
    PublicFormService,
    PublicManageService,
    PublicPayService,
    PublicPreferencesService,
    PublicReceiptService,
    PublicReviewService,
    PublicShopService,
)

pay_router = APIRouter(prefix="/pay", tags=["public-pay"])

RateLimited = Annotated[None, Depends(public_pay_rate_limit)]
ReviewRateLimited = Annotated[None, Depends(public_review_rate_limit)]
FormRateLimited = Annotated[None, Depends(public_form_rate_limit)]
ContractRateLimited = Annotated[None, Depends(public_contract_rate_limit)]
BookingRateLimited = Annotated[None, Depends(public_booking_rate_limit)]
PrefsRateLimited = Annotated[None, Depends(public_prefs_rate_limit)]


@pay_router.get("/{token}", response_model=PublicInvoice)
async def public_invoice(
    token: str, db: DbSession, gateway: GatewayDep, _: RateLimited
) -> PublicInvoice:
    return await PublicPayService(db, gateway).invoice(token)


@pay_router.post("/{token}/card", response_model=PublicCardIntent)
async def public_pay_card(
    token: str,
    db: DbSession,
    gateway: GatewayDep,
    _: RateLimited,
    data: PublicPayIn | None = None,
) -> PublicCardIntent:
    return await PublicPayService(db, gateway).pay_card(token, data)


@pay_router.post("/{token}/interac", response_model=InteracRequest)
async def public_pay_interac(
    token: str, db: DbSession, gateway: GatewayDep, _: RateLimited
) -> InteracRequest:
    return await PublicPayService(db, gateway).pay_interac(token)


receipt_router = APIRouter(prefix="/receipt", tags=["public-receipt"])


@receipt_router.get("/{token}", response_model=PublicReceipt)
async def public_receipt(token: str, db: DbSession, _: RateLimited) -> PublicReceipt:
    return await PublicReceiptService(db).receipt(token)


estimate_router = APIRouter(prefix="/estimate", tags=["public-estimate"])


@estimate_router.get("/{token}", response_model=PublicEstimate)
async def public_estimate(token: str, db: DbSession, _: RateLimited) -> PublicEstimate:
    return await PublicEstimateService(db).context(token)


@estimate_router.post("/{token}/accept", response_model=PublicEstimate)
async def public_estimate_accept(
    token: str,
    data: PublicEstimateAccept,
    db: DbSession,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
    _: RateLimited,
) -> PublicEstimate:
    result = await PublicEstimateService(db).accept(token, data)
    await Notifier(email, sms, push).on_estimate_answered(db, token)
    return result


@estimate_router.post("/{token}/decline", response_model=PublicEstimate)
async def public_estimate_decline(
    token: str,
    data: PublicEstimateDecline,
    db: DbSession,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
    _: RateLimited,
) -> PublicEstimate:
    result = await PublicEstimateService(db).decline(token, data)
    await Notifier(email, sms, push).on_estimate_answered(db, token)
    return result


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


@form_router.post("/{token}/upload", response_model=PublicFileUpload)
async def public_form_upload(
    token: str,
    body: PublicFileCreate,
    db: DbSession,
    storage: StorageDep,
    _: FormRateLimited,
) -> PublicFileUpload:
    return await PublicFormService(db).upload(token, body, storage)


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


prefs_router = APIRouter(prefix="/prefs", tags=["public-prefs"])


@prefs_router.get("/{token}", response_model=PublicPreferences)
async def public_preferences(token: str, db: DbSession, _: PrefsRateLimited) -> PublicPreferences:
    return await PublicPreferencesService(db).context(token)


@prefs_router.post("/{token}", response_model=PublicPreferences)
async def public_preferences_save(
    token: str, body: PublicPreferencesUpdate, db: DbSession, _: PrefsRateLimited
) -> PublicPreferences:
    return await PublicPreferencesService(db).save(token, body)


@prefs_router.post("/{token}/unsubscribe", response_model=PublicPreferences)
async def public_unsubscribe(
    token: str, body: PublicUnsubscribe, db: DbSession, _: PrefsRateLimited
) -> PublicPreferences:
    return await PublicPreferencesService(db).unsubscribe(token, body.channel)


booking_router = APIRouter(prefix="/book", tags=["public-booking"])


@booking_router.get("/{slug}/services", response_model=PublicBookingPage)
async def public_booking_page(
    slug: str, db: DbSession, gateway: GatewayDep, _: BookingRateLimited
) -> PublicBookingPage:
    return await PublicBookingService(db, gateway).page(slug)


@booking_router.get("/{slug}/slots", response_model=PublicSlots)
async def public_booking_slots(
    slug: str,
    item_id: str,
    staff_id: str,
    date: date,
    db: DbSession,
    gateway: GatewayDep,
    _: BookingRateLimited,
) -> PublicSlots:
    return await PublicBookingService(db, gateway).slots(slug, item_id, staff_id, date)


@booking_router.get("/{slug}/days", response_model=PublicDays)
async def public_booking_days(
    slug: str,
    item_id: str,
    staff_id: str,
    start: Annotated[date, Query(alias="from")],
    db: DbSession,
    gateway: GatewayDep,
    _: BookingRateLimited,
    days: Annotated[int, Query(ge=1, le=14)] = 7,
) -> PublicDays:
    return await PublicBookingService(db, gateway).days(slug, item_id, staff_id, start, days)


@booking_router.post("/{slug}", response_model=PublicBookingResult)
async def public_book(
    slug: str,
    body: PublicBookingCreate,
    db: DbSession,
    gateway: GatewayDep,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
    _: BookingRateLimited,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key", min_length=8)] = None,
) -> PublicBookingResult:
    result = await PublicBookingService(db, gateway).book(slug, body, idempotency_key)
    await Notifier(email, sms, push).on_booking_confirmed(db, result.booking_id)
    return result


@booking_router.get("/{slug}/shop", response_model=PublicShop)
async def public_shop(
    slug: str, db: DbSession, gateway: GatewayDep, _: BookingRateLimited
) -> PublicShop:
    return await PublicShopService(db, gateway).shop(slug)


@booking_router.post("/{slug}/shop/orders", response_model=PublicShopOrderResult)
async def public_shop_order(
    slug: str,
    body: PublicShopOrderCreate,
    db: DbSession,
    gateway: GatewayDep,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=8)],
    _: BookingRateLimited,
) -> PublicShopOrderResult:
    return await PublicShopService(db, gateway).order(slug, body, idempotency_key)


manage_router = APIRouter(prefix="/manage", tags=["public-manage"])


@manage_router.get("/{token}", response_model=ManagedBooking)
async def manage_view(
    token: str, db: DbSession, gateway: GatewayDep, _: BookingRateLimited
) -> ManagedBooking:
    return await PublicManageService(db, gateway).view(token)


@manage_router.get("/{token}/days", response_model=PublicDays)
async def manage_days(
    token: str,
    start: Annotated[date, Query(alias="from")],
    db: DbSession,
    gateway: GatewayDep,
    _: BookingRateLimited,
    days: Annotated[int, Query(ge=1, le=14)] = 7,
) -> PublicDays:
    return await PublicManageService(db, gateway).days(token, start, days)


@manage_router.get("/{token}/slots", response_model=PublicSlots)
async def manage_slots(
    token: str, date: date, db: DbSession, gateway: GatewayDep, _: BookingRateLimited
) -> PublicSlots:
    return await PublicManageService(db, gateway).slots(token, date)


@manage_router.post("/{token}/reschedule", response_model=ManagedBooking)
async def manage_reschedule(
    token: str,
    body: ManageReschedule,
    db: DbSession,
    gateway: GatewayDep,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
    _: BookingRateLimited,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key", min_length=8)] = None,
) -> ManagedBooking:
    service = PublicManageService(db, gateway)
    before = await service.view(token)
    result = await service.reschedule(token, body, idempotency_key)
    if result.starts_at != before.starts_at:
        booking_id = await service.booking_id(token)
        await Notifier(email, sms, push).on_booking_rescheduled(db, booking_id)
    return result


@manage_router.post("/{token}/cancel", response_model=ManageCancelResult)
async def manage_cancel(
    token: str,
    db: DbSession,
    gateway: GatewayDep,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
    _: BookingRateLimited,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key", min_length=8)] = None,
) -> ManageCancelResult:
    service = PublicManageService(db, gateway)
    live = (await service.view(token)).status != "canceled"
    result = await service.cancel(token, idempotency_key)
    if live:
        await Notifier(email, sms, push).on_booking_canceled(db, await service.booking_id(token))
    return result


media_router = APIRouter(prefix="/media", tags=["media"])


@media_router.get("/{file_id}", response_class=RedirectResponse, status_code=302)
async def public_media(file_id: str, db: DbSession, storage: StorageDep) -> RedirectResponse:
    location = await public_media_location(db, storage, file_id)
    return RedirectResponse(location, status_code=302, headers={"Cache-Control": "max-age=300"})
