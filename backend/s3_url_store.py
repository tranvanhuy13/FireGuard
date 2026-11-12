"""S3 storage for full endpoint URLs, including Supabase's API path."""
import os
import time
from urllib.parse import urlsplit


def endpoint_url(value):
    parsed = urlsplit(value)
    if (parsed.scheme not in ("http", "https") or not parsed.hostname
            or parsed.username or parsed.password or parsed.query or parsed.fragment):
        raise ValueError("S3 endpoint must be an http(s) URL without credentials, query or fragment")
    return value.rstrip("/")


class S3UrlStore:
    def __init__(self, endpoint):
        from botocore.exceptions import ClientError

        self._client_error = ClientError
        self.bucket = os.environ["S3_BUCKET"]
        self.client = self._client(endpoint_url(endpoint))
        self.name = f"s3://{self.bucket}"

    @staticmethod
    def _client(endpoint):
        import boto3
        from botocore.config import Config

        return boto3.client(
            "s3", endpoint_url=endpoint,
            aws_access_key_id=os.environ["S3_ACCESS_KEY"],
            aws_secret_access_key=os.environ["S3_SECRET_KEY"],
            region_name=os.environ.get("S3_REGION") or "us-east-1",
            config=Config(
                signature_version="s3v4", s3={"addressing_style": "path"},
                connect_timeout=2, read_timeout=15,
                retries={"max_attempts": 1, "mode": "standard"},
                request_checksum_calculation="when_required",
                response_checksum_validation="when_required",
            ),
        )

    def put(self, key, data, content_type):
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)

    def get(self, key):
        try:
            response = self.client.get_object(Bucket=self.bucket, Key=key)
        except self._client_error as exc:
            if exc.response["Error"]["Code"] in ("NoSuchKey", "NoSuchBucket", "404"):
                return None
            raise
        body = response["Body"]
        try:
            return body.read()
        finally:
            body.close()

    def delete(self, key):
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def list_periodic(self):
        pages = self.client.get_paginator("list_objects_v2").paginate(
            Bucket=self.bucket, Prefix="snapshots/periodic_")
        for page in pages:
            for item in page.get("Contents", []):
                yield item["Key"], item["LastModified"].timestamp(), item["Size"]

    def list_snapshots(self):
        pages = self.client.get_paginator("list_objects_v2").paginate(Bucket=self.bucket, Prefix="snapshots/")
        for page in pages:
            for item in page.get("Contents", []):
                yield item["Key"], item["LastModified"].timestamp(), item["Size"]

    def download(self, key, path):
        # Avoid a multipart/parallel download for the startup model.
        response = self.client.get_object(Bucket=self.bucket, Key=key)
        body = response["Body"]
        try:
            with open(path, "wb") as output:
                for chunk in body.iter_chunks(chunk_size=1024 * 1024):
                    output.write(chunk)
        except BaseException:
            # A partial model must not be mistaken for a complete model at startup.
            try:
                os.remove(path)
            except OSError:
                pass
            raise
        finally:
            body.close()

    def stat(self, key):
        return self.client.head_object(Bucket=self.bucket, Key=key)

    def snapshot_url(self, key, expires_in=None, expires_at=None):
        public = endpoint_url(os.environ.get("S3_PUBLIC_ENDPOINT", "").strip())
        seconds = int(os.environ.get("S3_SNAPSHOT_URL_TTL_SECONDS", "86400"))
        if expires_in is not None:
            seconds = min(seconds, expires_in)
        if not 1 <= seconds <= 604800:
            raise ValueError("S3_SNAPSHOT_URL_TTL_SECONDS must be between 1 and 604800")
        self.stat(key)
        if expires_at is not None:
            seconds = min(seconds, int(expires_at - time.time()))
            if seconds < 1:
                raise ValueError("Snapshot expired")
        # Sign the public endpoint, including its API path; never rewrite the URL.
        signer = self._client(public)
        try:
            return signer.generate_presigned_url(
                "get_object", Params={"Bucket": self.bucket, "Key": key}, ExpiresIn=seconds)
        finally:
            signer.close()
