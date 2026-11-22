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
import re
from datetime import datetime, timedelta
from urllib.parse import urlsplit
import threading
import time

import cv2

logger = logging.getLogger(__name__)

SNAPSHOT_DIR = os.getenv("SNAPSHOT_DIR", "snapshots")
SYNC_INTERVAL_SECONDS = 60   # retry uploading snapshots that fell back to disk
SNAPSHOT_PREFIX = "snapshots/"
PERIODIC_RETENTION_DAYS = max(1, int(os.getenv("PERIODIC_SNAPSHOT_RETENTION_DAYS", "7")))
RETENTION_INTERVAL_SECONDS = max(60, int(os.getenv("SNAPSHOT_CLEANUP_INTERVAL_SECONDS", "3600")))
RETENTION_BATCH_SIZE = 500
_PERIODIC_NAME = re.compile(r"periodic_(\d{8}_\d{6})_cam_\d+\.jpg")
_maintenance_lock = threading.RLock()
_snapshot_pins = {}
_pin_lock = threading.RLock()
_stop = threading.Event()
_worker = None
_worker_lock = threading.Lock()
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
                            region=os.getenv("S3_REGION") or None,
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

    def list_periodic(self):
        for obj in self.client.list_objects(self.bucket, prefix=SNAPSHOT_PREFIX + "periodic_", recursive=True):
            yield obj.object_name, obj.last_modified.timestamp(), obj.size

    def list_snapshots(self):
        for obj in self.client.list_objects(self.bucket, prefix=SNAPSHOT_PREFIX, recursive=True):
            yield obj.object_name, obj.last_modified.timestamp(), obj.size

    def download(self, key, path):
        self.client.fget_object(self.bucket, key, path)

    def stat(self, key):
        return self.client.stat_object(self.bucket, key)

    def snapshot_url(self, key, expires_in=None, expires_at=None):
        from minio import Minio

        # Sign with the external host itself; rewriting a signed URL breaks it.
        endpoint = urlsplit(os.getenv("S3_PUBLIC_ENDPOINT", "").strip())
        if (endpoint.scheme not in ("http", "https") or not endpoint.hostname
                or endpoint.username or endpoint.password or endpoint.query
                or endpoint.fragment or endpoint.path not in ("", "/")):
            raise ValueError("S3_PUBLIC_ENDPOINT must be an http(s) S3 API origin without a path")
        seconds = int(os.getenv("S3_SNAPSHOT_URL_TTL_SECONDS", "3600"))
        if expires_in is not None:
            seconds = min(seconds, expires_in)
        if not 1 <= seconds <= 604800:
            raise ValueError("S3_SNAPSHOT_URL_TTL_SECONDS must be between 1 and 604800")
        self.stat(key)  # A signed URL alone does not prove that upload succeeded.
        if expires_at is not None:
            seconds = min(seconds, int(expires_at - time.time()))
            if seconds < 1:
                raise ValueError("Snapshot expired")
        signer = Minio(
            endpoint.netloc,
            access_key=os.environ["S3_ACCESS_KEY"],
            secret_key=os.environ["S3_SECRET_KEY"],
            secure=endpoint.scheme == "https",
            region=os.getenv("S3_REGION") or "us-east-1",
        )
        return signer.presigned_get_object(self.bucket, key, expires=timedelta(seconds=seconds))


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
        try:
            self.bucket.blob(key).delete()
        except self._not_found:
            pass

    def list_periodic(self):
        for blob in self.bucket.list_blobs(prefix=SNAPSHOT_PREFIX + "periodic_"):
            yield blob.name, blob.updated.timestamp(), blob.size or 0

    def list_snapshots(self):
        for blob in self.bucket.list_blobs(prefix=SNAPSHOT_PREFIX):
            yield blob.name, blob.updated.timestamp(), blob.size or 0

    def download(self, key, path):
        self.bucket.blob(key).download_to_filename(path)

    def stat(self, key):
        blob = self.bucket.blob(key)
        blob.reload()
        return blob


