from unittest.mock import MagicMock, patch

import pytest
from app.db.engine import check_database
from alembic.script import ScriptDirectory
from pathlib import Path


def test_old_schema_is_rejected_before_serving_profile_routes():
    conn = MagicMock()
    conn.execute.return_value.fetchall.return_value = [("0001_mysql",)]
    with patch("app.db.engine.get_connection", return_value=conn):
        conn.__enter__.return_value = conn
        with pytest.raises(RuntimeError, match="alembic upgrade head"):
            check_database()


def test_current_schema_requires_profile_columns_and_lock_rows():
    conn = MagicMock()
    conn.__enter__.return_value = conn
    head = ScriptDirectory(str(Path(__file__).resolve().parents[2] / "migrations")).get_current_head()
    conn.execute.return_value.fetchall.side_effect = [
        [(head,)], [{"name": "auth"}, {"name": "notifications"}]]
    with patch("app.db.engine.get_connection", return_value=conn):
        check_database()
    assert any("full_name, phone, avatar_url" in call.args[0] for call in conn.execute.call_args_list)
