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

| Variable | Use/default |
| --- | --- |
| `MODEL_PATH` | YOLO weights; defaults to `best.pt` in the backend directory |
| `MODEL_OBJECT` | Object-store key for a missing model; default `models/best.pt` |
| `MYSQL_HOST`, `MYSQL_PORT` | Required Aiven MySQL endpoint and service port |
| `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD` | Required database and credentials |
| `MYSQL_SSL_CA` | Required CA PEM file; relative paths resolve against backend; certificate and hostname verified |
| `DB_POOL_SIZE`, `DB_MAX_OVERFLOW` | Connections per process: defaults 5 plus 5 overflow |
| `DB_POOL_TIMEOUT`, `DB_POOL_RECYCLE` | Pool wait/connection age in seconds: defaults 10/300 |
| `SNAPSHOT_DIR` | Local snapshot directory; default `snapshots` relative to working directory |
| `PERIODIC_SNAPSHOT_RETENTION_DAYS` | Periodic capture lifetime; default 7 days, minimum 1; set 30 for a month |
| `SNAPSHOT_CLEANUP_INTERVAL_SECONDS` | Retention scan interval; default 3600 seconds, minimum 60 |
| `FORWARDED_ALLOW_IPS` | Uvicorn trusted reverse-proxy addresses for client IP limits; configure for the deployed proxy |
| `S3_ENDPOINT` | Select MinIO/S3-compatible storage |
| `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_SECURE` | MinIO/S3 configuration |
| `S3_PUBLIC_ENDPOINT` | Public S3 API origin, e.g. `https://s3.example.com`; no bucket/path; required for Zalo image links |
| `S3_REGION` | Bucket region; public-link signing defaults to `us-east-1`; set to the actual region |
| `S3_SNAPSHOT_URL_TTL_SECONDS` | S3 image-link lifetime, default 86400 (24 hours), range 1–604800 |
| `GCS_BUCKET` | Select GCS if no S3 endpoint is configured |
| `STREAM_TOKEN_SECRET` | Stable signing secret for compatibility tokens across restarts |
| `ZALO_BOT_TOKEN`, `ZALO_CHAT_ID`, `ZALO_ENABLED` | Optional nonblank environment overrides for Zalo notification settings |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_ENABLED` | Optional nonblank environment overrides for Telegram notification settings |
| `GMAIL_ADDRESS`, `GMAIL_APP_PASSWORD` | Account OTP email configuration |
| `AUTH_DEV_MODE` | Local OTP logging behavior; see `auth/utils.py` |

Alarm confidence, persistence, cooldown and Zalo/Telegram settings are stored in the settings database. They are not all environment variables. See [the detection guide](../REALTIME_DETECTION.md) for numeric settings and fallbacks.

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

Admins can create, edit, toggle and delete real destinations at `/notifications/accounts` and `/notifications/groups`. The form needs only channel, display name and chat ID; credentials stay in `.env` or backend settings. Data persists in `notification_targets` in `DB_NAME`. A saved channel supports up to 20 destinations and rejects duplicate channel/chat IDs across accounts/groups. Active saved destinations take precedence over the legacy `ZALO_CHAT_ID` / `TELEGRAM_CHAT_ID`; all-disabled saved destinations suppress that channel instead of falling back to a legacy destination. No saved rows means legacy configuration still works. Saving an active destination sets its persisted enabled flag to true, subject to environment overrides.

The previous Notification Groups page used browser-only mock data, so entering a chat ID there did not configure backend delivery. Use Import my existing browser recipients to copy user-created entries to the backend; seeded samples are excluded. Entries already saved are skipped. The Test button now makes a real single-recipient API request and reports its actual result; it never simulates success. The recipients page and backend settings bypass the dashboard mock interceptor. Destination management and testing require admin authorization. The legacy mock rules editor is hidden because those rules are not applied by the backend.

Per-recipient delivery results are keyed by opaque destination identity and contain sanitized outcomes, not raw chat IDs. Video automatic/manual retries preserve successful recipient results and retry only unfinished destinations. A destination edit produces a new identity, ensuring alerts are delivered to the new chat. Settings chat ID fields become read-only when destinations are managed by Accounts/Groups.

## MySQL deployment

Both Compose files require MYSQL_* and MYSQL_SSL_CA_HOST_PATH (an existing absolute CA path on the Docker host). The CA is mounted read-only at /run/secrets/aiven-ca.pem. DB_NAME and AUTH_DB_PATH are no longer consumed. See [MySQL/Aiven migration](../MYSQL_AIVEN_MIGRATION.md) for migration, import, TLS and cutover commands. Keep /data for snapshots and models.
