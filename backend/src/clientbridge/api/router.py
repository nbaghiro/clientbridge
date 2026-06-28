"""Mounts all versioned API routers under /v1. Domain routers are added here as they land."""

from fastapi import APIRouter

from clientbridge.api.v1 import (
    bookings,
    catalog,
    clients,
    dashboard,
    devices,
    estimates,
    invoices,
    onboarding,
    payments,
    staff,
    tax,
)

api_router = APIRouter(prefix="/v1")
api_router.include_router(clients.router)
api_router.include_router(catalog.router)
api_router.include_router(bookings.router)
api_router.include_router(invoices.router)
api_router.include_router(estimates.router)
api_router.include_router(payments.router)
api_router.include_router(payments.pay_router)
api_router.include_router(tax.router)
api_router.include_router(onboarding.router)
api_router.include_router(staff.router)
api_router.include_router(dashboard.router)
api_router.include_router(devices.router)
