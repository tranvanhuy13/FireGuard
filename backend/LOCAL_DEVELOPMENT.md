# Local backend configuration

Copy `.env.local.example` to `.env.local` in this directory:

```powershell
Copy-Item .env.local.example .env.local
```

The local file sets `MODEL_PATH=best.pt`. Keep deployment values in `.env` or in your hosting environment. `.env.local` is ignored by Git and excluded from the backend Docker build.

Configuration priority is:

1. Existing process environment variables (including hosting settings).
2. `backend/.env.local`.
3. The existing `.env` file.
4. Application defaults.

Relative model paths are resolved against the backend directory. Start normally from this directory, without setting MODEL_PATH each time:

```powershell
.\venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Restart the backend after changing configuration. If your current shell still contains an old `MODEL_PATH`, clear it once with `Remove-Item Env:MODEL_PATH -ErrorAction SilentlyContinue` in PowerShell or `set MODEL_PATH=` in Command Prompt. This allows `.env.local` to supply the value.
