from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class AppError(Exception):
    status_code = 400
    code = "app_error"

    def __init__(
        self, message: str, *, code: str | None = None, status_code: int | None = None
    ) -> None:
        self.message = message
        if code:
            self.code = code
        if status_code:
            self.status_code = status_code
        super().__init__(message)


class NotFound(AppError):
    status_code = 404
    code = "not_found"


class Forbidden(AppError):
    status_code = 403
    code = "forbidden"


class Unauthorized(AppError):
    status_code = 401
    code = "unauthorized"


class Conflict(AppError):
    status_code = 409
    code = "conflict"


class Unprocessable(AppError):
    status_code = 422
    code = "unprocessable"


class CardDeclined(AppError):
    status_code = 402
    code = "card_declined"


class PaymentActionRequired(AppError):
    status_code = 402
    code = "payment_action_required"


class PaymentsNotConfigured(AppError):
    status_code = 503
    code = "payments_not_configured"


class TooManyRequests(AppError):
    status_code = 429
    code = "too_many_requests"


async def app_error_handler(_: Request, exc: Exception) -> JSONResponse:
    # Registered only for AppError; the signature matches Starlette's expected handler type.
    if not isinstance(exc, AppError):
        raise exc
    return JSONResponse(
        status_code=exc.status_code, content={"error": exc.code, "message": exc.message}
    )


class UnhandledErrors:
    """Answer an unhandled exception inside CORS so the browser can read the 500, then re-raise."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = False

        async def tracked(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, tracked)
        except Exception:
            if not started:
                response = JSONResponse(
                    status_code=500,
                    content={"error": "internal_error", "message": "something went wrong"},
                )
                await response(scope, receive, send)
            raise
