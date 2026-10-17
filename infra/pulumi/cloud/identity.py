"""Per-workload Google service accounts bound to Kubernetes accounts, and CI's keyless identity."""

from collections.abc import Sequence
from dataclasses import dataclass

import pulumi
import pulumi_gcp as gcp

from environments import Environment

GITHUB_ISSUER = "https://token.actions.githubusercontent.com"
DEPLOY_REF = "refs/heads/main"


@dataclass(frozen=True)
class Account:
    namespace: str
    name: str  # the Kubernetes service account
    google: gcp.serviceaccount.Account
    # the same account as Workload Identity Federation names it, for grants made to the KSA itself
    principal: pulumi.Output[str]

    @property
    def members(self) -> list[pulumi.Output[str]]:
        return [self.google.email.apply(lambda email: f"serviceAccount:{email}"), self.principal]


def workload_accounts(
    project: str,
    project_number: pulumi.Output[str],
    env: Environment,
    workloads: Sequence[str],
    cluster: gcp.container.Cluster,
) -> dict[str, Account]:
    """Each grant to the pool waits for the cluster, since GKE creates <project>.svc.id.goog."""
    accounts: dict[str, Account] = {}
    for workload in workloads:
        google = gcp.serviceaccount.Account(
            f"{env.name}-{workload}",
            account_id=f"cb-{env.name}-{workload}",
            display_name=f"Clientbridge {env.name} {workload}",
        )
        gcp.serviceaccount.IAMMember(
            f"{env.name}-{workload}-workload-identity",
            service_account_id=google.name,
            role="roles/iam.workloadIdentityUser",
            member=f"serviceAccount:{project}.svc.id.goog[{env.namespace}/{workload}]",
            opts=pulumi.ResourceOptions(depends_on=[cluster]),
        )
        # the Auth Proxy sidecar; database credentials still keep each environment to its own data
        gcp.projects.IAMMember(
            f"{env.name}-{workload}-cloudsql",
            project=project,
            role="roles/cloudsql.client",
            member=google.email.apply(lambda email: f"serviceAccount:{email}"),
        )
        principal = pulumi.Output.all(project_number, cluster.id).apply(
            lambda values, w=workload: (
                f"principal://iam.googleapis.com/projects/{values[0]}/locations/global/"
                f"workloadIdentityPools/{project}.svc.id.goog/subject/ns/{env.namespace}/sa/{w}"
            )
        )
        accounts[workload] = Account(env.namespace, workload, google, principal)
    return accounts


@dataclass(frozen=True)
class Ci:
    provider: gcp.iam.WorkloadIdentityPoolProvider
    builder: gcp.serviceaccount.Account  # pushes and tags images, from any job on main
    deployers: dict[str, gcp.serviceaccount.Account]  # per environment, only from its job on main


def ci(
    project: str,
    github_repository: str,
    registry: gcp.artifactregistry.Repository,
    envs: Sequence[Environment],
) -> Ci:
    pool = gcp.iam.WorkloadIdentityPool(
        "github", workload_identity_pool_id="github", display_name="GitHub Actions"
    )
    provider = gcp.iam.WorkloadIdentityPoolProvider(
        "github",
        workload_identity_pool_id=pool.workload_identity_pool_id,
        workload_identity_pool_provider_id="github",
        attribute_mapping={
            "google.subject": "assertion.sub",
            "attribute.repository": "assertion.repository",
            "attribute.ref": "assertion.ref",
            "attribute.repository_ref": "assertion.repository + '@' + assertion.ref",
            "attribute.subject_ref": "assertion.sub + '@' + assertion.ref",
        },
        attribute_condition=(
            f"assertion.repository == '{github_repository}' && assertion.ref == '{DEPLOY_REF}'"
        ),
        oidc={"issuer_uri": GITHUB_ISSUER},
    )
    builder = gcp.serviceaccount.Account(
        "builder", account_id="cb-builder", display_name="Clientbridge CI image pushes"
    )
    gcp.serviceaccount.IAMMember(
        "builder-github",
        service_account_id=builder.name,
        role="roles/iam.workloadIdentityUser",
        member=pool.name.apply(
            lambda name: (
                f"principalSet://iam.googleapis.com/{name}/attribute.repository_ref/"
                f"{github_repository}@{DEPLOY_REF}"
            )
        ),
    )
    gcp.artifactregistry.RepositoryIamMember(
        "builder-push",
        repository=registry.name,
        location=registry.location,
        role="roles/artifactregistry.writer",
        member=builder.email.apply(lambda email: f"serviceAccount:{email}"),
    )
    deployers: dict[str, gcp.serviceaccount.Account] = {}
    for env in envs:
        account = gcp.serviceaccount.Account(
            f"deploy-{env.name}",
            account_id=f"cb-deploy-{env.name}",
            display_name=f"Clientbridge CI deploys to {env.name}",
        )
        # only a job on main in this environment's GitHub environment, which gates production
        subject = f"repo:{github_repository}:environment:{env.github_environment}@{DEPLOY_REF}"
        gcp.serviceaccount.IAMMember(
            f"deploy-{env.name}-github",
            service_account_id=account.name,
            role="roles/iam.workloadIdentityUser",
            member=pool.name.apply(
                lambda name, s=subject: (
                    f"principalSet://iam.googleapis.com/{name}/attribute.subject_ref/{s}"
                )
            ),
        )
        # reaching the control plane only; what it may change is the namespace Role (kubernetes/)
        gcp.projects.IAMMember(
            f"deploy-{env.name}-cluster",
            project=project,
            role="roles/container.clusterViewer",
            member=account.email.apply(lambda email: f"serviceAccount:{email}"),
        )
        deployers[env.name] = account
    return Ci(provider=provider, builder=builder, deployers=deployers)


STATE_PROJECT = (
    "clientbridge"  # the Pulumi project, whose stacks the state bucket keeps under .pulumi/
)


def state_prefixes(bucket: str, stack: str) -> list[str]:
    objects = f"projects/_/buckets/{bucket}/objects/.pulumi"
    return [
        f"{objects}/stacks/{STATE_PROJECT}/{stack}.json",
        f"{objects}/history/{STATE_PROJECT}/{stack}/",
        f"{objects}/backups/{STATE_PROJECT}/{stack}/",
        # locks are kept under the stack's fully qualified name
        f"{objects}/locks/organization/{STATE_PROJECT}/{stack}/",
    ]


def state_access(ci: Ci, envs: Sequence[Environment], bucket: str, key: str) -> None:
    """Each deployer reads every stack's state (none holds a secret) and writes only its own."""
    for env in envs:
        member = ci.deployers[env.name].email.apply(lambda email: f"serviceAccount:{email}")
        gcp.storage.BucketIAMMember(
            f"deploy-{env.name}-state-read",
            bucket=bucket,
            role="roles/storage.objectViewer",
            member=member,
        )
        prefixes = state_prefixes(bucket, env.name)
        gcp.storage.BucketIAMMember(
            f"deploy-{env.name}-state-write",
            bucket=bucket,
            role="roles/storage.objectUser",
            member=member,
            condition={
                "title": f"{env.name} stack only",
                "expression": " || ".join(f'resource.name.startsWith("{p}")' for p in prefixes),
            },
            # the replacement has the same IAM key, so deleting the original after would remove it
            opts=pulumi.ResourceOptions(delete_before_replace=True),
        )
        gcp.kms.CryptoKeyIAMMember(
            f"deploy-{env.name}-state-key",
            crypto_key_id=key,
            role="roles/cloudkms.cryptoKeyEncrypterDecrypter",
            member=member,
        )
