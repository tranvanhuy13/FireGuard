# Real-time fire and smoke detection

The backend uses `MODEL_PATH`, defaulting to `backend/best.pt` when started from the backend directory. The model must expose both `fire` and `smoke` classes (case-insensitive; `flame`/`flames` map to `fire`). Startup reports an explicit error if either class is missing. No alternate model is downloaded automatically.

## Video playback

Upload through **Analyze Video → Upload and play**. Select 5, 10, or 15 detection updates per second. The player displays analyzed JPEG frames with matching boxes, confidence, and video timestamps. Play/pause, restart from the beginning, stop, and evidence images are supported. Preview is a silent analyzed-frame stream, not an audio player; it does not support arbitrary seeking. Camera inference gets priority. When inference is slower than the selected cadence, playback slows and shows buffering instead of attaching late boxes to unrelated frames.

- `POST /video-analysis`: multipart `file`, `sample_fps` (1–15, default 5). Returns `{ "job_id": "..." }`. HTTP Basic credentials are verified before the multipart body is read or spooled. Both verified, unblocked `user` and `admin` accounts may upload; rejected credentials return 401 and blocked/unverified accounts return 403. Empty/unsupported uploads return 400 and files over 500 MB return 413; failed uploads are removed.
- `GET /video-analysis` and `GET /video-analysis/{job_id}`: metadata and summaries, without image payloads.
- `POST /video-analysis/{job_id}/playback`: `{ "action": "pause" | "resume" | "restart" }`. Returns a job ID. Restart creates a fresh run using the retained upload and returns its new ID.
- `POST /video-analysis/{job_id}/cancel`: stop the active/queued analysis and unsent notifications, including notifications pending after analysis completion.
- `POST /video-analysis/{job_id}/notifications/retry`: authenticated body `{ "event_type": "fire" | "smoke", "channel": "zalo" | "telegram" }`; retry only an unsuccessful channel and return updated job metadata.
- `WS /ws/video-analysis/{job_id}`: pushed job state. Each newly analyzed frame includes a base64 JPEG in `frame`, `frame_id`, `current_time`, `detections`, and `confirmed`. The JPEG already contains its matching overlay. Metadata-only updates omit `frame`; clients retain the previous image. Other fields include `effective_fps`, `buffering`, `progress`, `events`, `summary`, `error`, and `revision`.

States are `queued`, `processing`, `paused`, `done`, `error`, and `cancelled`. Reconnecting immediately receives the latest state and image. Missing/evicted jobs close the socket with code 1008. Closing the modal pauses its job; reopening permits resume. Upload errors and corrupt/empty videos produce explicit errors.

One video actively holds the processing slot at a time. Pausing lets any in-flight frame finish, then releases the slot so another queued video can run. A paused job retains its decoder position, latest preview and analysis state. Resume sets it to `queued` until the slot is available, then continues from its next frame with playback timing reset. Paused and queued jobs can be cancelled immediately; cancelling/shutdown does not require resuming a paused job. At most 20 jobs are retained; the oldest completed job without pending notifications is evicted as needed. Upload sources are retained for restart until their final referencing job is evicted or the server shuts down; startup removes leftover temporary uploads. Each video keeps at most 24 preview evidence snapshots and one preview frame; first-notification evidence for a later class is stored separately when that limit is reached. Uploaded-video results do not create camera alarm events.

