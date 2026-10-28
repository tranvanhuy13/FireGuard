# Configuration and local setup

## Backend environment precedence

Startup in `backend/main.py` loads configuration in this order:

1. Variables already set by the shell or hosting environment.
2. `backend/.env.local` (loaded without overriding existing variables).
3. The existing `.env` discovered by python-dotenv.
4. Defaults in code.

For local development, copy the template once from `backend/`:

```powershell
Copy-Item .env.local.example .env.local
```

It sets `MODEL_PATH=best.pt`. Relative model paths are anchored to the backend directory; explicit absolute paths remain absolute. The private local file is ignored by Git and excluded from backend Docker builds. Restart after changing configuration. If an old shell `MODEL_PATH` is still set, clear it once in PowerShell with `Remove-Item Env:MODEL_PATH -ErrorAction SilentlyContinue` or in Command Prompt with `set MODEL_PATH=`.

## Backend variables

| Variable | Use/default |
| --- | --- |
| `MODEL_PATH` | YOLO weights; defaults to `best.pt` in the backend directory |
| `MODEL_OBJECT` | Object-store key for a missing model; default `models/best.pt` |
| `DB_NAME` | Detection/settings/camera SQLite path; default backend `fire_guard.db` |
| `AUTH_DB_PATH` | Account SQLite path; default `example.db` relative to working directory |
| `SNAPSHOT_DIR` | Local snapshot directory; default `snapshots` relative to working directory |
| `PERIODIC_SNAPSHOT_RETENTION_DAYS` | Periodic capture lifetime; default 7 days, minimum 1; set 30 for a month |
| `SNAPSHOT_CLEANUP_INTERVAL_SECONDS` | Retention scan interval; default 3600 seconds, minimum 60 |
| `FORWARDED_ALLOW_IPS` | Uvicorn trusted reverse-proxy addresses for client IP limits; configure for the deployed proxy |
| `S3_ENDPOINT` | Select MinIO/S3-compatible storage |
| `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_SECURE` | MinIO/S3 configuration |
| `GCS_BUCKET` | Select GCS if no S3 endpoint is configured |
| `STREAM_TOKEN_SECRET` | Stable signing secret for compatibility tokens across restarts |
| `GMAIL_ADDRESS`, `GMAIL_APP_PASSWORD` | Account OTP email configuration |
| `AUTH_DEV_MODE` | Local OTP logging behavior; see `auth/utils.py` |

Alarm confidence, persistence, cooldown and Zalo/Telegram settings are stored in the settings database. They are not all environment variables. See [the detection guide](../REALTIME_DETECTION.md) for numeric settings and fallbacks.

## Local startup

Run from `backend/` using the project's virtual environment:

```powershell
.\venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

For a new environment, create the virtual environment and install `requirements.txt` first. Keep the working directory at `backend/` so default account, snapshot and upload paths are predictable. Ensure a model with both required classes is available; startup loads the model and may activate configured cameras.

From `frontend/`, install dependencies when needed and start the development server:

```powershell
npm install
npm run dev
```

`start.bat` launches both applications on Windows and performs dependency-install steps. `start-local-backend.sh` instead invokes the local Docker Compose backend service; it expects the local Compose environment file.

## Frontend configuration

`frontend/src/config.ts` uses `NEXT_PUBLIC_API_URL`, defaulting to `http://localhost:8000`. `NEXT_PUBLIC_WS_URL` can override the WebSocket base URL; otherwise it derives `ws`/`wss` from the API URL.

Mock behavior is controlled by `NEXT_PUBLIC_USE_MOCK`, with optional separate `NEXT_PUBLIC_USE_MOCK_AUTH` and `NEXT_PUBLIC_USE_MOCK_DATA` flags. Development also checks the browser's `force_mock` localStorage flag. Check those flags when verifying against the real backend. Public frontend variables must not contain secrets; Next.js uses them in browser code/builds.

## Deployment map

- [Backend Dockerfile](../../backend/Dockerfile): runtime defaults use persistent `/data` paths and support the hosting `PORT` variable.
- [Frontend Dockerfile](../../frontend/Dockerfile): frontend image build.
- [Local Compose](../../deploy/docker-compose.local.yml): local MinIO, initializer, backend, frontend and Caddy stack.
- [Production Compose](../../deploy/docker-compose.yml): image-based VM deployment with GCS configuration.
- [Local environment example](../../deploy/local.env.example) and [deployment example](../../deploy/env.example): template variable names, not secret files.
- [Deployment workflows](../../.github/workflows/): deployment automation definitions.

Deployment files are implementation references, not evidence that a deployment has run. Some configuration entries may be historical; confirm that the consuming module actually reads a variable before relying on it.

## Periodic snapshot retention

Storage maintenance starts with the application lifespan and stops on shutdown, also in local-only mode. At startup and every cleanup interval it deletes at most 500 expired copies per storage backend. A file must match `periodic_YYYYMMDD_HHMMSS_cam_<numeric-id>.jpg` exactly, and both its capture timestamp and modification time must be older than the retention cutoff. Camera capture currently runs every 15 seconds (5,760 periodic images per camera per day). Retention uses local modification times and MinIO/GCS object modification metadata. `event_*`, `video_*`, nested keys, symlinks and unknown filenames are preserved.

Deletion errors are logged and retried on a later scan; other candidates continue. Pending upload synchronization and cleanup are serialized within each worker. Cloud credentials need permission to list the `snapshots/periodic_` prefix and delete those objects. The maintenance log records deleted copies and bytes. Full deletion batches schedule another scan after 60 seconds to drain backlogs without waiting a full cleanup interval. This is an age policy, not a hard disk quota; size depends on camera count and JPEG sizes. Event evidence has no automatic retention policy in this change. Configure bucket lifecycle rules only for the periodic prefix if additional provider-side cleanup is needed.
