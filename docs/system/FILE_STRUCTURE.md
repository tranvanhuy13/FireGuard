# File structure

## Backend layout

```text
backend/
|-- main.py                    Stable uvicorn main:app entry point
|-- app/
|   |-- bootstrap.py           Service construction, router wiring and lifecycle
|   |-- core/                  Environment/paths, CORS, health routes, runtime services
|   |-- auth/                  Credentials, OTP, recovery, sessions, audit and tokens
|   |-- users/                 User routes, models and request/response schemas
|   |-- cameras/               Camera routes, source schema, capture manager and streams
|   |-- detection/             Detector, shared confirmation rules and model scheduler
|   |-- videos/                Upload/playback routes, control schemas and analyzer
|   |-- events/                History, alert/statistics routes and alert WebSocket
|   |-- settings/              Settings routes and bounded settings cache
|   |-- notifications/         Recipient routes/repository, bot delivery and test route
|   |-- storage/               Snapshot routes, storage providers, evidence and S3 URLs
|   `-- db/                    MySQL configuration, engine, schema and repositories
|-- migrations/                Existing Alembic revision history
|-- scripts/
|   |-- maintenance/           Snapshot cleanup and legacy camera assignment
|   |-- migration/             Read-only legacy SQLite import into MySQL
|   |-- provisioning/          Seed, test-account provisioning and operator role changes
|   `-- diagnostics/           Explicit live storage smoke check
|-- tests/
|   |-- unit/                  Offline regressions and in-process API-handler checks
|   |-- integration/           Opt-in live app and real MySQL checks
|   |-- conftest.py            Integration opt-in and disposable-database safety gate
|   |-- integration_mode.py    Shared opt-in state
|   |-- integration_fixtures.py Database-writing fixtures, opt-in only
|   |-- source.py              Actual route ASTs for isolated handler tests
|   `-- mocks.py               Package module/parent-binding isolation helper
|-- best.pt                    Default local model; path unchanged
|-- model_provenance.json      Checkpoint provenance
|-- Dockerfile
|-- .dockerignore
|-- .env.local.example
|-- alembic.ini
|-- pytest.ini
|-- requirements.txt
|-- requirements-test.txt
`-- LOCAL_DEVELOPMENT.md
```

Python package directories contain `__init__.py`. Local `.env.local`, `certs/`,
`snapshots/`, `uploads_tmp/`, `migration_backups/`, `venv/`, caches and legacy
SQLite files remain at their existing locations. They are runtime/developer
files, not application packages; moving source does not migrate or delete data.

## Backend responsibilities

| Module | Responsibility |
| --- | --- |
| `main.py` | Builds the app through `app.bootstrap.create_app`; keeps the deployment entry point |
| `app/bootstrap.py` | Loads environment before service imports, starts shared services, registers routers and shuts down managers/pool |
| `app/core/config.py` | Resolves backend-root paths and preserves process/local/shared environment precedence |
| `app/core/runtime.py` | One process-owned camera/video service set and alert event loop; no services start on import |
| `app/cameras/manager.py` | Webcam leases, capture threads, latest frames, overlays and event queue |
| `app/detection/rules.py` | Class normalization, thresholds, confirmation and drawing for cameras/videos |
| `app/detection/scheduler.py` | One model owner with camera priority and cancellation |
| `app/videos/analyzer.py` | Upload queue, paced playback, control, evidence and independent bot queue |
| `app/db/repositories/operations.py` | Camera/settings/events/statistics persistence using the shared MySQL engine |
| `app/auth/database.py` | Account connection compatibility using the same shared MySQL database |
| `app/notifications/repository.py` | Account-owned recipient persistence |
| `app/storage/service.py` | Local/cloud snapshots, model retrieval and background retention/synchronization |

Public HTTP/WebSocket paths remain unchanged. The repository also contains
`frontend/` (Next.js), `deploy/` (Compose/proxy/VM scripts), `.github/workflows/`
(CI/deployment) and `docs/` (guides and historical design notes).

## Frontend feature map

| Location | Responsibility |
| --- | --- |
| `src/app/page.tsx` | Landing page |
| `src/app/login/`, `register/`, `verify-otp/` | Login, registration, account activation |
| `src/app/forgot-password/`, `reset-password/`, `auth/callback/` | Account recovery and callback pages |
| `src/app/dashboard/` | Dashboard layout and overview |
| `src/app/dashboard/cameras/`, `history/`, `ai-settings/` | Monitoring, event history, AI settings |
| `src/app/dashboard/notifications/`, `profile/`, `users/`, `audit-log/` | Notification and account/admin UI |
| `src/components/CameraGrid.tsx` | Camera tiles and controls, opens Analyze Video |
| `src/components/VideoFeed.tsx` | Default camera feed |
| `src/components/CameraDetectionStatus.tsx` | Live detection WebSocket hook and freshness badge |
| `src/components/VideoAnalysisModal.tsx` | Upload, analyzed playback, control commands, evidence timeline |
| `src/components/AlertPanel.tsx`, `StatsChart.tsx`, `HistoryModal.tsx` | Alerts, statistics, history presentation |
| `src/components/RequireRole.tsx` | UI access gate |
| `src/context/AuthContext.tsx` | User session, role normalization, stream-token refresh |
| `src/context/LanguageContext.tsx`, `src/locales/` | Language selection and translations |
| `src/lib/api/client.ts`, `auth.ts`, `mockService.ts` | Request handling, authentication calls, explicit mock behavior |
| `src/config.ts` | Backend and WebSocket base URLs |

A page existing in the frontend does not imply the backend implements every matching management endpoint; inspect its data source and routes.

## Runtime and generated files

`backend/best.pt` is the default model. Other weights may exist locally; their classes must be inspected before use. Although `*.pt` is ignored, already tracked weights remain tracked.

Databases (`*.db`), `.env`/`.env.local`, snapshots, temporary uploads, virtual environments, `node_modules/`, build outputs, logs, and browser-test artifacts are runtime/developer data rather than architectural source modules. Do not infer tracked status from their presence on disk; use `git status` and `git ls-files`. Temporary video uploads are managed by `VideoAnalyzer`.

## Persistence and operator commands

Accounts, cameras, settings, evidence and notification recipients share MySQL.
SQLite is used only for legacy import and disposable offline test storage.
Alembic files remain under `backend/migrations/` and import `app.db`.

Run operator commands from `backend/` with `python -m`, for example:

```text
python -m scripts.maintenance.assign_legacy_cameras
python -m scripts.migration.migrate_sqlite_to_mysql --help
python -m scripts.provisioning.seed_mysql
python -m scripts.provisioning.provision_camera_test_account --help
python -m scripts.provisioning.set_role --help
python -m scripts.diagnostics.storage_smoke
```

Read each command's help and side effects before execution. Cleanup, provisioning,
role changes and live diagnostics are not part of offline verification.
