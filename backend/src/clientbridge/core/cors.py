from starlette.datastructures import Headers
from starlette.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

from clientbridge.core.config import Settings

# response headers the clients read beyond the CORS-safelisted ones
EXPOSED = ["Retry-After"]


class SplitCors:
    """Credentialed CORS for the staff web app only; Connect and Pay get CORS without the cookie."""

    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app_origins = frozenset(settings.app_origins())
        self.credentialed = CORSMiddleware(
            app,
            allow_origins=list(self.app_origins),
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=EXPOSED,
        )
        self.public = CORSMiddleware(
            app,
            allow_origins=[o for o in settings.allowed_origins() if o not in self.app_origins],
            allow_origin_regex=settings.allowed_origin_regex(),
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=EXPOSED,
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        origin = Headers(scope=scope).get("origin") if scope["type"] == "http" else None
        handler = self.credentialed if origin in self.app_origins else self.public
        await handler(scope, receive, send)
