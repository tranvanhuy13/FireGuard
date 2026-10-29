"""Paced video playback with a separate bounded bot-notification queue."""
import base64
import copy
import logging
import math
import os
import queue
import threading
import time
import uuid
from collections import OrderedDict

import cv2
import storage
from detection_rules import read_settings, filter_detections, confirm_frame, draw_detections

logger = logging.getLogger(__name__)
UPLOAD_DIR = "uploads_tmp"
ALLOWED_EXT = {".mp4", ".avi", ".mov", ".mkv", ".webm", ".m4v", ".wmv"}
MAX_UPLOAD_MB = 500
MAX_SNAPSHOTS = 24
MAX_JOBS_KEPT = 20
FINISHED = ("done", "error", "cancelled")


class VideoAnalyzer:
    def __init__(self, detect_fn, get_setting, notify_fn=None):
        self.detect = detect_fn
        self.get_setting = get_setting
        self.notify = notify_fn
        self._notifications = queue.Queue(maxsize=40)
        self.jobs = OrderedDict()
        self._controls = {}
        self._lock = threading.RLock()
        self._slot = threading.BoundedSemaphore(1)
        self._closed = False
        self._notification_thread = None
        if notify_fn is not None:
            self._notification_thread = threading.Thread(target=self._send_notifications,
                                                        name="video-notifications", daemon=True)
            self._notification_thread.start()
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        for name in os.listdir(UPLOAD_DIR):
            self._remove(os.path.join(UPLOAD_DIR, name))

    @staticmethod
    def _remove(path):
        try:
            os.remove(path)
        except OSError:
            pass

    def submit(self, path, filename, sample_fps):
        with self._lock:
            if self._closed:
                raise ValueError("Analyzer is shutting down")
            self._prune(preserve_path=path)
            if len(self.jobs) >= MAX_JOBS_KEPT:
                raise ValueError("Too many active analyses; cancel an existing job first")
            job_id = uuid.uuid4().hex[:12]
            self.jobs[job_id] = {
                "id": job_id, "filename": filename, "status": "queued", "revision": 0,
                "progress": 0.0, "sample_fps": max(1, min(15, int(sample_fps))),
                "duration": None, "frames_analyzed": 0, "current_time": 0,
                "effective_fps": 0, "buffering": False, "detections": [],
                "confirmed": [], "frame": None, "frame_id": 0,
                "verdict": None, "summary": {}, "events": [], "error": None,
                "created_at": time.time(), "finished_at": None, "notifications": {},
            }
            control = {"cancel": threading.Event(), "paused": False, "path": path,
                       "wake": threading.Event(), "notification_pending": 0,
                       "notification_types": set(), "notification_snapshots": set()}
            self._controls[job_id] = control
            thread = threading.Thread(target=self._run, args=(job_id,), daemon=True,
                                      name=f"video-{job_id}")
            control["thread"] = thread
            thread.start()
            return job_id

    def get(self, job_id, include_frame=False):
        with self._lock:
            job = self.jobs.get(job_id)
            if job is None:
                return None
            return copy.deepcopy({key: value for key, value in job.items()
                                  if include_frame or key != "frame"})

    def list(self):
        with self._lock:
            return [self.get(job_id) for job_id in reversed(self.jobs)]

    def cancel(self, job_id):
        with self._lock:
            if job_id not in self.jobs or self.jobs[job_id]["status"] in FINISHED:
                return False
            self._controls[job_id]["cancel"].set()
            self._controls[job_id]["wake"].set()
            return True

    def playback(self, job_id, action):
        with self._lock:
            if job_id not in self.jobs:
                raise KeyError(job_id)
            job, control = self.jobs[job_id], self._controls[job_id]
            if action == "restart":
                # Replay leases the retained source; do not copy a 500 MB upload
                # under the job lock or delete it while another run still uses it.
                new_id = self.submit(control["path"], job["filename"], job["sample_fps"])
                self.cancel(job_id)
                return new_id
            if job["status"] in FINISHED:
                raise ValueError("This analysis has finished; restart to play again")
            control["paused"] = action == "pause"
            control["wake"].set()
            self._update(job_id, status="paused" if control["paused"] else "queued")
            return job_id

    def _update(self, job_id, **values):
        with self._lock:
            self.jobs[job_id].update(values)
            self.jobs[job_id]["revision"] += 1

    def _prune(self, preserve_path=None):
        while len(self.jobs) >= MAX_JOBS_KEPT:
            old = next((key for key, job in self.jobs.items()
                        if job["status"] in FINISHED and not self._controls[key]["thread"].is_alive()
                        and not self._controls[key]["notification_pending"]), None)
            if old is None:
                return
            for event in self.jobs[old]["events"]:
                # Notified evidence must outlive job eviction so S3 links stay usable.
                if os.path.basename(event["snapshot"]) not in self._controls[old]["notification_snapshots"]:
                    storage.delete_snapshot(event["snapshot"])
            path = self._controls.pop(old)["path"]
            if path != preserve_path and not any(item["path"] == path for item in self._controls.values()):
                self._remove(path)
            del self.jobs[old]

    def shutdown(self):
        with self._lock:
            self._closed = True
            controls = list(self._controls.values())
            for control in controls:
                control["cancel"].set()
                control["wake"].set()
        for control in controls:
            control["thread"].join(timeout=2)
            if not control["thread"].is_alive():
                self._remove(control["path"])
        if self._notification_thread is not None:
            self._notification_thread.join(timeout=2)

    def _queue_notification(self, job_id, name, confidence, timestamp, snapshot, path):
        with self._lock:
            control = self._controls[job_id]
            if control["cancel"].is_set() or self._closed:
                storage.unpin_snapshot(snapshot)
                return
            try:
                self._notifications.put_nowait((job_id, name, confidence, timestamp, snapshot, path))
            except queue.Full:
                storage.unpin_snapshot(snapshot)
                logger.warning("[Video %s] Notification queue full; retrying at next evidence frame", job_id)
                return
            control["notification_pending"] += 1
            control["notification_types"].add(name)
            self.jobs[job_id]["notifications"][name] = {"status": "queued"}

    def _send_notifications(self):
        while True:
            try:
                item = self._notifications.get(timeout=0.2)
            except queue.Empty:
                if self._closed:
                    return
                continue
            job_id, name, confidence, timestamp, snapshot, path = item
            with self._lock:
                control = self._controls[job_id]
                cancel = control["cancel"]
                filename = self.jobs[job_id]["filename"]
            results = {"status": "cancelled"}
            try:
                if not cancel.is_set():
                    results = self.notify(name, confidence, path,
                                          context={"job_id": job_id, "filename": filename,
                                                   "video_time": timestamp}, cancelled=cancel)
                    if any(value.get("status") == "sent" for value in results.values()):
                        with self._lock:
                            control["notification_snapshots"].add(snapshot)
            except Exception:
                results = {"status": "failed"}
                logger.warning("[Video %s] Notification delivery failed", job_id)
            finally:
                storage.unpin_snapshot(snapshot)
                storage.discard_local(path)
                with self._lock:
                    self.jobs[job_id]["notifications"][name] = results
                    self.jobs[job_id]["revision"] += 1
                    control["notification_pending"] -= 1
                self._notifications.task_done()

    def _acquire_slot(self, job_id):
        """Only the worker owns its lease; pause/cancel may change while waiting."""
        control = self._controls[job_id]
        while not control["cancel"].is_set():
            with self._lock:
                paused = control["paused"]
                control["wake"].clear()
            if paused:
                control["wake"].wait(0.05)
                continue
            if self._slot.acquire(timeout=0.05):
                with self._lock:
                    if not control["paused"] and not control["cancel"].is_set():
                        return
                self._slot.release()
        raise InterruptedError()

    def _run(self, job_id):
        control = self._controls[job_id]
        cancel = control["cancel"]
        cap = None
        acquired = False
        try:
            self._acquire_slot(job_id)
            acquired = True
            if cancel.is_set():
                raise InterruptedError()
            cap = cv2.VideoCapture(control["path"])
            if not cap.isOpened():
                raise ValueError("Cannot open this video (unsupported codec or corrupted file).")
            fps = cap.get(cv2.CAP_PROP_FPS)
            fps = fps if math.isfinite(fps) and 1 <= fps <= 240 else 25.0
            count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
            total = int(count) if math.isfinite(count) and count > 0 else 0
            duration = total / fps if total else None
            step = max(1, round(fps / self.jobs[job_id]["sample_fps"]))
            interval = step / fps
            self._update(job_id, duration=duration, status="processing")
            streak, summary, events, last_snap = {}, {}, [], {}
            analyzed = index = 0
            deadline = time.monotonic()
            while not cancel.is_set():
                with self._lock:
                    paused = control["paused"]
                    if paused:
                        self._slot.release()
                        acquired = False
                        self._update(job_id, status="paused", buffering=False)
                if paused:
                    self._acquire_slot(job_id)
                    acquired = True
                    deadline = time.monotonic()
                    continue
                if not cap.grab():
                    break
                if index % step:
                    index += 1
                    continue
                ok, frame = cap.retrieve()
                timestamp = index / fps
                index += 1
                if not ok or frame is None:
                    continue
                started = time.monotonic()
                self._update(job_id, status="processing")
                _, raw = self.detect(frame.copy(), background=True, cancelled=cancel)
                if cancel.is_set():
                    raise InterruptedError()
                settings = read_settings(self.get_setting)
                detections = filter_detections(raw, settings)
                confirmed = confirm_frame(streak, detections, settings["persistence"])
                annotated = draw_detections(frame, detections)
                analyzed += 1
                for name, confidence in confirmed.items():
                    info = summary.setdefault(name, {"samples": 0, "max_confidence": 0, "first_time": timestamp})
                    info["samples"] += 1
                    info["max_confidence"] = max(info["max_confidence"], confidence)
                    gap = max(2.0, (duration or 0) / MAX_SNAPSHOTS)
                    if len(events) < MAX_SNAPSHOTS and timestamp - last_snap.get(name, -1e9) >= gap:
                        snapshot = f"video_{job_id}_{int(timestamp * 1000)}_{name}.jpg"
                        notify = self.notify is not None and name not in control["notification_types"]
                        if notify:
                            storage.pin_snapshot(snapshot)
                        try:
                            path = storage.save_snapshot(snapshot, annotated, keep_local=notify)
                        except Exception:
                            if notify:
                                storage.unpin_snapshot(snapshot)
                            raise
                        if notify:
                            self._queue_notification(job_id, name, confidence, timestamp, snapshot, path)
                        events.append({"time": timestamp, "class": name, "confidence": confidence,
                                       "snapshot": f"/snapshots/{snapshot}"})
                        last_snap[name] = timestamp
                height, width = annotated.shape[:2]
                if width > 960:
                    annotated = cv2.resize(annotated, (960, round(height * 960 / width)))
                ok, jpeg = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 80])
                if not ok:
                    raise ValueError("Cannot encode preview frame")
                elapsed = time.monotonic() - started
                self._update(job_id, frame=base64.b64encode(jpeg).decode("ascii"), frame_id=analyzed,
                             current_time=timestamp, frames_analyzed=analyzed,
                             progress=min(0.999, index / total) if total else None,
                             detections=detections, confirmed=list(confirmed), summary=copy.deepcopy(summary),
                             events=list(events), effective_fps=round(1 / max(interval, elapsed), 1),
                             buffering=elapsed > interval * 1.25,
                             status="paused" if control["paused"] else "processing")
                deadline += interval
                delay = max(0, deadline - time.monotonic())
                with self._lock:
                    control["wake"].clear()
                    paused = control["paused"]
                if not paused:
                    control["wake"].wait(delay)
                deadline = max(deadline, time.monotonic())
            if cancel.is_set():
                raise InterruptedError()
            if not analyzed:
                raise ValueError("No frames could be read from this video.")
            verdict = "fire" if "fire" in summary else "smoke" if "smoke" in summary else "none"
            self._update(job_id, status="done", progress=1, verdict=verdict,
                         buffering=False, finished_at=time.time())
        except InterruptedError:
            self._update(job_id, status="cancelled", buffering=False, finished_at=time.time())
        except Exception as error:
            logger.exception("[Video %s] Playback failed", job_id)
            self._update(job_id, status="error", error=str(error), finished_at=time.time())
        finally:
            if cap is not None:
                cap.release()
            if acquired:
                self._slot.release()
            if self._closed:
                self._remove(control["path"])
