import cv2
import threading
import time
import os
import logging
import queue
from collections import namedtuple
from detection_rules import read_settings, filter_detections, confirm_frame, draw_detections
from inference_scheduler import InferenceScheduler

import numpy as np

import notification
import storage

logger = logging.getLogger(__name__)

CAMERA_FPS = 30                  # target capture / stream rate
SNAPSHOT_INTERVAL_SECONDS = 15    # periodic snapshot per camera
DETECTION_LOG_INTERVAL_SECONDS = 15  # detection console output per camera/class
DETECTION_FPS = 10               # max AI inferences per second per camera
OVERLAY_TTL_SECONDS = 1.0        # hide boxes if detector stalls longer than this
RECONNECT_DELAY_SECONDS = 10
MAX_READ_FAILURES = 5
JPEG_QUALITY = 80


# Detection overlay: annotated pixels + boolean mask of pixels the detector drew
Overlay = namedtuple("Overlay", "pixels mask timestamp")


class SharedWebcam:
    """One physical webcam connection, leased by independently enabled tiles."""

    _lock = threading.Lock()
    _devices = {}

    @classmethod
    def acquire(cls, source):
        with cls._lock:
            device = cls._devices.get(source)
            if device is None:
                cap = cv2.VideoCapture(source)
                cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
                cap.set(cv2.CAP_PROP_FPS, CAMERA_FPS)
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                device = {"cap": cap, "users": 0, "frame": None, "read_at": 0,
                          "lock": threading.Lock()}
                cls._devices[source] = device
            device["users"] += 1
            return cls(source, device)

    def __init__(self, source, device):
        self.source = source
        self.device = device
        self.released = False

    def isOpened(self):
        with self.device["lock"]:
            return not self.released and self.device["cap"].isOpened()

    def read(self):
        with self.device["lock"]:
            if self.released:
                return False, None
            # Reuse the latest frame across tiles instead of reading the device
            # once per tile and multiplying its capture rate.
            if time.monotonic() - self.device["read_at"] >= 1.0 / CAMERA_FPS:
                ok, frame = self.device["cap"].read()
                self.device["frame"] = frame if ok else None
                self.device["read_at"] = time.monotonic()
            frame = self.device["frame"]
            return frame is not None, frame

    def release(self):
        with self._lock, self.device["lock"]:
            if self.released:
                return
            self.released = True
            self.device["users"] -= 1
            if self.device["users"] == 0:
                self.device["cap"].release()
                self._devices.pop(self.source, None)


def save_snapshot_async(camera, frame, generation):
    """Save a snapshot on a worker thread so disk / network I/O never stalls capture."""
    def task(img):
        with camera._state_lock:
            if not camera.running or not camera.is_active or camera._generation != generation:
                return
            filename = f"periodic_{time.strftime('%Y%m%d_%H%M%S')}_cam_{camera.id}.jpg"
        storage.save_snapshot(filename, img)
        logger.info("[Cam %s] Periodic snapshot saved: %s", camera.id, filename)

    threading.Thread(target=task, args=(frame.copy(),), daemon=True).start()


