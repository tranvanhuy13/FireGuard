"""Offline regressions: rules, model scheduling, playback, and WebSocket API.
Run: python -m unittest discover -s tests -p test_realtime_detection.py
"""
import ast
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from detection_rules import read_settings, filter_detections, confirm_frame
from inference_scheduler import InferenceScheduler

with patch.dict(sys.modules, {"storage": Mock()}):
    spec = importlib.util.spec_from_file_location("video_under_test", ROOT / "video_analyzer.py")
    video = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(video)


def detection(name="smoke", confidence=0.8):
    return {"class": name, "confidence": confidence, "bbox": [4, 20, 50, 50]}


def wait_for(predicate, timeout=4):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(0.01)
    raise AssertionError("Timed out waiting for condition")


class RulesTests(unittest.TestCase):
    def test_thresholds_and_legacy_fallback(self):
        values = {"ai_confidence_threshold": "0.3", "smoke_threshold": "70", "persistence": "3"}
        settings = read_settings(lambda key, default: values.get(key, default))
        self.assertEqual(settings["fire"], 0.3)
        self.assertEqual(settings["smoke"], 0.7)
        self.assertEqual(settings["persistence"], 3)
        self.assertEqual([d["class"] for d in filter_detections([
            detection("Flame", 0.4), detection("Smoke", 0.6), detection("person", 0.99)
        ], settings)], ["fire"])

    def test_invalid_settings_and_multiple_boxes(self):
        settings = read_settings(lambda key, default: "nan")
        self.assertEqual(settings["smoke"], 0.25)
        streak = {}
        self.assertEqual(confirm_frame(streak, [detection(), detection()], 2), {})
        self.assertEqual(streak["smoke"], 1)
        self.assertIn("smoke", confirm_frame(streak, [detection()], 2))
        confirm_frame(streak, [], 2)
        self.assertEqual(confirm_frame(streak, [detection()], 2), {})

    def test_high_confidence_still_requires_confirmation(self):
        self.assertEqual(confirm_frame({}, [detection(confidence=0.99)], 2), {})


class SchedulerTests(unittest.TestCase):
    def test_camera_priority_and_no_concurrent_model_calls(self):
        first_started, release = threading.Event(), threading.Event()
        calls = []
        def process(frame):
            calls.append(frame)
            if frame == "first":
                first_started.set()
                self.assertTrue(release.wait(2))
            return frame, []
        scheduler = InferenceScheduler(Mock(process_frame=process))
        first = threading.Thread(target=lambda: scheduler.detect("first", background=True))
        video_thread = threading.Thread(target=lambda: scheduler.detect("video", background=True))
        camera = threading.Thread(target=lambda: scheduler.detect("camera"))
        first.start()
        self.assertTrue(first_started.wait(1))
        video_thread.start()
        camera.start()
        wait_for(lambda: scheduler._cameras_waiting == 1)
        release.set()
        for thread in (first, video_thread, camera):
            thread.join(2)
            self.assertFalse(thread.is_alive())
        self.assertEqual(calls, ["first", "camera", "video"])

    def test_cancel_before_model_call(self):
        model = Mock()
        cancelled = threading.Event()
        cancelled.set()
        with self.assertRaises(InterruptedError):
            InferenceScheduler(model).detect(None, background=True, cancelled=cancelled)
        model.process_frame.assert_not_called()


class SettingsTests(unittest.TestCase):
    def setUp(self):
        from fastapi import FastAPI, HTTPException, Depends
        from pydantic import BaseModel
        import math
        self.values = {"ai_confidence_threshold": "0.25"}
        database = Mock()
        database.get_setting.side_effect = lambda key, default: self.values.get(key, default)
        database.get_all_settings.side_effect = lambda: dict(self.values)
        database.set_setting.side_effect = lambda key, value: self.values.update({key: value})
        names = {"SettingsModel", "get_settings", "save_setting"}
        tree = ast.parse((ROOT / "main.py").read_text(encoding="utf-8-sig"))
        routes = ast.Module(body=[node for node in tree.body if getattr(node, "name", None) in names], type_ignores=[])
        self.namespace = dict(app=FastAPI(), HTTPException=HTTPException, BaseModel=BaseModel,
                              math=math, database=database, read_settings=read_settings,
                              Depends=Depends, get_current_user=lambda: None)
        exec(compile(routes, str(ROOT / "main.py"), "exec"), self.namespace)

    def test_ui_settings_expose_effective_values_and_update_rules(self):
        self.assertEqual(float(self.namespace["get_settings"](Mock(role="admin"))["settings"]["smoke_threshold"]), 25)
        self.namespace["save_setting"](self.namespace["SettingsModel"](key="smoke_threshold", value="80"), Mock(role="admin"))
        settings = read_settings(lambda key, default: self.values.get(key, default))
        self.assertEqual(settings["smoke"], 0.8)
        self.assertEqual(settings["fire"], 0.25)
        self.assertEqual(filter_detections([detection(confidence=0.7)], settings), [])

    def test_invalid_settings_are_rejected(self):
        from fastapi import HTTPException
        for key, value in [("smoke_threshold", "nan"), ("fire_threshold", "101"),
                           ("persistence", "0"), ("persistence", "1.5"), ("cooldown", "-1")]:
            with self.subTest(key=key, value=value), self.assertRaises(HTTPException) as error:
                self.namespace["save_setting"](self.namespace["SettingsModel"](key=key, value=value), Mock(role="admin"))
            self.assertEqual(error.exception.status_code, 400)
        self.namespace["database"].set_setting.assert_not_called()


class PlaybackTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="playback_", dir=ROOT / "tests")
        self.addCleanup(self.tmp.cleanup)
        self.uploads_patch = patch.object(video, "UPLOAD_DIR", self.tmp.name)
        self.uploads_patch.start()
        self.addCleanup(self.uploads_patch.stop)
        self.values = {"persistence": "2", "fire_threshold": "50", "smoke_threshold": "50"}
        self.detector = Mock(side_effect=lambda frame, **kwargs: (frame, [detection(), detection("fire")]))
        self.analyzer = video.VideoAnalyzer(self.detector, lambda key, default: self.values.get(key, default))
        self.addCleanup(self.analyzer.shutdown)
        video.storage.reset_mock()

    def source(self, frames=12):
        path = os.path.join(self.tmp.name, "clip_" + str(time.time_ns())[-8:] + ".avi")
        writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"MJPG"), 10, (64, 64))
        self.assertTrue(writer.isOpened())
        for _ in range(frames):
            writer.write(np.zeros((64, 64, 3), dtype=np.uint8))
        writer.release()
        return path

    def submit(self, frames=12):
        return self.analyzer.submit(self.source(frames), "sample.avi", 10)

    def test_synchronized_frames_and_independent_fire_smoke_events(self):
        job_id = self.submit(4)
        job = wait_for(lambda: (j if (j := self.analyzer.get(job_id, True))["status"] == "done" else None))
        self.assertEqual(job["frames_analyzed"], 4)
        self.assertEqual(job["frame_id"], 4)
        self.assertAlmostEqual(job["current_time"], 0.3)
        self.assertEqual(set(job["summary"]), {"fire", "smoke"})
        self.assertEqual({event["class"] for event in job["events"]}, {"fire", "smoke"})
        self.assertTrue(job["frame"])
        self.assertNotIn("frame", self.analyzer.get(job_id))
        self.assertTrue(all(call.kwargs["background"] for call in self.detector.call_args_list))

    def test_pause_resume_restart_and_cancel(self):
        job_id = self.submit(20)
        wait_for(lambda: self.analyzer.get(job_id)["frames_analyzed"] >= 2)
        self.analyzer.playback(job_id, "pause")
        time.sleep(0.15)  # allow any single in-flight inference to finish
        before = self.analyzer.get(job_id)["frame_id"]
        time.sleep(0.2)
        self.assertEqual(self.analyzer.get(job_id)["frame_id"], before)
        self.assertEqual(self.analyzer.get(job_id)["status"], "paused")
        self.analyzer.playback(job_id, "resume")
        wait_for(lambda: self.analyzer.get(job_id)["frame_id"] > before)
        new_id = self.analyzer.playback(job_id, "restart")
        self.assertNotEqual(new_id, job_id)
        wait_for(lambda: self.analyzer.get(new_id)["frame_id"] >= 1)
        self.analyzer.cancel(new_id)
        wait_for(lambda: self.analyzer.get(new_id)["status"] == "cancelled")

    def test_queued_cancellation_does_not_wait_for_running_video(self):
        running = self.submit(50)
        wait_for(lambda: self.analyzer.get(running)["frame_id"] >= 1)
        queued = self.submit()
        self.analyzer.cancel(queued)
        wait_for(lambda: self.analyzer.get(queued)["status"] == "cancelled", timeout=1)
        self.assertEqual(self.analyzer.get(running)["status"], "processing")

    def test_negative_and_corrupt_input(self):
        self.detector.side_effect = lambda frame, **kwargs: (frame, [])
        job_id = self.submit(2)
        wait_for(lambda: self.analyzer.get(job_id)["status"] == "done")
        self.assertEqual(self.analyzer.get(job_id)["verdict"], "none")
        bad = Path(self.tmp.name) / "broken.avi"
        bad.write_bytes(b"invalid")
        bad_id = self.analyzer.submit(str(bad), "broken.avi", 10)
        wait_for(lambda: self.analyzer.get(bad_id)["status"] == "error")

    def test_each_class_can_confirm_on_its_own(self):
        for name in ("fire", "smoke"):
            with self.subTest(name=name):
                self.detector.side_effect = lambda frame, name=name, **kwargs: (frame, [detection(name)])
                job_id = self.submit(2)
                wait_for(lambda: self.analyzer.get(job_id)["status"] == "done")
                self.assertEqual(self.analyzer.get(job_id)["verdict"], name)
                self.assertEqual(set(self.analyzer.get(job_id)["summary"]), {name})

    def test_replay_keeps_source_when_original_job_is_evicted(self):
        with patch.object(video, "MAX_JOBS_KEPT", 1):
            job_id = self.submit(2)
            wait_for(lambda: self.analyzer.get(job_id)["status"] == "done")
            self.analyzer._controls[job_id]["thread"].join(1)
            source = self.analyzer._controls[job_id]["path"]
            new_id = self.analyzer.playback(job_id, "restart")
            wait_for(lambda: self.analyzer.get(new_id)["status"] == "done")
            self.assertIsNone(self.analyzer.get(job_id))
            self.assertTrue(os.path.exists(source))

    def test_low_throughput_reports_buffering(self):
        def slow(frame, **kwargs):
            time.sleep(0.15)
            return frame, []
        self.detector.side_effect = slow
        job_id = self.submit(5)
        wait_for(lambda: self.analyzer.get(job_id)["buffering"])
        self.assertLess(self.analyzer.get(job_id)["effective_fps"], 10)

    def test_shutdown_removes_retained_uploads(self):
        self.submit(2)
        self.analyzer.shutdown()
        self.assertEqual(os.listdir(self.tmp.name), [])

    def test_http_and_websocket_playback_contract(self):
        from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends
        from pydantic import BaseModel, ValidationError
        from typing import Literal
        from unittest.mock import AsyncMock
        import asyncio
        # Exercise the real route handlers in-process: no production database,
        # webcam, notifications, or network sockets are opened by these tests.
        names = {"PlaybackControl", "control_video_playback", "video_analysis_updates", "get_video_analysis", "cancel_video_analysis"}
        tree = ast.parse((ROOT / "main.py").read_text(encoding="utf-8-sig"))
        routes = ast.Module(body=[node for node in tree.body if getattr(node, "name", None) in names], type_ignores=[])
        namespace = dict(app=FastAPI(), WebSocket=WebSocket, WebSocketDisconnect=WebSocketDisconnect,
                         HTTPException=HTTPException, BaseModel=BaseModel, Literal=Literal,
                         asyncio=asyncio, video_analyzer=self.analyzer, time=time,
                         Depends=Depends, get_current_user=lambda: None,
                         authorize_websocket=AsyncMock(return_value=True))
        exec(compile(routes, str(ROOT / "main.py"), "exec"), namespace)
        job_id = self.submit(20)
        self.assertEqual(namespace["get_video_analysis"](job_id)["id"], job_id)
        control_type = namespace["PlaybackControl"]
        with self.assertRaises(ValidationError):
            control_type(action="seek")
        with self.assertRaises(HTTPException) as missing:
            namespace["control_video_playback"]("missing", control_type(action="pause"))
        self.assertEqual(missing.exception.status_code, 404)
        namespace["control_video_playback"](job_id, control_type(action="pause"))
        websocket = Mock(accept=AsyncMock(), send_json=AsyncMock(),
                         receive_text=AsyncMock(side_effect=WebSocketDisconnect()), close=AsyncMock())
        async def immediate_wait(awaitable, timeout):
            return await awaitable
        coroutine = namespace["video_analysis_updates"](websocket, job_id)
        with patch.object(asyncio, "wait_for", immediate_wait):
            with self.assertRaises(StopIteration):
                coroutine.send(None)
        update = websocket.send_json.call_args.args[0]
        self.assertEqual(update["id"], job_id)
        self.assertIn("frame_id", update)
        result = namespace["control_video_playback"](job_id, control_type(action="restart"))
        self.assertNotEqual(result["job_id"], job_id)
        self.assertEqual(namespace["cancel_video_analysis"](result["job_id"])["status"], "ok")


if __name__ == "__main__":
    unittest.main()
