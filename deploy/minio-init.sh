#!/bin/sh
# One-shot MinIO setup, run by the minio-init service on every `docker compose up`.
# Idempotent: bucket, policy, user and model upload are skipped if they already exist.
set -eu

mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null

mc mb --ignore-existing "local/$S3_BUCKET"

# Backend gets its own user, limited to this one bucket (not the root credentials)
cat > /tmp/policy.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {"Effect": "Allow", "Action": ["s3:GetBucketLocation", "s3:ListBucket"],
     "Resource": ["arn:aws:s3:::$S3_BUCKET"]},
    {"Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
     "Resource": ["arn:aws:s3:::$S3_BUCKET/*"]}
  ]
}
JSON
mc admin policy create local fireguard-backend /tmp/policy.json
mc admin user add local "$S3_ACCESS_KEY" "$S3_SECRET_KEY"
mc admin policy attach local fireguard-backend --user "$S3_ACCESS_KEY" 2>/dev/null || true

# Periodic snapshots (every 10 s per camera) expire after 30 days; event snapshots are kept
# (the image has no grep, so match with a shell pattern)
rules=$(mc ilm rule ls "local/$S3_BUCKET" 2>/dev/null || true)
case "$rules" in
  *snapshots/periodic_*) ;;
  *) mc ilm rule add --prefix "snapshots/periodic_" --expire-days 30 "local/$S3_BUCKET" ;;
esac

# The model is not in git: upload it once from the seed mount
if ! mc stat "local/$S3_BUCKET/$MODEL_OBJECT" >/dev/null 2>&1; then
  if [ -f /seed/best.pt ]; then
    mc cp /seed/best.pt "local/$S3_BUCKET/$MODEL_OBJECT"
  else
    echo "ERROR: $MODEL_OBJECT is not in MinIO and no seed model is mounted at /seed/best.pt" >&2
    exit 1
  fi
fi
echo "MinIO ready: bucket $S3_BUCKET"
