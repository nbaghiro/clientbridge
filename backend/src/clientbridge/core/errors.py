import logging
from collections.abc import Mapping

import stripe
from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class AppError(Exception):
    status_code = 400
    code = "app_error"

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        status_code: int | None = None,
        detail: Mapping[str, object] | None = None,
    ) -> None:
        self.message = message
        self.detail = detail
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


class UnsupportedCurrency(AppError):
    status_code = 422
    code = "unsupported_currency"


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
    content: dict[str, object] = {"error": exc.code, "message": exc.message}
    if exc.detail is not None:
        content["detail"] = jsonable_encoder(exc.detail)
    return JSONResponse(status_code=exc.status_code, content=content)


_stripe_log = logging.getLogger("clientbridge.stripe")

_STRIPE_CODES: Mapping[str, tuple[int, str, str]] = {
    "charge_disputed": (409, "payment_disputed", "the payment is disputed"),
    "amount_too_small": (422, "amount_too_small", "the amount is below the card minimum"),
}


def _stripe_failure(exc: stripe.StripeError) -> tuple[int, str, str]:
    if isinstance(exc, stripe.IdempotencyError):
        return 409, "idempotency_mismatch", "the retry differs from the original request"
    if isinstance(exc, stripe.CardError):
        return 402, "card_declined", "the card was declined"
    known = _STRIPE_CODES.get(exc.code or "")
    return known or (502, "payment_provider_error", "the payment provider refused the request")


async def stripe_error_handler(_: Request, exc: Exception) -> JSONResponse:
    # Stripe errors that escape the adapter answer with a stable code, never Stripe's own text.
    if not isinstance(exc, stripe.StripeError):
        raise exc
    status_code, code, message = _stripe_failure(exc)
    _stripe_log.warning(
        "stripe error %s (%s) on request %s answered as %s",
        exc.code,
        type(exc).__name__,
        exc.request_id,
        code,
    )
    return JSONResponse(status_code=status_code, content={"error": code, "message": message})


async def validation_error_handler(_: Request, exc: Exception) -> JSONResponse:
    # Every refused request names a stable code, so clients choose their message without the text.
    if not isinstance(exc, RequestValidationError):
        raise exc
    return JSONResponse(
        status_code=422,
        content={
            "error": "invalid_request",
            "message": "the request did not validate",
            "detail": jsonable_encoder(exc.errors()),
        },
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
