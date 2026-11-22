"""Response-header timings for the two list APIs, without logging private filters."""
from time import perf_counter


class ListTimingMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("path") not in ("/history", "/audit-log"):
            return await self.app(scope, receive, send)
        started = perf_counter()

        async def timed_send(message):
            if message["type"] == "http.response.start":
                elapsed = (perf_counter() - started) * 1000
                auth = scope.get("state", {}).get("auth_ms", 0)
                headers = list(message.get("headers", []))
                headers.append((b"server-timing", f"auth;dur={auth:.1f}, app;dur={elapsed:.1f}".encode()))
                headers.append((b"cache-control", b"no-store"))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, timed_send)
