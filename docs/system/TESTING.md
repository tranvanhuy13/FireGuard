# Testing and verification

Commands below assume existing dependencies are installed. They are guidance, not a record that checks have run for a future change.

## Focused backend checks

From `backend/`, run the offline suites:

```powershell
.\venv\Scripts\python.exe -m unittest discover -s tests/unit -p test_camera_lifecycle.py
.\venv\Scripts\python.exe -m unittest discover -s tests/unit -p test_realtime_detection.py
.\venv\Scripts\python.exe -m unittest discover -s tests/unit -p test_admin_profile.py
.\venv\Scripts\python.exe -m unittest discover -s tests/unit -p test_auth_timing.py
.\venv\Scripts\python.exe -m unittest discover -s tests/unit -p test_notification_permissions.py
```

These suites isolate hardware/storage dependencies. Camera checks cover enable/disable, shared webcam leases, confirmation/cooldowns and stale state. Real-time checks cover settings, model scheduling, playback, cancellation, source retention and API handler contracts, including upload rejection before body reads and pause/resume slot handoff between videos. API handlers are exercised in-process with fake sockets; this is not a full network/browser test.

Live source/capture regressions also run with `python -m pytest tests/unit/test_camera_sources.py tests/unit/test_camera_lifecycle.py tests/unit/test_api_security_registration.py -q`.
They cover source preservation/validation, changes during a blocked read, failed
database writes, capture timeouts and independent capture/AI freshness. Devices,
network streams and persistence are mocked.

Use syntax compilation when appropriate:

```powershell
.\venv\Scripts\python.exe -m py_compile main.py app/cameras/manager.py app/detection/detector.py app/detection/rules.py app/detection/scheduler.py app/videos/analyzer.py
```

Compilation does not load the application or verify runtime model accuracy.

`test_admin_profile.py` extracts the actual login/audit route definitions from the feature packages without
importing main. It checks admin/user login roles, profile email validation, audit
pagination, anonymous/user rejection and connection cleanup with a fake repository.
It does not connect to MySQL, load model weights, or start cameras.

`test_auth_timing.py` exercises both credential-verification entry points with
fake lookups and limiter calls, plus real bcrypt checks. It covers missing users,
wrong passwords, dummy matches, account validation, limiter ordering and error
cleanup without importing main or accessing MySQL. Timing distributions are
measured separately; unit tests do not assert wall-clock thresholds.

## Backend integration tests and side effects

From `backend/`, install `python -m pip install -r requirements-test.txt` in a
dedicated virtual environment, then run `python -m pytest tests/ -q -rs`.
The default runs offline tests without MySQL configuration. The three live-app
modules (`test_all_apis.py`, `test_health_and_auth.py`, `test_notifications.py`)
skip before importing `main`; real MySQL concurrency checks also skip. An explicit
request for only a disabled integration module returns pytest exit code 5
(no tests collected), with the skip reason. Other test failures remain failures.

To run live-app tests, explicitly provide `--integration`,
`FIREGUARD_TEST_MYSQL=1`, and `MYSQL_DATABASE` ending in `_test`:

```powershell
$env:FIREGUARD_TEST_MYSQL = '1'
$env:MYSQL_DATABASE = 'fireguard_test'
.\venv\Scripts\python.exe -m pytest tests/ --integration -m integration -q
```

These variables are only the safety gate: prepare the remaining MySQL/TLS
configuration, migrations, full application dependencies, model/storage and
disabled external notification channels in an isolated environment first.
Do not use real users or valuable databases. `main` checks the schema, loads the
model and starts background managers; API tests can change application data.

The harness never infers integration opt-in from dotenv files. Application
modules can still load their own environment configuration. The test-account
reset and SMTP mock are registered only in integration mode and apply only to
tests marked `integration`; they do not run for offline or MySQL concurrency
tests. The `_test` guard remains mandatory before application imports. No runtime
SQLite fallback is introduced. Standalone MySQL unittest checks retain their
own environment guard.

