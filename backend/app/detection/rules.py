"""Shared fire/smoke filtering and frame-based confirmation for every source."""
import math
import cv2


def draw_detections(frame, detections):
    image = frame.copy()
    for detection in detections:
        x1, y1, x2, y2 = map(int, detection["bbox"])
        color = (0, 70, 255) if detection["class"] == "fire" else (0, 200, 255)
        cv2.rectangle(image, (x1, y1), (x2, y2), color, 2)
        label = f'{detection["class"]} {detection["confidence"]:.0%}'
        cv2.putText(image, label, (max(0, x1), max(18, y1 - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
    return image


def normalize_class(value):
    name = str(value).strip().lower()
    return {"flame": "fire", "flames": "fire"}.get(name, name)


def _number(get_setting, key, fallback, low, high):
    try:
        value = float(get_setting(key, fallback))
        return min(high, max(low, value)) if math.isfinite(value) else fallback
    except (TypeError, ValueError):
        return fallback


def read_settings(get_setting):
    legacy = _number(get_setting, "ai_confidence_threshold", 0.25, 0, 1)
    return {
        "fire": _number(get_setting, "fire_threshold", legacy * 100, 0, 100) / 100,
        "smoke": _number(get_setting, "smoke_threshold", legacy * 100, 0, 100) / 100,
        "persistence": int(_number(get_setting, "persistence",
            _number(get_setting, "ai_persistence_frames", 2, 1, 30), 1, 30)),
        "cooldown": _number(get_setting, "cooldown",
            _number(get_setting, "ai_cooldown_seconds", 5, 0, 3600), 0, 3600),
    }


def filter_detections(detections, settings):
    accepted = []
    for detection in detections or []:
        name = normalize_class(detection.get("class", ""))
        confidence = float(detection.get("confidence", 0))
        if name in ("fire", "smoke") and math.isfinite(confidence) and confidence >= settings[name]:
            accepted.append({**detection, "class": name, "confidence": confidence})
    return accepted


def confirm_frame(streak, detections, persistence):
    """Multiple boxes of the same class count as ONE observation per frame."""
    present = {}
    for detection in detections:
        name = detection["class"]
        present[name] = max(present.get(name, 0), detection["confidence"])
    for name in set(streak) | set(present):
        streak[name] = streak.get(name, 0) + 1 if name in present else 0
    return {name: confidence for name, confidence in present.items() if streak[name] >= persistence}
