# Account-owned Zalo and Telegram recipients

Each signed-in account manages its own Notification Accounts/Groups, including
add, edit, delete, active switches and explicit test delivery. Admins have the
same ownership restrictions for recipient data. A chat can be registered by
multiple accounts; within one account, channel/chat pairs must be unique.

Camera alerts use the camera owner. Uploaded-video alerts and manual/automatic
retries use the video job owner. Missing ownership or an empty active list sends
nothing. Global ZALO_CHAT_ID / TELEGRAM_CHAT_ID and old settings chat IDs are no
longer fallback destinations. Bot tokens and global channel enabled flags remain
admin-managed, with environment overrides taking precedence. Enable each required
bot globally, then add and activate recipients while signed into each account.
Recipient switches never enable a shared bot implicitly.

## Docker / Render

The backend Dockerfile copies the Alembic migrations and runs
`python -m alembic upgrade head` before starting Uvicorn. Migration failure stops
startup. Deploy this image with the existing MySQL configuration and TLS CA.
No database credentials belong in the Dockerfile. The command must not be
replaced by a Render Start Command that skips migrations.

Apply migration 0006 before starting any new backend. Stop old backend instances
before rollout: older code does not enforce recipient ownership. Local and Render
must use the same database to share each account's saved destinations.

## Local PowerShell migration

Stop the local backend, then run:

```powershell
Set-Location D:\python\FireGuard\AI-fire-detection\backend
.\venv\Scripts\python.exe -m alembic upgrade head
.\venv\Scripts\python.exe -m alembic current
```

These commands load MySQL settings from `backend/.env.local` (or existing process
environment). Confirm the target database before running. The resulting revision
is `0006_owned_notifications`. Restart the backend after migration.

## Existing destinations

Migration preserves old rows with NULL owner. They are quarantined and cannot
receive alerts. Sign in to each intended account and add its Zalo/Telegram
recipients again through the UI. This is the preferred way to establish explicit
ownership. An operator can instead assign a reviewed legacy row using a bound
SQL update of `owner_user_id` to the correct users.id; never infer ownership from
an audit username or assign every old destination to every account.

The migration is forward-only: automatic downgrade would restore shared access
to private chat IDs. Rollback requires an operator-reviewed data migration.

## Verification

Offline regression tests use disposable SQLite storage and mocked providers to
check owner isolation, cross-account duplicate chats, quarantined legacy rows,
independent active flags/cooldowns and delivery without a global fallback.
API tests check user/admin isolation and explicit single-recipient testing.
Camera/video suites check owner propagation. They do not send real bot messages.


## Camera test account without saved images

An operator can create an active `user` account without an email using:

```powershell
Set-Location D:\python\FireGuard\AI-fire-detection\backend
.\venv\Scripts\python.exe -m scripts.provision_camera_test_account camtest
```

The password is prompted securely and stored as a bcrypt hash. Provisioning refuses
an existing username and does not reset any existing password. This explicit
operator flow creates an already-active account without signup/OTP email.
It stores `camera_snapshots_enabled_user_<id>=false` in the existing settings
table, so no schema migration is required for this policy.

Updated backend code must be running on local/Render before using this account.
The account uses the same DB identity on both backends. Camera event and periodic
images are not JPEG-encoded, registered, written to disk or uploaded. Existing
pending camera files belonging to an opted-out owner are skipped by background
upload. Event metadata and live in-memory camera streams continue normally;
bot alerts are text-only with no image attachment or snapshot URL. The policy
is camera-specific: uploaded-video behavior is unchanged. It does not delete
historical images. Policy reads bypass the settings cache and fail closed if the
DB is unavailable. Only admins/operators can change this setting.
