from uuid import uuid4

import boto3
import httpx
import pytest
from botocore.awsrequest import AWSPreparedRequest
from botocore.exceptions import ClientError

from clientbridge.core.config import get_settings
from clientbridge.integrations.s3 import S3_CONFIG, S3Storage, get_file_storage


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


def test_uploads_carry_no_checksum_header_for_gcs_to_reject() -> None:
    settings = get_settings()
    client = boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
        config=S3_CONFIG,
    )
    sent: list[str] = []

    def record(request: AWSPreparedRequest, **_: object) -> None:
        sent.extend(name.lower() for name in request.headers)

    client.meta.events.register("before-send.s3.PutObject", record)
    key = f"probe/{uuid4()}"
    client.put_object(Bucket=settings.s3_bucket, Key=key, Body=b"probe")
    client.delete_object(Bucket=settings.s3_bucket, Key=key)
    assert sent
    assert not [name for name in sent if "checksum" in name]
