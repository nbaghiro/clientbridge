from uuid import uuid4

import httpx
import pytest
from botocore.exceptions import ClientError

from clientbridge.core.config import get_settings
from clientbridge.integrations.s3 import S3Storage, get_file_storage


def test_s3_storage_round_trips_an_object_through_presigned_urls() -> None:
    storage = get_file_storage()
    key = f"tests/{uuid4().hex}.txt"
    upload = httpx.put(
        storage.presign_upload(key, "text/plain"),
        content=b"hello",
        headers={"Content-Type": "text/plain"},
    )
    upload.raise_for_status()
    assert storage.head(key) == 5
    assert httpx.get(storage.presign_download(key)).content == b"hello"
    storage.delete(key)
    assert storage.head(key) is None


def test_s3_storage_raises_errors_other_than_a_missing_object() -> None:
    s = get_settings()
    storage = S3Storage(
        endpoint=s.s3_endpoint,
        bucket=s.s3_bucket,
        access_key=s.s3_access_key,
        secret_key="not-the-secret",
        region=s.s3_region,
        ttl_seconds=60,
    )
    with pytest.raises(ClientError):
        storage.head(f"tests/{uuid4().hex}.txt")