_store = None


def enabled():
    return bool(S3_ENDPOINT or GCS_BUCKET)


def _get_store():
    global _store
    if _store is None:
        if S3_ENDPOINT.startswith(("http://", "https://")):
            from app.storage.s3_url_store import S3UrlStore
            _store = S3UrlStore(S3_ENDPOINT)
        else:
            _store = _MinioStore() if S3_ENDPOINT else _GcsStore()
    return _store


def local_path(name):
    return os.path.join(SNAPSHOT_DIR, os.path.basename(name))


def pin_snapshot(name):
    """Keep notification attachments out of maintenance/deletion until released."""
    with _pin_lock:
        name = os.path.basename(name)
        _snapshot_pins[name] = _snapshot_pins.get(name, 0) + 1


def unpin_snapshot(name):
    with _pin_lock:
        name = os.path.basename(name)
        remaining = _snapshot_pins.get(name, 0) - 1
        if remaining > 0:
            _snapshot_pins[name] = remaining
        else:
            _snapshot_pins.pop(name, None)


def _write_local(name, data):
    path = local_path(name)
    with open(path, "wb") as f:
        f.write(data)
    return path


def camera_snapshots_allowed(owner_user_id, source_kind):
    """Fresh all-source opt-out, with the legacy camera-only policy as fallback."""
    if owner_user_id is None:
        return True
    from app.db.engine import read_rows
    from sqlalchemy.exc import SQLAlchemyError
    try:
        rows = read_rows("SELECT value FROM settings WHERE `key`=?",
                         (f"snapshots_enabled_user_{int(owner_user_id)}",))
        if rows and str(rows[0]["value"]).lower() not in ("true", "1", "yes", "on"):
            return False
        if source_kind != "camera":
            return True
        rows = read_rows("SELECT value FROM settings WHERE `key`=?",
                         (f"camera_snapshots_enabled_user_{int(owner_user_id)}",))
    except SQLAlchemyError:
        logger.warning("[Storage] Snapshot skipped: account policy unavailable")
        return False
    return not rows or str(rows[0]["value"]).lower() in ("true", "1", "yes", "on")


def save_snapshot(name, img, keep_local=False, *, owner_user_id=None, source_kind=None, source_id=None):
    """
    Encode `img` as JPEG and store it as snapshot `name`.
    keep_local=True also leaves a copy on disk (needed by notifications that
    attach the file). Returns the local path when one was written, else None.
    """
    if not camera_snapshots_allowed(owner_user_id, source_kind):
        return None
    ok, buf = cv2.imencode(".jpg", img)
    if not ok:
        logger.error("[Storage] Could not encode snapshot %s", name)
        return None
    data = buf.tobytes()

    if owner_user_id is not None:
        from app.storage import evidence as evidence
        evidence.register(name, owner_user_id, source_kind, source_id)

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


def restore_snapshot(name):
    """Restore an attachment from storage for a manually retried notification."""
    path = local_path(name)
    if os.path.isfile(path):
        return path
    data = read_snapshot(name)
    return _write_local(name, data) if data is not None else None


def delete_snapshot(name):
    with _pin_lock:
        if _snapshot_pins.get(os.path.basename(name)):
            return
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
            _get_store().stat(SNAPSHOT_PREFIX + os.path.basename(path))
            with _pin_lock:
                if _snapshot_pins.get(os.path.basename(path)):
                    return
                os.remove(path)
        except Exception:
            logger.warning("[Storage] Keeping local snapshot %s; remote copy not confirmed", os.path.basename(path))


