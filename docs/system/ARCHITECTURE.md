# Runtime architecture

## Services and startup

The browser runs a Next.js frontend. HTTP requests reach FastAPI; camera images use MJPEG streams, while detection status, alerts, and analyzed video state use WebSockets. The backend owns camera capture, the YOLO model, SQLite persistence, and notification delivery.

`backend/main.py` loads configuration before importing services that read environment variables. Importing the application initializes the databases, ensures model availability, loads YOLO, and constructs the camera/video managers. It is not a side-effect-free library import. The FastAPI lifespan installs the alert callback and shuts down managers.

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

Pause/resume operates on a job. Restart creates a new run that shares the retained source. Stop cancels active or queued work. Uploads are retained until their last referencing job is evicted or shutdown removes them. Jobs are in memory, with a maximum of 20 retained jobs and 24 evidence snapshots per video. Uploaded-video detections do not create camera alarm events. The first confirmed fire and smoke evidence in each job is placed in a separate bounded notification queue (40 items). One worker sends Zalo/Telegram independently of playback; pause/resume does not requeue, restart creates a new notification scope, and cancelled jobs skip unsent work. An HTTP request already in progress cannot be recalled.

The job's `notifications` metadata records queued and per-channel outcomes. Snapshot attachments are pinned against maintenance until delivery finishes; jobs with pending notifications cannot be evicted. Evidence referenced by a successful notification is preserved after job eviction so S3 links do not immediately break. Such video evidence currently requires explicit/manual deletion; other video evidence retains its existing eviction cleanup. Notification work and deduplication are in memory and are not recovered across backend restarts.

See [the detailed playback contract](../REALTIME_DETECTION.md) for state and payload fields.

## Persistence and external services

The detection database (`database.py`) holds cameras, settings, and events. Account data uses the separate `auth/database.py` database. `storage.py` selects MinIO/S3 when `S3_ENDPOINT` is set, otherwise GCS when `GCS_BUCKET` is set, otherwise local disk. Missing model files can be retrieved from configured object storage. Snapshot upload failures can fall back to disk for later synchronization.

Zalo and Telegram delivery lives in `notification.py`. Zalo sends warning text containing a direct expiring S3 image link after verifying the remote object; Telegram uploads the local image. Zalo links require a publicly reachable S3 API origin configured through `S3_PUBLIC_ENDPOINT`. Account OTP email behavior lives in `auth/utils.py`; it is a separate flow from camera alarm notifications.

Both bots share the same warning body (detected class, confidence, time and source). Camera notifications include the camera name captured with the event; uploaded-video notifications identify the video filename, job and video timestamp instead of inventing a camera name. Telegram uses this body as the photo caption or text; Zalo appends the S3 image link. Adding camera context does not bypass camera notification cooldowns.

## Access control as implemented

Operational HTTP routes require verified, unblocked accounts through HTTP Basic. Both `user` and `admin` may monitor cameras, add/edit/delete/toggle them, analyze video, read history/statistics, test notifications and change the shared alarm sound preference. System configuration and account management require `admin`.

Camera feeds, snapshots and all WebSockets require signed, expiring media credentials. Connected feeds/sockets recheck authorization periodically. Zalo's direct S3 links carry their own expiring S3 signature and do not use backend media credentials. Roles and blocking state are stored in the account database; signup cannot assign admin privileges.

See [authentication and roles](../AUTHORIZATION.md) for the endpoint matrix, migration, first-admin provisioning, token lifecycle and feature boundaries.
