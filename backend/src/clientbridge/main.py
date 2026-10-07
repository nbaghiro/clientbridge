from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from clientbridge.api import auth as auth_api
from clientbridge.api.public import (
    booking_router,
    contract_router,
    form_router,
    manage_router,
    media_router,
    pay_router,
    review_router,
)
from clientbridge.api.router import api_router
from clientbridge.api.webhooks import router as webhooks_router
from clientbridge.core.config import get_settings
from clientbridge.core.errors import AppError, app_error_handler
from clientbridge.sync import router as sync_router


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Clientbridge API", version="0.1.0")
    app.add_exception_handler(AppError, app_error_handler)

    # Dev allows any localhost origin; prod allows the configured ones, including Connect.
    extra_origins = [o.strip() for o in settings.cors_allow_origins.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=extra_origins,
        allow_origin_regex=r"http://localhost:\d+" if settings.env == "dev" else None,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health() -> dict[str, object]:
        return {"status": "ok", "env": settings.env}

    app.include_router(auth_api.router)
    app.include_router(sync_router)
    # Public surfaces: unauthenticated, checked by signature, token or slug instead.
    app.include_router(webhooks_router)
    app.include_router(pay_router)
    app.include_router(review_router)
    app.include_router(form_router)
    app.include_router(contract_router)
    app.include_router(booking_router)
    app.include_router(manage_router)
    app.include_router(media_router)
    app.include_router(api_router)
    return app


app = create_app()
