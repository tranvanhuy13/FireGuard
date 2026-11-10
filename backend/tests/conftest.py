"""Safe default collection; application integration tests require explicit opt-in."""
import os
from pathlib import Path
import sys

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def pytest_addoption(parser):
    parser.addoption("--integration", action="store_true", default=False,
                     help="Enable application integration tests against a disposable *_test MySQL database")


def pytest_configure(config):
    from tests import integration_mode
    integration_mode.enabled = False
    if not config.getoption("--integration"):
        return
    # Never infer opt-in from developer dotenv files or import main before validation.
    if (os.getenv("FIREGUARD_TEST_MYSQL") != "1"
            or not os.getenv("MYSQL_DATABASE", "").endswith("_test")):
        raise pytest.UsageError(
            "--integration requires FIREGUARD_TEST_MYSQL=1 and MYSQL_DATABASE ending in _test")
    integration_mode.enabled = True
    config.pluginmanager.import_plugin("tests.integration_fixtures")


def pytest_collection_modifyitems(config, items):
    if config.getoption("--integration"):
        return
    for item in items:
        if item.path.name == "test_mysql_concurrency.py":
            item.add_marker(pytest.mark.skip(reason="Real MySQL checks require --integration"))
