"""Account and operational data share the configured MySQL database."""
from app.db.engine import check_database, get_connection


def init_db():
    check_database()
