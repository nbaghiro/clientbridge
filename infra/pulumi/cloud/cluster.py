"""One regional Autopilot cluster for both environments, reached only through its DNS endpoint."""

import pulumi
import pulumi_gcp as gcp

from cloud import network

# replaces the default compute account, which holds Editor or, in newer organizations, nothing
NODE_ROLES = (
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/stackdriver.resourceMetadata.writer",
)


def nodes(
    project: str, repository: gcp.artifactregistry.Repository
) -> tuple[gcp.serviceaccount.Account, list[pulumi.Resource]]:
    account = gcp.serviceaccount.Account(
        "nodes", account_id="cb-nodes", display_name="Clientbridge cluster nodes"
    )
    member = account.email.apply(lambda email: f"serviceAccount:{email}")
    grants: list[pulumi.Resource] = [
        gcp.projects.IAMMember(
            f"nodes-{role.removeprefix('roles/').replace('.', '-')}",
            project=project,
            role=role,
            member=member,
        )
        for role in NODE_ROLES
    ]
    grants.append(
        gcp.artifactregistry.RepositoryIamMember(
            "nodes-pull",
            repository=repository.name,
            location=repository.location,
            role="roles/artifactregistry.reader",
            member=member,
        )
    )
    return account, grants


def create(
    project: str,
    region: str,
    net: network.Network,
    repository: gcp.artifactregistry.Repository,
) -> gcp.container.Cluster:
    account, grants = nodes(project, repository)
    return gcp.container.Cluster(
        "clientbridge",
        name="clientbridge",
        location=region,
        enable_autopilot=True,
        network=net.vpc.id,
        subnetwork=net.subnet.id,
        datapath_provider="ADVANCED_DATAPATH",
        ip_allocation_policy={
            "cluster_secondary_range_name": network.PODS_RANGE,
            "services_secondary_range_name": network.SERVICES_RANGE,
        },
        release_channel={"channel": "REGULAR"},
        private_cluster_config={"enable_private_nodes": True},
        # IAM-checked DNS endpoint only; no IP endpoint to allowlist or expose
        control_plane_endpoints_config={
            "dns_endpoint_config": {"allow_external_traffic": True},
            "ip_endpoints_config": {"enabled": False},
        },
        workload_identity_config={"workload_pool": f"{project}.svc.id.goog"},
        cluster_autoscaling={
            "auto_provisioning_defaults": {
                "service_account": account.email,
                "oauth_scopes": ["https://www.googleapis.com/auth/cloud-platform"],
            }
        },
        gateway_api_config={"channel": "CHANNEL_STANDARD"},
        secret_manager_config={"enabled": True},
        # Autopilot requires Managed Prometheus; with no PodMonitoring it collects only free metrics
        monitoring_config={
            "enable_components": ["SYSTEM_COMPONENTS"],
            "managed_prometheus": {"enabled": True},
        },
        logging_config={"enable_components": ["SYSTEM_COMPONENTS", "WORKLOADS"]},
        deletion_protection=True,
        opts=pulumi.ResourceOptions(protect=True, depends_on=grants),
    )


def dns_endpoint(cluster: gcp.container.Cluster) -> pulumi.Output[str]:
    return cluster.control_plane_endpoints_config.apply(
        lambda config: (
            config.dns_endpoint_config.endpoint
            if config and config.dns_endpoint_config and config.dns_endpoint_config.endpoint
            else ""
        )
    )
