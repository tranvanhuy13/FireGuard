# MySQL on Aiven

The backend requires MySQL 8+ (InnoDB), SQLAlchemy Core and PyMySQL. SQLite is
only used by the explicit legacy-data importer and disposable offline tests.
Operational and account tables share one MySQL database. API timestamp strings,
password hashes, IDs, roles and notification settings are preserved. Photos,
models and videos remain in the configured filesystem/object storage.

## Configure

In Aiven Console, open the MySQL service's Overview / Connection information.
Copy Host, Port, Database name, User and Password. Download the project CA
certificate. Create the database first if using a name other than the existing
database. Allow the backend's outbound IP in any configured IP allowlist.

Copy the keys from [the backend template](../backend/.env.local.example) into
ignored `backend/.env.local`, preserving existing settings:

```dotenv
MYSQL_HOST=your-service.aivencloud.com
MYSQL_PORT=your-service-port
MYSQL_DATABASE=fireguard
MYSQL_USER=your-service-user
MYSQL_PASSWORD="your-password"
MYSQL_SSL_CA=certs/aiven-ca.pem
DB_POOL_SIZE=5
DB_MAX_OVERFLOW=5
DB_POOL_TIMEOUT=10
DB_POOL_RECYCLE=300
```

`MYSQL_SSL_CA` is the CA file visible to the backend process. Relative native
paths resolve against `backend/`. Absolute Windows paths such as
`D:/certs/aiven-ca.pem` work for native Python. Certificate and hostname
verification are both mandatory. There is no insecure TLS fallback.

Shell/hosting variables win over `.env.local`, then backend `.env`, then defaults.
Do not put database credentials in frontend variables, Git, Docker images or logs.
The pool permits `DB_POOL_SIZE + DB_MAX_OVERFLOW` connections per process;
budget migration/CLI connections separately and stay below the service limit.

## Prepare schema

From `backend/`, using the project virtual environment:

```powershell
.\venv\Scripts\python.exe -m pip install -r requirements.txt
.\venv\Scripts\python.exe -m alembic upgrade head
```

Migrations must finish before starting the API. Importing auth modules does not
create schema. API startup checks schema/version before starting cameras. MySQL
DDL is not transactionally rolled back: inspect a failed initial migration before
retrying; never drop production tables to make a retry pass.

For a NEW empty installation only, optionally seed default settings and Camera 1:

```powershell
.\venv\Scripts\python.exe -m scripts.seed_mysql
```

Seeding is idempotent. Do not seed before importing legacy data: the importer
intentionally refuses nonempty application tables.

## Import existing SQLite data

1. Rehearse using copies and a separate staging MySQL database.
2. Stop all backend instances, including camera/background event writers.
3. Back up the actual operational and account databases consistently (use SQLite
   backup tooling, or checkpoint and copy after all processes close). Docker used
   `/data/fire_guard.db` and `/data/auth.db`; native auth defaulted to `example.db`
   relative to its working directory. Do not assume repository files are live data.
4. Create an empty migrated MySQL database. Do not start the API or seed it yet.
5. Run the default rollback-only rehearsal, then explicitly commit:

```powershell
.\venv\Scripts\python.exe -m scripts.migrate_sqlite_to_mysql --operational-db D:/backups/fire_guard.db --auth-db D:/backups/auth.db
.\venv\Scripts\python.exe -m scripts.migrate_sqlite_to_mysql --operational-db D:/backups/fire_guard.db --auth-db D:/backups/auth.db --apply
```

Sources are opened read-only. The importer preserves IDs and compares imported
column values and row counts inside one transaction. A failed import rolls back
all rows. A repeated successful import is refused, preventing duplicates. MySQL
advances AUTO_INCREMENT for explicit IDs; rollback rehearsals can also advance
sequences, which does not affect correctness. Notification insertion order is
preserved through an explicit `sequence` column. Earlier viewer/operator roles
become user, matching the previous SQLite startup migration. Missing optional
legacy columns receive schema defaults. OTPs and login attempts are preserved;
expired attempts are cleaned on the next reservation. The script reads source
tables into memory and writes in batches; allow enough memory for the backup.

Binary collation keeps identifier matching case-sensitive. Oversized legacy
strings, invalid roles, and unique conflicts fail instead of silently truncating
or overwriting accounts. Review source data in a separate copy if validation fails.
Timestamp values are copied verbatim: event times used local wall time while audit
timestamps used UTC ISO strings. No timezone conversion is guessed during import.

6. Validate account/admin access, event history, settings, cameras and snapshot
   availability; keep existing snapshot storage accessible.
7. Start the backend with MySQL configuration, then check `/health/ready`.

## Deployment

Both Compose files forward `MYSQL_*` and pool settings. Set
`MYSQL_SSL_CA_HOST_PATH` to an existing absolute file path ON THE DOCKER HOST;
Compose mounts it read-only at `/run/secrets/aiven-ca.pem`. Keep `/data` for
snapshots and model files. A missing CA source is rejected rather than created
as a directory. Runtime variables belong in the deployment's external env file.

