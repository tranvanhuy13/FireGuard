import asyncio
from unittest.mock import AsyncMock

import pytest
from starlette.formparsers import MultiPartException
from auth.upload import UploadLimitMiddleware


def test_chunked_upload_is_stopped_at_limit_and_releases_slot():
    async def scenario():
        async def consume(scope, receive, send):
            await receive()
            await receive()
            raise AssertionError("must never consume the remainder")
        middleware = UploadLimitMiddleware(consume, max_bytes=5, max_concurrent=1)
        receive = AsyncMock(side_effect=[{"type": "http.request", "body": b"1234", "more_body": True},
                                        {"type": "http.request", "body": b"5678", "more_body": True}])
        scope = {"type": "http", "method": "POST", "path": "/video-analysis", "headers": []}
        with pytest.raises(MultiPartException):
            await middleware(scope, receive, AsyncMock())
        assert receive.await_count == 2
        assert middleware.slots.acquire(blocking=False)
        middleware.slots.release()
    asyncio.run(scenario())


def test_mid_multipart_rejection_returns_413_and_closes_partial_file():
    import tempfile
    from unittest.mock import patch
    from fastapi import FastAPI, File, UploadFile

    async def scenario():
        app = FastAPI()
        app.add_middleware(UploadLimitMiddleware, max_bytes=200)

        @app.post("/video-analysis")
        async def upload(file: UploadFile = File(...)):
            raise AssertionError("oversized upload must not reach the endpoint")

        opened = []
        original = tempfile.SpooledTemporaryFile
        def spool(*args, **kwargs):
            file = original(*args, **kwargs)
            opened.append(file)
            return file
        receive = AsyncMock(side_effect=[
            {"type": "http.request", "body": b'--x\r\nContent-Disposition: form-data; name="file"; filename="x.mp4"\r\n\r\n1234', "more_body": True},
            {"type": "http.request", "body": b"x" * 250, "more_body": True}])
        send = AsyncMock()
        scope = {"type": "http", "method": "POST", "path": "/video-analysis", "query_string": b"",
                 "headers": [(b"content-type", b"multipart/form-data; boundary=x")], "scheme": "http"}
        with patch("starlette.formparsers.SpooledTemporaryFile", side_effect=spool):
            await app(scope, receive, send)
        assert send.call_args_list[0].args[0]["status"] == 413
        assert opened and all(file.closed for file in opened)
    asyncio.run(scenario())


def test_oversized_content_length_rejected_without_body_read():
    async def scenario():
        app, receive, send = AsyncMock(), AsyncMock(), AsyncMock()
        scope = {"type": "http", "method": "POST", "path": "/video-analysis",
                 "headers": [(b"content-length", b"100")]}
        await UploadLimitMiddleware(app, max_bytes=5)(scope, receive, send)
        assert send.call_args_list[0].args[0]["status"] == 413
        receive.assert_not_awaited()
        app.assert_not_awaited()
    asyncio.run(scenario())
