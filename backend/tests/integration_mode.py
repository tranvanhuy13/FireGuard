"""Collection gate shared by modules that import the live application."""
import pytest

enabled = False


def require_integration():
    if not enabled:
        pytest.skip(
            "Application integration tests disabled; use --integration with "
            "FIREGUARD_TEST_MYSQL=1 and a disposable MYSQL_DATABASE ending in _test",
            allow_module_level=True,
        )
