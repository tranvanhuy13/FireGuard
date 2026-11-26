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

It sets `MODEL_PATH=best.pt`. Relative model paths are anchored to the backend directory; explicit absolute paths remain absolute. Configure MYSQL_* and run `python -m alembic upgrade head` before starting the backend; see [MySQL/Aiven migration](../MYSQL_AIVEN_MIGRATION.md). The private local file is ignored by Git and excluded from backend Docker builds. Restart after changing configuration. If an old shell `MODEL_PATH` is still set, clear it once in PowerShell with `Remove-Item Env:MODEL_PATH -ErrorAction SilentlyContinue` or in Command Prompt with `set MODEL_PATH=`.

## Backend variables

Local webcams (numeric sources `0`–`63`) start disabled when loaded from the
database, even if their saved `is_active` is enabled. Enable them explicitly in
the camera UI after backend startup. Network cameras retain their saved state.
This startup policy does not rewrite camera records in the shared database.

| Variable | Use/default |
| --- | --- |
| `MODEL_PATH` | YOLO weights; defaults to `best.pt` in the backend directory |
| `MODEL_OBJECT` | Object-store key for a missing model; default `models/best.pt` |
| `MYSQL_HOST`, `MYSQL_PORT` | Required Aiven MySQL endpoint and service port |
| `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD` | Required database and credentials |
| `MYSQL_SSL_CA` | CA PEM file; relative paths resolve against backend. Render can discover `/etc/secrets/aiven-ca.pem`; certificate and hostname verified |
| `DB_POOL_SIZE`, `DB_MAX_OVERFLOW` | Connections per process: defaults 5 plus 5 overflow |
| `DB_POOL_TIMEOUT`, `DB_POOL_RECYCLE` | Pool wait/connection age in seconds: defaults 10/300 |
| `SNAPSHOT_DIR` | Local snapshot directory; default `snapshots` relative to working directory |
| `PERIODIC_SNAPSHOT_RETENTION_DAYS` | Periodic capture lifetime; default 7 days, minimum 1; set 30 for a month |
| `SNAPSHOT_CLEANUP_INTERVAL_SECONDS` | Retention scan interval; default 3600 seconds, minimum 60 |
| `FORWARDED_ALLOW_IPS` | Uvicorn trusted reverse-proxy addresses for client IP limits; configure for the deployed proxy |
| `S3_ENDPOINT` | Select MinIO/S3-compatible storage; full http(s) URLs support API paths such as Supabase `/storage/v1/s3`; bare host:port retains the MinIO client |
| `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_SECURE` | MinIO/S3 configuration |
| `S3_PUBLIC_ENDPOINT` | Public S3 endpoint for Zalo links; full URL mode preserves API paths, e.g. Supabase `/storage/v1/s3`; bare MinIO mode requires an origin without a path |
| `S3_REGION` | Bucket region; public-link signing defaults to `us-east-1`; set to the actual region |
| `S3_SNAPSHOT_URL_TTL_SECONDS` | S3 signing lifetime, default 3600 (1 hour), range 1–604800; bot links are capped at 3600 seconds and the evidence retention deadline; dashboard links at 300 seconds |
| `GCS_BUCKET` | Select GCS if no S3 endpoint is configured |
| `AUTH_SESSION_SECRET` | Stable backend-only secret for one-hour API sessions across workers/restarts; falls back to `STREAM_TOKEN_SECRET`, then a per-process random secret |
| `STREAM_TOKEN_SECRET` | Stable signing secret for password-bound media tokens across restarts |
| `CORS_ORIGINS` | Comma-separated allowed HTTP(S) origins; explicit configuration replaces development defaults |
| `ZALO_BOT_TOKEN`, `ZALO_CHAT_ID`, `ZALO_ENABLED` | Optional nonblank environment overrides for Zalo notification settings |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_ENABLED` | Optional nonblank environment overrides for Telegram notification settings |
| `GMAIL_ADDRESS`, `GMAIL_APP_PASSWORD` | Account OTP email configuration |
| `AUTH_DEV_MODE` | Local OTP logging behavior; see `auth/utils.py` |

Alarm confidence, persistence, cooldown and Zalo/Telegram settings are stored in the settings database. They are not all environment variables. See [the detection guide](../REALTIME_DETECTION.md) for numeric settings and fallbacks.

Camera bot delivery has a separate 15-second cooldown per account and channel
(Telegram/Zalo), measured from successful delivery. This limit is independent
of the AI event cooldown in the database.

## Local startup

Run from `backend/` using the project's virtual environment:

```powershell
.\venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

