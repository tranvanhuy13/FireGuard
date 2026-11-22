"""Offline deployment contract: no database mutations or server processes."""
import importlib.util
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from scripts import start_server


@pytest.mark.parametrize("failure", [False, True])
def test_migration_uses_locked_connection_and_always_releases(failure):
    connection = MagicMock()
    connection.execute.return_value.scalar.return_value = 1
    engine = MagicMock()
    engine.connect.return_value.__enter__.return_value = connection
    error = RuntimeError("migration failed") if failure else None
    with patch("app.db.engine.get_engine", return_value=engine), \
         patch("app.db.engine.dispose_engine") as dispose, \
         patch("alembic.command.upgrade", side_effect=error) as upgrade:
        if failure:
            with pytest.raises(RuntimeError, match="migration failed"):
                start_server.migrate()
        else:
            start_server.migrate()
        assert upgrade.call_args.args[0].attributes["connection"] is connection
        assert upgrade.call_args.args[1] == "head"
        assert "GET_LOCK" in str(connection.execute.call_args_list[0].args[0])
        assert "RELEASE_LOCK" in str(connection.execute.call_args_list[-1].args[0])
        dispose.assert_called_once()


def test_lock_timeout_never_attempts_migration():
    engine = MagicMock()
    engine.connect.return_value.__enter__.return_value.execute.return_value.scalar.return_value = 0
    with patch("app.db.engine.get_engine", return_value=engine), \
         patch("app.db.engine.dispose_engine"), patch("alembic.command.upgrade") as upgrade:
        with pytest.raises(RuntimeError, match="migration lock"):
            start_server.migrate()
        upgrade.assert_not_called()


def test_failed_migration_never_opens_api_port():
    with patch.object(start_server.os, "chdir"), \
         patch.object(start_server, "migrate", side_effect=RuntimeError("failed")), \
         patch.object(start_server.os, "execv") as execute:
        with pytest.raises(RuntimeError):
            start_server.main()
        execute.assert_not_called()


def test_startup_migrates_before_exec_and_uses_render_port(monkeypatch):
    monkeypatch.setenv("PORT", "10000")
    calls = []
    with patch.object(start_server.os, "chdir"), \
         patch.object(start_server, "migrate", side_effect=lambda: calls.append("migrate")), \
         patch.object(start_server.os, "execv", side_effect=lambda *_: calls.append("exec")) as execute:
        start_server.main()
    assert calls == ["migrate", "exec"]
    assert "10000" in execute.call_args.args[1]
    assert "0.0.0.0" in execute.call_args.args[1]


def migration():
    path = Path(__file__).resolve().parents[2] / "migrations/versions/0007_history_audit_indexes.py"
    spec = importlib.util.spec_from_file_location("history_indexes", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_partial_index_migration_can_resume():
    module = migration()
    inspector = MagicMock()
    inspector.get_indexes.side_effect = [[{"name": "events_owner_source_time_id",
        "column_names": ["owner_user_id", "source_kind", "timestamp", "id"]}], []]
    with patch.object(module.context, "is_offline_mode", return_value=False), \
         patch.object(module.op, "get_bind"), patch.object(module, "inspect", return_value=inspector), \
         patch.object(module.op, "create_index") as create:
        module.upgrade()
    create.assert_called_once_with("audit_timestamp_id", "audit_log", ["timestamp", "id"])


def test_unexpected_existing_index_definition_is_rejected():
    module = migration()
    inspector = MagicMock()
    inspector.get_indexes.return_value = [{"name": "events_owner_source_time_id", "column_names": ["id"]}]
    with patch.object(module.context, "is_offline_mode", return_value=False), \
         patch.object(module.op, "get_bind"), patch.object(module, "inspect", return_value=inspector), \
         patch.object(module.op, "create_index") as create:
        with pytest.raises(RuntimeError, match="Unexpected definition"):
            module.upgrade()
        create.assert_not_called()
