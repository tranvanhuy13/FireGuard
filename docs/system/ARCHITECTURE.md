# Runtime architecture

## Services and startup

The dashboard tracks alert-history HTTP, camera HTTP and alert WebSocket states
independently. Requests time out after 30 seconds, retry transient failures up to
five times with 2–30 second backoff, and honor HTTP Retry-After. Authentication
and other permanent 4xx errors do not automatically loop. Request generations
and abort cleanup reject stale results after retry, unmount or navigation.
Transient failures show a nonblocking localized notice while retaining data;
reconnecting the stream refreshes history without replacing newer live alerts.
Camera requests run serially and are shared with the dashboard camera grid;
standalone grids also use serial polling. Hidden tabs defer polling and returning
online or visible refreshes data. Stream-token refresh restarts only its socket.
The header's Internet indicator reflects browser connectivity, not backend health.

The browser runs a Next.js frontend. HTTP requests reach FastAPI; camera images use MJPEG streams, while detection status, alerts, and analyzed video state use WebSockets. The backend owns camera capture, the YOLO model, MySQL persistence, and notification delivery.

`backend/main.py` delegates to `app.bootstrap.create_app()`. Bootstrap loads environment configuration before importing services, checks the migrated MySQL schema, ensures model availability, loads YOLO and constructs the camera/video managers. Importing `main` still starts these services; importing route modules does not start managers. Routes use the process-owned services in `app.core.runtime`. The FastAPI lifespan installs alert callbacks and shuts down managers and the shared MySQL engine.

## Camera processing

The dashboard camera wall retains the 4/9/16/25 layouts and pagination. Every
authenticated supported role (`user` and `admin`) has a visible On/Off switch on
each owned camera tile, including the dense layouts. Switching off still asks
for confirmation, pending requests disable the switch, and failed updates restore
the previous state. Camera capture, AI, freshness and ownership remain server-owned.

On desktop, drag the separators to resize navigation, the alerts column, statistics
and daily count panels; separators also support arrow keys, Shift for larger steps,
and Home/End for bounds. Expand camera area hides surrounding dashboard panels
without remounting the camera stream; Restore panels brings them back. Reset layout
restores the dashboard panel proportions. Sizes are kept for the current mounted
view only. Narrow screens use stacked panels and hide desktop-only separators.

1. `Camera` captures frames independently from inference and publishes its newest frame.
2. `SharedWebcam` lets enabled tiles using the same webcam index share that physical device. Sources preserve webcam indices 0–63 or RTSP/RTSPS/HTTP(S) URLs; local paths and other protocols are rejected. Network capture uses FFmpeg with five-second open/read timeouts. Authenticated camera operators control these backend-host sources, including cameras on its private network.
3. `CameraManager` requests inference on available new frames, targeting at most 10 inferences per second per camera. Actual throughput depends on the model, hardware, and number of sources.
4. `InferenceScheduler` permits one model call at a time; waiting camera requests take priority over uploaded-video requests.
5. Shared rules filter and confirm fire/smoke detections. Overlays expire after one second without a fresh analyzed capture.
6. Confirmed camera events are queued for snapshot/database work. Alerts are broadcast and notifications are dispatched separately from the capture path.

Generation checks discard work from a camera session that has been disabled or replaced. Webcam leases are released when no enabled tile needs the device. The stream serves recent frames rather than accumulating a queue of old frames.

OpenCV open/read exceptions are handled by the capture retry loop so a transient
driver or decoder error does not terminate the camera thread. Error logs omit
exception text because it may include credentials from a camera URL.
Webcam indices refer to USB devices on the backend host. External sources must provide a video stream URL reachable
from the backend, rather than a camera login/viewer web page.

Editing a source persists the database update before changing the live camera,
invalidates in-flight reads/inference, and lets the capture thread release and
reopen the source. Startup no longer rewrites saved sources to webcam 0. Invalid
legacy sources are skipped with a camera-ID-only warning. JPEGs older than six
seconds are withheld. WebSocket capture freshness is independent of AI results.
Real HLS cameras use the authenticated backend MJPEG/AI path; only explicit demo
cameras play HLS directly in the browser. The grid combines capture freshness
with image errors/token availability before showing its clock or counting a
camera as running. Losing telemetry hides the clock. The clock is viewer system
time, not the frame's capture timestamp.