For a new environment, create the virtual environment and install `requirements.txt` first. Keep the working directory at `backend/` so snapshot and upload paths are predictable. Ensure a model with both required classes is available; startup loads the model and may activate configured cameras.

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

- [Render launcher](../../deploy/launcher/README.md): a separate static waiting page wakes FE and BE concurrently, checks both public readiness endpoints, then redirects to FE. Requires public `FRONTEND_URL`/`BACKEND_URL`; readiness responses support cross-origin checks without credentials.

- [Backend Dockerfile](../../backend/Dockerfile): runtime defaults use persistent `/data` paths and support the hosting `PORT` variable.
- [Frontend Dockerfile](../../frontend/Dockerfile): frontend image build.
- [Local Compose](../../deploy/docker-compose.local.yml): local MinIO, initializer, backend, frontend and Caddy stack.
- [Production Compose](../../deploy/docker-compose.yml): image-based VM deployment with GCS configuration.
- [Local environment example](../../deploy/local.env.example) and [deployment example](../../deploy/env.example): template variable names, not secret files.
- [Deployment workflows](../../.github/workflows/): deployment automation definitions.

Deployment files are implementation references, not evidence that a deployment has run. Some configuration entries may be historical; confirm that the consuming module actually reads a variable before relying on it.

## Zalo snapshot links

### Bot credentials and video delivery

Nonblank process environment / loaded `.env.local` / shared `.env` values override the corresponding MySQL notification setting. Blank or absent environment values fall back to MySQL. `ZALO_ENABLED` and `TELEGRAM_ENABLED` accept `true`, `1`, `yes`, or `on` (case insensitive); any other explicit value disables the channel. When neither environment nor MySQL specifies a flag, complete credentials enable that channel automatically. A saved `false` remains disabled: set the environment flag to `true` or enable the bot in admin settings. Compose forwards these six variables from its `--env-file`; a repository `.env` is not automatically copied into the backend container.

Admin `/settings` returns masked effective bot settings and separate `notification_status` metadata with configuration completeness, enabled state, and the environment/database source of each field. Environment-owned inputs are read-only in the settings UI; change the environment and restart/recreate the backend to update them. `/test-notification` bypasses camera cooldown and returns per-channel outcomes and `ok`, `partial`, or `error`; a successful HTTP response alone is not proof of delivery.

Telegram troubleshooting: credentials can be valid while MySQL still has `telegram_enabled=false`. Enable it in admin settings or explicitly set `TELEGRAM_ENABLED=true` in `backend/.env.local` for native startup. A Compose backend requires the flag in its external `--env-file` and container recreation instead. The UI distinguishes enabled, disabled and incomplete configuration; disabled test results explain which flag to change. Effective configuration takes effect after restarting a native backend.

Delivery outcomes include sanitized HTTP/API error codes and descriptions for troubleshooting without exposing tokens, chat IDs or URLs. Telegram falls back from photo delivery to text for known media/caption rejections or unreadable attachments; credential, permission, rate-limit and ambiguous network failures retain their failure result rather than creating a second text request. Successful text fallback records `mode=text`, `fallback_reason` and the original `photo_error`. Photo captions over 1024 UTF-16 units are sent as text to preserve the warning. Local snapshot cleanup still waits for delivery completion.

