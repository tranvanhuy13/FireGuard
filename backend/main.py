"""Stable entry point: uvicorn main:app (run from backend/)."""
from app.bootstrap import create_app

app = create_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, log_level="info")
