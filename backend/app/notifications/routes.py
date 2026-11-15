"""Authenticated accounts manage and test only their own destinations."""
import re
from sqlalchemy.exc import IntegrityError
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from app.auth.dependencies import get_current_user
from app.auth.audit import log_action
from app.notifications import service as notification
import app.notifications.repository as targets

router = APIRouter(prefix="/notifications", dependencies=[Depends(get_current_user)])
Kind = Literal["accounts", "groups"]


class TargetBody(BaseModel):
    channel: Literal["zalo", "telegram"]
    friendlyName: str = Field(min_length=1, max_length=120)
    chatId: str = Field(min_length=1, max_length=128)
    active: bool = True

    @model_validator(mode="after")
    def validate_fields(self):
        self.friendlyName = self.friendlyName.strip()
        self.chatId = self.chatId.strip()
        if not self.friendlyName or not self.chatId or any(c.isspace() for c in self.chatId):
            raise ValueError("Name and chat ID are required; chat ID must not contain spaces")
        if self.channel == "telegram" and not re.fullmatch(r"-?\d{5,20}|@[A-Za-z0-9_]{5,64}", self.chatId):
            raise ValueError("Invalid Telegram chat ID")
        return self


@router.get("/{kind}")
def list_recipients(kind: Kind, current_user=Depends(get_current_user)):
    return {kind: targets.list_targets(kind, owner_user_id=current_user.id)}


def persist(kind, body, target_id, current_user):
    try:
        result = targets.save_target(kind, body, target_id, owner_user_id=current_user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Recipient not found") from exc
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="This channel/chat ID is already saved") from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    log_action(current_user, "app.notifications.service.recipient.save", result["id"])
    return result


@router.post("/{kind}", status_code=201)
def create_recipient(kind: Kind, body: TargetBody, current_user=Depends(get_current_user)):
    return persist(kind, body, None, current_user)


@router.put("/{kind}/{target_id}")
def update_recipient(kind: Kind, target_id: str, body: TargetBody, current_user=Depends(get_current_user)):
    return persist(kind, body, target_id, current_user)


@router.delete("/{kind}/{target_id}")
def delete_recipient(kind: Kind, target_id: str, current_user=Depends(get_current_user)):
    try:
        targets.delete_target(kind, target_id, owner_user_id=current_user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Recipient not found") from exc
    log_action(current_user, "app.notifications.service.recipient.delete", target_id)
    return {"status": "ok"}


@router.post("/{kind}/{target_id}/test")
def test_recipient(kind: Kind, target_id: str, current_user=Depends(get_current_user)):
    target = next((item for item in targets.list_targets(kind, owner_user_id=current_user.id) if item["id"] == target_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail="Recipient not found")
    if not target["active"]:
        raise HTTPException(status_code=409, detail="Enable this recipient before testing")
    details = {}
    sender = notification.send_zalo if target["channel"] == "zalo" else notification.send_telegram
    ok = sender("[TEST FIREGUARD — KHÔNG PHẢI BÁO CHÁY]\nNotification destination test.",
                chat_id=target["chatId"], details=details, request_attempts=1)
    log_action(current_user, "app.notifications.service.recipient.test", target_id)
    return {"status": "sent" if ok else "failed", **details}