Video analysis sends one successful notification per confirmed class/channel/job through separate bounded channel queues. Messages identify the uploaded video, job and video timestamp. Negative footage and detections below the configured threshold/persistence do not notify. Delivery checks both HTTP and bot API `ok` and uses connect/read timeouts. Camera delivery retries inside the HTTP helper; video delivery schedules at most three single-attempt dispatches per channel, with 2/4-second delays or a provider-specified retry delay up to 30 seconds. Longer rate-limit waits are reported as failed for manual retry. These budgets do not multiply. Failed channels do not block the other channel permanently or consume camera cooldown; ambiguous network failures can still result in provider-side duplicates. Stop suppresses queued requests and retries, but cannot retract a request already sent. Video notification state is in memory and is not durable across backend restarts. Video Restart cancels old queued/retrying deliveries, including after analysis completion. An in-flight request cannot be recalled; its final result is still recorded.

### Image links

Zalo sends warning text with a direct presigned GET link to `S3_BUCKET/snapshots/<name>` using `sendMessage`. Telegram still uploads the local image using `sendPhoto`. Zalo no longer uses the database `public_base_url` setting or the backend snapshot-token route. Test notifications without a snapshot send text only.

Configure the existing S3 credentials and `S3_PUBLIC_ENDPOINT` in the backend environment (`backend/.env.local` for native development, the external Compose environment file for local deployment), then restart/recreate the backend. The public endpoint must reach the same bucket as `S3_ENDPOINT`. Use the S3 API origin, not the MinIO Console, a Docker hostname, or an origin with a path prefix. A reverse proxy must preserve the signed host, path and query string; never replace the hostname after signing. Local Compose does not expose the S3 API publicly by itself: configure the public API ingress separately.

Links open without a MinIO login until they expire; bucket anonymous access is not required. The backend checks object metadata through the internal endpoint before signing with the public endpoint. Set `S3_REGION` to the bucket's actual region to avoid public-endpoint discovery requests and invalid signatures. Missing configuration, failed uploads or unavailable storage produce a text warning without an image URL. Local notification copies are kept when remote existence cannot be confirmed, for later background synchronization. Do not log or share signed links outside the intended recipients.

Temporary offline regressions verified SDK URL signing, delivery fallback, configuration precedence, retry/cooldown behavior, video notification deduplication/cancellation and attachment retention. Those temporary test files were removed at the user's request; existing project test suites remain.

## Periodic snapshot retention

Storage maintenance starts with the application lifespan and stops on shutdown, also in local-only mode. At startup and every cleanup interval it deletes at most 500 expired copies per storage backend. A file must match `periodic_YYYYMMDD_HHMMSS_cam_<numeric-id>.jpg` exactly, and both its capture timestamp and modification time must be older than the retention cutoff. Camera capture currently runs every 15 seconds (5,760 periodic images per camera per day). Retention uses local modification times and MinIO/GCS object modification metadata. `event_*`, `video_*`, nested keys, symlinks and unknown filenames are preserved.

Deletion errors are logged and retried on a later scan; other candidates continue. Pending upload synchronization and cleanup are serialized within each worker. Cloud credentials need permission to list the `snapshots/periodic_` prefix and delete those objects. The maintenance log records deleted copies and bytes. Full deletion batches schedule another scan after 60 seconds to drain backlogs without waiting a full cleanup interval. This is an age policy, not a hard disk quota; size depends on camera count and JPEG sizes. Event evidence has no automatic retention policy in this change. Configure bucket lifecycle rules only for the periodic prefix if additional provider-side cleanup is needed.

## Video notification troubleshooting and retry

Job metadata exposes per-class/per-channel delivery states, attempt counts, queue/start/finish timestamps, `notification_pending`, `notifications_cancelled`, and `notification_workers` health. Sanitized logs identify the job, detection class, channel and dispatch result. A failed dispatch or snapshot preparation error does not terminate the worker.

Authenticated `POST /video-analysis/{job_id}/notifications/retry` accepts `{ "event_type": "fire" | "smoke", "channel": "zalo" | "telegram" }`. It returns updated job metadata. Only failed, disabled or unconfigured channels can be retried; sending/successful/cancelled work is rejected (409), and missing jobs return 404. Fix credentials or enable the bot before retrying. The video modal shows channel outcomes and a retry button, and reconnects its updates after manual retry. New uploads always have independent notification state. The 24-image preview limit does not prevent the first notification for a later detection class.

