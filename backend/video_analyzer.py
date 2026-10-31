"""Paced video playback with a separate bounded bot-notification queue."""
import base64
import copy
import itertools
import logging
import math
import os
import queue
import threading
import time
import uuid
from collections import OrderedDict

import cv2
from sqlalchemy.exc import SQLAlchemyError
import storage
from detection_rules import read_settings, filter_detections, confirm_frame, draw_detections

logger = logging.getLogger(__name__)
UPLOAD_DIR = "uploads_tmp"
ALLOWED_EXT = {".mp4", ".avi", ".mov", ".mkv", ".webm", ".m4v", ".wmv"}
MAX_UPLOAD_MB = 500
MAX_SNAPSHOTS = 24
MAX_JOBS_KEPT = 20
FINISHED = ("done", "error", "cancelled")
BOT_CHANNELS = ("zalo", "telegram")
NOTIFICATION_ACTIVE = ("queued", "sending", "retrying")


class VideoAnalyzer:
    def __init__(self, detect_fn, get_setting, notify_fn=None):
        self.detect = detect_fn
        self.get_setting = get_setting
        self.notify = notify_fn
        self._notifications = {channel: queue.PriorityQueue(maxsize=40) for channel in BOT_CHANNELS}
        self._notification_wake = {channel: threading.Event() for channel in BOT_CHANNELS}
        self._notification_threads = {}
        self._notification_ticket = itertools.count()
        self.jobs = OrderedDict()
        self._controls = {}
        self._lock = threading.RLock()
        self._slot = threading.BoundedSemaphore(1)
        self._closed = False
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        for name in os.listdir(UPLOAD_DIR):
            self._remove(os.path.join(UPLOAD_DIR, name))
        self._ensure_notification_workers()

    def _ensure_notification_workers(self):
        with self._lock:
            if self.notify is None or self._closed:
                return
            for channel in BOT_CHANNELS:
                worker = self._notification_threads.get(channel)
                if worker is None or not worker.is_alive():
                    worker = threading.Thread(target=self._send_notifications, args=(channel,),
                                              name=f"video-notifications-{channel}", daemon=True)
                    self._notification_threads[channel] = worker
                    worker.start()

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
            self._ensure_notification_workers()
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
                "notification_pending": 0,
            }
            control = {"cancel": threading.Event(), "paused": False, "path": path,
                       "wake": threading.Event(), "notification_pending": 0,
                       "notification_evidence": {}, "notification_tickets": {},
                       "notification_snapshots": set()}
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
            result = copy.deepcopy({key: value for key, value in job.items()
                                    if include_frame or key != "frame"})
            result["notification_workers"] = {channel: worker.is_alive()
                                               for channel, worker in self._notification_threads.items()}
            result["notifications_cancelled"] = self._controls[job_id]["cancel"].is_set()
            return result

    def list(self):
        with self._lock:
            return [self.get(job_id) for job_id in reversed(self.jobs)]

    def cancel(self, job_id):
        with self._lock:
            if job_id not in self.jobs:
                return False
            if self.jobs[job_id]["status"] in FINISHED and not self._controls[job_id]["notification_pending"]:
                return False
            self._controls[job_id]["cancel"].set()
            self._controls[job_id]["wake"].set()
            self._cancel_notifications(job_id)
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
                # Completed playback may still have queued bot work.
                control["cancel"].set()
                control["wake"].set()
                if job_id in self.jobs:
                    self._cancel_notifications(job_id)
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
            snapshots = {os.path.basename(event["snapshot"]) for event in self.jobs[old]["events"]}
            snapshots.update(item["snapshot"] for item in self._controls[old]["notification_evidence"].values())
            for snapshot in snapshots:
                # Notified evidence must outlive job eviction so S3 links stay usable.
                if snapshot not in self._controls[old]["notification_snapshots"]:
                    storage.delete_snapshot(snapshot)
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
            for job_id in list(self.jobs):
                self._cancel_notifications(job_id)
        for control in controls:
            control["thread"].join(timeout=2)
            if not control["thread"].is_alive():
                self._remove(control["path"])
        for worker in self._notification_threads.values():
            worker.join(timeout=2)

    def _notification_changed(self, job_id):
        job = self.jobs[job_id]
        job["notification_pending"] = self._controls[job_id]["notification_pending"]
        job["revision"] += 1

    def _schedule_notification(self, job_id, name, channel, delay=0, reset=False):
        control = self._controls[job_id]
        states = self.jobs[job_id]["notifications"].setdefault(name, {})
        previous = states.get(channel, {})
        ticket = next(self._notification_ticket)
        due = time.monotonic() + delay
        try:
            self._notifications[channel].put_nowait((due, ticket, job_id, name))
        except queue.Full:
            return False
        if reset:
            previous = {"attempts": 0, "queued_at": time.time(),
                        "recipients": {key: value for key, value in previous.get("recipients", {}).items()
                                       if value.get("status") == "sent"}}
            control["notification_pending"] += 1
        states[channel] = {**previous, "status": "retrying" if delay else "queued",
                           "next_attempt_at": time.time() + delay}
        control["notification_tickets"][(name, channel)] = ticket
        self._notification_changed(job_id)
        self._notification_wake[channel].set()
        logger.info("[Video %s] Notification %s/%s queued; delay=%.1fs",
                    job_id, name, channel, delay)
        return True

    def _release_notification_snapshot(self, job_id, name):
        control = self._controls[job_id]
        states = self.jobs[job_id]["notifications"].get(name, {})
        if any(result["status"] in NOTIFICATION_ACTIVE for result in states.values()):
            return
        evidence = control["notification_evidence"][name]
        if evidence.get("pinned"):
            evidence["pinned"] = False
            try:
                storage.unpin_snapshot(evidence["snapshot"])
            except Exception:
                logger.warning("[Video %s] Unable to release notification attachment", job_id)
        # Background storage maintenance owns local deletion; no network cleanup
        # on the notification worker before the next job can be dispatched.

    def _finish_notification(self, job_id, name, channel, result):
        control = self._controls[job_id]
        previous = self.jobs[job_id]["notifications"][name][channel]
        if previous["status"] in NOTIFICATION_ACTIVE:
            control["notification_pending"] -= 1
        base = {key: value for key, value in previous.items() if key != "next_attempt_at"}
        if result["status"] == "sent":
            for key in ("reason", "description", "http_status", "error_code", "retry_after"):
                base.pop(key, None)
        self.jobs[job_id]["notifications"][name][channel] = {
            **base, **result, "finished_at": time.time(),
            "attempts": previous.get("attempts", 0),
        }
        if result["status"] == "sent" or any(item.get("status") == "sent" for item in result.get("recipients", {}).values()):
            control["notification_snapshots"].add(control["notification_evidence"][name]["snapshot"])
        self._notification_changed(job_id)
        self._release_notification_snapshot(job_id, name)
        logger.info("[Video %s] Notification %s/%s: %s, attempt=%d",
                    job_id, name, channel, result["status"], previous.get("attempts", 0))

    def _cancel_notifications(self, job_id):
        for name, states in list(self.jobs[job_id]["notifications"].items()):
            for channel, state in list(states.items()):
                if state["status"] in ("queued", "retrying"):
                    self._finish_notification(job_id, name, channel, {"status": "cancelled"})
        for wake in self._notification_wake.values():
            wake.set()

    def _queue_notification(self, job_id, name, confidence, timestamp, snapshot, path):
        with self._lock:
            control = self._controls[job_id]
            if control["cancel"].is_set() or self._closed:
                storage.unpin_snapshot(snapshot)
                return
            self._ensure_notification_workers()
            control["notification_evidence"][name] = {
                "confidence": confidence, "timestamp": timestamp, "snapshot": snapshot,
                "path": path, "pinned": True,
            }
            states = self.jobs[job_id]["notifications"].setdefault(name, {})
            # Initialize both channels before either can finish and release the image.
            for channel in BOT_CHANNELS:
                states[channel] = {"status": "initializing"}
            for channel in BOT_CHANNELS:
                if not self._schedule_notification(job_id, name, channel, reset=True):
                    states[channel] = {"status": "failed", "reason": "queue_full", "attempts": 0,
                                       "description": "Notification queue is full; retry this channel"}
            self._notification_changed(job_id)
            self._release_notification_snapshot(job_id, name)

    def retry_notification(self, job_id, name, channel):
        with self._lock:
            if job_id not in self.jobs:
                raise KeyError(job_id)
            control = self._controls[job_id]
            if self.notify is None or self._closed or control["cancel"].is_set():
                raise ValueError("This job no longer accepts notification delivery")
            state = self.jobs[job_id]["notifications"].get(name, {}).get(channel)
            if not state or state["status"] not in ("failed", "disabled", "unconfigured"):
                raise ValueError("Only failed, disabled or unconfigured channels may be retried")
            evidence = control["notification_evidence"][name]
            self._ensure_notification_workers()
            pinned_here = not evidence["pinned"]
            if pinned_here:
                storage.pin_snapshot(evidence["snapshot"])
                evidence["pinned"] = True
            if not self._schedule_notification(job_id, name, channel, reset=True):
                if pinned_here:
                    evidence["pinned"] = False
                    storage.unpin_snapshot(evidence["snapshot"])
                raise ValueError("Notification queue is full")
            return self.get(job_id)

    @staticmethod
    def _retry_delay(result, attempts):
        transient = (result.get("reason") in ("timeout", "network_error", "rate_limited")
                     or result.get("http_status", 0) >= 500)
        if not transient or attempts >= 3:
            return None
        try:
            delay = max(float(result.get("retry_after", 0)), 2 ** attempts)
        except (ValueError, TypeError):
            return None
        return delay if math.isfinite(delay) and 0 <= delay <= 30 else None

    def _send_notifications(self, channel):
        work = self._notifications[channel]
        wake = self._notification_wake[channel]
        while True:
            try:
                due, ticket, job_id, name = work.get(timeout=0.2)
            except queue.Empty:
                if self._closed:
                    return
                continue
            try:
                with self._lock:
                    control = self._controls.get(job_id)
                    if control is None:
                        continue
                    state = self.jobs[job_id]["notifications"].get(name, {}).get(channel, {})
                    if (control["notification_tickets"].get((name, channel)) != ticket
                            or state.get("status") not in ("queued", "retrying")):
                        continue
                    if control["cancel"].is_set() or self._closed:
                        self._finish_notification(job_id, name, channel, {"status": "cancelled"})
                        continue
                    if due > time.monotonic():
                        work.put_nowait((due, ticket, job_id, name))
                        delay = max(0.001, min(due - time.monotonic(), 0.2))
                    else:
                        delay = 0
                        state.update(status="sending", started_at=time.time(),
                                     attempts=state.get("attempts", 0) + 1)
                        self._notification_changed(job_id)
                        evidence = dict(control["notification_evidence"][name])
                        recipient_results = dict(state.get("recipients", {}))
                        filename = self.jobs[job_id]["filename"]
                        cancel = control["cancel"]
                if delay > 0:
                    wake.wait(delay)
                    wake.clear()
                    continue
                logger.info("[Video %s] Notification %s/%s sending; attempt=%d",
                            job_id, name, channel, state["attempts"])
                path = evidence["path"]
                if channel == "telegram":
                    path = storage.restore_snapshot(evidence["snapshot"]) or path
                results = self.notify(
                    name, evidence["confidence"], path or evidence["snapshot"],
                    context={"job_id": job_id, "filename": filename, "video_time": evidence["timestamp"]},
                    cancelled=cancel, channels=(channel,), request_attempts=1,
                    recipient_results=recipient_results)
                result = results.get(channel)
                if not isinstance(result, dict) or "status" not in result:
                    raise ValueError("Invalid notification result")
                with self._lock:
                    state = self.jobs[job_id]["notifications"][name][channel]
                    delay = self._retry_delay(result, state["attempts"]) if result["status"] == "failed" else None
                    if delay is not None and not cancel.is_set() and not self._closed:
                        state.update({key: value for key, value in result.items() if key != "status"})
                        if self._schedule_notification(job_id, name, channel, delay):
                            continue
                    self._finish_notification(job_id, name, channel, result)
            except Exception as exc:
                logger.warning("[Video %s] Notification %s/%s worker error: %s",
                               job_id, name, channel, type(exc).__name__)
                with self._lock:
                    if job_id in self.jobs and channel in self.jobs[job_id]["notifications"].get(name, {}):
                        self._finish_notification(job_id, name, channel, {
                            "status": "failed", "reason": "worker_error",
                            "description": "Notification worker could not process this event",
                        })
            finally:
                work.task_done()

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
                    notify = self.notify is not None and name not in control["notification_evidence"]
                    if notify or (len(events) < MAX_SNAPSHOTS and timestamp - last_snap.get(name, -1e9) >= gap):
                        snapshot = f"video_{job_id}_{int(timestamp * 1000)}_{name}.jpg"
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
                        if len(events) < MAX_SNAPSHOTS:
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
            if isinstance(error, SQLAlchemyError):
                logger.warning("[Video %s] Playback stopped: database unavailable (%s)", job_id, type(error).__name__)
                message = "Database temporarily unavailable. Please retry the analysis when the connection recovers."
            else:
                logger.exception("[Video %s] Playback failed", job_id)
                message = str(error)
            self._update(job_id, status="error", error=message, buffering=False, finished_at=time.time())
        finally:
            if cap is not None:
                cap.release()
            if acquired:
                self._slot.release()
            if self._closed:
                self._remove(control["path"])
