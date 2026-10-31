"""Thread-safe settings snapshots; warm readers never wait on remote refresh."""
import logging
import threading
import time

logger = logging.getLogger(__name__)


class SettingsCache:
    def __init__(self, loader, ttl=5):
        self.loader = loader
        self.ttl = ttl
        self._lock = threading.Lock()
        self._cold_lock = threading.Lock()
        self._values = None
        self._expires = 0
        self._version = 0
        self._refreshing = False

    def peek(self):
        with self._lock:
            return dict(self._values or {})

    def put(self, key, value):
        """Called only after commit; a prior refresh must not undo this write."""
        with self._lock:
            self._version += 1
            if self._values is not None:
                self._values = {**self._values, key: value}
                self._expires = time.monotonic() + self.ttl

    def _refresh(self, version):
        try:
            values = self.loader()
            with self._lock:
                if self._version == version:
                    self._values = dict(values)
        except Exception as error:
            # Do not log SQL, settings values, credentials or driver messages.
            logger.warning("Settings refresh unavailable; retaining last valid snapshot (%s)", type(error).__name__)
        finally:
            with self._lock:
                self._expires = time.monotonic() + self.ttl
                self._refreshing = False

    def snapshot(self):
        with self._lock:
            cold = self._values is None
        if cold:
            with self._cold_lock:
                while True:
                    with self._lock:
                        if self._values is not None:
                            break
                        version = self._version
                    # With no known settings, propagate failure rather than invent thresholds.
                    values = dict(self.loader())
                    with self._lock:
                        if version != self._version:
                            continue
                        self._values = values
                        self._expires = time.monotonic() + self.ttl
                        break
        with self._lock:
            if time.monotonic() >= self._expires and not self._refreshing:
                self._refreshing = True
                threading.Thread(target=self._refresh, args=(self._version,), daemon=True,
                                 name="settings-refresh").start()
            return dict(self._values)

