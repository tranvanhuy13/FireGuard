import logging
import math
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.auth.dependencies import get_current_user
from app.detection.rules import read_settings
from app.db.repositories import operations as database
from app.notifications import service as notification

logger = logging.getLogger(__name__)
router = APIRouter()


class SettingsModel(BaseModel):
    key: str
    value: str


@router.get("/settings")
def get_settings(current_user=Depends(get_current_user)):
    """Get all settings (masking secrets)."""
    if current_user.role != "admin":
        return {"settings": {"alarm_sound_enabled": database.get_setting("alarm_sound_enabled", "true")}}
    settings = database.get_all_settings()
    effective = read_settings(database.get_setting)
    settings.update(fire_threshold=str(effective["fire"] * 100),
                    smoke_threshold=str(effective["smoke"] * 100),
                    persistence=str(effective["persistence"]), cooldown=str(effective["cooldown"]))
    masked_keys = ["zalo_bot_token", "zalo_oa_access_token", "zalo_oa_refresh_token",
                   "zalo_oa_secret_key", "telegram_bot_token"]
    for key in masked_keys:
        if key in settings and settings[key]:
            settings[key] = "********"
    bot_settings, bot_status = notification.configuration_status(current_user.id)
    settings.update(bot_settings)
    return {"settings": settings, "notification_status": bot_status}


@router.post("/settings")
def save_setting(setting: SettingsModel, current_user=Depends(get_current_user)):
    """Save a setting."""
    if current_user.role != "admin" and setting.key != "alarm_sound_enabled":
        raise HTTPException(status_code=403, detail="Admin permission required")
    if setting.value == "********":      # never save the masked placeholder back
        return {"status": "skipped", "message": "Masked value ignored"}
    bounds = {"fire_threshold": (0, 100), "smoke_threshold": (0, 100),
              "persistence": (1, 30), "cooldown": (0, 3600),
              "ai_confidence_threshold": (0, 1), "ai_persistence_frames": (1, 30),
              "ai_cooldown_seconds": (0, 3600)}
    if setting.key in bounds:
        try:
            value = float(setting.value)
            low, high = bounds[setting.key]
            if not math.isfinite(value) or not low <= value <= high:
                raise ValueError()
            if setting.key in ("persistence", "ai_persistence_frames") and not value.is_integer():
                raise ValueError()
        except ValueError as error:
            raise HTTPException(status_code=400, detail=f"Invalid value for {setting.key}") from error
    database.set_setting(setting.key, setting.value)
    return {"status": "ok", "message": "Setting saved"}
