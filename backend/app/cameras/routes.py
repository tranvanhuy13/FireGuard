import logging
from fastapi import APIRouter, Depends, HTTPException
from app.auth.dependencies import get_current_user
from app.cameras.schemas import CameraModel
from app.core.runtime import runtime

logger = logging.getLogger(__name__)
router = APIRouter()


def owned_camera(camera_id, user_id):
    camera = runtime.camera_manager.cameras.get(camera_id)
    if camera is None or camera.owner_user_id != user_id:
        raise HTTPException(status_code=404, detail="Camera not found")
    return camera


@router.get("/cameras")
def get_cameras(current_user=Depends(get_current_user)):
    """Get list of cameras with real-time status details."""
    cameras = []
    for id, cam in list(runtime.camera_manager.cameras.items()):
        if cam.owner_user_id != current_user.id:
            continue
        cameras.append({
            "id": id,
            "name": cam.name,
            "source": str(cam.source),
            "is_active": cam.is_active,
            "status": cam.status,
        })
    return {"cameras": cameras}


@router.post("/cameras")
def add_new_camera(cam: CameraModel, current_user=Depends(get_current_user)):
    """Add a new camera."""
    new_id = runtime.camera_manager.add_camera(cam.source, cam.name, cam.is_active, owner_user_id=current_user.id)
    return {"status": "ok", "id": new_id, "message": "Camera added"}


@router.delete("/cameras/{camera_id}")
def delete_camera(camera_id: int, current_user=Depends(get_current_user)):
    """Remove a camera."""
    owned_camera(camera_id, current_user.id)
    if runtime.camera_manager.remove_camera(camera_id):
        return {"status": "ok", "message": "Camera removed"}
    raise HTTPException(status_code=404, detail="Camera not found")


@router.put("/cameras/{camera_id}")
def update_camera(camera_id: int, cam: CameraModel, current_user=Depends(get_current_user)):
    owned_camera(camera_id, current_user.id)
    source = cam.source if "source" in cam.model_fields_set else None
    if runtime.camera_manager.update_camera(camera_id, cam.name, cam.is_active, source=source):
        return {"status": "ok", "message": "Camera updated"}
    raise HTTPException(status_code=404, detail="Camera not found")


@router.post("/cameras/{camera_id}/toggle")
def toggle_camera(camera_id: int, active: bool, current_user=Depends(get_current_user)):
    """Enable or disable a camera."""
    owned_camera(camera_id, current_user.id)
    if runtime.camera_manager.toggle_camera(camera_id, active):
        return {"status": "ok", "message": f"Camera {'enabled' if active else 'disabled'}"}
    raise HTTPException(status_code=404, detail="Camera not found")
