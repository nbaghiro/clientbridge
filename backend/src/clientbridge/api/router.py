"""Mounts all versioned API routers under /v1. Domain routers are added here as they land."""

from fastapi import APIRouter

from clientbridge.api.v1 import clients, onboarding, staff

api_router = APIRouter(prefix="/v1")
api_router.include_router(clients.router)
api_router.include_router(onboarding.router)
api_router.include_router(staff.router)
