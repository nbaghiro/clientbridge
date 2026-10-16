"""Compute quotas above a new project's defaults, so Autopilot can add the nodes it schedules."""

import pulumi_gcp as gcp

COMPUTE = "compute.googleapis.com"
# a new project allows 250 GB of SSD per region, and every Autopilot node boots from a 100 GB disk
SSD_GB = 500
CPUS = 24


def create(project: str, region: str, contact: str) -> list[gcp.cloudquota.SQuotaPreference]:
    wanted = (
        ("ssd", "SSD-TOTAL-GB-per-project-region", {"region": region}, SSD_GB),
        ("cpus", "CPUS-ALL-REGIONS-per-project", {}, CPUS),
    )
    return [
        gcp.cloudquota.SQuotaPreference(
            f"quota-{name}",
            parent=f"projects/{project}",
            name=f"clientbridge-{name}",
            service=COMPUTE,
            quota_id=quota_id,
            dimensions=dimensions,
            quota_config=gcp.cloudquota.SQuotaPreferenceQuotaConfigArgs(preferred_value=str(value)),
            contact_email=contact,
            justification="GKE Autopilot nodes for the staging and production environments",
        )
        for name, quota_id, dimensions, value in wanted
    ]
