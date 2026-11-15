"""Authenticated event history and incident handling contract."""
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from app.auth.dependencies import get_current_user
from app.auth.audit import log_action
from app.db.repositories import operations as database

router = APIRouter(dependencies=[Depends(get_current_user)])


class EventStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["new", "confirmed", "false_alarm"]


@router.patch("/alerts/{event_id}/status")
def update_status(event_id: int, body: EventStatus, user=Depends(get_current_user)):
    if not database.update_event_status(event_id, body.status, user.username, owner_user_id=user.id):
        raise HTTPException(status_code=404, detail="Alert not found")
    log_action(user, "alert.status", f"alert:{event_id}", body.status)
    return {"status": body.status, "handled_by": user.username}


@router.get("/history")
def history(limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0),
            search: str = Query("", max_length=255),
            event_type: Literal["all", "fire", "smoke"] = "all",
            status: Literal["all", "new", "confirmed", "false_alarm"] = "all",
            sort: Literal["timestamp", "camera_id", "type", "confidence", "status", "id"] = "timestamp",
            direction: Literal["asc", "desc"] = "desc", max_id: int | None = Query(None, ge=0),
            user=Depends(get_current_user)):
    return database.search_events(limit, offset, search=search, event_type=event_type, status=status,
                                  sort=sort, direction=direction, max_id=max_id, owner_user_id=user.id)


@router.get("/alerts")
def get_alerts(current_user=Depends(get_current_user)):
    events = database.get_recent_events(limit=50, owner_user_id=current_user.id)
    formatted_alerts = []
    for event in events:
        formatted_alerts.append({
            "id": event["id"],
            "timestamp": event["timestamp"],
            "type": event["type"],
            "confidence": event["confidence"],
            "snapshot": event["snapshot_path"],
            "status": event["status"],
            "handled_by": event.get("handled_by"),
            "camera_id": event.get("camera_id"),
            "camera_name": event.get("camera_name"),
            "source_kind": event.get("source_kind", "camera"),
            "video_name": event.get("video_name"), "video_time": event.get("video_time"),
            "video_job_id": event.get("video_job_id"),
        })
    return {"alerts": formatted_alerts}

@router.get("/stats")
def get_stats(current_user=Depends(get_current_user)):
    """Get daily event statistics."""
    return {"stats": database.get_daily_stats(owner_user_id=current_user.id)}
