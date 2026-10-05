from fastapi import APIRouter

from clientbridge.api import (
    billing,
    bookings,
    business,
    catalog,
    clients,
    contracts,
    earnings,
    files,
    forms,
    gift_cards,
    messaging,
    notifications,
    orders,
    packages,
    payments,
    recurrences,
    reports,
    reviews,
    staff,
    subscriptions,
    tax,
)

api_router = APIRouter(prefix="/v1")
api_router.include_router(clients.router)
api_router.include_router(business.business_router)
api_router.include_router(catalog.router)
api_router.include_router(bookings.router)
api_router.include_router(recurrences.router)
api_router.include_router(billing.invoices_router)
api_router.include_router(earnings.router)
api_router.include_router(billing.estimates_router)
api_router.include_router(payments.connect_router)
api_router.include_router(payments.payments_router)
api_router.include_router(orders.router)
api_router.include_router(payments.terminal_router)
api_router.include_router(gift_cards.router)
api_router.include_router(packages.router)
api_router.include_router(subscriptions.router)
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
api_router.include_router(files.router)
