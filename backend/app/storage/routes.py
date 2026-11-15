import json
import logging
import time
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response, RedirectResponse
from app.auth.dependencies import get_current_user
from app.auth.stream_tokens import require_snapshot_user
from app.storage import service as storage
from app.storage import evidence as evidence

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/snapshots/{name}")
def get_snapshot(name: str, current_user=Depends(require_snapshot_user)):
    # Worker credentials are scoped to this exact filename; account tokens also
    # require ownership. Unregistered legacy objects are never exposed.
    row = evidence.find(name)
    if row is None:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    if current_user is not None:
        evidence.require_snapshot(name, current_user.id)
    elif row["expires_at"] <= time.time() or row["deleted_at"] is not None:
        raise HTTPException(status_code=410, detail="Snapshot expired")
    url = storage.snapshot_public_url(name, expires_in=max(1, min(300, int(row["expires_at"] - time.time()))))
    if url:
        return RedirectResponse(url, headers={"Cache-Control": "no-store"})
    data = storage.read_snapshot(name)
    if data is None:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return Response(data, media_type="image/jpeg",
                    headers={"Cache-Control": "no-store"})


@router.get("/snapshot-access/{name}")
def snapshot_access(name: str, current_user=Depends(get_current_user)):
    url, ttl = storage.private_snapshot_url(name, current_user.id)
    return Response(content=json.dumps({"url": url, "expires_in": ttl}),
                    media_type="application/json", headers={"Cache-Control": "no-store"})
