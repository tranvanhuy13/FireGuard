# Authentication and roles

The backend is the authority for account roles. Frontend controls are only a user-interface convenience. Editing browser state or sending a `role` field with signup does not grant privileges.

| Operation | user | admin |
| --- | --- | --- |
| View cameras, live video, detections, alerts, history, statistics and snapshots | Yes | Yes |
| Enable/disable cameras | Yes | Yes |
| Upload/analyze video and control playback | Yes | Yes |
| Send tests to own recipients | Yes | Yes |
| Use system test endpoint (own recipients only) | No | Yes |
| View/add own Zalo and Telegram recipients | Yes | Yes |
| Edit/delete/enable own recipients | Yes | Yes |
| Read/change the shared alarm sound preference | Yes | Yes |
| Add, edit or delete cameras | Yes | Yes |
| Read masked system settings and update AI/notification configuration | No | Yes |
| List accounts, assign roles, block/unblock accounts | No | Yes |

## HTTP and media credentials

Operational HTTP routes require HTTP Basic credentials in `Authorization`. `POST /video-analysis` uses a dedicated upload route that verifies credentials before FastAPI reads/parses the multipart body; its endpoint reuses that verified identity without checking the password a second time. Missing or incorrect credentials return 401. Unverified or blocked accounts and insufficient permissions return 403. `/auth/login` and `/users/me` return the persisted `role` (`user` or `admin`).

The health endpoint `/`, generated API documentation, signup, account OTP and password recovery remain public. Successful OTP verification is required before using operational features. Blocking is stored separately from verification, so account verification/password recovery cannot unblock an account.

Use authenticated `GET /auth/stream-token` for a signed, one-hour media token. Supply it as `?token=...` to both `/video_feed` routes, `/snapshots/{name}`, and all three `/ws/...` routes. Media tokens cannot authorize management HTTP requests. Signatures are tied to the current password hash; expired/tampered tokens return 401. Blocked/unverified accounts cannot use otherwise valid tokens. Connected streams and WebSockets recheck authorization approximately every 30 seconds, and close when access expires or is revoked. Rejected WebSocket connections use policy close code 1008 (the HTTP handshake can be rejected before acceptance).

Set the same private `STREAM_TOKEN_SECRET` on every backend worker to keep credentials valid across workers and restarts. Without it, each process uses a random secret. Never log or persist media URLs containing tokens in analytics. Proxy access logs should redact the `token` query parameter. The frontend keeps media tokens in memory and renews them before expiry. Logout clears the browser session; a copied media credential remains valid until expiry unless the password changes or the account is blocked.

Zalo notifications include a direct presigned S3 GET link scoped to one snapshot, valid for 24 hours by default (`S3_SNAPSHOT_URL_TTL_SECONDS`). Anyone holding the link can read that image until expiration, subject to the storage provider's access policy and object availability. This S3 signature does not grant access to backend APIs or camera streams. The existing five-minute backend snapshot-token helper remains available for compatibility but is no longer used for Zalo delivery. Telegram continues uploading the image directly. Protected backend snapshot responses use `Cache-Control: no-store`.

## Account administration

Migration runs during backend startup and adds `role` (default `user`) and `is_blocked` (default false), preserving existing accounts. Existing accounts named `admin` are **not** automatically promoted. Signup always creates an unverified `user`.

To provision the first administrator, run from `backend/` against the intended account database:

```powershell
.\venv\Scripts\python.exe -m scripts.provisioning.set_role EXISTING_VERIFIED_USERNAME admin
```

The command loads `.env.local` and `.env` with process variables taking precedence, and honors `AUTH_DB_PATH`. It requires an existing verified, unblocked account. No default admin password is created. Log in again after assigning the role.

Admins can use the real frontend Users page or these HTTP Basic endpoints:

- `GET /users`: returns public account fields only; no password hashes or OTPs.
- `PUT /users/{id}` with `{"role":"admin"}` or `{"status":"blocked"}` / `{"status":"active"}`. Both fields can be sent together.
- Only roles `user`/`admin` and statuses `active`/`blocked` are accepted; unknown fields return 422. Unblocking does not bypass OTP verification. Admins cannot change their own role or block themselves, or remove the last active admin. Updates use a database transaction.

## Scope and verification

This implements authorization for all existing backend operations and real account administration. Notification accounts/groups use authenticated `/notifications/accounts` and `/notifications/groups` APIs. Both roles can list/create/edit/delete/enable/test only their own destinations. Owner-scoped recipients are used by camera/video alerts with server-side bot credentials. Legacy mock rules are not applied to alert routing and their tab is hidden on the real recipients page. The existing branch's `PATCH /alerts/{id}/status` and `GET /audit-log` APIs are preserved, with `user`/`admin` permissions replacing legacy viewer/operator roles. `PUT /alerts/{id}` and `PUT /users/{id}/role` remain supported for compatibility. The audit-log frontend screen still uses its existing mock integration.

