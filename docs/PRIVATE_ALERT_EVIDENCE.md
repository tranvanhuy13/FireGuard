# Private Fire Alert evidence and deployment

FireGuard keeps users, camera ownership, alerts, snapshot metadata and archived
video results in Aiven MySQL. Supabase is a private file bucket accessed through
the existing S3 adapter. No Supabase Auth migration is required.

## Behavior

- Every newly created camera and uploaded video is owned by the authenticated
  user's numeric ID. The server supplies this ID; clients cannot assign owners.
  New cameras default to off. Account creation never starts a camera.
- Both roles see only their own resources, including media feeds, detection
  sockets, video control/retry APIs, alerts, incident status and camera history.
- Fire Alert combines camera and uploaded-video evidence using `source_kind`.
  Video evidence never consumes camera cooldowns or enters camera history/stats.
- Snapshots have a durable registry entry with capture time and an expiry exactly
  seven days later. Supabase keys remain `snapshots/<unique-name>.jpg` for adapter
  compatibility; ownership is enforced through the MySQL registry, not filenames.
- `GET /snapshot-access/{name}` authorizes ownership and returns a short signed
  URL plus `expires_in`. The browser downloads directly from Supabase. The bucket
  must stay private. Signed URLs are bearer links, valid for at most five minutes
  and never intentionally beyond retention; someone given a link can use it until
  it expires. Already downloaded bytes cannot be revoked.
- The legacy `/snapshots/{name}?token=...` route also checks ownership and expiry,
  then redirects to Storage. Local fallback is served with `Cache-Control: no-store`.
  Scoped internal notification credentials may access only their named image.
- A worker cleans up at startup and hourly while the backend runs. Remote deletion
  and local deletion must succeed before a registry entry is marked deleted.
  Failures are retried; expired files are never re-uploaded by pending sync.
  Notification pins do not extend the seven-day deadline. Bot image links also
  expire after at most five minutes; manual video retries reject expired evidence.
- New registered video images survive job eviction until retention. Video source
  files and decoder/notification queues remain temporary. Job creation and terminal
  results are persisted; after restart unfinished jobs are reported as interrupted,
  and archived jobs cannot resume/restart/retry notifications. Fire Alert evidence
  remains available independently of those playback jobs.
- Old unregistered generated `event_`, `video_` and `periodic_` JPEGs are reclaimed
  after seven days by file/object modification age. Models and unrelated keys are
  excluded. Legacy images have no inferred owner and cannot be opened through API.

The alert record remains after its image expires. The UI shows an expired-image
message after access returns HTTP 410. No signed URLs are persisted in MySQL.

## Before migrating

Back up the target MySQL database, verify the `MYSQL_*` settings/CA certificate,
and deploy frontend and backend together. Do not use `alembic stamp head`: it
would skip the actual schema changes. Revision: `0005_cameras_default_off`.
Revision 0005 disables all existing cameras across all accounts once and changes
the database default to off; cameras can subsequently be enabled explicitly.

The migration adds columns/tables without removing existing application data.
Existing cameras/events have NULL ownership because ownership cannot be inferred
safely. Such cameras are not started or listed until explicitly assigned.

An operator can inspect and assign a specific legacy camera in the MySQL console:

```sql
SELECT id, username FROM users ORDER BY id;
SELECT id, name, owner_user_id FROM cameras ORDER BY id;
-- Replace the example IDs with verified IDs. Never assign all cameras blindly.
UPDATE cameras SET owner_user_id = 12 WHERE id = 3 AND owner_user_id IS NULL;
```

Restart the backend after assignment. Historical events and old snapshots remain
unassigned/hidden; camera assignment does not silently transfer historical media.
New detections are fully owned and visible. A historical ownership import requires
a separately verified mapping and is intentionally not guessed by this migration.

## Local Windows (PowerShell)

From the repository root:

```powershell
Set-Location backend
.\venv\Scripts\python.exe -m alembic current
.\venv\Scripts\python.exe -m alembic upgrade head
.\venv\Scripts\python.exe -m alembic current
```