## Notification Accounts and Groups

Verified users and admins can create, edit, toggle, delete and test their own destinations at `/notifications/accounts` and `/notifications/groups`. The form needs channel, display name and chat ID; credentials remain in environment/admin settings. MySQL `notification_targets` persists the authenticated owner. Each account supports up to 20 destinations per channel, with unique channel/chat pairs across its accounts/groups. Camera/video alerts select only active recipients of the source owner. Global chat IDs are no longer fallback destinations. Legacy NULL-owner destinations are quarantined; see [migration and rollout](../ACCOUNT_NOTIFICATIONS.md). Saving an active destination does not modify shared channel enabled flags; an admin must enable bot availability.

The previous Notification Groups page used browser-only mock data, so entering a chat ID there did not configure backend delivery. Use Import my existing browser recipients to copy user-created entries to the backend; seeded samples are excluded. Entries already saved are skipped. The Test button now makes a real single-recipient API request and reports its actual result; it never simulates success. The recipients page and backend settings bypass the dashboard mock interceptor. Destination management and testing require ownership; system configuration requires admin. The legacy mock rules editor is hidden because those rules are not applied by the backend.

Per-recipient delivery results are keyed by opaque destination identity and contain sanitized outcomes, not raw chat IDs. Video automatic/manual retries preserve successful recipient results and retry only unfinished destinations. A destination edit produces a new identity, ensuring alerts are delivered to the new chat. Settings chat ID fields are read-only; manage destinations in Accounts/Groups.

## MySQL deployment

Both Compose files require MYSQL_* and MYSQL_SSL_CA_HOST_PATH (an existing absolute CA path on the Docker host). The CA is mounted read-only at /run/secrets/aiven-ca.pem. DB_NAME and AUTH_DB_PATH are no longer consumed. See [MySQL/Aiven migration](../MYSQL_AIVEN_MIGRATION.md) for migration, import, TLS and cutover commands. Keep /data for snapshots and models.


## Applying Audit/History optimizations

Install the updated requirements (FastAPI >=0.121.1 is required for media dependency function scope; see [FastAPI early-exit dependencies](https://fastapi.tiangolo.com/tutorial/dependencies/dependencies-with-yield/#early-exit-and-scope)). Run `python -m alembic upgrade head` from `backend/` before starting the updated backend (required head: `0007_history_audit_indexes`). Deploy frontend and backend together. Set `AUTH_SESSION_SECRET` to a strong shared backend-only secret for multiple workers; never expose it through `NEXT_PUBLIC_*`. Without a stable shared secret, sessions are intentionally invalidated by process restarts and may fail between workers. Existing Basic browser sessions use the compatibility path until the next login; sign out and sign in to obtain the faster Bearer session. Password changes invalidate Bearer sessions immediately. These changes do not increase the database pool size.


### Render deployment with migration

For a native Python Render backend, set Root Directory to `backend`, Build Command to `pip install -r requirements.txt`, and Start Command to `python scripts/start_server.py`. For a Docker Render backend, keep Docker Command empty so the image uses the same entrypoint. An older explicit Uvicorn Docker Command must be cleared or replaced with `python scripts/start_server.py`.

The entrypoint acquires a MySQL advisory lock, applies Alembic through `0007_history_audit_indexes`, releases the lock and starts Uvicorn on `0.0.0.0:$PORT`. Other instances wait up to 60 seconds for the lock. A failed migration or lock acquisition prevents API startup. Do not run migrations during the build; runtime has the database credentials and mounted CA. No separate pre-deploy step is required. Existing CI one-off `alembic upgrade head` commands remain valid; serialize these deploy jobs with service starts. Migration 0007 can recover when an earlier attempt created only one of its two indexes, but rejects an existing index with an unexpected column definition.

Keep `MYSQL_*`, the Aiven CA secret file, Storage credentials and `AUTH_SESSION_SECRET` in the backend environment. This PR does not provision services or modify live Render settings. The frontend has no database migration; deploy its matching code after the backend is ready. Verify `/health`, login and the two list APIs after deployment. Do not downgrade the shared database while either release is serving traffic.
