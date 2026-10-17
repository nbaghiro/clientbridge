import json
import logging
import sys
import time
from datetime import UTC, datetime

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from clientbridge.core.config import Environment

_STANDARD = frozenset(logging.makeLogRecord({}).__dict__) | {"message", "asctime", "taskName"}
# servers that install their own handlers; their records go through ours instead
_SERVER_LOGGERS = ("uvicorn", "uvicorn.error", "uvicorn.access", "arq")
requests_log = logging.getLogger("clientbridge.requests")


class JsonFormatter(logging.Formatter):
    """One JSON object per line, with the record's `extra` fields alongside the standard ones."""

    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, object] = {
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "severity": record.levelname,  # the field Cloud Logging reads the level from
            "logger": record.name,
            "message": record.getMessage(),
        }
        entry.update({k: v for k, v in record.__dict__.items() if k not in _STANDARD})
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
            # the field Error Reporting groups errors by
            entry["stack_trace"] = entry["exception"]
        return json.dumps(entry, default=str)


def configure_logging(env: Environment) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
        if env == "dev"
        else JsonFormatter()
    )
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)
    for name in _SERVER_LOGGERS:
        server = logging.getLogger(name)
        server.handlers.clear()
        server.propagate = True
    logging.getLogger("uvicorn.access").disabled = True  # the request log below replaces it


class RequestLog:
    """Log each HTTP request's method, route, status and duration once it finishes."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = time.perf_counter()
        status = 500

        async def tracked(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, tracked)
        finally:
            route = scope.get("route")
            requests_log.info(
                "request",
                extra={
                    "method": scope["method"],
                    # the route template, so tokens in public paths stay out of the logs
                    "path": getattr(route, "path", scope["path"]),
                    "status": status,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                },
            )