def snapshot_public_url(name, expires_in=None):
    """Return an externally reachable, expiring S3 link for an uploaded snapshot."""
    if not S3_ENDPOINT:
        return None
    try:
        from app.storage import evidence as evidence
        row = evidence.find(os.path.basename(name))
        if row is None or row["deleted_at"] is not None or row["expires_at"] <= time.time():
            return None
        remaining = max(1, int(row["expires_at"] - time.time()))
        expires_in = min(expires_in if expires_in is not None else 3600, remaining, 3600)
        store = _get_store()
        key = SNAPSHOT_PREFIX + os.path.basename(name)
        try:
            return store.snapshot_url(key, expires_in=expires_in, expires_at=row["expires_at"])
        except Exception:
            # A failed initial upload may still have a local fallback. Retry it
            # before sending a notification without its evidence link.
            path = local_path(name)
            if row["expires_at"] <= time.time() or not os.path.isfile(path):
                raise
            with open(path, "rb") as image:
                store.put(key, image.read(), "image/jpeg")
            return store.snapshot_url(key, expires_in=expires_in, expires_at=row["expires_at"])
    except Exception:
        # Do not log signed URLs or credentials returned by providers.
        logger.warning("[Storage] S3 snapshot link unavailable for %s; check upload and public endpoint configuration", os.path.basename(name))
        return None


def private_snapshot_url(name, user_id):
    from app.storage import evidence as evidence
    row = evidence.require_snapshot(name, user_id)
    ttl = max(1, min(300, int(row["expires_at"] - time.time())))
    url = snapshot_public_url(name, expires_in=ttl)
    if url is None:
        return None, ttl
    return url, ttl


def cleanup_evidence(now=None):
    """Delete remote and local copies before acknowledging deletion; retry failures."""
    from app.storage import evidence as evidence
    removed = 0
    with _maintenance_lock:
        for row in evidence.expired(RETENTION_BATCH_SIZE, now):
            name = row["name"]
            try:
                # Retention is a hard limit, including evidence pinned by bot work.
                if enabled():
                    _get_store().delete(SNAPSHOT_PREFIX + name)
                path = local_path(name)
                try:
                    os.remove(path)
                except FileNotFoundError:
                    pass
                evidence.mark_deleted(name)
                removed += 1
            except Exception:
                logger.warning("[Storage] Evidence deletion failed; retrying later: %s", name)
    return removed


def cleanup_unregistered(now=None):
    """Reclaim old pre-migration/orphan captures, never models or arbitrary objects."""
    from app.storage import evidence as evidence
    cutoff = (time.time() if now is None else now) - evidence.RETENTION_SECONDS
    managed = re.compile(r"(?:event_[\w-]+|video_[\w-]+|periodic_[\w-]+)\.jpg", re.ASCII)
    removed = 0
    def eligible(name, modified):
        return modified < cutoff and managed.fullmatch(name) and evidence.find(name) is None
    with _maintenance_lock:
        for entry in os.scandir(SNAPSHOT_DIR):
            if removed >= RETENTION_BATCH_SIZE:
                break
            if not entry.is_file(follow_symlinks=False) or not eligible(entry.name, entry.stat().st_mtime):
                continue
            try:
                os.remove(entry.path)
                removed += 1
            except OSError:
                logger.warning("[Storage] Legacy local cleanup failed: %s", entry.name)
        if enabled():
            for key, modified, _ in _get_store().list_snapshots():
                if removed >= RETENTION_BATCH_SIZE:
                    break
                name = key.removeprefix(SNAPSHOT_PREFIX)
                if not key.startswith(SNAPSHOT_PREFIX) or not eligible(name, modified):
                    continue
                try:
                    _get_store().delete(key)
                    removed += 1
                except Exception:
                    logger.warning("[Storage] Legacy remote cleanup failed: %s", name)
    return removed


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
        if _stop.is_set():
            break
        if _snapshot_pins.get(name):
            continue
        path = os.path.join(SNAPSHOT_DIR, name)
        # Fresh files may still be in use (e.g. attached to a notification being sent)
        if not name.endswith(".jpg") or now - os.path.getmtime(path) < SYNC_INTERVAL_SECONDS:
            continue
        from app.storage import evidence as evidence
        row = evidence.find(name)
        if row and not camera_snapshots_allowed(row["owner_user_id"], row["source_kind"]):
            continue
        if row and (row["expires_at"] <= now or row["deleted_at"] is not None):
            continue  # Never resurrect expired evidence after a failed delete/upload.
        if row is None and now - os.path.getmtime(path) >= evidence.RETENTION_SECONDS:
            continue
        with open(path, "rb") as f:
            data = f.read()
        _get_store().put(SNAPSHOT_PREFIX + name, data, "image/jpeg")
        with _pin_lock:
            if _snapshot_pins.get(name):
                continue
            os.remove(path)
        logger.info("[Storage] Synced pending snapshot %s", name)


