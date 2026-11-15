"""Refactor boundaries: stable public routes, paths and model-free route imports."""
import json
import os
from pathlib import Path
import subprocess
import sys

from app.core.config import BACKEND_DIR, model_path
from tests.unit.test_api_security_registration import app_module


def test_previous_http_and_websocket_paths_are_registered_once(app_module):
    expected = json.loads((BACKEND_DIR / "tests/route_contract.json").read_text())
    actual = []
    def collect(routes, prefix=""):
        for route in routes:
            included = getattr(route, "original_router", None)
            if included is not None:
                context = getattr(route, "include_context", None)
                collect(included.routes, prefix + getattr(context, "prefix", ""))
            elif hasattr(route, "path"):
                methods = getattr(route, "methods", None)
                if methods:
                    actual.extend((method, prefix + route.path) for method in methods)
                else:
                    actual.append(("WEBSOCKET", prefix + route.path))

    collect(app_module.app.routes)
    for method, path in expected:
        assert actual.count((method, path)) == 1, (method, path)


def test_model_path_still_resolves_against_backend(monkeypatch):
    monkeypatch.delenv("MODEL_PATH", raising=False)
    assert Path(model_path()) == BACKEND_DIR / "best.pt"
    monkeypatch.setenv("MODEL_PATH", "models/custom.pt")
    assert Path(model_path()) == BACKEND_DIR / "models/custom.pt"


def test_route_imports_do_not_require_a_model_or_connect_to_mysql():
    script = '''
import importlib.abc
import sys
class Forbidden(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {'ultralytics', 'torch'}:
            raise AssertionError('Model runtime imported during route registration')
sys.meta_path.insert(0, Forbidden())
from unittest.mock import patch
with patch('pymysql.connect', side_effect=AssertionError('Unexpected database connection')):
    import app.bootstrap
    import app.cameras.routes
    import app.videos.routes
'''
    result = subprocess.run([sys.executable, "-c", script], cwd=BACKEND_DIR,
                            env=os.environ.copy(), capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
