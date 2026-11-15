"""Paths and environment precedence independent of the current module location."""
import os
from pathlib import Path
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[2]

def load_environment():
    # Existing process values always win over dotenv files.
    load_dotenv(BACKEND_DIR / ".env.local")
    load_dotenv(BACKEND_DIR / ".env")
    load_dotenv(BACKEND_DIR.parent / ".env")

def model_path():
    path = Path(os.getenv("MODEL_PATH") or "best.pt")
    return str(path if path.is_absolute() else BACKEND_DIR / path)
