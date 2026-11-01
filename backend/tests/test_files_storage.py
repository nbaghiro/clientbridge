from urllib.parse import parse_qs, urlsplit
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
        storage.presign_upload(key, "text/plain", 5),
        content=b"hello",
        headers={"Content-Type": "text/plain"},
    )
    upload.raise_for_status()
    assert storage.head(key) == 5
    assert httpx.get(storage.presign_download(key)).content == b"hello"
    storage.delete(key)
    assert storage.head(key) is None


def test_an_upload_url_takes_only_the_declared_size() -> None:
    storage = get_file_storage()
    key = f"tests/{uuid4().hex}.txt"
    url = storage.presign_upload(key, "text/plain", 5)
    [signed] = parse_qs(urlsplit(url).query)["X-Amz-SignedHeaders"]
    assert "content-length" in signed.split(";")
    refused = httpx.put(url, content=b"hello world", headers={"Content-Type": "text/plain"})
    assert refused.status_code == 403
    assert storage.head(key) is None


def test_a_promoted_copy_keeps_its_bytes_when_the_upload_is_put_again() -> None:
    storage = get_file_storage()
    upload, key = f"tests/{uuid4().hex}.png", f"tests/{uuid4().hex}.png"
    url = storage.presign_upload(upload, "image/jpeg", 5)
    httpx.put(url, content=b"first", headers={"Content-Type": "image/jpeg"}).raise_for_status()
    storage.promote(upload, key, "image/png")
    httpx.put(url, content=b"later", headers={"Content-Type": "image/jpeg"}).raise_for_status()
    served = httpx.get(storage.presign_download(key))
    assert served.content == b"first" and served.headers["content-type"] == "image/png"
    assert storage.read_start(key, 3) == b"fir"
    for each in (upload, key):
        storage.delete(each)


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