Periodic snapshots run every 15 seconds per camera. Detection console messages are limited to once per 15 seconds per camera/class. These are separate from the configurable alarm-event cooldown and the notification module's channel cooldown.

## Detection policy

`FireDetector` requires model classes that normalize to both `fire` and `smoke`. `flame` and `flames` normalize to `fire`; class names are case-insensitive. It produces raw boxes and scores. The source pipelines apply shared rules before drawing overlays.

The canonical settings are `fire_threshold` and `smoke_threshold` (percent), `persistence` (consecutive analyzed frames), and `cooldown` (seconds). Legacy `ai_*` settings supply fallbacks. Multiple boxes of the same class count once in a frame. Missing observations reset that class's streak. High confidence does not bypass persistence. Fire and smoke have independent confirmation and camera-event cooldown state.

## Uploaded-video processing

`POST /video-analysis` verifies credentials before reading the multipart upload, then creates a background job. One active video holds the playback slot at a time. A paused worker releases that slot after its in-flight frame finishes; resume queues for a slot and continues from its retained decoder position. The worker samples and decodes frames, requests lower-priority model inference, applies shared rules, and publishes a bounded latest preview.

`WS /ws/video-analysis/{job_id}` carries image and matching detection/timestamp data. Metadata-only updates omit the image. Playback slows when inference cannot keep pace; the frontend displays buffering. Preview is silent and does not implement arbitrary seeking.

Pause/resume operates on a job. Restart creates a new run that shares the retained source. Stop cancels active or queued work. Uploads are retained until their last referencing job is evicted or shutdown removes them. Playback jobs are in memory, with creation/terminal result metadata archived in MySQL and a maximum of 20 live retained jobs and 24 preview evidence snapshots per video (plus first-notification evidence when the preview limit is reached). Uploaded-video evidence is persisted with source_kind='video' for the combined Fire Alert feed, and remains excluded from camera history/statistics and camera alarm cooldowns. The first confirmed fire and smoke evidence in each job is dispatched through independent bounded Zalo and Telegram queues (40 items per channel). Each channel has its own worker, so a stalled bot cannot block the other. Pause/resume does not requeue; restart creates a new scope and cancels unsent work from the old job, even when its analysis has finished. Cancelled jobs skip unsent work. An HTTP request already in progress cannot be recalled.

The job's `notifications` metadata records per-class/per-channel `queued`, `sending`, `retrying`, `sent`, `failed`, `disabled`, `unconfigured`, or `cancelled` outcomes and attempt counts. `notification_pending` counts unfinished channel deliveries. Each video delivery gets one HTTP attempt per dispatch, at most three dispatches for transient errors, with delayed retries yielding to other ready jobs. Invalid credentials/permissions do not retry automatically. Manual retry targets only one unsuccessful channel and preserves successful channels. WebSockets stay open after playback finishes until pending notifications settle. Snapshot attachments are pinned against maintenance until both channels settle; local cleanup is delegated to background maintenance, and retrying Telegram can restore a local attachment from object storage; jobs with pending notifications cannot be evicted. Evidence referenced by a successful notification is preserved after job eviction so S3 links do not immediately break. All registered camera/video/periodic evidence is retained for seven days from capture, including notified evidence; owned video evidence survives job eviction until that deadline. Notification work and deduplication are in memory and are not recovered across backend restarts.

See [the detailed playback contract](../REALTIME_DETECTION.md) for state and payload fields.

## Persistence and external services

The repositories (`database.py` and `auth/database.py`) share one Aiven MySQL database through `db/engine.py`. Schema changes are explicit Alembic migrations, never runtime DDL. Camera/settings/events and account tables remain separate modules. See [MySQL migration](../MYSQL_AIVEN_MIGRATION.md). `storage.py` selects MinIO/S3 when `S3_ENDPOINT` is set, otherwise GCS when `GCS_BUCKET` is set, otherwise local disk. Missing model files can be retrieved from configured object storage. Snapshot upload failures can fall back to disk for later synchronization.

