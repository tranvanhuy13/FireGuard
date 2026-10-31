from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from typing import Literal
from auth.dependencies import get_current_user, get_db, require_admin, validate_account
from auth.audit import log_action
from .schemas import User
from .models import User as UserModel

router = APIRouter()

@router.get("/me", response_model=User)
def read_users_me(current_user: UserModel = Depends(get_current_user)):
    return current_user


def public_user(row):
    return {"id": str(row["id"]), "username": row["username"], "name": row["username"],
            "email": row["email"], "role": row["role"], "is_active": bool(row["is_active"]),
            "status": "blocked" if row["is_blocked"] else "active" if row["is_active"] else "pending"}


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
        log_action(admin, "user.update", f"user:{target["username"]}")
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
