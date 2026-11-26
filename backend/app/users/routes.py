import re
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from typing import Literal
from app.auth.dependencies import get_current_user, get_db, require_admin, validate_account
from app.auth.audit import log_action
from app.auth.routes import validate_password
from app.auth.utils import verify_password, get_password_hash
from .schemas import User, ProfileUpdate, ChangePasswordRequest
from .models import User as UserModel

router = APIRouter()

@router.get("/me")
def read_users_me(current_user: UserModel = Depends(get_current_user)):
    name = current_user.full_name or current_user.username
    return {
        "id": current_user.id,
        "username": current_user.username,
        "email": current_user.email,
        "role": current_user.role,
        "is_active": bool(current_user.is_active),
        "full_name": current_user.full_name or "",
        "fullName": name,
        "phone": current_user.phone or "",
        "avatar_url": current_user.avatar_url or "",
        "avatarUrl": current_user.avatar_url or "",
    }


@router.put("/me")
@router.patch("/me")
def update_users_me(update: ProfileUpdate, current_user: UserModel = Depends(get_current_user), db=Depends(get_db)):
    full_name = update.full_name if update.full_name is not None else update.fullName
    if full_name is None:
        full_name = current_user.full_name
    else:
        full_name = full_name.strip()

    phone = update.phone if update.phone is not None else current_user.phone
    if phone is not None:
        phone = phone.strip()
    if phone:
        if not re.fullmatch(r"[0-9]{9,11}", phone):
            raise HTTPException(status_code=400, detail="Số điện thoại không hợp lệ (9-11 chữ số)")

    avatar_url = update.avatar_url if update.avatar_url is not None else update.avatarUrl
    if avatar_url is None:
        avatar_url = current_user.avatar_url

    db.execute(
        "UPDATE users SET full_name = ?, phone = ?, avatar_url = ? WHERE id = ?",
        (full_name, phone, avatar_url, current_user.id)
    )
    db.commit()

    name = full_name or current_user.username
    return {
        "id": current_user.id,
        "username": current_user.username,
        "email": current_user.email,
        "role": current_user.role,
        "is_active": bool(current_user.is_active),
        "full_name": full_name or "",
        "fullName": name,
        "phone": phone or "",
        "avatar_url": avatar_url or "",
        "avatarUrl": avatar_url or "",
        "message": "Profile updated successfully",
    }


@router.post("/change-password")
@router.put("/me/password")
def change_password(body: ChangePasswordRequest, current_user: UserModel = Depends(get_current_user), db=Depends(get_db)):
    current_pwd = body.current_password or body.currentPassword or body.password
    new_pwd = body.new_password or body.newPassword

    if not current_pwd:
        raise HTTPException(status_code=400, detail="Vui lòng nhập mật khẩu hiện tại")
    if not new_pwd:
        raise HTTPException(status_code=400, detail="Vui lòng nhập mật khẩu mới")

    if not verify_password(current_pwd, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Mật khẩu hiện tại không chính xác")

    validate_password(new_pwd)

    if verify_password(new_pwd, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Mật khẩu mới không được trùng mật khẩu cũ")

    new_hash = get_password_hash(new_pwd)
    db.execute("UPDATE users SET hashed_password = ? WHERE id = ?", (new_hash, current_user.id))
    db.commit()
    log_action(current_user, "user.password_change", f"user:{current_user.username}")

    return {"message": "Password changed successfully"}


def public_user(row):
    full_name = row.get("full_name") or ""
    return {
        "id": str(row["id"]),
        "username": row["username"],
        "name": full_name or row["username"],
        "email": row["email"],
        "role": row["role"],
        "is_active": bool(row["is_active"]),
        "status": "blocked" if row["is_blocked"] else "active" if row["is_active"] else "pending",
        "full_name": full_name,
        "fullName": full_name or row["username"],
        "phone": row.get("phone") or "",
        "avatar_url": row.get("avatar_url") or "",
        "avatarUrl": row.get("avatar_url") or "",
    }


@router.get("", dependencies=[Depends(require_admin)])
def list_users(db=Depends(get_db)):
    return {"users": [public_user(row) for row in db.execute("SELECT * FROM users ORDER BY id")]}


class UserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["user", "admin"] | None = None
    status: Literal["active", "blocked"] | None = None


@router.put("/{user_id}")
def update_user(user_id: int, update: UserUpdate, admin=Depends(require_admin), db=Depends(get_db)):
    try:
        db.begin_serialized()
        actor = db.execute("SELECT * FROM users WHERE id=?", (admin.id,)).fetchone()
        if actor is None or actor["role"] != "admin":
            raise HTTPException(status_code=403, detail="Admin permission required")
        validate_account(UserModel(**dict(actor)))
        target = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if target is None:
            raise HTTPException(status_code=404, detail="User not found")
        role = update.role or target["role"]
        blocked = update.status == "blocked" if update.status else bool(target["is_blocked"])
        if user_id == admin.id and (role != target["role"] or blocked):
            raise HTTPException(status_code=403, detail="Cannot change your own role or block yourself")
        if update.status == "active" and not target["is_active"]:
            raise HTTPException(status_code=409, detail="Account must verify its email first")
        count = db.execute("SELECT count(*) FROM users WHERE role='admin' AND is_active=1 AND is_blocked=0").fetchone()[0]
        if target["role"] == "admin" and target["is_active"] and not target["is_blocked"] and count <= 1 and (role != "admin" or blocked):
            raise HTTPException(status_code=409, detail="Cannot remove the last active admin")
        db.execute("UPDATE users SET role=?, is_blocked=? WHERE id=?", (role, blocked, user_id))
        result = public_user(db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone())
        db.commit()
        log_action(admin, "user.update", f"user:{target['username']}")
        return result
    except Exception:
        db.rollback()
        raise


class RoleUpdate(BaseModel):
    role: Literal["user", "admin"]


@router.put("/{user_id}/role", response_model=User)
def set_user_role(user_id: int, body: RoleUpdate, db=Depends(get_db), admin=Depends(require_admin)):
    """Compatibility route for clients of the earlier authorization branch."""
    return update_user(user_id, UserUpdate(role=body.role), admin, db)
