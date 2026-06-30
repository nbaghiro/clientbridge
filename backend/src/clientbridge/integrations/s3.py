"""Object-storage adapter — the S3/MinIO boundary (mirrors the email/payments adapters).

Production talks to S3; the dev stack runs MinIO (docker-compose `minio`). Tests override
`get_file_storage` with a recording fake, so the file command flow is covered without the network.
Presigning is local HMAC — no round-trip — so the methods are sync.
"""

from typing import Protocol

import boto3

from clientbridge.core.config import get_settings


class FileStorage(Protocol):
    def presign_upload(self, key: str, content_type: str) -> str: ...
    def presign_download(self, key: str) -> str: ...


class S3Storage:
    def __init__(  # pragma: no cover - real S3/MinIO, faked in tests
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

    def presign_upload(self, key: str, content_type: str) -> str:  # pragma: no cover
        return str(
            self._client.generate_presigned_url(
                "put_object",
                Params={"Bucket": self._bucket, "Key": key, "ContentType": content_type},
                ExpiresIn=self._ttl,
            )
        )

    def presign_download(self, key: str) -> str:  # pragma: no cover
        return str(
            self._client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self._bucket, "Key": key},
                ExpiresIn=self._ttl,
            )
        )


def get_file_storage() -> FileStorage:  # pragma: no cover - constructs the real client
    s = get_settings()
    return S3Storage(
        endpoint=s.s3_endpoint,
        bucket=s.s3_bucket,
        access_key=s.s3_access_key,
        secret_key=s.s3_secret_key,
        region=s.s3_region,
        ttl_seconds=s.s3_presign_ttl_seconds,
    )
