"""
video_analyzer.py - Check an uploaded video for fire / smoke with the SAME model
and the SAME settings (confidence threshold, persistence) as the live cameras.

Jobs run in the background (one at a time) so long videos never block the API.
Uploaded videos are deleted after analysis. Results are NOT written to the events
table and do NOT trigger Zalo/Telegram notifications - this is a check, not an alarm.
"""
import copy
import logging
import os
import re
import threading
import time
import uuid
from collections import OrderedDict, defaultdict

import cv2

logger = logging.getLogger(__name__)

SNAPSHOT_DIR = "snapshots"
UPLOAD_DIR = "uploads_tmp"
ALLOWED_EXT = {".mp4", ".avi", ".mov", ".mkv", ".webm", ".m4v", ".wmv"}
MAX_UPLOAD_MB = 500
MAX_SNAPSHOTS = 24            # evidence frames kept per video
MIN_SNAPSHOT_GAP_SECONDS = 2.0
MAX_JOBS_KEPT = 20
FINISHED = ("done", "error", "cancelled")


def _safe(name):
    return re.sub(r"[^a-zA-Z0-9_-]", "", str(name)) or "obj"


class VideoAnalyzer:
    def __init__(self, detect_fn, get_setting):
        """
        detect_fn(frame) -> (annotated_frame, detections)   (CameraManager.detect)
        get_setting(key, default) -> str                    (database.get_setting)
        """
        self.detect = detect_fn
        self.get_setting = get_setting
        self.jobs = OrderedDict()
        self._cancel = {}
        self._lock = threading.Lock()
        self._slot = threading.Semaphore(1)      # one analysis at a time

        os.makedirs(SNAPSHOT_DIR, exist_ok=True)
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        for f in os.listdir(UPLOAD_DIR):          # leftovers from a previous crash
            try:
                os.remove(os.path.join(UPLOAD_DIR, f))
            except OSError:
                pass

    # ------------------------------------------------------------------ public
    def submit(self, path, filename, sample_fps):
        job_id = uuid.uuid4().hex[:12]
        job = {
            "id": job_id, "filename": filename, "status": "queued",
            "progress": 0.0, "sample_fps": sample_fps,
            "duration": None, "frames_analyzed": 0,
            "verdict": None, "summary": {}, "events": [],
            "error": None, "created_at": time.time(), "finished_at": None,
        }
        with self._lock:
            self.jobs[job_id] = job
            self._cancel[job_id] = threading.Event()
            self._prune()
        threading.Thread(target=self._run, args=(job_id, path), daemon=True,
                         name=f"video-{job_id}").start()
        return job_id

    def get(self, job_id):
        with self._lock:
            job = self.jobs.get(job_id)
            return copy.deepcopy(job) if job else None

    def list(self):
        with self._lock:
            return [copy.deepcopy(j) for j in reversed(self.jobs.values())]

    def cancel(self, job_id):
        with self._lock:
            ev = self._cancel.get(job_id)
            job = self.jobs.get(job_id)
            if ev is None or job is None or job["status"] in FINISHED:
                return False
            ev.set()
            return True

    # ---------------------------------------------------------------- internal
    def _update(self, job_id, **kw):
        with self._lock:
            self.jobs[job_id].update(kw)

    def _prune(self):
        """Keep only the newest MAX_JOBS_KEPT jobs (called with the lock held)."""
        while len(self.jobs) > MAX_JOBS_KEPT:
            old_id = next((i for i, j in self.jobs.items() if j["status"] in FINISHED), None)
            if old_id is None:
                break
            for ev in self.jobs[old_id]["events"]:
                try:
                    os.remove(os.path.join(SNAPSHOT_DIR, os.path.basename(ev["snapshot"])))
                except OSError:
                    pass
            del self.jobs[old_id]
            self._cancel.pop(old_id, None)

    def _run(self, job_id, path):
        cancel = self._cancel[job_id]
        cap = None
        try:
            with self._slot:
                if cancel.is_set():
                    self._update(job_id, status="cancelled", finished_at=time.time())
                    return
                self._update(job_id, status="processing")

                cap = cv2.VideoCapture(path)
                if not cap.isOpened():
                    raise ValueError("Cannot open this video (unsupported codec or corrupted file).")

                fps = cap.get(cv2.CAP_PROP_FPS) or 0
                if not (1 <= fps <= 240):
                    fps = 25.0
                total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
                duration = total / fps if total > 0 else None
                self._update(job_id, duration=round(duration, 2) if duration else None)

                with self._lock:
                    sample_fps = self.jobs[job_id]["sample_fps"]
                step = max(1, round(fps / sample_fps))

                try:
                    conf_threshold = float(self.get_setting("ai_confidence_threshold", "0.25"))
                    persistence_limit = int(self.get_setting("ai_persistence_frames", "2"))
                except Exception:
                    conf_threshold, persistence_limit = 0.25, 2

                min_gap = max(MIN_SNAPSHOT_GAP_SECONDS,
                              (duration / MAX_SNAPSHOTS) if duration else 0)

                streak = defaultdict(int)
                last_snap = {}
                summary, events = {}, []
                analyzed = idx = 0

                while True:
                    if cancel.is_set():
                        self._update(job_id, status="cancelled", finished_at=time.time())
                        return
                    if not cap.grab():
                        break

                    if idx % step == 0:
                        ok, frame = cap.retrieve()
                        if ok and frame is not None:
                            analyzed += 1
                            t = idx / fps
                            annotated, detections = self.detect(frame)

                            present = {}
                            for det in detections or []:
                                conf = float(det["confidence"])
                                if conf >= conf_threshold:
                                    cls = str(det["class"]).lower()
                                    present[cls] = max(present.get(cls, 0.0), conf)

                            for cls in list(streak):
                                if cls not in present:
                                    streak[cls] = 0

                            for cls, conf in present.items():
                                streak[cls] += 1
                                # same rule as the live cameras
                                if streak[cls] < persistence_limit and conf <= 0.6:
                                    continue
                                info = summary.setdefault(
                                    cls, {"samples": 0, "max_confidence": 0.0, "first_time": round(t, 2)})
                                info["samples"] += 1
                                info["max_confidence"] = round(max(info["max_confidence"], conf), 3)

                                if (len(events) < MAX_SNAPSHOTS
                                        and t - last_snap.get(cls, -1e9) >= min_gap):
                                    last_snap[cls] = t
                                    name = f"video_{job_id}_{int(t * 1000):08d}_{_safe(cls)}.jpg"
                                    img = annotated if annotated is not None else frame
                                    cv2.imwrite(os.path.join(SNAPSHOT_DIR, name), img)
                                    events.append({"time": round(t, 2), "class": cls,
                                                   "confidence": round(conf, 3),
                                                   "snapshot": f"/snapshots/{name}"})

                            if analyzed % 5 == 0:
                                self._update(job_id, frames_analyzed=analyzed,
                                             summary=copy.deepcopy(summary), events=list(events))
                    idx += 1

                    if idx % 15 == 0 and total > 0:
                        self._update(job_id, progress=round(min(0.99, idx / total), 3))

                if analyzed == 0:
                    raise ValueError("No frames could be read from this video.")

                classes = list(summary)
                if any("fire" in c or "flame" in c for c in classes):
                    verdict = "fire"
                elif any("smoke" in c for c in classes):
                    verdict = "smoke"
                elif classes:
                    verdict = "detected"
                else:
                    verdict = "none"

                self._update(job_id, status="done", progress=1.0, verdict=verdict,
                             frames_analyzed=analyzed, summary=summary, events=events,
                             finished_at=time.time())
        except Exception as e:
            logger.exception("[Video %s] Analysis failed", job_id)
            self._update(job_id, status="error", error=str(e), finished_at=time.time())
        finally:
            if cap is not None:
                cap.release()
            try:
                os.remove(path)
            except OSError:
                pass