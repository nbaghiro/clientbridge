from typing import Annotated

from fastapi import APIRouter, Depends, Query

from clientbridge.core.deps import DbSession, PlatformIdentity
from clientbridge.integrations.resend import EmailSender, get_test_email_sender
from clientbridge.models.payments import PaymentStatus
from clientbridge.models.platform import WebhookStatus
from clientbridge.schemas.admin import (
    AdminAccessInfo,
    AdminActivity,
    AdminBusiness,
    AdminBusinessDetail,
    AdminClient,
    AdminDelivery,
    AdminDriftAcknowledgement,
    AdminDriftResult,
    AdminEdition,
    AdminEmail,
    AdminEmailConfig,
    AdminEmailPreview,
    AdminEmailResult,
    AdminEmailSend,
    AdminOperations,
    AdminOverview,
    AdminPage,
    AdminPayment,
    AdminPaymentDetail,
    AdminPersonDetail,
    AdminSession,
    AdminSmsAssignment,
    AdminUser,
)
from clientbridge.services.admin import AdminService
from clientbridge.services.email_samples import samples

router = APIRouter(prefix="/admin/v1", tags=["admin"])


def service(db: DbSession, identity: PlatformIdentity) -> AdminService:
    return AdminService(db, identity)


Service = Annotated[AdminService, Depends(service)]
Search = Annotated[str, Query(max_length=160)]
Offset = Annotated[int, Query(ge=0, le=100000)]
BusinessFilter = Annotated[str | None, Query(max_length=100)]


@router.get("/session")
async def admin_session(identity: PlatformIdentity) -> AdminSession:
    return AdminSession(identity_id=identity.id)


@router.get("/overview")
async def overview(admin: Service) -> AdminOverview:
    return await admin.overview()


@router.get("/businesses")
async def businesses(
    admin: Service, q: Search = "", offset: Offset = 0
) -> AdminPage[AdminBusiness]:
    return await admin.businesses(q, offset)


@router.get("/businesses/{business_id}")
async def business(admin: Service, business_id: str) -> AdminBusinessDetail:
    return await admin.business(business_id)


@router.get("/users")
async def users(admin: Service, q: Search = "", offset: Offset = 0) -> AdminPage[AdminUser]:
    return await admin.users(q, offset)


@router.get("/users/{user_id}")
async def person(admin: Service, user_id: str) -> AdminPersonDetail:
    return await admin.person(user_id)


@router.get("/clients")
async def clients(
    admin: Service, q: Search = "", business_id: BusinessFilter = None, offset: Offset = 0
) -> AdminPage[AdminClient]:
    return await admin.clients(q, business_id, offset)


@router.get("/payments")
async def payments(
    admin: Service,
    q: Search = "",
    business_id: BusinessFilter = None,
    status: PaymentStatus | None = None,
    offset: Offset = 0,
) -> AdminPage[AdminPayment]:
    return await admin.payments(q, business_id, status, offset)


@router.get("/payments/{payment_id}")
async def payment(admin: Service, payment_id: str) -> AdminPaymentDetail:
    return await admin.payment(payment_id)


@router.get("/activity")
async def activity(
    admin: Service, q: Search = "", business_id: BusinessFilter = None, offset: Offset = 0
) -> AdminPage[AdminActivity]:
    return await admin.activity(q, business_id, offset)


@router.get("/operations")
async def operations(
    admin: Service, status: WebhookStatus | None = None, offset: Offset = 0
) -> AdminOperations:
    return await admin.operations(status, offset)


@router.get("/access")
async def access(admin: Service) -> AdminAccessInfo:
    return admin.access()


@router.get("/emails")
async def emails(identity: PlatformIdentity) -> list[AdminEmail]:
    return [AdminEmail(key=key, subject=mail.subject) for key, mail in samples().items()]


@router.get("/email-config")
async def email_config(admin: Service) -> AdminEmailConfig:
    return admin.email_config()


@router.get("/emails/{key}")
async def email_preview(admin: Service, key: str) -> AdminEmailPreview:
    return admin.email_preview(key)


def test_sender(body: AdminEmailSend) -> EmailSender:
    return get_test_email_sender(body.transport)


TestSender = Annotated[EmailSender, Depends(test_sender)]


@router.post("/emails/{key}/send")
async def send_email(
    admin: Service, key: str, body: AdminEmailSend, sender: TestSender
) -> AdminEmailResult:
    return await admin.send_email(key, body, sender)


@router.get("/deliveries")
async def deliveries(
    admin: Service, offset: Annotated[int, Query(ge=0, le=10000)] = 0
) -> AdminPage[AdminDelivery]:
    return await admin.deliveries(offset)


@router.post("/businesses/{business_id}/sms")
async def assign_sms(admin: Service, business_id: str, body: AdminSmsAssignment) -> AdminBusiness:
    return await admin.assign_sms(business_id, body)


@router.post("/businesses/{business_id}/edition")
async def set_edition(admin: Service, business_id: str, body: AdminEdition) -> AdminBusiness:
    return await admin.set_edition(business_id, body)


@router.post("/businesses/{business_id}/drift/{finding_id}/acknowledge")
async def acknowledge_drift(
    admin: Service, business_id: str, finding_id: str, body: AdminDriftAcknowledgement
) -> AdminDriftResult:
    return await admin.acknowledge_drift(business_id, finding_id, body)