The first confirmed fire and smoke findings per job each enqueue one bot notification independently of camera cooldowns. Zalo receives warning text with an expiring direct S3 image link; Telegram receives the local evidence photo. Job metadata includes `notifications` with per-class/per-channel outcomes and attempt counts, plus `notification_pending` and worker health. Zalo and Telegram have independent bounded workers. Transient failures get at most three dispatch attempts; unsuccessful channels can be retried from the video modal without resending successful channels. WebSocket updates continue after playback completion until notification work settles. Pause/resume does not duplicate notifications; restart creates a new scope and cancels old unsent notifications even if the old analysis has finished. Stop skips unsent work but cannot retract an in-flight HTTP request. Successfully notified evidence survives job eviction and requires explicit cleanup, preserving S3 links. Configure bot credentials/enabled flags as described in [configuration](system/CONFIGURATION.md#bot-credentials-and-video-delivery).

## Cameras and settings

An operator can disable snapshot persistence for a test account using
`python -m scripts.provisioning.provision_camera_test_account camtest --disable-images` from
`backend/`. The global per-user opt-out blocks camera and uploaded-video snapshots
before image storage, while retaining in-memory playback and detection metadata.
Alerts are text-only and video evidence thumbnails are omitted. Existing images
are not deleted; see [account policy](ACCOUNT_NOTIFICATIONS.md#test-account-without-saved-images).

`POST /cameras` and `PUT /cameras/{id}` accept `{name, source, is_active}` through
the existing verified/unblocked HTTP Basic gate for user/admin. Source defaults
to `"0"` and accepts webcam indices 0–63, RTSP/RTSPS, or HTTP(S) camera streams
(including HLS and MJPEG). On PUT, omitting source preserves the current source.
Unsupported protocols/local paths return 422. Saved
sources survive restart; editing a source invalidates old capture/inference work
after the database write succeeds. Network capture uses bounded FFmpeg open/read
timeouts and reconnects on failure. A valid URL does not prove reachability: save,
enable, and check the actual picture/status. The old simulated connection test
has been removed. Stream URLs are reached by the backend host, not the viewer.

Real HLS sources are decoded and analyzed on the backend, then displayed through
the signed `/video_feed/{id}` stream. Browser-direct HLS remains a view-only demo
feature requiring both mock-data and demo-camera flags. No demo boxes/scores are
added to real feeds.

Camera capture runs independently of model inference. A single model scheduler serializes callers and gives waiting camera requests priority over video requests. Camera inference reads the latest frame rather than building a frame queue. Slow snapshot storage and notifications run separately. Overlays and detection status expire after one second without a fresh analyzed capture.

`WS /ws/detections` sends `{ "cameras": [...] }` up to 10 times per second. Camera records contain `camera_id`, `active`, `status`, `stale`, `detections`, and `confirmed`. Fresh records also include `frame_id`, `timestamp` (Unix time), and `latency_ms` (capture through inference). The dashboard clears detection badges when the connection or data becomes stale. Bounding boxes continue to appear on the existing camera MJPEG streams.

Every record also includes `generation`, `capture_frame_id`, `frame_age_ms`
(nullable before a capture), and `frame_fresh`. Capture is fresh while active and
its newest frame is less than six seconds old; AI `stale` remains a separate
one-second threshold. Clients hide the viewer clock when capture telemetry is
missing/stale, an image errors, or a media token is unavailable. This indicates
recent backend capture plus usable image transport, not a measured display
latency or a timestamp embedded by the source camera. Expired authorization and
transport loss clear badges and reconnect, including when refreshed tokens are
unchanged. Missing camera stream IDs return 404 and removed/disabled feeds close.

The AI settings page and both inference paths use:

| Setting | Units | Behavior |
| --- | --- | --- |
| `fire_threshold` | 0–100 percent | Minimum fire confidence |
| `smoke_threshold` | 0–100 percent | Minimum smoke confidence |
| `persistence` | 1–30 analyzed frames | Consecutive observations before confirmation |
| `cooldown` | 0–3600 seconds | Minimum interval between alarms for each class on each camera |

Existing `ai_confidence_threshold`, `ai_persistence_frames`, and `ai_cooldown_seconds` provide fallbacks when the newer settings are absent. `GET /settings` exposes effective values so the controls match the backend. Invalid numeric updates are rejected. A high-confidence box still obeys confirmation. Multiple boxes of one class count once per frame; fire and smoke confirmation/cooldowns are independent. Missing detections reset that class's streak. Changes take effect on subsequent analyzed frames.

## Verification

From `backend/`:

```powershell
.\venv\Scripts\python.exe -m unittest discover -s tests -p test_realtime_detection.py
.\venv\Scripts\python.exe -m unittest discover -s tests -p test_camera_lifecycle.py
```

These offline tests exercise sampled video decoding, confirmation/thresholds, synchronized frame metadata, negative and corrupt input, playback controls, queued cancellation, source retention, model serialization/camera priority, API handler contracts, camera cooldowns, lifecycle, and stale detection expiry. API handler tests run in-process with a fake socket; they do not open a network listener or a physical webcam.

From `frontend/`, run `node_modules/.bin/tsc --noEmit` (or `tsc.cmd` on Windows). Actual camera latency, smoke recall, and false positives still require representative footage from the deployment site; synthetic rule tests and blank-frame FPS are not accuracy measurements.
