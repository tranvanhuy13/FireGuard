import logging
from fastapi import APIRouter, Depends
from app.auth.dependencies import get_current_user, require_admin
from app.notifications import service as notification

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/test-notification", dependencies=[Depends(require_admin)])
def test_notification(current_user=Depends(get_current_user)):
    """Trigger a test notification."""
    results = notification.trigger_notifications("TEST EVENT", 0.99, None, bypass_cooldown=True, owner_user_id=current_user.id)
    results = results if isinstance(results, dict) else {}
    sent = sum(result.get("status") == "sent" for result in results.values())
    status = "ok" if results and sent == len(results) else "partial" if sent else "error"
    return {"status": status, "channels": results,
            "message": "Test notification sent" if status == "ok" else
                       "Some channels did not send; check per-channel outcomes" if status == "partial" else
                       "No notification sent; check enabled channels, credentials and recipients"}
