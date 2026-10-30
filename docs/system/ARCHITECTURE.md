# Runtime architecture

## Services and startup

The browser runs a Next.js frontend. HTTP requests reach FastAPI; camera images use MJPEG streams, while detection status, alerts, and analyzed video state use WebSockets. The backend owns camera capture, the YOLO model, MySQL persistence, and notification delivery.

`backend/main.py` loads configuration before importing services that read environment variables. Importing the application checks the migrated MySQL schema, ensures model availability, loads YOLO, and constructs the camera/video managers. It is not a side-effect-free library import. The FastAPI lifespan installs the alert callback and shuts down managers.

## Camera processing

1. `Camera` captures frames independently from inference and publishes its newest frame.
2. `SharedWebcam` lets multiple enabled tiles share a physical device. Current camera-management operations normalize sources to the backend computer's webcam `0`.
3. `CameraManager` requests inference on available new frames, targeting at most 10 inferences per second per camera. Actual throughput depends on the model, hardware, and number of sources.
4. `InferenceScheduler` permits one model call at a time; waiting camera requests take priority over uploaded-video requests.
5. Shared rules filter and confirm fire/smoke detections. Overlays expire after one second without a fresh analyzed capture.
6. Confirmed camera events are queued for snapshot/database work. Alerts are broadcast and notifications are dispatched separately from the capture path.

Generation checks discard work from a camera session that has been disabled or replaced. Webcam leases are released when no enabled tile needs the device. The stream serves recent frames rather than accumulating a queue of old frames.

Periodic snapshots run every 15 seconds per camera. Detection console messages are limited to once per 15 seconds per camera/class. These are separate from the configurable alarm-event cooldown and the notification module's channel cooldown.

## Detection policy

`FireDetector` requires model classes that normalize to both `fire` and `smoke`. `flame` and `flames` normalize to `fire`; class names are case-insensitive. It produces raw boxes and scores. The source pipelines apply shared rules before drawing overlays.

The canonical settings are `fire_threshold` and `smoke_threshold` (percent), `persistence` (consecutive analyzed frames), and `cooldown` (seconds). Legacy `ai_*` settings supply fallbacks. Multiple boxes of the same class count once in a frame. Missing observations reset that class's streak. High confidence does not bypass persistence. Fire and smoke have independent confirmation and camera-event cooldown state.

## Uploaded-video processing

`POST /video-analysis` verifies credentials before reading the multipart upload, then creates a background job. One active video holds the playback slot at a time. A paused worker releases that slot after its in-flight frame finishes; resume queues for a slot and continues from its retained decoder position. The worker samples and decodes frames, requests lower-priority model inference, applies shared rules, and publishes a bounded latest preview.

`WS /ws/video-analysis/{job_id}` carries image and matching detection/timestamp data. Metadata-only updates omit the image. Playback slows when inference cannot keep pace; the frontend displays buffering. Preview is silent and does not implement arbitrary seeking.

Pause/resume operates on a job. Restart creates a new run that shares the retained source. Stop cancels active or queued work. Uploads are retained until their last referencing job is evicted or shutdown removes them. Jobs are in memory, with a maximum of 20 retained jobs and 24 preview evidence snapshots per video (plus first-notification evidence when the preview limit is reached). Uploaded-video detections do not create camera alarm events. The first confirmed fire and smoke evidence in each job is dispatched through independent bounded Zalo and Telegram queues (40 items per channel). Each channel has its own worker, so a stalled bot cannot block the other. Pause/resume does not requeue; restart creates a new scope and cancels unsent work from the old job, even when its analysis has finished. Cancelled jobs skip unsent work. An HTTP request already in progress cannot be recalled.

The job's `notifications` metadata records per-class/per-channel `queued`, `sending`, `retrying`, `sent`, `failed`, `disabled`, `unconfigured`, or `cancelled` outcomes and attempt counts. `notification_pending` counts unfinished channel deliveries. Each video delivery gets one HTTP attempt per dispatch, at most three dispatches for transient errors, with delayed retries yielding to other ready jobs. Invalid credentials/permissions do not retry automatically. Manual retry targets only one unsuccessful channel and preserves successful channels. WebSockets stay open after playback finishes until pending notifications settle. Snapshot attachments are pinned against maintenance until both channels settle; local cleanup is delegated to background maintenance, and retrying Telegram can restore a local attachment from object storage; jobs with pending notifications cannot be evicted. Evidence referenced by a successful notification is preserved after job eviction so S3 links do not immediately break. Such video evidence currently requires explicit/manual deletion; other video evidence retains its existing eviction cleanup. Notification work and deduplication are in memory and are not recovered across backend restarts.

See [the detailed playback contract](../REALTIME_DETECTION.md) for state and payload fields.

## Persistence and external services

The repositories (`database.py` and `auth/database.py`) share one Aiven MySQL database through `db/engine.py`. Schema changes are explicit Alembic migrations, never runtime DDL. Camera/settings/events and account tables remain separate modules. See [MySQL migration](../MYSQL_AIVEN_MIGRATION.md). `storage.py` selects MinIO/S3 when `S3_ENDPOINT` is set, otherwise GCS when `GCS_BUCKET` is set, otherwise local disk. Missing model files can be retrieved from configured object storage. Snapshot upload failures can fall back to disk for later synchronization.

Zalo and Telegram delivery lives in `notification.py`. Zalo sends warning text containing a direct expiring S3 image link after verifying the remote object; Telegram uploads the local image. Zalo links require a publicly reachable S3 API origin configured through `S3_PUBLIC_ENDPOINT`. Account OTP email behavior lives in `auth/utils.py`; it is a separate flow from camera alarm notifications.

Both bots share the same warning body (detected class, confidence, time and source). Camera notifications include the camera name captured with the event; uploaded-video notifications identify the video filename, job and video timestamp instead of inventing a camera name. Telegram uses this body as the photo caption or text; Zalo appends the S3 image link. Adding camera context does not bypass camera notification cooldowns.

## Access control as implemented

Operational HTTP routes require verified, unblocked accounts through HTTP Basic. Both `user` and `admin` may monitor cameras, add/edit/delete/toggle them, analyze video, read history/statistics, test notifications and change the shared alarm sound preference. System configuration and account management require `admin`.

Camera feeds, snapshots and all WebSockets require signed, expiring media credentials. Connected feeds/sockets recheck authorization periodically. Zalo's direct S3 links carry their own expiring S3 signature and do not use backend media credentials. Roles and blocking state are stored in the account database; signup cannot assign admin privileges.

See [authentication and roles](../AUTHORIZATION.md) for the endpoint matrix, migration, first-admin provisioning, token lifecycle and feature boundaries.

## Notification recipients

Notification Accounts/Groups use admin-only backend APIs and the MySQL `notification_targets` table. Bot tokens continue to come from environment/settings. Active persisted recipients are authoritative for a channel; when a channel has saved rows but all are disabled, it sends to nobody. When no rows exist, the legacy environment/settings chat ID remains a fallback. An active recipient save enables the persisted channel flag; explicit environment enabled flags remain authoritative. Camera/video alerts send to each active destination. Per-recipient results let video retries skip successful deliveries, including after manual retry; editing a destination changes its delivery identity.

The recipients page always uses the real API, even when other dashboard data is mocked. The Import action explicitly copies user-created browser recipients, preserving active flags and excluding seeded demo entries. It does not send messages. The Test button invokes real single-recipient delivery only on an explicit click. Configuration uses the existing backend Settings editor; mock rules do not control actual alerts.