def _expired_periodic(name, modified, cutoff):
    match = _PERIODIC_NAME.fullmatch(name)
    if not match or modified >= cutoff:
        return False
    try:
        captured = datetime.strptime(match.group(1), "%Y%m%d_%H%M%S").timestamp()
    except ValueError:
        return False
    return captured < cutoff


def cleanup_periodic(now=None):
    """Delete only old periodic captures, in bounded batches on each backend."""
    cutoff = (time.time() if now is None else now) - PERIODIC_RETENTION_DAYS * 86400
    removed = size = 0
    with _maintenance_lock:
        with os.scandir(SNAPSHOT_DIR) as entries:
            attempted = 0
            for entry in entries:
                if _stop.is_set() or attempted >= RETENTION_BATCH_SIZE:
                    break
                try:
                    if not entry.is_file(follow_symlinks=False):
                        continue
                    if _snapshot_pins.get(entry.name):
                        continue
                    stat = entry.stat(follow_symlinks=False)
                    if not _expired_periodic(entry.name, stat.st_mtime, cutoff):
                        continue
                    attempted += 1
                    os.remove(entry.path)
                    removed += 1
                    size += stat.st_size
                except OSError as exc:
                    logger.warning("[Storage] Retention failed for %s: %s", entry.name, exc)
        if enabled() and not _stop.is_set():
            try:
                store = _get_store()
                attempted = 0
                for key, modified, byte_count in store.list_periodic():
                    if _stop.is_set() or attempted >= RETENTION_BATCH_SIZE:
                        break
                    name = key.removeprefix(SNAPSHOT_PREFIX)
                    if not key.startswith(SNAPSHOT_PREFIX) or not _expired_periodic(name, modified, cutoff):
                        continue
                    attempted += 1
                    try:
                        store.delete(key)
                        removed += 1
                        size += byte_count
                    except Exception as exc:
                        logger.warning("[Storage] Retention failed for %s: %s", key, exc)
            except Exception as exc:
                logger.warning("[Storage] Object retention scan failed: %s", exc)
    logger.info("[Storage] Periodic retention removed %d copies (%d bytes)", removed, size)
    return removed, size


def start_sync():
    """Start lifecycle-owned local/cloud maintenance, including local-only mode."""
    global _worker
    with _worker_lock:
        if _worker is not None and _worker.is_alive():
            return
        _stop.clear()

        def loop():
            next_cleanup = 0
            while not _stop.is_set():
                if time.monotonic() >= next_cleanup:
                    removed = 0
                    try:
                        removed = cleanup_evidence()
                        removed += cleanup_unregistered()
                    except Exception as exc:
                        logger.warning("[Storage] Retention failed, retrying later: %s", exc)
                    delay = SYNC_INTERVAL_SECONDS if removed >= RETENTION_BATCH_SIZE else RETENTION_INTERVAL_SECONDS
                    next_cleanup = time.monotonic() + delay
                if enabled() and not _stop.is_set():
                    try:
                        with _maintenance_lock:
                            _sync_pending()
                    except Exception as exc:
                        logger.warning("[Storage] Pending sync failed, retrying later: %s", exc)
                _stop.wait(SYNC_INTERVAL_SECONDS)

        _worker = threading.Thread(target=loop, name="storage-maintenance", daemon=True)
        _worker.start()


def stop_sync():
    with _worker_lock:
        _stop.set()
        if _worker is not None:
            _worker.join(timeout=20)
            if _worker.is_alive():
                logger.warning("[Storage] Maintenance still waiting for object storage at shutdown")
