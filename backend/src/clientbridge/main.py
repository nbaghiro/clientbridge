from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from clientbridge.api.admin import router as admin_router
from clientbridge.api.public import (
    booking_router,
    contract_router,
    estimate_router,
    form_router,
    manage_router,
    media_router,
    pay_router,
    payment_setup_router,
    prefs_router,
    receipt_router,
    review_router,
)
from clientbridge.api.public_orders import router as public_orders_router
from clientbridge.api.returning import router as returning_router
from clientbridge.api.router import api_router
from clientbridge.api.site import router as site_router
from clientbridge.api.webhooks import router as webhooks_router
from clientbridge.core.config import get_settings
from clientbridge.core.cors import SplitCors
from clientbridge.core.db import engine
from clientbridge.core.errors import (
    AppError,
    UnhandledErrors,
    app_error_handler,
    validation_error_handler,
)
from clientbridge.core.logs import RequestLog, configure_logging
from clientbridge.core.uploads import UploadSizeLimit
from clientbridge.integrations.http import close_http_client, start_http_client
from clientbridge.services.health import unready_dependencies
from clientbridge.sync import router as sync_router


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    configure_logging(get_settings().env)
    start_http_client()
    try:
        yield
    finally:
        await close_http_client()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Clientbridge API", version="0.1.0", lifespan=lifespan)
    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_middleware(UnhandledErrors)  # added first, so it runs inside CORS

    app.add_middleware(UploadSizeLimit)

    app.add_middleware(SplitCors, settings=settings)
    app.add_middleware(RequestLog)  # outermost, so the logged status is the one sent

    async def health() -> dict[str, object]:
        return {"status": "ok", "env": settings.env}

    async def ready() -> JSONResponse:
        failed = await unready_dependencies(engine, get_settings().redis_url)
        if failed:
            return JSONResponse({"status": "unavailable", "failed": failed}, status_code=503)
        return JSONResponse({"status": "ready"})

    app.add_api_route("/health", health, methods=["GET"])
    app.add_api_route("/ready", ready, methods=["GET"])

    app.include_router(sync_router)
    # Public surfaces: unauthenticated, checked by signature, token or slug instead.
    app.include_router(site_router)
    app.include_router(webhooks_router)
    app.include_router(pay_router)
    app.include_router(payment_setup_router)
    app.include_router(estimate_router)
    app.include_router(receipt_router)
    app.include_router(public_orders_router)
    app.include_router(review_router)
    app.include_router(form_router)
    app.include_router(contract_router)
    app.include_router(booking_router)
    app.include_router(returning_router)
    app.include_router(manage_router)
    app.include_router(media_router)
    app.include_router(prefs_router)
    app.include_router(api_router)
    app.include_router(admin_router)
    return app


app = create_app()
