"""Exercise collection in disposable subprocesses; never import the live app."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


SOURCE = Path(__file__).resolve().parent


class TestHarnessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        tests = self.root / "tests"
        tests.mkdir()
        for name in ("__init__.py", "conftest.py", "integration_mode.py", "integration_fixtures.py",
                     "test_all_apis.py", "test_health_and_auth.py", "test_notifications.py"):
            shutil.copyfile(SOURCE / name, tests / name)
        # Any accidental import/call fails before real services can be reached.
        (self.root / "main.py").write_text(
            "raise AssertionError('LIVE_MAIN_IMPORTED')\n", encoding="utf-8")
        for package in ("auth", "db"):
            (self.root / package).mkdir()
            (self.root / package / "__init__.py").touch()
        (self.root / "auth" / "utils.py").write_text(
            "def get_password_hash(*args): raise AssertionError('HASH_CALLED')\n", encoding="utf-8")
        (self.root / "db" / "engine.py").write_text(
            "def get_connection(): raise AssertionError('DB_CONNECTED')\n", encoding="utf-8")
        (tests / "test_probe.py").write_text(
            "def test_offline():\n    assert True\n", encoding="utf-8")

    def run_pytest(self, *args, environment=None):
        env = os.environ.copy()
        for key in list(env):
            if key.startswith(("MYSQL_", "FIREGUARD_TEST_", "PYTEST_")) or key == "PYTHONPATH":
                env.pop(key)
        env["PYTEST_DISABLE_PLUGIN_AUTOLOAD"] = "1"
        env.update(environment or {})
        result = subprocess.run([sys.executable, "-m", "pytest", *args, "-q", "-rs"],
                                cwd=self.root, env=env, capture_output=True, text=True, timeout=30)
        output = result.stdout + result.stderr
        self.assertNotIn("LIVE_MAIN_IMPORTED", output)
        self.assertNotIn("DB_CONNECTED", output)
        self.assertNotIn("HASH_CALLED", output)
        return result.returncode, output

    def test_default_runs_offline_and_skips_live_modules(self):
        code, output = self.run_pytest("tests")
        self.assertEqual(code, 0, output)
        self.assertIn("1 passed, 3 skipped", output)

    def test_direct_integration_file_is_skipped_before_import(self):
        code, output = self.run_pytest("tests/test_health_and_auth.py")
        # Pytest returns 5 when the only requested module is skipped (no tests collected).
        self.assertEqual(code, 5, output)
        self.assertIn("1 skipped", output)
        self.assertIn("Application integration tests disabled", output)

    def test_developer_environment_and_dotenv_do_not_enable_integration(self):
        (self.root / ".env.local").write_text(
            "FIREGUARD_TEST_MYSQL=1\nMYSQL_DATABASE=developer\n", encoding="utf-8")
        code, output = self.run_pytest("tests", environment={
            "FIREGUARD_TEST_MYSQL": "1", "MYSQL_DATABASE": "developer"})
        self.assertEqual(code, 0, output)
        self.assertIn("1 passed, 3 skipped", output)

    def test_explicit_integration_requires_safe_environment(self):
        for env in ({}, {"MYSQL_DATABASE": "safe_test"},
                    {"FIREGUARD_TEST_MYSQL": "1", "MYSQL_DATABASE": "developer"}):
            with self.subTest(environment=env):
                code, output = self.run_pytest("tests", "--integration", environment=env)
                self.assertEqual(code, 4, output)
                self.assertIn("--integration requires", output)

    def test_valid_opt_in_registers_plugin_without_affecting_offline_tests(self):
        (self.root / "tests" / "test_probe.py").write_text(
            "from tests.integration_mode import require_integration\n"
            "def test_offline(pytestconfig):\n"
            "    require_integration()\n"
            "    assert pytestconfig.pluginmanager.hasplugin('tests.integration_fixtures')\n",
            encoding="utf-8")
        code, output = self.run_pytest("tests/test_probe.py", "--integration", environment={
            "FIREGUARD_TEST_MYSQL": "1", "MYSQL_DATABASE": "disposable_test"})
        self.assertEqual(code, 0, output)
        self.assertIn("1 passed", output)

    def test_offline_failures_still_fail_the_command(self):
        (self.root / "tests" / "test_probe.py").write_text(
            "def test_failure():\n    assert False\n", encoding="utf-8")
        code, output = self.run_pytest("tests/test_probe.py")
        self.assertEqual(code, 1, output)
        self.assertIn("1 failed", output)

    def test_default_never_runs_mysql_suite_even_with_stale_opt_in(self):
        (self.root / "tests" / "test_mysql_concurrency.py").write_text(
            "def test_database():\n    raise AssertionError('DB_CONNECTED')\n", encoding="utf-8")
        code, output = self.run_pytest("tests", environment={
            "FIREGUARD_TEST_MYSQL": "1", "MYSQL_DATABASE": "disposable_test"})
        self.assertEqual(code, 0, output)
        self.assertIn("1 passed, 4 skipped", output)


if __name__ == "__main__":
    unittest.main()
