from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class NoStoreByDefault:
    """Keep responses out of browser caches unless a route chose its own caching."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def stamped(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                # an offline browser may replay a cached /v1/me and skip the offline-access expiry
                headers.setdefault("Cache-Control", "no-store")
            await send(message)

        await self.app(scope, receive, stamped)
