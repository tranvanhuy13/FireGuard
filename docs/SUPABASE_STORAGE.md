# Supabase Storage for FireGuard

Use Supabase only for file storage; the existing Aiven MySQL database and
FireGuard authentication remain unchanged. No MinIO service or Render disk is needed.

## Setup

1. Create a Free Supabase project in the intended organization. Prefer Oregon
   when the Render backend runs in Oregon. Confirm the plan in the Dashboard.
2. In Storage, create a **private** bucket named `fireguard`. Do not add public
   read/write policies. Existing FireGuard API authorization protects access.
3. In Storage > S3, generate backend-only S3 access keys. These are **not** the
   publishable/anon key. S3 access keys bypass RLS across the project's buckets;
   use a dedicated project and never put these keys in frontend variables or Git.
4. Set these environment variables on the Render backend (merge with existing
   variables). Copy the actual endpoint and region from Supabase:

```dotenv
S3_ENDPOINT=https://PROJECT_REF.storage.supabase.co/storage/v1/s3
S3_PUBLIC_ENDPOINT=https://PROJECT_REF.storage.supabase.co/storage/v1/s3
S3_BUCKET=fireguard
S3_REGION=us-west-2
S3_ACCESS_KEY=REPLACE_IN_RENDER_ONLY
S3_SECRET_KEY=REPLACE_IN_RENDER_ONLY
S3_SNAPSHOT_URL_TTL_SECONDS=86400
PERIODIC_SNAPSHOT_RETENTION_DAYS=7
```

Full URL endpoints select the boto3 adapter, with TLS determined by the URL.
Existing MinIO `host:port` endpoints continue to use `S3_SECURE` and the MinIO
adapter. The Supabase API path must be included in both endpoint variables;
signed links must not be rewritten. Keep the bucket private: expiring signed
links allow their holders to download only the named object until expiration.

Deploy the branch containing the updated storage adapter and requirements before
enabling the endpoint on Render. The old MinIO client rejects endpoint paths.
Do not change database credentials or frontend variables for this integration.

## Verification

Run the offline regression from `backend/`:

```powershell
.\venv\Scripts\python.exe -m unittest discover -s tests -p test_s3_url_store.py
```

For the live check, use the deployed backend's Shell or an environment with the
same S3 variables and run `python storage_smoke.py`. Without importing `main`, it uploads a uniquely named disposable
object under `snapshots/`, HEAD it, read it back, and compare the bytes. Generate
a signed URL and download it without credentials to verify external access,
then deletes only that disposable object. It does not log the keys or signed URL.
Repeat after a backend redeploy to verify persistent remote storage. A live
backend health check alone does not prove storage works. Do not trigger bot
notifications or change production users to test storage.

Free storage and egress are limited; check current usage in Supabase. Periodic
snapshot retention does not remove event/video notification evidence. Monitor
total usage and clean up that evidence intentionally when no longer needed.
Existing local snapshots are not automatically migrated by changing these
variables, and ephemeral Render files may already have been lost.

References: [S3 authentication](https://supabase.com/docs/guides/storage/s3/authentication),
[supported operations](https://supabase.com/docs/guides/storage/s3/compatibility),
[Storage pricing](https://supabase.com/docs/guides/storage/pricing).
