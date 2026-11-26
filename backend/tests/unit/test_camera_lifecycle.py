"""Isolated camera regression checks; no model, database, or webcam required.

Run with: python -m unittest discover -s tests -p test_camera_lifecycle.py
"""

from tests.mocks import module_mocks
import importlib.util
import sys
import threading
import queue
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
with module_mocks({'app.notifications.service': Mock(), 'app.storage.service': Mock()}):
    spec = importlib.util.spec_from_file_location(
        "camera_lifecycle_under_test", Path(__file__).resolve().parents[2] / "app/cameras/manager.py"
    )
    cm = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cm)


class CameraLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.capture = Mock()
        self.capture.isOpened.return_value = True
        self.capture.read.return_value = (True, np.zeros((2, 2, 3), dtype=np.uint8))
        self.open_patch = patch.object(cm.cv2, "VideoCapture", return_value=self.capture)
        self.open_capture = self.open_patch.start()
        self.addCleanup(self.open_patch.stop)
        self.cameras = []
        cm.storage.save_snapshot.reset_mock()

    def tearDown(self):
        for camera in self.cameras:
            camera.stop()
        for camera in self.cameras:
            camera.thread.join(timeout=2)
            self.assertFalse(camera.thread.is_alive())

    def camera(self, active=False, source="0"):
        camera = cm.Camera(len(self.cameras) + 1, source, is_active=active)
        self.cameras.append(camera)
        return camera

    def test_disabled_camera_never_opens_laptop_camera(self):
        camera = self.camera()
        camera.thread.join(timeout=0.25)
        self.open_capture.assert_not_called()
        cm.storage.save_snapshot.assert_not_called()
        self.assertEqual(camera.status, "disconnected")

    def test_database_restore_requires_explicit_webcam_enable(self):
        manager = cm.CameraManager.__new__(cm.CameraManager)
        manager.cameras = {}
        database = Mock()
        database.get_all_db_cameras.return_value = [
            {"id": 1, "name": "Laptop", "source": "0", "is_active": 1, "owner_user_id": 1},
            {"id": 2, "name": "Network", "source": "rtsp://camera.local/live", "is_active": 1, "owner_user_id": 1},
        ]
        with module_mocks({'app.db.repositories.operations': database}):
            with patch.object(cm, "Camera") as camera_factory:
                manager.load_cameras_from_db()
                self.assertFalse(camera_factory.call_args_list[0].args[3])
                self.assertTrue(camera_factory.call_args_list[1].args[3])
        database.set_db_camera_status.assert_not_called()

    def test_capture_recovers_after_opencv_open_error(self):
        self.open_capture.side_effect = [cm.cv2.error('open failed'), self.capture]
        with patch.object(cm, 'RECONNECT_DELAY_SECONDS', 0.01):
            camera = self.camera(active=True, source='rtsp://camera.local/live')
            deadline = time.monotonic() + 2
            while camera.last_frame is None and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertIsNotNone(camera.last_frame)
            self.assertTrue(camera.thread.is_alive())

    def test_capture_recovers_after_opencv_read_error(self):
        def failed_read():
            self.capture.read.side_effect = None
            raise cm.cv2.error('read failed')

        self.capture.read.side_effect = failed_read
        with patch.object(cm, 'RECONNECT_DELAY_SECONDS', 0.01):
            camera = self.camera(active=True)
            deadline = time.monotonic() + 2
            while camera.last_frame is None and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertIsNotNone(camera.last_frame)
            self.assertTrue(camera.thread.is_alive())
            camera.stop()

    def test_disable_during_read_discards_frame_and_releases_device(self):
        reading, finish_read, released = threading.Event(), threading.Event(), threading.Event()

        def read():
            reading.set()
            finish_read.wait(2)
            return True, np.zeros((2, 2, 3), dtype=np.uint8)

        self.capture.read.side_effect = read
        self.capture.release.side_effect = released.set
        camera = self.camera(active=True)
        self.assertTrue(reading.wait(1))
        camera.set_active(False)
        finish_read.set()
        self.assertTrue(released.wait(1))
        self.assertIsNone(camera.last_frame)
        self.assertIsNone(camera.get_jpeg())
        cm.storage.save_snapshot.assert_not_called()
        calls = self.open_capture.call_count
        camera.thread.join(timeout=0.25)
        self.assertEqual(self.open_capture.call_count, calls)

    def test_disable_during_open_releases_unwanted_capture(self):
        opening, finish_open, released = threading.Event(), threading.Event(), threading.Event()

        def open_capture(_source):
            opening.set()
            finish_open.wait(2)
            return self.capture

        self.open_capture.side_effect = open_capture
        self.capture.release.side_effect = released.set
        camera = self.camera(active=True)
        self.assertTrue(opening.wait(1))
        camera.set_active(False)
        finish_open.set()
        self.assertTrue(released.wait(1))
        self.capture.read.assert_not_called()
        cm.storage.save_snapshot.assert_not_called()
        self.assertEqual(camera.status, "disconnected")

    def test_queued_snapshot_cancelled_even_after_reenable(self):
        camera = self.camera()
        with camera._state_lock:
            camera.set_active(True)
            with patch.object(cm.threading, "Thread") as worker:
                cm.save_snapshot_async(camera, np.zeros((2, 2, 3)), camera._generation)
            task = worker.call_args.kwargs
            camera.set_active(False)
            task["target"](*task["args"])
            camera.set_active(True)
            task["target"](*task["args"])
            camera.set_active(False)
            cm.storage.save_snapshot.assert_not_called()

    def test_manager_disables_all_cameras_and_allows_restart(self):
        manager = cm.CameraManager.__new__(cm.CameraManager)
        manager._mutation_lock = threading.RLock()
        camera = self.camera()
        manager.cameras = {camera.id: camera}
        saved = threading.Event()
        with module_mocks({'app.db.repositories.operations': Mock()}), patch.object(
            cm.storage, "save_snapshot", side_effect=lambda *_a: saved.set()
        ):
            self.assertTrue(manager.toggle_camera(camera.id, True))
            self.assertTrue(saved.wait(1))
            self.assertTrue(manager.toggle_camera(camera.id, False))
            self.assertFalse(manager.has_active_camera())
            self.assertIsNone(camera.get_jpeg())
            count = cm.storage.save_snapshot.call_count
            camera.thread.join(timeout=0.25)
            self.assertEqual(cm.storage.save_snapshot.call_count, count)
            saved.clear()
            self.assertTrue(manager.toggle_camera(camera.id, True))
            self.assertTrue(saved.wait(1))
            manager.toggle_camera(camera.id, False)

    def test_two_tiles_share_device_until_last_tile_is_disabled(self):
        first_ready, second_ready = threading.Event(), threading.Event()

        def saved(filename, _frame):
            (first_ready if 'cam_1_' in filename else second_ready).set()

        with patch.object(cm.storage, 'save_snapshot', side_effect=saved):
            first = self.camera(active=True)
            second = self.camera(active=True)
            self.assertTrue(first_ready.wait(1))
            self.assertTrue(second_ready.wait(1))
            self.open_capture.assert_called_once_with(0)
            first.set_active(False)
            first.thread.join(timeout=0.3)
            self.capture.release.assert_not_called()
            self.assertIsNotNone(second.get_latest()[1])
            second.set_active(False)
            second.thread.join(timeout=0.3)
            self.capture.release.assert_called_once()
            self.assertFalse(cm.SharedWebcam._devices)

    def test_shared_webcam_reuses_frame_for_multiple_tiles(self):
        first = cm.SharedWebcam.acquire(0)
        second = cm.SharedWebcam.acquire(0)
        try:
            with patch.object(cm.time, 'monotonic', return_value=100):
                first_frame = first.read()[1]
                self.assertIs(first_frame, second.read()[1])
                self.capture.read.assert_called_once()
            first.release()
            self.capture.release.assert_not_called()
        finally:
            first.release()
            second.release()
        self.capture.release.assert_called_once()

    def test_configured_and_new_cameras_keep_their_sources(self):
        manager = cm.CameraManager.__new__(cm.CameraManager)
        manager._mutation_lock = threading.RLock()
        manager.cameras = {}
        database = Mock()
        database.get_all_db_cameras.return_value = [
            {'id': 1, 'name': 'Gate', 'source': 'rtsp://old', 'is_active': 0, 'owner_user_id': 1},
            {'id': 2, 'name': 'Lobby', 'source': '1', 'is_active': 0, 'owner_user_id': 1},
        ]
        database.add_db_camera.return_value = 3
        with module_mocks({'app.db.repositories.operations': database}), patch.object(cm, 'Camera') as camera:
            manager.load_cameras_from_db()
            self.assertEqual([call.args[1] for call in camera.call_args_list], ['rtsp://old', '1'])
            manager.add_camera('rtsp://old', 'New', False)
            database.add_db_camera.assert_called_once_with('New', 'rtsp://old', 0)
            database.update_db_camera.assert_not_called()

    def test_source_update_rolls_back_on_database_failure(self):
        manager = cm.CameraManager.__new__(cm.CameraManager)
        manager._mutation_lock = threading.RLock()
        camera = self.camera()
        manager.cameras = {camera.id: camera}
        database = Mock()
        with module_mocks({'app.db.repositories.operations': database}):
            database.update_db_camera.side_effect = RuntimeError('unavailable')
            with self.assertRaises(RuntimeError):
                manager.update_camera(camera.id, 'New', True, source='1')
            self.assertEqual(camera.source, '0')
            self.assertFalse(camera.is_active)
            database.update_db_camera.side_effect = None
            manager.update_camera(camera.id, 'New', False, source='1')
            self.assertEqual(camera.source, '1')
            database.update_db_camera.assert_called_with(camera.id, 'New', '1', False)

    def test_switch_source_during_read_drops_old_frame_and_reopens(self):
        reading, finish_read, reopened = threading.Event(), threading.Event(), threading.Event()
        old_capture = self.capture
        next_capture = Mock()
        next_capture.isOpened.return_value = True
        next_capture.read.return_value = (False, None)

        def read():
            reading.set()
            finish_read.wait(2)
            return True, np.ones((2, 2, 3), dtype=np.uint8)

        def open_capture(source, *args):
            if source == 0:
                return old_capture
            reopened.set()
            return next_capture

        old_capture.read.side_effect = read
        self.open_capture.side_effect = open_capture
        camera = self.camera(active=True)
        self.assertTrue(reading.wait(1))
        camera.configure('Network camera', 'https://camera.example/live.m3u8', True)
        finish_read.set()
        self.assertTrue(reopened.wait(1))
        self.assertIsNone(camera.last_frame)
        old_capture.release.assert_called_once()
        call = self.open_capture.call_args
        self.assertEqual(call.args[0], 'https://camera.example/live.m3u8')
        self.assertIn(cm.cv2.CAP_PROP_READ_TIMEOUT_MSEC, call.args[2])

    def test_frame_freshness_does_not_depend_on_ai_and_stale_jpeg_is_hidden(self):
        manager = cm.CameraManager.__new__(cm.CameraManager)
        camera = self.camera()
        manager.cameras = {camera.id: camera}
        with camera._state_lock:
            camera.set_active(True)
            camera._publish(np.zeros((2, 2, 3), dtype=np.uint8))
            state = manager.detection_states()[0]
            self.assertTrue(state['frame_fresh'])
            self.assertTrue(state['stale'])  # No AI result yet, but capture is live.
            self.assertIsNotNone(camera.get_jpeg())
            camera.captured_at = time.monotonic() - 7
            self.assertFalse(manager.detection_states()[0]['frame_fresh'])
            self.assertIsNone(camera.get_jpeg())
            camera.set_active(False)

    def test_source_changed_during_jpeg_encoding_discards_old_picture(self):
        camera = self.camera()
        with camera._state_lock:
            camera.set_active(True)
            camera._publish(np.zeros((2, 2, 3), dtype=np.uint8))

            def encode(*_args):
                camera.configure('Other device', '1', True)
                return True, np.array([1, 2, 3], dtype=np.uint8)

            with patch.object(cm.cv2, 'imencode', side_effect=encode):
                self.assertIsNone(camera.get_jpeg())
            camera.set_active(False)


    def test_failed_camera_writes_preserve_live_state_and_allow_retry(self):
        manager = cm.CameraManager.__new__(cm.CameraManager)
        manager._mutation_lock = threading.RLock()
        camera = self.camera()
        manager.cameras = {camera.id: camera}
        database = Mock()
        with module_mocks({'app.db.repositories.operations': database}):
            database.set_db_camera_status.side_effect = RuntimeError('database unavailable')
            with self.assertRaises(RuntimeError):
                manager.toggle_camera(camera.id, True)
            self.assertFalse(camera.is_active)
            database.delete_db_camera.side_effect = RuntimeError('database unavailable')
            with self.assertRaises(RuntimeError):
                manager.remove_camera(camera.id)
            self.assertIs(manager.cameras[camera.id], camera)
            self.assertTrue(camera.running)
            database.set_db_camera_status.side_effect = None
            self.assertTrue(manager.toggle_camera(camera.id, True))
            self.assertTrue(camera.is_active)
            database.delete_db_camera.side_effect = None
            self.assertTrue(manager.remove_camera(camera.id))
            self.assertFalse(camera.running)
            self.assertNotIn(camera.id, manager.cameras)

    def test_fire_and_smoke_have_independent_confirmation_and_cooldowns(self):
        manager = cm.CameraManager.__new__(cm.CameraManager)
        manager._events = queue.Queue(maxsize=10)
        camera = self.camera()
        settings = {"fire": 0.5, "smoke": 0.5, "persistence": 2, "cooldown": 60}
        detections = [{"class": "fire", "confidence": 0.8},
                      {"class": "smoke", "confidence": 0.8},
                      {"class": "smoke", "confidence": 0.9}]
        frame = np.zeros((2, 2, 3), dtype=np.uint8)
        self.assertEqual(manager._process_detections(camera, detections, frame, settings), {})
        self.assertEqual(manager._events.qsize(), 0)
        confirmed = manager._process_detections(camera, detections, frame, settings)
        self.assertEqual(set(confirmed), {"fire", "smoke"})
        self.assertEqual(manager._events.qsize(), 2)
        manager._process_detections(camera, detections, frame, settings)
        self.assertEqual(manager._events.qsize(), 2)
        manager._process_detections(camera, [], frame, settings)
        self.assertEqual(camera.detection_persistence, {"fire": 0, "smoke": 0})

    def test_event_evidence_is_unique_and_notifications_preserve_source(self):
        manager = cm.CameraManager.__new__(cm.CameraManager)
        manager.alert_callback = Mock()
        camera = self.camera()
        database = Mock()
        database.add_event.return_value = (1, "2026-11-09 12:00:00")
        frame = np.zeros((2, 2, 3), dtype=np.uint8)
        with module_mocks({'app.db.repositories.operations': database}), patch.object(cm.threading, "Thread") as worker:
            manager._save_event(camera, "fire", 0.9, frame)
            first = cm.storage.save_snapshot.call_args.args[0]
            worker.call_args.kwargs["target"]()
            cm.notification.trigger_notifications.assert_called_with("fire", 0.9, cm.storage.save_snapshot.return_value,
                                                                    camera_name=camera.name, owner_user_id=camera.owner_user_id)
            manager._save_event(camera, "fire", 0.9, frame)
            self.assertNotEqual(first, cm.storage.save_snapshot.call_args.args[0])
            self.assertEqual(database.add_event.call_args.kwargs, {"camera_id": camera.id, "camera_name": camera.name, "owner_user_id": None})

    def test_detection_metadata_and_overlay_expire(self):
        manager = cm.CameraManager.__new__(cm.CameraManager)
        camera = self.camera()
        manager.cameras = {camera.id: camera}
        camera.detection_state = {"captured_at": time.monotonic() - 2,
                                  "detections": [{"class": "smoke"}], "confirmed": ["smoke"]}
        state = manager.detection_states()[0]
        self.assertTrue(state["stale"])
        self.assertEqual(state["detections"], [])
        original = np.zeros((2, 2, 3), dtype=np.uint8)
        annotated = np.ones_like(original)
        camera.set_overlay(original, annotated, time.monotonic() - 2)
        self.assertTrue(np.array_equal(camera._compose(original), original))


if __name__ == "__main__":
    unittest.main()
