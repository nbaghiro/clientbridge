from fastapi import FastAPI

from clientbridge.core.config import get_settings
from clientbridge.core.errors import AppError, app_error_handler


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Clientbridge API", version="0.1.0")
    app.add_exception_handler(AppError, app_error_handler)

    @app.get("/health")
    async def health() -> dict[str, object]:
        return {"status": "ok", "env": settings.env}

    # Routers are mounted here as domains land:
    # from clientbridge.api.router import api_router
    # app.include_router(api_router, prefix="/v1")
    return app


app = create_app()
