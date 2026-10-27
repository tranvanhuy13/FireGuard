# Authentication and roles

The backend is the authority for account roles. Frontend controls are only a user-interface convenience. Editing browser state or sending a `role` field with signup does not grant privileges.

| Operation | user | admin |
| --- | --- | --- |
| View cameras, live video, detections, alerts, history, statistics and snapshots | Yes | Yes |
| Enable/disable cameras | Yes | Yes |
| Upload/analyze video and control playback | Yes | Yes |
| Send a test notification | Yes | Yes |
| Read/change the shared alarm sound preference | Yes | Yes |
| Add, edit or delete cameras | Yes | Yes |
| Read masked system settings and update AI/notification configuration | No | Yes |
| List accounts, assign roles, block/unblock accounts | No | Yes |

## HTTP and media credentials

Operational HTTP routes require HTTP Basic credentials in `Authorization`. Missing or incorrect credentials return 401. Unverified or blocked accounts and insufficient permissions return 403. `/auth/login` and `/users/me` return the persisted `role` (`user` or `admin`).

The health endpoint `/`, generated API documentation, signup, account OTP and password recovery remain public. Successful OTP verification is required before using operational features. Blocking is stored separately from verification, so account verification/password recovery cannot unblock an account.

Use authenticated `GET /auth/stream-token` for a signed, one-hour media token. Supply it as `?token=...` to both `/video_feed` routes, `/snapshots/{name}`, and all three `/ws/...` routes. Media tokens cannot authorize management HTTP requests. Signatures are tied to the current password hash; expired/tampered tokens return 401. Blocked/unverified accounts cannot use otherwise valid tokens. Connected streams and WebSockets recheck authorization approximately every second, and close when access expires or is revoked. Rejected WebSocket connections use policy close code 1008 (the HTTP handshake can be rejected before acceptance).

Set the same private `STREAM_TOKEN_SECRET` on every backend worker to keep credentials valid across workers and restarts. Without it, each process uses a random secret. Never log or persist media URLs containing tokens in analytics. Proxy access logs should redact the `token` query parameter. The frontend keeps media tokens in memory and renews them before expiry. Logout clears the browser session; a copied media credential remains valid until expiry unless the password changes or the account is blocked.

Notification workers may create a signed link for one Zalo snapshot, valid for five minutes. This credential cannot read another image, open camera streams or access APIs. Telegram continues uploading the image directly. Protected backend snapshot responses use `Cache-Control: no-store`. External object-storage URLs are governed by that storage provider's access policy.

## Account administration

Migration runs during backend startup and adds `role` (default `user`) and `is_blocked` (default false), preserving existing accounts. Existing accounts named `admin` are **not** automatically promoted. Signup always creates an unverified `user`.

To provision the first administrator, run from `backend/` against the intended account database:

```powershell
.\venv\Scripts\python.exe -m auth.set_role EXISTING_VERIFIED_USERNAME admin
```

The command loads `.env.local` and `.env` with process variables taking precedence, and honors `AUTH_DB_PATH`. It requires an existing verified, unblocked account. No default admin password is created. Log in again after assigning the role.

Admins can use the real frontend Users page or these HTTP Basic endpoints:

- `GET /users`: returns public account fields only; no password hashes or OTPs.
- `PUT /users/{id}` with `{"role":"admin"}` or `{"status":"blocked"}` / `{"status":"active"}`. Both fields can be sent together.
- Only roles `user`/`admin` and statuses `active`/`blocked` are accepted; unknown fields return 422. Unblocking does not bypass OTP verification. Admins cannot change their own role or block themselves, or remove the last active admin. Updates use a database transaction.

## Scope and verification

This implements authorization for all existing backend operations and real account administration. The separate frontend mock notification accounts/groups/rules do not yet have corresponding backend APIs. The existing branch's `PATCH /alerts/{id}/status` and `GET /audit-log` APIs are preserved, with `user`/`admin` permissions replacing legacy viewer/operator roles. `PUT /alerts/{id}` and `PUT /users/{id}/role` remain supported for compatibility. The audit-log frontend screen still uses its existing mock integration.

For authorization changes, verify anonymous rejection, role boundaries, account blocking, media expiry/revocation and legacy migration using disposable accounts and fake camera/storage/video services. Both roles must be able to add, edit and delete cameras; system configuration and user administration remain admin-only. Run the existing offline suites from `backend/`: `python -m unittest discover -s tests -p test_camera_lifecycle.py` and `python -m unittest discover -s tests -p test_realtime_detection.py`.
