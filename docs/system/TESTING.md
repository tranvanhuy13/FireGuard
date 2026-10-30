# Testing and verification

Commands below assume existing dependencies are installed. They are guidance, not a record that checks have run for a future change.

## Focused backend checks

From `backend/`, run the offline suites:

```powershell
.\venv\Scripts\python.exe -m unittest discover -s tests -p test_camera_lifecycle.py
.\venv\Scripts\python.exe -m unittest discover -s tests -p test_realtime_detection.py
.\venv\Scripts\python.exe -m unittest discover -s tests -p test_admin_profile.py
```

These suites isolate hardware/storage dependencies. Camera checks cover enable/disable, shared webcam leases, confirmation/cooldowns and stale state. Real-time checks cover settings, model scheduling, playback, cancellation, source retention and API handler contracts, including upload rejection before body reads and pause/resume slot handoff between videos. API handlers are exercised in-process with fake sockets; this is not a full network/browser test.

Use syntax compilation when appropriate:

```powershell
.\venv\Scripts\python.exe -m py_compile main.py camera_manager.py detection.py detection_rules.py inference_scheduler.py video_analyzer.py
```

Compilation does not load the application or verify runtime model accuracy.

`test_admin_profile.py` extracts the actual login/audit route definitions without
importing main. It checks admin/user login roles, profile email validation, audit
pagination, anonymous/user rejection and connection cleanup with a fake repository.
It does not connect to MySQL, load model weights, or start cameras.

## Backend integration tests and side effects

`tests/test_all_apis.py` and `tests/test_health_and_auth.py` import `main`, which checks the MySQL schema, loads the model and starts background managers. API tests can modify camera records, settings and other application state.

Pytest collection requires `FIREGUARD_TEST_MYSQL=1` and `MYSQL_DATABASE` ending in `_test`, before importing modules that start the application. The autouse fixture now resets its test user through the shared MySQL connection; it never writes `example.db`. Use a disposable database, disabled notification channels and configured model/storage. Offline `unittest` suites avoid this fixture.

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

`npm test` runs Playwright using `frontend/playwright.config.ts`. It targets Chromium and the `BASE_URL` environment variable, defaulting to `http://localhost:3000`. The configuration does not start the application automatically: start the required frontend/backend services first and prepare the account/data fixtures needed by the selected tests.

Existing specs cover authentication, redirects, role gates and API security expectations. Read each spec before running it; older expectations can differ from current backend access rules. Confirm actual responses and intended policy before changing code or weakening a test.

## Manual feature validation

For detection changes, use smoke-only, fire-only, combined and negative footage with known labels. Check confirmation, missing-frame reset, source timestamps, and independent event cooldowns. Exercise uploaded-video pause/resume/restart/stop, reconnects and corrupt inputs. Run camera and video together to observe prioritization, then test camera disable/reconnect and stale overlays.

Measure inference FPS and capture-to-display latency on the target hardware. Separately assess false positives and misses on representative footage. A blank image benchmark or successful model-class inspection is not an accuracy test. State explicitly when physical-camera testing was not performed.

## Documentation checks

For Markdown-only changes, verify relative links, referenced source paths, code-fence balance and `git diff --check`. Do not start cameras, modify databases or send notifications to validate prose.
