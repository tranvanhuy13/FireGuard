import cv2
import threading
import time
import os
import logging
from collections import namedtuple

import numpy as np

import notification
import storage

logger = logging.getLogger(__name__)

CAMERA_FPS = 30                  # target capture / stream rate
SNAPSHOT_INTERVAL_SECONDS = 10    # periodic snapshot per camera
DETECTION_FPS = 10               # max AI inferences per second per camera
OVERLAY_TTL_SECONDS = 1.0        # hide boxes if detector stalls longer than this
RECONNECT_DELAY_SECONDS = 10
MAX_READ_FAILURES = 5
JPEG_QUALITY = 80


# Detection overlay: annotated pixels + boolean mask of pixels the detector drew
Overlay = namedtuple("Overlay", "pixels mask timestamp")


def save_snapshot_async(cam_id, frame):
    """Save a snapshot on a worker thread so disk / network I/O never stalls capture."""
    def task(img):
        filename = f"periodic_{time.strftime('%Y%m%d_%H%M%S')}_cam_{cam_id}.jpg"
        storage.save_snapshot(filename, img)
        logger.info("[Cam %s] Periodic snapshot saved: %s", cam_id, filename)

    threading.Thread(target=task, args=(frame.copy(),), daemon=True).start()


class Camera:
    """
    One camera = one capture thread.

    The capture thread does nothing but read frames (~30 FPS), publish the
    newest one, and trigger the 5-second snapshot. AI detection runs elsewhere
    and can never slow the stream down.
    """

    def __init__(self, id, source, name="Camera", is_active=True):
        self.id = id
        self.source = source
        self.name = name
        self.is_active = is_active

        self._stop = threading.Event()
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

        self.last_periodic_snapshot_time = 0
        self.last_no_frame_log = 0

        self.status = "connecting"
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
        self._stop.set()
        self.status = "disconnected"

    # ---------------------------------------------------------------- capture
    def _open(self):
        self.status = "connecting"
        try:
            src = int(self.source)
        except (TypeError, ValueError):
            src = self.source

        cap = cv2.VideoCapture(src)
        if isinstance(src, int):
            # USB webcams only reach 30 FPS at higher resolutions with MJPG
            cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
            cap.set(cv2.CAP_PROP_FPS, CAMERA_FPS)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # always read the freshest frame

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

    def _maybe_snapshot(self, frame):
        now = time.time()
        if now - self.last_periodic_snapshot_time >= SNAPSHOT_INTERVAL_SECONDS:
            self.last_periodic_snapshot_time = now
            save_snapshot_async(self.id, frame)

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
            ok, frame = self.cap.read()

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

    def set_overlay(self, original, annotated):
        """
        Remember what the detector drew (boxes/labels) so it can be painted on
        top of every new raw frame, keeping the annotated stream at full FPS.
        """
        if annotated is None or annotated.shape != original.shape:
            self.overlay = None
            return
        mask = np.any(annotated != original, axis=2)
        self.overlay = Overlay(annotated, mask, time.time()) if mask.any() else None

    # -------------------------------------------------------------- streaming
    def _compose(self, frame):
        ov = self.overlay
        if (ov is not None
                and time.time() - ov.timestamp < OVERLAY_TTL_SECONDS
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
        self.detector_lock = threading.Lock()
        self.running = True
        self.alert_callback = None

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
                source = db_cam["source"]
                is_active = db_cam["is_active"] == 1

                if cam_id in self.cameras:
                    self.cameras[cam_id].name = name
                    self.cameras[cam_id].source = source
                    self.cameras[cam_id].is_active = is_active
                else:
                    self.cameras[cam_id] = Camera(cam_id, source, name, is_active)
            print(f"Loaded {len(db_cams)} cameras from database.")
        except Exception as e:
            print(f"Error loading cameras from database: {e}")

    def add_camera(self, source, name="Camera"):
        import database
        cam_id = database.add_db_camera(name, source, 1)
        self.cameras[cam_id] = Camera(cam_id, source, name, True)
        return cam_id

    def remove_camera(self, camera_id):
        import database
        cam = self.cameras.pop(camera_id, None)
        if cam is None:
            return False
        cam.stop()
        database.delete_db_camera(camera_id)
        return True

    def toggle_camera(self, camera_id, is_active):
        import database
        cam = self.cameras.get(camera_id)
        if cam is None:
            return False
        cam.is_active = is_active          # capture thread reacts on its own
        database.set_db_camera_status(camera_id, is_active)
        return True

    def shutdown(self):
        self.running = False
        for cam in list(self.cameras.values()):
            cam.stop()

    def detect(self, frame):
        """Run the shared AI model (thread-safe). Returns (annotated_frame, detections)."""
        with self.detector_lock:
            return self.detector.process_frame(frame)

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
            did_work = False

            for cam in list(self.cameras.values()):
                if not cam.running or not cam.is_active:
                    continue

                now = time.time()
                if now - cam.last_detection_time < min_interval:
                    continue

                frame_id, frame = cam.get_latest()
                if frame is None or frame_id == cam.last_detected_id:
                    continue

                cam.last_detected_id = frame_id
                cam.last_detection_time = now
                did_work = True

                try:
                    # Pass a copy: the detector may draw on the image in place
                    annotated_frame, detections = self.detect(frame.copy())
                except Exception:
                    logger.exception("[Camera %s] Detection failed", cam.id)
                    continue

                cam.set_overlay(frame, annotated_frame)

                if detections:
                    self._process_detections(cam, detections, annotated_frame)
                else:
                    cam.detection_persistence = {}

            if not did_work:
                time.sleep(0.005)

    def _process_detections(self, cam, detections, annotated_frame):
        current_classes = set()

        import database
        try:
            conf_threshold = float(database.get_setting("ai_confidence_threshold", "0.25"))
            persistence_limit = int(database.get_setting("ai_persistence_frames", "2"))
            configured_cooldown = float(database.get_setting("ai_cooldown_seconds", "5"))
            cooldown_seconds = max(configured_cooldown, SNAPSHOT_INTERVAL_SECONDS)
        except Exception:
            conf_threshold = 0.25
            persistence_limit = 2
            cooldown_seconds = 5

        for det in detections:
            cls_name = det["class"]
            conf = det["confidence"]

            if conf < conf_threshold:
                continue

            current_classes.add(cls_name)
            cam.detection_persistence[cls_name] = cam.detection_persistence.get(cls_name, 0) + 1

            if cam.detection_persistence[cls_name] >= persistence_limit or conf > 0.6:
                current_time = time.time()
                if current_time - cam.last_event_time > cooldown_seconds:
                    self._save_event(cam, cls_name, conf, annotated_frame)
                    cam.last_event_time = current_time
                    break

        for existing_cls in list(cam.detection_persistence.keys()):
            if existing_cls not in current_classes:
                cam.detection_persistence[existing_cls] = 0

    def _save_event(self, cam, cls_name, conf, frame):
        timestamp_str = time.strftime("%Y%m%d_%H%M%S")
        filename = f"event_{timestamp_str}_{cam.id}_{cls_name}.jpg"
        # Local copy is kept until notifications (which attach the file) are done
        filepath = storage.save_snapshot(filename, frame, keep_local=True)

        snapshot_url = f"/snapshots/{filename}"
        import database
        event_id, timestamp = database.add_event(cls_name, conf, snapshot_url)

        print(f"[Cam {cam.id}] Detected {cls_name} ({conf:.2f})")

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

        def notify():
            try:
                notification.trigger_notifications(cls_name, conf, filepath)
            finally:
                storage.discard_local(filepath)

        threading.Thread(target=notify, daemon=True).start()