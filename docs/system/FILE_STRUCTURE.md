# File structure

## Repository layout

```text
AI-fire-detection/
|-- AGENTS.md                 Coding-agent entry point
|-- backend/                  FastAPI, OpenCV, YOLO, persistence, notifications
|   |-- auth/                 Credentials, OTP, password reset, account database
|   |-- users/                User data models and current-user route
|   |-- tests/                Offline regressions and API integration tests
|   |-- .env.local.example    Template for private local overrides
|   |-- .dockerignore         Backend build exclusions
|   |-- Dockerfile            Backend container build and runtime defaults
|   |-- LOCAL_DEVELOPMENT.md  Local environment instructions
|   `-- requirements.txt      Python dependencies
|-- frontend/                 Next.js application with React and TypeScript
|   |-- src/app/              App Router pages and layouts
|   |-- src/components/       Shared UI and camera/video components
|   |-- src/context/          Authentication and language providers
|   |-- src/lib/api/          API client, account calls, mock service
|   |-- src/locales/          English and Vietnamese strings
|   |-- public/               Static public assets
|   |-- tests/                Playwright browser tests
|   |-- .env.example          Frontend environment template
|   |-- package.json          Scripts and JavaScript dependencies
|   |-- playwright.config.ts Browser test settings
|   `-- Dockerfile            Frontend container build
|-- deploy/                   Compose, reverse proxy, storage, VM scripts
|-- .github/workflows/        Local and cloud deployment workflows
|-- docs/                     API notes, feature docs, screenshots, proposal
|   `-- system/               This documentation collection
|-- start.bat                 Windows launcher for backend and frontend
|-- start-local-backend.sh    Starts the local Compose backend service
|-- .gitignore               Source-control exclusions
`-- LICENSE                  Repository license
```

## Backend modules

| File | Responsibility |
| --- | --- |
| [main.py](../../backend/main.py) | Environment loading, application startup/shutdown, HTTP and WebSocket routes, service wiring |
| [detection.py](../../backend/detection.py) | Load YOLO weights, validate required classes, produce raw detections |
| [detection_rules.py](../../backend/detection_rules.py) | Normalize class names, read settings, filter confidence, confirm observations, draw boxes |
| [inference_scheduler.py](../../backend/inference_scheduler.py) | Serialize access to the shared model and prioritize waiting cameras |
| [camera_manager.py](../../backend/camera_manager.py) | Shared webcam leases, capture threads, current frames, overlays, event queue, live detection state |
| [video_analyzer.py](../../backend/video_analyzer.py) | Upload job queue, paced analyzed frames, pause/resume/restart/cancel, evidence and cleanup |
| [database.py](../../backend/database.py) | SQLite camera records, settings, detection events and statistics |
| [storage.py](../../backend/storage.py) | Local snapshots, MinIO/S3 or GCS access, model retrieval, pending snapshot synchronization |
| [notification.py](../../backend/notification.py) | Zalo/Telegram notification delivery and channel cooldown |
| [auth/database.py](../../backend/auth/database.py) | Separate SQLite account database |
| [auth/dependencies.py](../../backend/auth/dependencies.py) | HTTP Basic credential validation and database dependencies |
| [auth/upload.py](../../backend/auth/upload.py) | Early HTTP Basic gate for video uploads, before multipart parsing |
| [auth/routes.py](../../backend/auth/routes.py) | Signup, account OTP, and password-reset endpoints |
| [auth/utils.py](../../backend/auth/utils.py) | Password hashing, OTP and mail helpers |
| [users/routes.py](../../backend/users/routes.py) | Authenticated current-user endpoint |

Schema/model files in `auth/` and `users/` define request, response, and user data structures. Read the route and its schema together when changing account behavior.

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
