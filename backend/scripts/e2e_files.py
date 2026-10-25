"""Read committed client-photo rows and independently hash their stored bytes."""

import argparse
import asyncio
import hashlib
import json

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from sqlalchemy import text

from clientbridge.core.config import get_settings
from clientbridge.core.db import engine


async def evidence(client_id: str) -> list[dict[str, object]]:
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        rows = await db.execute(
            text(
                "SELECT id, business_id, parent_id, content_type, size, uploaded_at, s3_key "
                "FROM files WHERE parent_type = 'client' AND parent_id = :client "
                "AND purpose = 'photo' ORDER BY id"
            ),
            {"client": client_id},
        )
        files = [dict(row) for row in rows.mappings()]
    settings = get_settings()
    storage = boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
        config=Config(response_checksum_validation="when_required"),
    )
    for file in files:
        try:
            response = storage.get_object(Bucket=settings.s3_bucket, Key=str(file.pop("s3_key")))
            with response["Body"] as stream:
                body = stream.read()
            file["storage"] = {"size": len(body), "sha256": hashlib.sha256(body).hexdigest()}
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") not in {"NoSuchKey", "404"}:
                raise
            file["storage"] = None
    return files


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("client_id")
    args = parser.parse_args()
    try:
        print(json.dumps(await evidence(args.client_id), default=str))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
