"""
storage.py - Where snapshot images (and the model file) live.

Backend is picked from the environment:
  S3_ENDPOINT set -> MinIO / any S3-compatible store (S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY)
  GCS_BUCKET set  -> Google Cloud Storage (Application Default Credentials)
  neither         -> local disk only, exactly like before

Snapshots are stored as "snapshots/<name>"; the model is downloaded from
MODEL_OBJECT on startup if it is not on disk yet.
"""
import io
import logging
import os
import threading
import time

import cv2

logger = logging.getLogger(__name__)

SNAPSHOT_DIR = os.getenv("SNAPSHOT_DIR", "snapshots")
SYNC_INTERVAL_SECONDS = 60   # retry uploading snapshots that fell back to disk
SNAPSHOT_PREFIX = "snapshots/"
MODEL_OBJECT = os.getenv("MODEL_OBJECT", "models/best.pt")

S3_ENDPOINT = os.getenv("S3_ENDPOINT", "").strip()
GCS_BUCKET = os.getenv("GCS_BUCKET", "").strip()

os.makedirs(SNAPSHOT_DIR, exist_ok=True)


class _MinioStore:
    def __init__(self):
        import urllib3
        from minio import Minio
        from minio.error import S3Error
        self._not_found = S3Error
        self.bucket = os.environ["S3_BUCKET"]
        # Fail fast when MinIO is down so camera threads are not held up
        http = urllib3.PoolManager(timeout=urllib3.Timeout(connect=2, read=15),
                                   retries=urllib3.Retry(total=1, backoff_factor=0.2))
        self.client = Minio(S3_ENDPOINT,
                            access_key=os.environ["S3_ACCESS_KEY"],
                            secret_key=os.environ["S3_SECRET_KEY"],
                            secure=os.getenv("S3_SECURE", "false").lower() == "true",
                            http_client=http)
        self.name = f"minio://{S3_ENDPOINT}/{self.bucket}"

    def put(self, key, data, content_type):
        self.client.put_object(self.bucket, key, io.BytesIO(data), len(data),
                               content_type=content_type)

    def get(self, key):
        try:
            resp = self.client.get_object(self.bucket, key)
        except self._not_found as e:
            if e.code in ("NoSuchKey", "NoSuchBucket"):
                return None
            raise
        try:
            return resp.read()
        finally:
            resp.close()
            resp.release_conn()

    def delete(self, key):
        self.client.remove_object(self.bucket, key)

    def download(self, key, path):
        self.client.fget_object(self.bucket, key, path)


class _GcsStore:
    def __init__(self):
        from google.cloud import storage as gcs
        from google.api_core.exceptions import NotFound
        self._not_found = NotFound
        self.bucket = gcs.Client().bucket(GCS_BUCKET)
        self.name = f"gs://{GCS_BUCKET}"

    def put(self, key, data, content_type):
        self.bucket.blob(key).upload_from_string(data, content_type=content_type)

    def get(self, key):
        try:
            return self.bucket.blob(key).download_as_bytes()
        except self._not_found:
            return None

    def delete(self, key):
        self.bucket.blob(key).delete()

    def download(self, key, path):
        self.bucket.blob(key).download_to_filename(path)


_store = None


def enabled():
    return bool(S3_ENDPOINT or GCS_BUCKET)


def _get_store():
    global _store
    if _store is None:
        _store = _MinioStore() if S3_ENDPOINT else _GcsStore()
    return _store


def local_path(name):
    return os.path.join(SNAPSHOT_DIR, os.path.basename(name))


def _write_local(name, data):
    path = local_path(name)
    with open(path, "wb") as f:
        f.write(data)
    return path


def save_snapshot(name, img, keep_local=False):
    """
    Encode `img` as JPEG and store it as snapshot `name`.
    keep_local=True also leaves a copy on disk (needed by notifications that
    attach the file). Returns the local path when one was written, else None.
    """
    ok, buf = cv2.imencode(".jpg", img)
    if not ok:
        logger.error("[Storage] Could not encode snapshot %s", name)
        return None
    data = buf.tobytes()

    path = _write_local(name, data) if keep_local or not enabled() else None
    if enabled():
        try:
            _get_store().put(SNAPSHOT_PREFIX + name, data, "image/jpeg")
        except Exception as e:
            logger.error("[Storage] Upload of %s failed: %s", name, e)
            if path is None:  # don't lose the image: fall back to disk
                path = _write_local(name, data)
    return path


def read_snapshot(name):
    """Return JPEG bytes for snapshot `name`, or None if it does not exist."""
    path = local_path(name)
    if os.path.exists(path):
        with open(path, "rb") as f:
            return f.read()
    if enabled():
        try:
            return _get_store().get(SNAPSHOT_PREFIX + os.path.basename(name))
        except Exception as e:
            logger.error("[Storage] Download of %s failed: %s", name, e)
    return None


def delete_snapshot(name):
    try:
        os.remove(local_path(name))
    except OSError:
        pass
    if enabled():
        try:
            _get_store().delete(SNAPSHOT_PREFIX + os.path.basename(name))
        except Exception:
            pass


def discard_local(path):
    """Remove a local copy once it is no longer needed (only when object storage holds the original)."""
    if path and enabled():
        try:
            os.remove(path)
        except OSError:
            pass


def ensure_model(path):
    """Download the model from object storage if it is not on disk yet."""
    if os.path.exists(path) or not enabled():
        return
    store = _get_store()
    logger.info("[Storage] Downloading %s/%s -> %s", store.name, MODEL_OBJECT, path)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    store.download(MODEL_OBJECT, path)


def _sync_pending():
    """Upload snapshots left on disk (object storage was unreachable), then drop the local copy."""
    now = time.time()
    for name in os.listdir(SNAPSHOT_DIR):
        path = os.path.join(SNAPSHOT_DIR, name)
        # Fresh files may still be in use (e.g. attached to a notification being sent)
        if not name.endswith(".jpg") or now - os.path.getmtime(path) < SYNC_INTERVAL_SECONDS:
            continue
        with open(path, "rb") as f:
            data = f.read()
        _get_store().put(SNAPSHOT_PREFIX + name, data, "image/jpeg")
        os.remove(path)
        logger.info("[Storage] Synced pending snapshot %s", name)


def start_sync():
    """Background thread that retries pending uploads, e.g. after MinIO was down at boot."""
    if not enabled():
        return

    def loop():
        while True:
            try:
                _sync_pending()
            except Exception as e:
                logger.warning("[Storage] Pending snapshot sync failed, retrying later: %s", e)
            time.sleep(SYNC_INTERVAL_SECONDS)

    threading.Thread(target=loop, name="storage-sync", daemon=True).start()
