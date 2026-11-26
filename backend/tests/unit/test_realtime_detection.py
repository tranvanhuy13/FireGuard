"""Offline regressions: detection rules, model scheduling, and settings.
Run: python -m unittest discover -s tests -p test_realtime_detection.py
"""

from tests.source import application_source
import ast
from pathlib import Path
import sys
import threading
import time
import unittest
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from app.detection.rules import read_settings, filter_detections, confirm_frame
from app.detection.scheduler import InferenceScheduler


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
        bg_thread = threading.Thread(target=lambda: scheduler.detect("background", background=True))
        camera = threading.Thread(target=lambda: scheduler.detect("camera"))
        first.start()
        self.assertTrue(first_started.wait(1))
        bg_thread.start()
        camera.start()
        wait_for(lambda: scheduler._cameras_waiting == 1)
        release.set()
        for thread in (first, bg_thread, camera):
            thread.join(2)
            self.assertFalse(thread.is_alive())
        self.assertEqual(calls, ["first", "camera", "background"])

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
        tree = ast.parse(application_source())
        routes = ast.Module(body=[node for node in tree.body if getattr(node, "name", None) in names], type_ignores=[])
        self.namespace = dict(app=FastAPI(), HTTPException=HTTPException, BaseModel=BaseModel,
                              notification=Mock(configuration_status=lambda owner_user_id=None: ({}, {})),
                              math=math, database=database, read_settings=read_settings,
                              Depends=Depends, get_current_user=lambda: None, log_action=Mock())
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


if __name__ == "__main__":
    unittest.main()
