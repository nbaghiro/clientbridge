from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from clientbridge.core.mirrors import Mirror
from clientbridge.core.phones import Phone
from clientbridge.models.business import (
    Business,
    BusinessStatus,
    Plan,
    PlanStatus,
    StaffRole,
    StaffStatus,
    User,
)
from clientbridge.models.clients import Client, ClientStatus
from clientbridge.models.messaging import Delivery, DeliveryState
from clientbridge.models.payments import (
    DisputeStatus,
    Payment,
    PaymentKind,
    PaymentProvider,
    PaymentStatus,
    PayMethod,
)
from clientbridge.models.platform import Audit, Webhook, WebhookProvider, WebhookStatus


class AdminSession(BaseModel):
    identity_id: str


class AdminBusiness(Mirror):
    mirrors = Business
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    slug: str
    status: BusinessStatus
    timezone: str
    billing_email: str | None
    sms_number: str | None
    plan: Plan | None
    plan_status: PlanStatus
    trial_ends_at: datetime
    stripe_account_id: str | None
    stripe_charges_enabled: bool
    stripe_payouts_enabled: bool
    created_at: datetime


class AdminUser(Mirror):
    mirrors = User
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str | None
    email: str
    phone: str | None
    last_seen_at: datetime | None
    created_at: datetime


class AdminClient(Mirror):
    mirrors = Client
    model_config = ConfigDict(from_attributes=True)
    id: str
    business_id: str
    name: str
    email: str | None
    phone: str | None
    status: ClientStatus
    user_id: str | None
    created_at: datetime


class AdminMembership(BaseModel):
    business_id: str
    business_name: str
    user_id: str | None
    name: str | None
    role: StaffRole
    status: StaffStatus


class AdminPayment(Mirror):
    business_name: str | None = None
    mirrors = Payment
    model_config = ConfigDict(from_attributes=True)
    id: str
    business_id: str
    client_id: str | None
    kind: PaymentKind
    status: PaymentStatus
    amount_cents: int
    currency: str
    method: PayMethod
    provider: PaymentProvider
    provider_ref: str | None
    parent_payment_id: str | None
    invoice_id: str | None
    order_id: str | None
    booking_id: str | None
    dispute_status: DisputeStatus | None
    created_at: datetime
    paid_at: datetime | None


class AdminActivity(Mirror):
    business_name: str | None = None
    actor_name: str | None = None
    mirrors = Audit
    model_config = ConfigDict(from_attributes=True)
    id: str
    business_id: str
    performed_by: str | None
    action: str
    entity_type: str
    entity_id: str
    created_at: datetime


class AdminWebhook(Mirror):
    mirrors = Webhook
    model_config = ConfigDict(from_attributes=True)
    id: str
    provider: WebhookProvider
    event: str
    status: WebhookStatus
    created_at: datetime
    processed_at: datetime | None


class AdminPage[T](BaseModel):
    items: list[T]
    has_more: bool


class AdminOverview(BaseModel):
    businesses: int
    users: int
    clients: int
    failed_payments: int
    failed_webhooks: int
    recent_businesses: list[AdminBusiness]
    activity: list[AdminActivity]


class AdminBusinessDetail(BaseModel):
    business: AdminBusiness
    staff: list[AdminMembership]
    clients: int
    payments: int


class AdminPersonDetail(BaseModel):
    user: AdminUser
    memberships: list[AdminMembership]
    clients: list[AdminClient]


class AdminLedgerLeg(BaseModel):
    account_category: str
    id: str
    journal_id: str
    account_id: str
    event: str
    amount_cents: int
    currency: str
    occurred_at: datetime


class AdminPaymentDetail(BaseModel):
    payment: AdminPayment
    business: AdminBusiness
    client: AdminClient | None
    refunds: list[AdminPayment]
    entries: list[AdminLedgerLeg]
    stripe_url: str | None


class AdminOperations(BaseModel):
    environment: str
    database_revision: list[str]
    expected_revision: list[str]
    webhooks: AdminPage[AdminWebhook]
    pending_webhooks: int
    failed_webhooks: int
    email_transport: Literal["smtp", "resend", "unconfigured"]
    email_transports: list[Literal["smtp", "resend"]]


class AdminAccessInfo(BaseModel):
    identity_id: str
    email: str
    environment: str
    development_grant: bool
    second_factor: bool


class AdminEmailConfig(BaseModel):
    email_transports: list[Literal["smtp", "resend"]]


class AdminEmail(BaseModel):
    key: str
    subject: str


class AdminEmailPreview(AdminEmail):
    html: str
    text: str


class AdminEmailSend(BaseModel):
    recipient: str = Field(max_length=254, pattern=r"^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$")
    transport: Literal["smtp", "resend"]
    request_id: str = Field(min_length=16, max_length=80, pattern=r"^[a-zA-Z0-9-]+$")


class AdminEmailResult(BaseModel):
    delivery_id: str
    state: DeliveryState


class AdminDelivery(Mirror):
    mirrors = Delivery
    id: str
    business_id: str | None
    state: DeliveryState
    created_at: datetime
    provider_ref: str | None
    error: str | None
    recipient: str
    subject: str
    actor: str | None


class AdminSmsAssignment(BaseModel):
    number: Phone = Field(max_length=32)
