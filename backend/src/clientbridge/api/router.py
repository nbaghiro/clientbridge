from fastapi import APIRouter

from clientbridge.api import (
    billing,
    bookings,
    business,
    catalog,
    clients,
    consents,
    contracts,
    earnings,
    entitlements,
    files,
    forms,
    messaging,
    notes,
    notifications,
    orders,
    payments,
    reports,
    reviews,
    staff,
    subjects,
    tax,
)

api_router = APIRouter(prefix="/v1")
api_router.include_router(clients.router)
api_router.include_router(subjects.router)
api_router.include_router(notes.router)
api_router.include_router(consents.router)
api_router.include_router(business.business_router)
api_router.include_router(catalog.router)
api_router.include_router(bookings.router)
api_router.include_router(bookings.recurrences_router)
api_router.include_router(billing.invoices_router)
api_router.include_router(earnings.router)
api_router.include_router(billing.estimates_router)
api_router.include_router(payments.connect_router)
api_router.include_router(payments.payments_router)
api_router.include_router(orders.router)
api_router.include_router(payments.terminal_router)
api_router.include_router(entitlements.gift_cards_router)
api_router.include_router(entitlements.packages_router)
api_router.include_router(entitlements.subscriptions_router)
api_router.include_router(tax.router)
api_router.include_router(business.onboarding_router)
api_router.include_router(staff.router)
api_router.include_router(reports.dashboard_router)
api_router.include_router(notifications.router)
api_router.include_router(reports.reports_router)
api_router.include_router(reviews.router)
api_router.include_router(messaging.router)
api_router.include_router(forms.router)
api_router.include_router(contracts.router)
api_router.include_router(contracts.signatures_router)
api_router.include_router(files.router)
