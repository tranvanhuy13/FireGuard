from typing import List
from fastapi import APIRouter, Depends, HTTPException
from auth.audit import log_action
from auth.dependencies import get_current_user, get_db, require_admin
from .schemas import User, RoleUpdate

router = APIRouter()


@router.get("/me", response_model=User)
def read_users_me(current_user=Depends(get_current_user)):
    return current_user


@router.get("", response_model=List[User])
def list_users(db=Depends(get_db), admin=Depends(require_admin)):
    rows = db.execute(
        "SELECT id, username, email, is_active, role FROM users ORDER BY id"
    ).fetchall()
    return [dict(r) for r in rows]


@router.put("/{user_id}/role", response_model=User)
def set_user_role(user_id: int, body: RoleUpdate, db=Depends(get_db), admin=Depends(require_admin)):
    if user_id == admin.id:
        # đồng thời đảm bảo luôn còn ít nhất 1 admin
        raise HTTPException(status_code=400, detail="You cannot change your own role")
    row = db.execute(
        "SELECT id, username, email, is_active, role FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="User not found")
    db.execute("UPDATE users SET role = ? WHERE id = ?", (body.role, user_id))
    db.commit()
    log_action(admin, "user.role_change", f"user:{row['username']}", f"{row['role']} -> {body.role}")
    return {**dict(row), "role": body.role}