from fastapi import APIRouter

from clientbridge.api import (
    auth,
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
    hours,
    messaging,
    notes,
    notifications,
    orders,
    payments,
    plans,
    reports,
    reviews,
    staff,
    subjects,
    tax,
    zones,
)
from clientbridge.api.plans import PlanWritable

api_router = APIRouter(prefix="/v1")
# routers without PlanWritable stay writable for a lapsed business; staff routes gate themselves
api_router.include_router(plans.router)
api_router.include_router(auth.router)
api_router.include_router(clients.router, dependencies=[PlanWritable])
api_router.include_router(subjects.router, dependencies=[PlanWritable])
api_router.include_router(notes.router, dependencies=[PlanWritable])
api_router.include_router(consents.router, dependencies=[PlanWritable])
api_router.include_router(business.business_router, dependencies=[PlanWritable])
api_router.include_router(catalog.router, dependencies=[PlanWritable])
api_router.include_router(bookings.router, dependencies=[PlanWritable])
api_router.include_router(bookings.recurrences_router, dependencies=[PlanWritable])
api_router.include_router(bookings.time_off_router, dependencies=[PlanWritable])
api_router.include_router(bookings.classes_router, dependencies=[PlanWritable])
api_router.include_router(bookings.online_router, dependencies=[PlanWritable])
api_router.include_router(billing.invoices_router, dependencies=[PlanWritable])
api_router.include_router(earnings.router, dependencies=[PlanWritable])
api_router.include_router(billing.estimates_router, dependencies=[PlanWritable])
api_router.include_router(payments.connect_router, dependencies=[PlanWritable])
api_router.include_router(payments.payments_router, dependencies=[PlanWritable])
api_router.include_router(orders.router, dependencies=[PlanWritable])
api_router.include_router(payments.terminal_router, dependencies=[PlanWritable])
api_router.include_router(entitlements.gift_cards_router, dependencies=[PlanWritable])
api_router.include_router(entitlements.packages_router, dependencies=[PlanWritable])
api_router.include_router(entitlements.subscriptions_router, dependencies=[PlanWritable])
api_router.include_router(tax.router, dependencies=[PlanWritable])
api_router.include_router(business.onboarding_router)
api_router.include_router(staff.router)
api_router.include_router(hours.router, dependencies=[PlanWritable])
api_router.include_router(reports.dashboard_router, dependencies=[PlanWritable])
api_router.include_router(notifications.router)
api_router.include_router(reports.reports_router, dependencies=[PlanWritable])
api_router.include_router(reviews.router, dependencies=[PlanWritable])
api_router.include_router(messaging.router, dependencies=[PlanWritable])
api_router.include_router(forms.router, dependencies=[PlanWritable])
api_router.include_router(contracts.router, dependencies=[PlanWritable])
api_router.include_router(contracts.signatures_router, dependencies=[PlanWritable])
api_router.include_router(files.router, dependencies=[PlanWritable])
api_router.include_router(zones.router)
