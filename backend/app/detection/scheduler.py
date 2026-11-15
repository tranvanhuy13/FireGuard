"""One model owner; waiting camera requests take priority over video playback."""
import threading


class InferenceScheduler:
    def __init__(self, detector):
        self.detector = detector
        self._condition = threading.Condition()
        self._busy = False
        self._cameras_waiting = 0

    def detect(self, frame, background=False, cancelled=None):
        with self._condition:
            if not background:
                self._cameras_waiting += 1
            try:
                while self._busy or (background and self._cameras_waiting):
                    if cancelled is not None and cancelled.is_set():
                        raise InterruptedError("Analysis cancelled")
                    self._condition.wait(0.05)
                if cancelled is not None and cancelled.is_set():
                    raise InterruptedError("Analysis cancelled")
                self._busy = True
            finally:
                if not background:
                    self._cameras_waiting -= 1
        try:
            return self.detector.process_frame(frame)
        finally:
            with self._condition:
                self._busy = False
                self._condition.notify_all()
