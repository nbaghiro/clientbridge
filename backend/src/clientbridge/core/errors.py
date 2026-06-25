from fastapi import Request
from fastapi.responses import JSONResponse


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


async def app_error_handler(_: Request, exc: Exception) -> JSONResponse:
    # Registered only for AppError; the signature matches Starlette's expected handler type.
    if not isinstance(exc, AppError):
        raise exc
    return JSONResponse(
        status_code=exc.status_code, content={"error": exc.code, "message": exc.message}
    )
