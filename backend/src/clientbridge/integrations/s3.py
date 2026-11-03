"""Object storage adapter (S3); presigning is local, so the methods are sync."""

from functools import cache
from typing import Protocol

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from clientbridge.core.config import get_settings

# SigV4 everywhere, so an upload URL signs its length; GCS rejects boto3's default checksums
S3_CONFIG = Config(
    signature_version="s3v4",
    request_checksum_calculation="when_required",
    response_checksum_validation="when_required",
)


class FileStorage(Protocol):
    def presign_upload(self, key: str, content_type: str, size: int) -> str: ...
    def presign_download(self, key: str) -> str: ...
    def head(self, key: str) -> int | None: ...
    def read_start(self, key: str, length: int) -> bytes: ...
    def promote(self, source: str, key: str, content_type: str) -> None: ...
    def delete(self, key: str) -> None: ...


class S3Storage:
    def __init__(
        self,
        *,
        endpoint: str,
        bucket: str,
        access_key: str,
        secret_key: str,
        region: str,
        ttl_seconds: int,
    ) -> None:
        self._bucket = bucket
        self._ttl = ttl_seconds
        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region,
            config=S3_CONFIG,
        )

    def presign_upload(self, key: str, content_type: str, size: int) -> str:
        """A PUT URL that storage accepts only with this type and exactly this many bytes."""
        return str(
            self._client.generate_presigned_url(
                "put_object",
                Params={
                    "Bucket": self._bucket,
                    "Key": key,
                    "ContentType": content_type,
                    "ContentLength": size,
                },
                ExpiresIn=self._ttl,
            )
        )

    def presign_download(self, key: str) -> str:
        return str(
            self._client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self._bucket, "Key": key},
                ExpiresIn=self._ttl,
            )
        )

    def head(self, key: str) -> int | None:
        """The stored object's size in bytes, or None when nothing was uploaded under the key."""
        try:
            response = self._client.head_object(Bucket=self._bucket, Key=key)
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
                return None
            raise
        return int(response["ContentLength"])

    def read_start(self, key: str, length: int) -> bytes:
        response = self._client.get_object(
            Bucket=self._bucket, Key=key, Range=f"bytes=0-{length - 1}"
        )
        return bytes(response["Body"].read())

    def promote(self, source: str, key: str, content_type: str) -> None:
        """Copies an object to a key no presigned URL reaches, stored as this type."""
        self._client.copy_object(
            Bucket=self._bucket,
            Key=key,
            CopySource={"Bucket": self._bucket, "Key": source},
            ContentType=content_type,
            MetadataDirective="REPLACE",
        )

    def delete(self, key: str) -> None:
        self._client.delete_object(Bucket=self._bucket, Key=key)


@cache
def get_file_storage() -> FileStorage:
    s = get_settings()
    return S3Storage(
        endpoint=s.s3_endpoint,
        bucket=s.s3_bucket,
        access_key=s.s3_access_key,
        secret_key=s.s3_secret_key,
        region=s.s3_region,
        ttl_seconds=s.s3_presign_ttl_seconds,
    )
