from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from clientbridge.api.public import booking_router, contract_router, form_router, review_router
from clientbridge.api.public import router as public_router
from clientbridge.api.router import api_router
from clientbridge.api.v1 import auth as auth_api
from clientbridge.api.webhooks import router as webhooks_router
from clientbridge.core.config import get_settings
from clientbridge.core.errors import AppError, app_error_handler
from clientbridge.sync import router as sync_router


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Clientbridge API", version="0.1.0")
    app.add_exception_handler(AppError, app_error_handler)

    # Cross-origin callers: the web/Connect apps and Expo clients hit /sync/* and the public
    # surfaces from another origin. Dev allows any localhost port; prod allows the configured
    # origins (the Connect origin, so embedded widgets can reach the public API).
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
    app.include_router(webhooks_router)  # surface #4 (signature-verified, unauthenticated)
    app.include_router(public_router)  # surface #4 (pay-link token, unauthenticated)
    app.include_router(review_router)  # surface #4 (review token, unauthenticated)
    app.include_router(form_router)  # surface #4 (form token, unauthenticated)
    app.include_router(contract_router)  # surface #4 (sign token, unauthenticated)
    app.include_router(booking_router)  # surface #4 (booking-page slug, unauthenticated)
    app.include_router(api_router)  # /v1/* domain routers
    return app


app = create_app()