`test_test_harness.py` verifies default collection, direct module skips, unsafe
opt-in rejection, fixture isolation and failure propagation in disposable
subprocesses with sentinel application/database modules. The
`backend-tests.yml` workflow runs the offline suite without database secrets.

For database-only checks and real MySQL concurrency tests without importing main, see [MySQL verification](../MYSQL_AIVEN_MIGRATION.md#transactions-and-verification).

Some test packages are not listed in production `requirements.txt`; ensure pytest/async support and HTTP client dependencies exist in the chosen test environment. Do not run integration tests against real users, enabled notification channels or valuable local databases merely to check a small edit.

## Frontend checks

From `frontend/`:

```powershell
.\node_modules\.bin\tsc.cmd --noEmit
.\node_modules\.bin\eslint.cmd src/components/CameraGrid.tsx
```

Replace the lint target with files affected by the change. `npm run lint` runs the repository ESLint configuration; `npm run build` verifies the production build when relevant. TypeScript and lint do not substitute for browser interaction checks.

## Browser tests

Dashboard transport regressions run offline from `frontend/` with
`npm run test:connection`. They use virtual timers and fake HTTP/WebSocket
transports to cover delayed responses, timeout/retry, stale results, unmount,
HTTP 401/403/429/5xx, serial polling, hidden/offline recovery and alert merging.

`tests/dashboard_connection.spec.ts` checks the actual dashboard with intercepted
API/WebSocket traffic. Start a separate frontend with
`NEXT_PUBLIC_API_URL=http://127.0.0.1:18080`,
`NEXT_PUBLIC_WS_URL=ws://127.0.0.1:18080` and all `NEXT_PUBLIC_USE_MOCK*` flags false.
The dummy API origin must match the test interception; do not point this test at
a production backend. Set `BASE_URL` to that frontend and run
`npx playwright test tests/dashboard_connection.spec.ts --project=chromium`.
Optionally set `PLAYWRIGHT_CHANNEL=chrome` to use installed Chrome.

`npm test` runs Playwright using `frontend/playwright.config.ts`. It targets Chromium and the `BASE_URL` environment variable, defaulting to `http://localhost:3000`. The configuration does not start the application automatically: start the required frontend/backend services first and prepare the account/data fixtures needed by the selected tests.

Existing specs cover authentication, redirects, role gates and API security expectations. Read each spec before running it; older expectations can differ from current backend access rules. Confirm actual responses and intended policy before changing code or weakening a test.

## Manual feature validation

`frontend/tests/monitoring_layout.spec.ts` runs against the same isolated frontend
and mocked API/WS origins below. It verifies user/admin On/Off controls across all
four layouts, page 2, failed-toggle rollback, splitter pointer/keyboard interactions,
camera-area expansion without replacing the stream image, and mobile overflow.
Run `npx playwright test tests/monitoring_layout.spec.ts --project=chromium` with
`BASE_URL` pointing to that frontend. It never enables a real camera. The resize
case also saves `frontend/test-results/monitoring-layout.png` for visual inspection.

`frontend/tests/live_monitoring.spec.ts` uses the isolated API/WS origins above
to check real HLS via the backend feed, image errors/stale capture, and source
editing with API validation failure. Run with real API/mock flags false and
`BASE_URL` pointing to the isolated frontend. For its demo-only retry scenario,
start a second frontend with `NEXT_PUBLIC_USE_MOCK_DATA=true`,
`NEXT_PUBLIC_USE_MOCK_AUTH=false`, `NEXT_PUBLIC_USE_DEMO_CAMERAS=true` and a separate
`FIREGUARD_NEXT_DIST_DIR`, then set `TEST_DEMO=1` when running that spec. Native HLS
failures/time are simulated to prove repeated retries; no public camera is used.

For detection changes, use smoke-only, fire-only, combined and negative footage with known labels. Check confirmation, missing-frame reset, source timestamps, and independent event cooldowns. Exercise uploaded-video pause/resume/restart/stop, reconnects and corrupt inputs. Run camera and video together to observe prioritization, then test camera disable/reconnect and stale overlays.

Measure inference FPS and capture-to-display latency on the target hardware. Separately assess false positives and misses on representative footage. A blank image benchmark or successful model-class inspection is not an accuracy test. State explicitly when physical-camera testing was not performed.

## Documentation checks

The review regressions additionally run with:

```powershell
# backend, offline services only
.\venv\Scripts\python.exe -m pytest tests/unit/test_api_security_registration.py tests/unit/test_upload_limits.py tests/unit/test_event_history.py tests/unit/test_schema_readiness.py -q
# frontend
node --test tests/api_client.unit.cjs tests/dashboard_connection.unit.cjs
```

`frontend/tests/review_regressions.spec.ts` uses intercepted API/WS traffic and
checks server-paged history, status updates and camera-image recovery with an
unchanged token. Use the isolated frontend/API origins documented in
[the review handover](../REVIEW_REFACTOR_PLAN.md#bàn-giao-bản-tích-hợp).

For Markdown-only changes, verify relative links, referenced source paths, code-fence balance and `git diff --check`. Do not start cameras, modify databases or send notifications to validate prose.

## Notification permissions regression checks

`test_notification_permissions.py` mounts the real notification router using the
bootstrap module's registration AST without importing main. It stubs database lookups,
audit writes and bot delivery while exercising actual verified/blocked-account
checks, account-owned CRUD/test for both roles, validation/conflicts, settings permissions
and the global test-delivery route. It never changes Aiven data or sends messages.

`frontend/tests/notification_permissions.spec.ts` covers user Add/save/reload for
both channels, owned recipient management controls, admin-only system settings and API error states.
Run `npx playwright test tests/notification_permissions.spec.ts --project=chromium`
against a local frontend with real-API/mock-auth flags disabled. The spec intercepts
all auth/notification/settings API requests; do not run against a production site.
Set BASE_URL for the local frontend; PLAYWRIGHT_CHANNEL=chrome optionally uses
installed Chrome. Browser persistence is simulated; production DB persistence is
covered separately by the MySQL suite on an empty disposable *_test database.

## Video database-outage and bot regression checks

From backend, run `python -m unittest discover -s tests/unit -p test_video_database_recovery.py`.
The suite uses simulated MySQL errors, mocked bot HTTP responses and generated
video frames. It covers stale-settings survival, cache recovery/concurrent writes,
bounded read-only retry, cold failure sanitization, video callback wiring, pending
notification WebSockets, manual per-channel retries, independent channel errors,
Telegram photo fallback, provider rejection, rate limits and credential redaction.
No production database writes or messages are performed. Run camera/realtime and
MySQL offline suites alongside this change. Actual Render network latency, CPU
throughput and provider credential validity still require deployment checks.


`test_owned_notifications.py` exercises the real recipient repository on disposable
SQLite storage (never a runtime fallback), including cross-account CRUD denial,
owner-scoped uniqueness/capacity, legacy quarantine, independent active flags and
cooldowns, and delivery without legacy global destinations. Run it alongside
`test_notification_permissions.py` and the camera/video notification suites.

## Package refactor checks

Application code lives under `backend/app/`. Offline suites live under
`tests/unit/`; opt-in live suites live under `tests/integration/`. Shared safety
fixtures remain at `tests/`. Run `python -m pytest tests -q -rs` for the offline
default or `python -m compileall -q app scripts tests main.py` for syntax checks.
`tests/source.py` reads the real route/schema/bootstrap ASTs without importing
`main`; `tests/mocks.py` patches both canonical module names and package bindings.
The public entry point remains `uvicorn main:app`; Alembic revision history and
runtime/model paths are unchanged.
