"""The Artifact Registry repository for the backend and web images."""

import pulumi_gcp as gcp

REPOSITORY = "clientbridge"
# the deploy workflow tags what each environment runs (staging-current, prod-<shortsha>, …)
KEPT_TAG_PREFIXES = ("prod-", "staging-current")
STAGING_TAG_PREFIX = "staging-"
STAGING_KEEP = f"{30 * 24 * 3600}s"  # staging-<shortsha> images older than 30 days go
KEEP = 20  # the most recent versions per image, whatever their tags


def create(region: str) -> gcp.artifactregistry.Repository:
    # a KEEP policy wins over DELETE, so a deployed or recent digest is never removed
    return gcp.artifactregistry.Repository(
        "images",
        repository_id=REPOSITORY,
        location=region,
        format="DOCKER",
        docker_config={"immutable_tags": False},
        cleanup_policy_dry_run=False,
        cleanup_policies=[
            {
                "id": "keep-deployed",
                "action": "KEEP",
                "condition": {"tag_state": "TAGGED", "tag_prefixes": list(KEPT_TAG_PREFIXES)},
            },
            {
                "id": "keep-recent-staging",
                "action": "KEEP",
                "condition": {
                    "tag_state": "TAGGED",
                    "tag_prefixes": [STAGING_TAG_PREFIX],
                    "newer_than": STAGING_KEEP,
                },
            },
            {"id": "keep-recent", "action": "KEEP", "most_recent_versions": {"keep_count": KEEP}},
            {"id": "delete-rest", "action": "DELETE", "condition": {"tag_state": "ANY"}},
        ],
    )


def location(project: str, region: str) -> str:
    return f"{region}-docker.pkg.dev/{project}/{REPOSITORY}"