The CD workflows run `python -m alembic upgrade head` as a one-off container before
starting the new backend and smoke-test readiness. Provision secrets and the CA
on the deployment host before enabling that rollout. On the first SQLite cutover,
pause automatic deployment and follow the stopped-backend import steps first;
the workflows do not import legacy data automatically. For manual Compose startup,
run the same one-off migration command before `up`:

```sh
docker compose -f deploy/docker-compose.yml --env-file /opt/fireguard/.env run --rm --no-deps backend python -m alembic upgrade head
docker compose -f deploy/docker-compose.yml --env-file /opt/fireguard/.env up -d
```

The backend Docker image runs `python -m alembic upgrade head` before starting
Uvicorn and stops if migration fails. This also supports Render services without
a pre-deploy command. Keep Render's Docker Command empty to use the image CMD;
an existing override must run the migration before Uvicorn as well. Mount the CA
as a runtime file available to both migration and API processes. The configured
service account needs migration permissions when using this startup command.
For multiple API instances, run migrations once in a release/pre-deploy step and
override the Docker Command to start only Uvicorn, avoiding concurrent migrations.
Separate DDL migration and DML application credentials where supported; workflows
currently use the configured service account for the migration command.

### Render CA file setup

In the backend service's Environment settings, add a Secret File named exactly
`aiven-ca.pem` and paste the full downloaded Aiven CA certificate, including its
BEGIN/END CERTIFICATE lines. Set `MYSQL_SSL_CA=/etc/secrets/aiven-ca.pem` and
save/redeploy the service. Setting an environment variable alone does not create
the certificate file; local `backend/certs/` is excluded from Git and Docker.

When `RENDER=true`, the backend also discovers that mounted file if MYSQL_SSL_CA
is unset or still points at a missing local path ending in `aiven-ca.pem`.
An existing configured file takes precedence. Certificate and hostname verification
remain enabled; a missing mount fails with Render-specific setup instructions.
See [Render's Docker secret-file documentation](https://render.com/docs/docker-secrets).

## Transactions and verification

The `transaction_locks` rows are created by the migration. Auth reservations, OTP
validation and admin changes lock the same `auth` row with `SELECT FOR UPDATE`
under READ COMMITTED. This conservatively preserves the earlier serialized
SQLite write behavior across processes, including the last-admin invariant.
It can limit auth write throughput; scope-specific locks can be introduced with
additional concurrency tests if load requires them. Notification saves use their
own lock so concurrent saves cannot exceed the per-channel recipient limit.

Offline checks (no Aiven, application startup, cameras or bot delivery):

```powershell
.\venv\Scripts\python.exe -m unittest discover -s tests -p test_mysql_persistence.py
.\venv\Scripts\python.exe -m alembic upgrade head --sql
```

Real database checks require a disposable, migrated, EMPTY database ending in
`_test`. Set its `MYSQL_*` values and set `FIREGUARD_TEST_MYSQL=1` in the shell:

```powershell
$env:FIREGUARD_TEST_MYSQL="1"
$env:MYSQL_DATABASE="fireguard_test"
.\venv\Scripts\python.exe -m alembic upgrade head
.\venv\Scripts\python.exe -m unittest discover -s tests -p test_mysql_concurrency.py
```

These tests exercise real MySQL CRUD/upsert, Unicode, unique conflicts, rollback,
concurrent OTP failures, concurrent login reservations and simultaneous admin
demotions. Existing pytest integration suites also require the explicit flag and
`_test` name before collection, because importing main starts services. They can
modify other tables and require model/storage configuration; keep notification
channels disabled and do not use valuable data. Offline tests use unittest.

## Rollback

Keep stopped SQLite backups and the previous backend image. Before MySQL accepts
new writes, reverting configuration/image can restore the old deployment.
After MySQL accepts writes, reconcile/export those changes before reverting;
simply reusing old SQLite loses new data. Never run both backends as independent
writers during cutover. The migration downgrade drops the MySQL application
tables and is destructive; it is not the production rollback procedure.

## Mid-video MySQL read timeouts

A MySQL 2013 error means an established query connection failed/timed out; it is
not the missing-CA error. Detection settings now use a shared five-second snapshot
with asynchronous refresh, so a transient outage after the snapshot is loaded does
not stop the current video. SELECT retries are bounded to one fresh connection;
credential errors and writes are not retried. If no settings snapshot has ever
loaded, analysis reports a generic database-unavailable error and must be retried
once connectivity returns. Persistent outages still require investigating Render
resources, Aiven connectivity, and service/network latency; this does not guarantee
real-time inference on a limited CPU.

Uploaded-video bot delivery requires ZALO_BOT_TOKEN / TELEGRAM_BOT_TOKEN via
runtime environment or saved admin settings, enabled channels and active shared
recipients. A chat ID alone is insufficient. Zalo photo links additionally require
reachable S3 storage and S3_PUBLIC_ENDPOINT; otherwise warning text can still be
sent. Confirm actual delivery with an explicit admin test action after deployment.
