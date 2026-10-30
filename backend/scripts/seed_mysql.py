"""Optional defaults for a fresh installation: python -m scripts.seed_mysql."""
from datetime import datetime
from db.engine import check_database, get_connection

DEFAULTS = {
    "ai_confidence_threshold": "0.25", "ai_persistence_frames": "2",
    "ai_cooldown_seconds": "5", "alarm_sound_enabled": "true",
    "email_enabled": "false", "telegram_enabled": "false",
}


def main():
    check_database()
    with get_connection() as conn:
        conn.begin_serialized()
        for key, value in DEFAULTS.items():
            conn.execute("INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE `key`=`key`", (key, value))
        if not conn.execute("SELECT COUNT(*) FROM cameras").fetchone()[0]:
            conn.execute("INSERT INTO cameras (name, source, is_active, created_at) VALUES (?, ?, ?, ?)",
                         ("Camera 1", "0", 1, datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
    print("Default settings and camera seeded without replacing existing values.")


if __name__ == "__main__":
    main()