class Camera:
    """
    One camera = one capture thread.

    The capture thread does nothing but read frames (~30 FPS), publish the
    newest one, and trigger periodic snapshots. AI detection runs elsewhere
    and can never slow the stream down.
    """

    def __init__(self, id, source, name="Camera", is_active=True):
        self.id = id
        self.source = source
        self.name = name
        self.is_active = is_active

        self._stop = threading.Event()
        self._state_lock = threading.RLock()
        self._generation = 0
        self._frame_lock = threading.Lock()

        # Published state
        self.last_frame = None
        self.frame_id = 0
        self.overlay = None
        self._jpeg_cache = (0, None)

        # Detection bookkeeping (used by CameraManager's detection thread)
        self.last_detected_id = 0
        self.last_detection_time = 0
        self.detection_persistence = {}
        self.last_event_time = 0
        self.last_detection_log_time = {}
        self.last_class_event_time = {}
        self.detection_state = None
        self.captured_at = 0

        self.last_periodic_snapshot_time = 0
        self.last_no_frame_log = 0

        self.status = "connecting" if is_active else "disconnected"
        self.consecutive_failures = 0
        self.cap = None

        self.thread = threading.Thread(target=self._capture_loop, daemon=True,
                                       name=f"capture-{id}")
        self.thread.start()

    # ------------------------------------------------------------------ state
    @property
    def running(self):
        return not self._stop.is_set()

    def stop(self):
        """Permanently stop this camera (used on remove / shutdown)."""
        with self._state_lock:
            self._stop.set()
            self.set_active(False)

    def set_active(self, is_active):
        with self._state_lock:
            self.is_active = bool(is_active) and self.running
            self._generation += 1
            self.status = "connecting" if self.is_active else "disconnected"
            self.detection_persistence = {}
            self.detection_state = None
            self.last_class_event_time = {}
            self.last_detected_id = 0
            self.last_periodic_snapshot_time = 0
            with self._frame_lock:
                self.last_frame = None
                self.overlay = None
                self._jpeg_cache = (0, None)

    # ---------------------------------------------------------------- capture
    def _open(self):
        with self._state_lock:
            if not self.running or not self.is_active:
                return False
            generation = self._generation
            self.status = "connecting"
        try:
            src = int(self.source)
        except (TypeError, ValueError):
            src = self.source

        if isinstance(src, int):
            cap = SharedWebcam.acquire(src)
        else:
            cap = cv2.VideoCapture(src)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

        with self._state_lock:
            if not self.running or not self.is_active or self._generation != generation:
                cap.release()
                return False
            if cap.isOpened():
                self.cap = cap
                self.status = "connected"
                self.consecutive_failures = 0
                logger.info("[Camera %s] Connected (source type: %s)", self.id, type(src).__name__)
                return True

        cap.release()
        self.status = "disconnected"
        logger.error("[Camera %s] Failed to open capture source", self.id)
        return False

    def _close(self):
        if self.cap is not None:
            self.cap.release()
            self.cap = None

    def _publish(self, frame):
        with self._frame_lock:
            self.last_frame = frame
            self.frame_id += 1
            self.captured_at = time.monotonic()

    def _maybe_snapshot(self, frame):
        if not self.running or not self.is_active:
            return
        now = time.time()
        if now - self.last_periodic_snapshot_time >= SNAPSHOT_INTERVAL_SECONDS:
            self.last_periodic_snapshot_time = now
            save_snapshot_async(self, frame, self._generation)

    def _capture_loop(self):
        interval = 1.0 / CAMERA_FPS

        while not self._stop.is_set():
            # Disabled camera: release the device and idle
            if not self.is_active:
                self._close()
                self.status = "disconnected"
                with self._frame_lock:
                    self.last_frame = None
                    self.overlay = None
                self._stop.wait(0.2)
                continue

            # (Re)connect when needed
            if self.cap is None:
                if not self._open():
                    self._stop.wait(RECONNECT_DELAY_SECONDS)
                    continue

            started = time.time()
            generation = self._generation
            ok, frame = self.cap.read()

            # Discard reads from a session disabled while the device was busy.
            with self._state_lock:
                if not self.running or not self.is_active or self._generation != generation:
                    self._close()
                    continue

            if not ok or frame is None:
                self.consecutive_failures += 1
                if self.consecutive_failures >= MAX_READ_FAILURES:
                    logger.error("[Camera %s] Lost connection after %s failed reads",
                                 self.id, self.consecutive_failures)
                    self._close()
                    self.status = "disconnected"
                    self._stop.wait(RECONNECT_DELAY_SECONDS)
                else:
                    self._stop.wait(0.02)
                continue

            with self._state_lock:
                if not self.running or not self.is_active or self._generation != generation:
                    self._close()
                    continue
                self.consecutive_failures = 0
                self._publish(frame)
                self._maybe_snapshot(frame)

            # Hold 30 FPS for sources that don't block (video files);
            # live streams already block in read(), so this is ~0 for them.
            remaining = interval - (time.time() - started)
            if remaining > 0:
                self._stop.wait(remaining)

        self._close()

    # -------------------------------------------------------------- detection
    def get_latest(self):
        with self._frame_lock:
            return self.frame_id, self.last_frame

    def set_overlay(self, original, annotated, captured_at=None):
        """
        Remember what the detector drew (boxes/labels) so it can be painted on
        top of every new raw frame, keeping the annotated stream at full FPS.
        """
        if annotated is None or annotated.shape != original.shape:
            self.overlay = None
            return
        mask = np.any(annotated != original, axis=2)
        self.overlay = Overlay(annotated, mask, captured_at or time.monotonic()) if mask.any() else None
        self._jpeg_cache = (0, None)

    # -------------------------------------------------------------- streaming
    def _compose(self, frame):
        ov = self.overlay
        if (ov is not None
                and time.monotonic() - ov.timestamp < OVERLAY_TTL_SECONDS
                and ov.mask.shape == frame.shape[:2]):
            out = frame.copy()
            out[ov.mask] = ov.pixels[ov.mask]
            return out
        return frame

    def get_display_frame(self):
        with self._frame_lock:
            frame = self.last_frame
        return None if frame is None else self._compose(frame)

    def get_jpeg(self):
        """Return (frame_id, jpeg_bytes) for the newest frame, encoded once per frame."""
        with self._frame_lock:
            frame_id, frame = self.frame_id, self.last_frame
            cached_id, cached_jpeg = self._jpeg_cache
        if frame is None:
            return None
        if cached_id == frame_id and cached_jpeg is not None:
            return frame_id, cached_jpeg

        ok, buf = cv2.imencode(".jpg", self._compose(frame),
                               [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
        if not ok:
            return None
        jpeg = buf.tobytes()
        self._jpeg_cache = (frame_id, jpeg)
        return frame_id, jpeg


class CameraManager:
    def __init__(self, detector):
        self.cameras = {}
        self.detector = detector
        # One model, many callers (live cameras + uploaded-video analysis):
        # serialize inference so the model is never called from two threads at once.
        self.scheduler = InferenceScheduler(detector)
        self._events = queue.Queue(maxsize=32)
        self.running = True
        self.alert_callback = None
        self.event_thread = threading.Thread(target=self._event_loop, daemon=True, name="camera-events")
        self.event_thread.start()

        self.load_cameras_from_db()

        self.thread = threading.Thread(target=self._detection_loop, daemon=True,
                                       name="detection")
        self.thread.start()

    def load_cameras_from_db(self):
        try:
            import database
            db_cams = database.get_all_db_cameras()
            for db_cam in db_cams:
                cam_id = db_cam["id"]
                name = db_cam["name"]
                # All dashboard tiles mirror the backend PC's default webcam.
                source = "0"
                is_active = db_cam["is_active"] == 1
                if db_cam["source"] != source:
                    database.update_db_camera(cam_id, name, source, is_active)

                if cam_id in self.cameras:
                    self.cameras[cam_id].name = name
                    self.cameras[cam_id].source = source
                    self.cameras[cam_id].set_active(is_active)
                else:
                    self.cameras[cam_id] = Camera(cam_id, source, name, is_active)
            print(f"Loaded {len(db_cams)} cameras from database.")
        except Exception as e:
            print(f"Error loading cameras from database: {e}")

    def add_camera(self, source="0", name="Camera", is_active=False):
        import database
        source = "0"
        cam_id = database.add_db_camera(name, source, int(is_active))
        self.cameras[cam_id] = Camera(cam_id, source, name, bool(is_active))
        return cam_id

    def remove_camera(self, camera_id):
        import database
        cam = self.cameras.pop(camera_id, None)
        if cam is None:
            return False
        cam.stop()
        database.delete_db_camera(camera_id)
        return True

    def has_active_camera(self):
        return any(cam.running and cam.is_active for cam in list(self.cameras.values()))

    def update_camera(self, camera_id, name, is_active):
        import database
        cam = self.cameras.get(camera_id)
        if cam is None:
            return False
        database.update_db_camera(camera_id, name, "0", is_active)
        cam.name = name
        cam.set_active(is_active)
        return True

    def toggle_camera(self, camera_id, is_active):
        import database
        cam = self.cameras.get(camera_id)
        if cam is None:
            return False
        cam.set_active(is_active)
        database.set_db_camera_status(camera_id, is_active)
        return True

    def shutdown(self):
        self.running = False
        for cam in list(self.cameras.values()):
            cam.stop()

    def detect(self, frame, background=False, cancelled=None):
        """Run the shared AI model (thread-safe). Returns (annotated_frame, detections)."""
        return self.scheduler.detect(frame, background=background, cancelled=cancelled)

    def detection_states(self):
        states = []
        for cam in list(self.cameras.values()):
            with cam._state_lock:
                state = cam.detection_state
                fresh = bool(state and time.monotonic() - state["captured_at"] < OVERLAY_TTL_SECONDS)
                states.append({"camera_id": cam.id, "active": cam.is_active, "status": cam.status,
                               "stale": not fresh, **({key: value for key, value in state.items()
                               if key != "captured_at"} if fresh else {"detections": [], "confirmed": []})})
        return states

    def _event_loop(self):
        while self.running or not self._events.empty():
            try:
                cam, generation, name, confidence, frame = self._events.get(timeout=0.2)
            except queue.Empty:
                continue
            try:
                with cam._state_lock:
                    valid = cam.running and cam.is_active and cam._generation == generation
                if valid:
                    self._save_event(cam, name, confidence, frame)
            except Exception:
                logger.exception("[Cam %s] Event storage failed", cam.id)
            finally:
                self._events.task_done()

    # ---------------------------------------------------------------- streaming
    def get_frame_id(self, camera_id):
        """Cheap check used by the stream loop to know if a new frame exists."""
        cam = self.cameras.get(camera_id)
        return None if cam is None else cam.frame_id

    def get_jpeg(self, camera_id):
        cam = self.cameras.get(camera_id)
        return None if cam is None else cam.get_jpeg()

    def get_frame(self, camera_id):
        """Latest frame (with detection overlay) as a numpy array."""
        cam = self.cameras.get(camera_id)
        if cam is None:
            logger.error("[Camera %s] Stream requested for unknown camera", camera_id)
            return None
        frame = cam.get_display_frame()
        if frame is None and time.time() - cam.last_no_frame_log >= 10:
            logger.warning("[Camera %s] Stream requested but no frame is available (status: %s)",
                           camera_id, cam.status)
            cam.last_no_frame_log = time.time()
        return frame

    # ---------------------------------------------------------------- detection
    def _detection_loop(self):
        """
        Runs AI on the *latest* frame of each camera, at most DETECTION_FPS
        times per second. If the model is slower than that, frames are simply
        skipped - capture and streaming are never blocked.
        """
        min_interval = 1.0 / DETECTION_FPS

        while self.running:
            if not self.has_active_camera():
                time.sleep(0.2)
                continue
            did_work = False

            for cam in list(self.cameras.values()):
                if not cam.running or not cam.is_active:
                    continue

                now = time.time()
                if now - cam.last_detection_time < min_interval:
                    continue

                with cam._state_lock:
                    if not cam.running or not cam.is_active:
                        continue
                    frame_id, frame = cam.get_latest()
                    if frame is None or frame_id == cam.last_detected_id:
                        continue

                    cam.last_detected_id = frame_id
                    cam.last_detection_time = now
                    generation = cam._generation
                    captured_at = cam.captured_at
                did_work = True

                try:
                    # Pass a copy: the detector may draw on the image in place
                    annotated_frame, detections = self.detect(frame.copy())
                    import database
                    settings = read_settings(database.get_setting)
                    detections = filter_detections(detections, settings)
                    annotated_frame = draw_detections(frame, detections)
                except Exception:
                    logger.exception("[Camera %s] Detection failed", cam.id)
                    with cam._state_lock:
                        cam.detection_persistence = {}
                        cam.detection_state = None
                        cam.overlay = None
                    continue

                with cam._state_lock:
                    if not cam.running or not cam.is_active or cam._generation != generation:
                        continue
                    cam.set_overlay(frame, annotated_frame, captured_at)
                    confirmed = self._process_detections(cam, detections, annotated_frame, settings)
                    cam.detection_state = {"frame_id": frame_id, "timestamp": time.time(),
                        "captured_at": captured_at, "detections": detections, "confirmed": list(confirmed),
                        "latency_ms": round((time.monotonic() - captured_at) * 1000)}

            if not did_work:
                time.sleep(0.005)

    def _process_detections(self, cam, detections, annotated_frame, settings=None):
        if settings is None:
            import database
            settings = read_settings(database.get_setting)
            detections = filter_detections(detections, settings)
        confirmed = confirm_frame(cam.detection_persistence, detections, settings["persistence"])
        now = time.monotonic()
        for name, confidence in confirmed.items():
            if now - cam.last_class_event_time.get(name, -1e9) < settings["cooldown"]:
                continue
            try:
                self._events.put_nowait((cam, cam._generation, name, confidence, annotated_frame.copy()))
                cam.last_class_event_time[name] = now
            except queue.Full:
                logger.warning("[Cam %s] Event queue full; retrying on next detection", cam.id)
        return confirmed

    def _save_event(self, cam, cls_name, conf, frame):
        timestamp_str = time.strftime("%Y%m%d_%H%M%S")
        filename = f"event_{timestamp_str}_{cam.id}_{cls_name}.jpg"
        # Local copy is kept until notifications (which attach the file) are done
        filepath = storage.save_snapshot(filename, frame, keep_local=True)

        snapshot_url = f"/snapshots/{filename}"
        import database
        event_id, timestamp = database.add_event(cls_name, conf, snapshot_url)

        now = time.monotonic()
        if now - cam.last_detection_log_time.get(cls_name, -1e9) >= DETECTION_LOG_INTERVAL_SECONDS:
            print(f"[Cam {cam.id}] Detected {cls_name} ({conf:.2f})")
            cam.last_detection_log_time[cls_name] = now

        if self.alert_callback:
            try:
                self.alert_callback({
                    "id": event_id,
                    "timestamp": timestamp,
                    "type": cls_name,
                    "confidence": conf,
                    "snapshot": snapshot_url,
                    "camera_name": cam.name
                })
            except Exception as e:
                print(f"Error in alert callback: {e}")

        event_camera_name = cam.name

        def notify():
            try:
                notification.trigger_notifications(cls_name, conf, filepath,
                                                   camera_name=event_camera_name)
            finally:
                storage.discard_local(filepath)

        threading.Thread(target=notify, daemon=True).start()
