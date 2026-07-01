"""Mounts all versioned API routers under /v1. Domain routers are added here as they land."""

from fastapi import APIRouter

from clientbridge.api.v1 import (
    bookings,
    business,
    catalog,
    clients,
    contracts,
    dashboard,
    devices,
    estimates,
    files,
    forms,
    gift_cards,
    invoices,
    messaging,
    onboarding,
    orders,
    packages,
    payments,
    payouts,
    reports,
    reviews,
    staff,
    subscriptions,
    tax,
    terminal,
)

api_router = APIRouter(prefix="/v1")
api_router.include_router(clients.router)
api_router.include_router(business.router)
api_router.include_router(catalog.router)
api_router.include_router(bookings.router)
api_router.include_router(invoices.router)
api_router.include_router(estimates.router)
api_router.include_router(payments.router)
api_router.include_router(payments.pay_router)
api_router.include_router(orders.router)
api_router.include_router(terminal.router)
api_router.include_router(payouts.router)
api_router.include_router(gift_cards.router)
api_router.include_router(packages.router)
api_router.include_router(subscriptions.router)
api_router.include_router(tax.router)
api_router.include_router(onboarding.router)
api_router.include_router(staff.router)
api_router.include_router(dashboard.router)
api_router.include_router(devices.router)
api_router.include_router(reports.router)
api_router.include_router(reviews.router)
api_router.include_router(messaging.router)
api_router.include_router(forms.router)
api_router.include_router(contracts.router)
api_router.include_router(files.router)
