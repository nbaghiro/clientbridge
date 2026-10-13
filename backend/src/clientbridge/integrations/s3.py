"""Object storage adapter (S3); presigning is local, so the methods are sync."""

from typing import Protocol

import boto3
from botocore.exceptions import ClientError

from clientbridge.core.config import get_settings


class FileStorage(Protocol):
    def presign_upload(self, key: str, content_type: str) -> str: ...
    def presign_download(self, key: str) -> str: ...
    def head(self, key: str) -> int | None: ...
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
        )

    def presign_upload(self, key: str, content_type: str) -> str:
        return str(
            self._client.generate_presigned_url(
                "put_object",
                Params={"Bucket": self._bucket, "Key": key, "ContentType": content_type},
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

    def delete(self, key: str) -> None:
        self._client.delete_object(Bucket=self._bucket, Key=key)


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
