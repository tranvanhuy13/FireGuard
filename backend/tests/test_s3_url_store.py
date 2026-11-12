"""Offline checks of Supabase path signing and S3 error/stream handling."""
import io
import os
import tempfile
import unittest
from datetime import datetime, timezone
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from botocore.response import StreamingBody
from botocore.stub import Stubber
from s3_url_store import S3UrlStore, endpoint_url


class S3UrlStoreTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {
            "S3_BUCKET": "fireguard", "S3_ACCESS_KEY": "offline-test-key",
            "S3_SECRET_KEY": "offline-test-secret", "S3_REGION": "us-west-2",
            "S3_PUBLIC_ENDPOINT": "https://example.storage.supabase.co/storage/v1/s3",
            "S3_SNAPSHOT_URL_TTL_SECONDS": "600",
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        self.store = S3UrlStore(os.environ["S3_PUBLIC_ENDPOINT"])
        self.addCleanup(self.store.client.close)
        self.stub = Stubber(self.store.client)
        self.stub.activate()
        self.addCleanup(self.stub.deactivate)

    def test_presigned_download_preserves_api_path_and_region(self):
        self.stub.add_response("head_object", {}, {"Bucket": "fireguard", "Key": "snapshots/a b.jpg"})
        url = urlsplit(self.store.snapshot_url("snapshots/a b.jpg"))
        self.assertEqual(url.path, "/storage/v1/s3/fireguard/snapshots/a%20b.jpg")
        query = parse_qs(url.query)
        self.assertEqual(query["X-Amz-Expires"], ["600"])
        self.assertIn("/us-west-2/s3/aws4_request", query["X-Amz-Credential"][0])
        self.assertEqual(query["X-Amz-SignedHeaders"], ["host"])
        self.stub.assert_no_pending_responses()

    def test_upload_download_delete_and_stream_close(self):
        key = "snapshots/test.jpg"
        self.stub.add_response("put_object", {}, {
            "Bucket": "fireguard", "Key": key, "Body": b"jpeg", "ContentType": "image/jpeg"})
        source = io.BytesIO(b"jpeg")
        self.stub.add_response("get_object", {"Body": StreamingBody(source, 4)}, {
            "Bucket": "fireguard", "Key": key})
        self.stub.add_response("delete_object", {}, {"Bucket": "fireguard", "Key": key})
        self.store.put(key, b"jpeg", "image/jpeg")
        self.assertEqual(self.store.get(key), b"jpeg")
        self.assertTrue(source.closed)
        self.store.delete(key)
        self.stub.assert_no_pending_responses()

    def test_retention_deadline_is_rechecked_after_object_verification(self):
        self.stub.add_response("head_object", {}, {"Bucket": "fireguard", "Key": "snapshots/expired.jpg"})
        with patch("s3_url_store.time.time", return_value=200):
            with self.assertRaisesRegex(ValueError, "Snapshot expired"):
                self.store.snapshot_url("snapshots/expired.jpg", expires_in=300, expires_at=100)

    def test_missing_object_is_none_but_denied_is_an_error(self):
        self.stub.add_client_error("get_object", "NoSuchKey", http_status_code=404)
        self.assertIsNone(self.store.get("missing"))
        self.stub.add_client_error("get_object", "AccessDenied", http_status_code=403)
        with self.assertRaises(self.store._client_error):
            self.store.get("private")

    def test_retention_lists_all_pages_only_periodic_prefix(self):
        when = datetime(2026, 1, 1, tzinfo=timezone.utc)
        self.stub.add_response("list_objects_v2", {
            "IsTruncated": True, "NextContinuationToken": "next",
            "Contents": [{"Key": "snapshots/periodic_a.jpg", "LastModified": when, "Size": 4}],
        }, {"Bucket": "fireguard", "Prefix": "snapshots/periodic_"})
        self.stub.add_response("list_objects_v2", {"IsTruncated": False}, {
            "Bucket": "fireguard", "Prefix": "snapshots/periodic_", "ContinuationToken": "next"})
        self.assertEqual(list(self.store.list_periodic()), [
            ("snapshots/periodic_a.jpg", when.timestamp(), 4)])

    def test_model_download_closes_body_and_writes_bytes(self):
        source = io.BytesIO(b"model")
        self.stub.add_response("get_object", {"Body": StreamingBody(source, 5)})
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "model.pt")
            self.store.download("models/best.pt", path)
            with open(path, "rb") as result:
                self.assertEqual(result.read(), b"model")
        self.assertTrue(source.closed)

    def test_bad_endpoints_and_expiration_are_rejected(self):
        for value in ("", "https://u:p@example.com", "https://example.com?key=secret", "ftp://example.com"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                endpoint_url(value)
        with patch.dict(os.environ, {"S3_SNAPSHOT_URL_TTL_SECONDS": "604801"}):
            with self.assertRaises(ValueError):
                self.store.snapshot_url("snapshots/a.jpg")


if __name__ == "__main__":
    unittest.main()
