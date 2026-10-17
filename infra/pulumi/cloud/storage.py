"""One private, versioned bucket per environment, reached through the S3-compatible API."""

from dataclasses import dataclass

import pulumi
import pulumi_gcp as gcp
from clientbridge.core.deployment import public_urls

from environments import Environment

ENDPOINT = "https://storage.googleapis.com"
REGION = "auto"  # what Cloud Storage's S3 interoperability signs with
NONCURRENT_DAYS = 30
CORS_MAX_AGE_SECONDS = 3600


@dataclass(frozen=True)
class Files:
    bucket: gcp.storage.Bucket
    account: gcp.serviceaccount.Account  # secrets_init.py creates its HMAC key


def account_id(env: Environment) -> str:
    return f"cb-{env.name}-files"


def account_email(project: str, env: Environment) -> str:
    return f"{account_id(env)}@{project}.iam.gserviceaccount.com"


def create(project: str, region: str, env: Environment) -> Files:
    bucket = gcp.storage.Bucket(
        f"{env.name}-files",
        name=f"{project}-{env.name}-files",
        location=region.upper(),
        storage_class="STANDARD",
        uniform_bucket_level_access=True,
        public_access_prevention="enforced",
        versioning={"enabled": True},
        lifecycle_rules=[
            {
                "action": {"type": "Delete"},
                "condition": {
                    "days_since_noncurrent_time": NONCURRENT_DAYS,
                    "with_state": "ARCHIVED",
                },
            }
        ],
        cors=_cors_rules(env.base_domain),
        force_destroy=False,
        opts=pulumi.ResourceOptions(protect=True),
    )
    # HMAC keys belong to a service account that can reach only this bucket
    account = gcp.serviceaccount.Account(
        f"{env.name}-files",
        account_id=account_id(env),
        display_name=f"Clientbridge {env.name} files (S3 interoperability)",
    )
    gcp.storage.BucketIAMMember(
        f"{env.name}-files-objects",
        bucket=bucket.name,
        role="roles/storage.objectAdmin",
        member=account.email.apply(lambda email: f"serviceAccount:{email}"),
    )
    return Files(bucket=bucket, account=account)


def _cors_rules(base_domain: str) -> list[gcp.storage.BucketCorArgsDict]:
    """Uploads only from the app and Connect; reads from anywhere, since a signed URL is a key."""
    urls = public_urls(base_domain)
    uploaders = [urls["web_base_url"], *urls["cors_allow_origins"].split(",")]
    return [
        {
            "origins": uploaders,
            "methods": ["PUT"],
            "response_headers": ["Content-Type"],
            "max_age_seconds": CORS_MAX_AGE_SECONDS,
        },
        # Connect fetches a logo through the API's /media redirect, which sends Origin: null
        {
            "origins": ["*"],
            "methods": ["GET", "HEAD"],
            "response_headers": ["Content-Type", "Content-Length", "ETag"],
            "max_age_seconds": CORS_MAX_AGE_SECONDS,
        },
    ]