For authorization changes, verify anonymous rejection, role boundaries, account blocking, media expiry/revocation and legacy migration using disposable accounts and fake camera/storage/video services. Both roles must be able to add, edit and delete cameras; system configuration and user administration remain admin-only. Run the existing offline suites from `backend/`: `python -m unittest discover -s tests -p test_camera_lifecycle.py` and `python -m unittest discover -s tests -p test_realtime_detection.py`.

## Password and OTP edge cases

Signup/reset allow special characters in passwords. Passwords must contain at least 8 characters and at most 72 UTF-8 bytes (bcrypt input limit); NUL is rejected. Passwords are never trimmed or silently truncated. Username validation remains alphanumeric. The existing frontend strength checklist remains in place. `PASSWORD_TOO_LONG` and `PASSWORD_INVALID` return 400.

Registration and password recovery share a five-attempt OTP limit. A SQLite write transaction serializes code checks and updates. Wrong guesses 1–4 return 400; the fifth invalidates the code and returns 429. Further requests remain 429 until a new code is successfully issued. The expiry timestamp is retained as the sent-time anchor so invalidating a code does not bypass the existing 60-second resend cooldown. Correct registration verification activates the account and clears the code/counter. Lockout is scoped to the OTP challenge, not the permanent account-blocking flag.

Resetting to the current password returns `400 PASSWORD_REUSED`, checked against the stored password hash after OTP validation. The password and OTP remain unchanged, allowing another password within the original OTP lifetime. A successful reset updates the hash and consumes the OTP atomically. Public forgot-password responses remain generic for existing and unknown addresses.

## Basic authentication failure limits

All endpoints using HTTP Basic authentication, including the early upload gate, share a persistent SQLite failure budget. Username and email for the same account use one key. Wrong attempts 1–4 return 401; the fifth and further attempts return `429 LOGIN_RATE_LIMITED` with `Retry-After`. Each attempt expires after 60 seconds. A separate IP budget permits 50 failures per 60 seconds across identifiers. Successful authentication removes only its own reservation, preserving previous failures. In-flight checks reserve capacity before password hashing, so parallel guesses cannot exceed the budget; requests can also receive 429 while the budget is occupied by concurrent checks. No permanent account block is applied. Expired entries are removed on the next Basic authentication request.

Workers must share `AUTH_DB_PATH` for a shared budget. Client addresses come from ASGI `request.client`; configure Uvicorn `FORWARDED_ALLOW_IPS` for the actual trusted reverse proxy in deployment. Do not trust all forwarded senders or parse client-supplied `X-Forwarded-For` in application code. Without trusted proxy configuration, the IP budget applies to the proxy address. Signed media-token requests do not consume the Basic authentication budget. The login UI displays a localized countdown and permits retry when `Retry-After` elapses; 429 does not clear an existing browser session.

## MySQL persistence update

The backend now requires MYSQL_* configuration and an explicit `python -m alembic upgrade head` before startup. Account and operational tables share MySQL; DB_NAME/AUTH_DB_PATH and older SQLite setup instructions above are historical. Auth CLI commands use the same MySQL settings and transaction locks. See [the migration runbook](MYSQL_AIVEN_MIGRATION.md) for CA setup, import, testing and rollback.

## Admin profile and audit history

`GET /auth/login` returns the persisted `role` alongside id, username, email and
activation status. The frontend uses that role to show administrator navigation;
an account's name alone does not grant access. Sign out and sign back in after a
backend update or role change to refresh the browser's saved profile.

`GET /users/me` requires a string email in its response schema. Administrators
provisioned directly in the database must have an email assigned before using
the profile/session restoration flow.

`GET /audit-log?limit=200&offset=0` returns `{"logs": [...]}` from MySQL, newest
first. Only verified, unblocked admins can access it; ordinary users receive 403
and missing credentials receive 401. Limit is clamped to 1–500 and offset to 0+.
The real audit-log screen consumes this endpoint; its mock API is separate.

## Account-owned notification recipient permissions

Verified, unblocked users and admins may list/create/edit/delete/test only their
own recipients. Foreign and NULL-owner legacy rows are hidden (404 on access).
The owner comes from authentication and cannot be supplied by a client.
Migration 0006 adds the owner foreign key and account/channel/chat uniqueness.
The 20-recipient channel limit applies per account. Saving/importing never sends
a test message or changes global channel availability.

Bot tokens and global channel availability remain admin-only through `/settings`;
regular users can only read/change `alarm_sound_enabled`. The system
`POST /test-notification` still requires admin and uses that admin's own list.
The frontend exposes recipient management/test to both roles and reserves
system configuration controls for admins. See [rollout](ACCOUNT_NOTIFICATIONS.md).
