"""Exercise the actual readiness handler without starting models or MySQL."""
import ast
import logging
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase, main
from unittest.mock import Mock

from fastapi import APIRouter, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient


class LauncherReadinessTests(TestCase):
    def setUp(self):
        source = Path(__file__).resolve().parents[2] / "app/core/routes.py"
        tree = ast.parse(source.read_text(encoding="utf-8"))
        handler = next(node for node in tree.body
                       if isinstance(node, ast.FunctionDef) and node.name == "database_readiness")
        self.database = SimpleNamespace(init_db=Mock())
        router = APIRouter()
        scope = dict(router=router, database=self.database, Response=Response,
                     HTTPException=HTTPException, logger=logging.getLogger(__name__))
        exec(compile(ast.Module(body=[handler], type_ignores=[]), str(source), "exec"), scope)
        app = FastAPI()
        app.add_middleware(CORSMiddleware, allow_origins=["https://frontend.example.com"],
                           allow_credentials=True)
        app.include_router(router)
        self.client = TestClient(app)

    def check_headers(self, response):
        self.assertEqual(response.headers["access-control-allow-origin"], "*")
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_launcher_can_read_ready_without_joining_api_allowlist(self):
        response = self.client.get("/health/ready", headers={"Origin": "https://launcher.example.com"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ready", "database": "mysql"})
        self.check_headers(response)
        self.database.init_db.assert_called_once()

    def test_unavailable_database_does_not_report_ready(self):
        self.database.init_db.side_effect = RuntimeError("private database error")
        response = self.client.get("/health/ready", headers={"Origin": "https://launcher.example.com"})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"detail": "Database unavailable"})
        self.check_headers(response)


if __name__ == "__main__":
    main()
