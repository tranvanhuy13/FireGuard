"""Authenticate uploads before FastAPI parses or spools their multipart body."""
from contextlib import closing

from fastapi import HTTPException, Request
from fastapi.routing import APIRoute
from starlette.concurrency import run_in_threadpool

from .database import get_connection
from .dependencies import get_current_user, security


class AuthenticatedUploadRoute(APIRoute):
    def get_route_handler(self):
        handle = super().get_route_handler()

        async def authenticated(request: Request):
            # HTTPBasic reads headers only. Password/DB work stays off the event loop.
            credentials = await security(request)

            def authenticate():
                with closing(get_connection()) as db:
                    return get_current_user(db=db, credentials=credentials)

            request.state.upload_user = await run_in_threadpool(authenticate)
            return await handle(request)

        return authenticated


def get_upload_user(request: Request):
    user = getattr(request.state, "upload_user", None)
    if user is None:
        raise HTTPException(status_code=401, detail="Upload authentication required")
    return user
