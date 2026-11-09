import asyncio
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
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
        with pytest.raises(HTTPException) as caught:
            await middleware(scope, receive, AsyncMock())
        assert caught.value.status_code == 413
        assert receive.await_count == 2
        assert middleware.slots.acquire(blocking=False)
        middleware.slots.release()
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