Zalo and Telegram delivery lives in `notification.py`. Zalo sends warning text containing a direct expiring S3 image link after verifying the remote object; Telegram uploads the local image. Zalo links require a publicly reachable S3 API origin configured through `S3_PUBLIC_ENDPOINT`. Account OTP email behavior lives in `auth/utils.py`; it is a separate flow from camera alarm notifications.

Both bots share the same warning body (detected class, confidence, time and source). Camera notifications include the camera name captured with the event; uploaded-video notifications identify the video filename, job and video timestamp instead of inventing a camera name. Telegram uses this body as the photo caption or text; Zalo appends the S3 image link. Adding camera context does not bypass camera notification cooldowns.

## Access control as implemented

After the review fixes, long-lived feeds and sockets recheck media authorization
every 30 seconds. Upload body parsing is bounded to two concurrent requests per
process and 501 MiB including multipart overhead; the file limit remains 500 MiB.
`CORS_ORIGINS`, when configured, replaces the development origin defaults.

Operational HTTP routes require verified, unblocked accounts through HTTP Basic. Cameras, feeds, video jobs, evidence, alerts, status updates, history and statistics are scoped to the current account for both roles. Legacy NULL-owner records are hidden; unassigned cameras are not started. Dashboard snapshot access issues Supabase/S3 signed URLs valid for at most five minutes and bounded by seven-day retention. See [private evidence and rollout](../PRIVATE_ALERT_EVIDENCE.md). Both `user` and `admin` may monitor cameras, add/edit/delete/toggle them, analyze video, read history/statistics, test notifications and change the shared alarm sound preference. System configuration and account management require `admin`.

Camera feeds, snapshots and all WebSockets require signed, expiring media credentials. Connected feeds/sockets recheck authorization periodically. Zalo's direct S3 links carry their own expiring S3 signature and do not use backend media credentials. Roles and blocking state are stored in the account database; signup cannot assign admin privileges.

See [authentication and roles](../AUTHORIZATION.md) for the endpoint matrix, migration, first-admin provisioning, token lifecycle and feature boundaries.

## Notification recipients

Notification Accounts/Groups belong to the authenticated account for both roles. Users and admins can list/add/edit/delete/test only their own recipients. `notification_targets.owner_user_id` references `users.id`; unique destinations and the 20-recipient channel limit apply per account. NULL-owner legacy rows remain stored but are never listed or used for delivery. Camera and video jobs pass their persisted owner to delivery, including retries. No global chat-ID fallback is used. Camera channel cooldowns are independent per owner. Bot tokens and global channel availability remain admin/environment configuration; recipient active switches never modify shared settings. Each account enables or disables its own destinations using their active switches. See [migration and rollout](../ACCOUNT_NOTIFICATIONS.md).

Camera/video alerts send to each active destination belonging to the source owner. Per-recipient results let video retries skip successful deliveries, including after manual retry; editing a destination changes its delivery identity.

The recipients page always uses the real API, even when other dashboard data is mocked. The Import action explicitly copies user-created browser recipients, preserving active flags and excluding seeded demo entries. It does not send messages. The Test button invokes real single-recipient delivery only on an explicit click. Configuration uses the existing backend Settings editor; mock rules do not control actual alerts.

## Settings during a database outage

`database.get_setting` reads a shared settings snapshot, loaded with one SELECT.
After five seconds, warm readers receive the last valid snapshot immediately while
one daemon thread refreshes it. Refresh failures retain that snapshot and are
retried on a later access, without terminating video/camera analysis. A process
with no valid snapshot fails rather than silently inventing detection thresholds.
Committed settings/recipient-enable writes update the local snapshot immediately;
other processes discover changes on refresh. Old refreshes cannot undo local writes.
Admin `get_all_settings` remains a fresh database read.

Settings and recipient SELECTs retry one disconnected connection (MySQL 2006,
2013, 2055) on a new connection. Writes are never replayed automatically. Pending
video notifications remain visible over WebSocket after processing ends, and the
per-channel authenticated retry API uses the existing queue/deduplication policy.
A notification configuration outage reports a retryable channel failure and does
not interrupt analysis or suppress the other channel. Bot error redaction uses
in-memory values and request destinations, without issuing database queries.

The admin global Test action bypasses camera cooldown and returns actual channel outcomes with overall `ok`, `partial` or `error`; an HTTP 200 alone does not mean a bot delivered a message.