The final revision must be `0005_cameras_default_off (head)`. Restart the local API
with your normal command. `.env.local` is loaded by the database configuration;
never paste database credentials into these commands or commit them.

## Docker Compose: build from this checkout

From the repository root, with the environment file already configured:

```powershell
docker compose -f deploy/docker-compose.local.yml --env-file "$HOME/.fireguard/local.env" build backend frontend
docker compose -f deploy/docker-compose.local.yml --env-file "$HOME/.fireguard/local.env" stop backend
docker compose -f deploy/docker-compose.local.yml --env-file "$HOME/.fireguard/local.env" run --rm --no-deps backend python -m alembic upgrade head
docker compose -f deploy/docker-compose.local.yml --env-file "$HOME/.fireguard/local.env" up -d backend frontend
docker compose -f deploy/docker-compose.local.yml --env-file "$HOME/.fireguard/local.env" exec backend python -m alembic current
```

This local Compose file defaults to MinIO. For Supabase, set `S3_ENDPOINT`,
`S3_PUBLIC_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` in
the environment file using [the Supabase setup](SUPABASE_STORAGE.md). The local
MinIO services can be left unused; `--no-deps` keeps the migration model-free.

## Docker Compose: production images

On the server, from the checkout, set `REGISTRY` and `TAG` in the configured env
file to images containing this revision, then:

```bash
docker compose -f deploy/docker-compose.yml --env-file /opt/fireguard/.env pull backend frontend
docker compose -f deploy/docker-compose.yml --env-file /opt/fireguard/.env stop backend
docker compose -f deploy/docker-compose.yml --env-file /opt/fireguard/.env run --rm --no-deps backend python -m alembic upgrade head
docker compose -f deploy/docker-compose.yml --env-file /opt/fireguard/.env up -d backend frontend
docker compose -f deploy/docker-compose.yml --env-file /opt/fireguard/.env exec backend python -m alembic current
```

The backend Dockerfile already runs `python -m alembic upgrade head` before
Uvicorn, including on Render when no custom Docker Command overrides it. The
manual migration above makes the update explicit. Run migrations from a single
instance before scaling out; MySQL DDL is not transactionally reversible. Do not
run a production downgrade to roll back code: it drops evidence metadata.

## Cleanup independent of backend uptime

The built-in worker catches up after restart. If the backend sleeps/stops, physical
deletion waits for recovery; API access still rejects expired images on recovery.
For deletion while the API is asleep, run an hourly external scheduler using the
same MySQL/S3 environment and CA certificate, with the backend image:

```bash
python cleanup_snapshots.py
# Or, from the production checkout:
docker compose -f deploy/docker-compose.yml --env-file /opt/fireguard/.env run --rm --no-deps backend python cleanup_snapshots.py
```

This command imports neither the detector nor `main`, and starts no cameras/bots.
Each invocation limits deletions; the persistent worker retries full batches sooner.
No external scheduler is provisioned by this PR. Under normal operation cleanup
occurs within roughly seven days plus one hour; outages/retries can extend physical
deletion, while authorization expiry is independent of cleanup completion.

## Verification

Run `python -m pytest tests/test_private_evidence.py tests/test_event_history.py
tests/test_api_security_registration.py tests/test_realtime_detection.py
tests/test_video_database_recovery.py tests/test_s3_url_store.py -q` from backend.
The private-evidence fixtures forbid connections to a live database.
Run TypeScript, affected-file ESLint and `tests/private_evidence.spec.ts` on an
isolated frontend with API/WS origins `http://127.0.0.1:18080` and
`ws://127.0.0.1:18080`; browser requests are intercepted.

After deploying, verify `/health/ready`, upload a test video under account A, and
confirm A sees the evidence while B cannot retrieve the job, snapshot or signed
URL. Use disposable evidence for a live Supabase check. Do not change production
snapshot timestamps just to test retention.
