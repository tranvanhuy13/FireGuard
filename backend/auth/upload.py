"""Authenticate uploads before FastAPI parses or spools their multipart body."""
from contextlib import closing
import threading

from fastapi import HTTPException, Request
from fastapi.routing import APIRoute
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse
from starlette.formparsers import MultiPartException

from .database import get_connection
from .dependencies import get_current_user, security


class UploadLimitMiddleware:
    """Bound bytes actually received and concurrent multipart parsing before spooling."""
    def __init__(self, app, max_bytes, max_concurrent=2):
        self.app = app
        self.max_bytes = max_bytes
        self.slots = threading.BoundedSemaphore(max_concurrent)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "POST" or scope["path"] != "/video-analysis":
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers", []))
        try:
            length = int(headers.get(b"content-length", b"0"))
            if length < 0:
                raise ValueError()
        except ValueError:
            return await JSONResponse({"detail": "Invalid Content-Length"}, status_code=400)(scope, receive, send)
        if length > self.max_bytes:
            return await JSONResponse({"detail": "Upload body too large"}, status_code=413)(scope, receive, send)
        if not self.slots.acquire(blocking=False):
            return await JSONResponse({"detail": "Too many concurrent uploads"}, status_code=429,
                                      headers={"Retry-After": "5"})(scope, receive, send)
        received = 0
        exceeded = False

        async def limited_receive():
            nonlocal received, exceeded
            message = await receive()
            received += len(message.get("body", b""))
            if received > self.max_bytes:
                exceeded = True
                # The multipart parser closes partially-spooled files on this exception.
                raise MultiPartException("Upload body too large")
            return message

        async def limited_send(message):
            if exceeded and message["type"] == "http.response.start":
                message = {**message, "status": 413}
            await send(message)

        try:
            await self.app(scope, limited_receive, limited_send)
        finally:
            self.slots.release()


class AuthenticatedUploadRoute(APIRoute):
    def get_route_handler(self):
        handle = super().get_route_handler()

        async def authenticated(request: Request):
            # HTTPBasic reads headers only. Password/DB work stays off the event loop.
            credentials = await security(request)

            def authenticate():
                with closing(get_connection()) as db:
                    return get_current_user(request=request, db=db, credentials=credentials)

            request.state.upload_user = await run_in_threadpool(authenticate)
            return await handle(request)

        return authenticated


def get_upload_user(request: Request):
    user = getattr(request.state, "upload_user", None)
    if user is None:
        raise HTTPException(status_code=401, detail="Upload authentication required")
    return user
