"""How every container runs: images, commands, environment variables, secrets and scheduling."""

import hashlib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

import pulumi
import pulumi_kubernetes as k8s
import yaml
from clientbridge.core import deployment as derived

from cloud.database import AUTH_MAX_CONNS
from environments import (
    API_PORT,
    AUTH_ADMIN_PORT,
    AUTH_PUBLIC_PORT,
    REDIS_PORT,
    Environment,
    Images,
    Size,
    Workload,
)
from kubernetes import compute

REPO = Path(__file__).resolve().parents[3]
COMPOSE = REPO / "docker-compose.yml"
SECRETS_DIR = "/var/run/secrets/clientbridge"
TRUSTED_PROXY_HOPS = 2  # Google's load balancer appends two addresses to X-Forwarded-For
# the auth service's public API under the API host, so its session cookie can be __Host-
AUTH_PREFIX = "/auth"
GRACE_SECONDS = 25  # every pod stops within the notice Autopilot gives a preempted Spot pod
# a stopping pod keeps serving while the load balancer stops sending to it, then drains
DRAIN_DELAY_SECONDS = 10
DRAIN_SECONDS = 10
API_WORKERS = 2
DB_POOL_SIZE = 3
DB_MAX_OVERFLOW = 1

# the backend image's commands (backend/Dockerfile): its default CMD, the worker and migrate
API_COMMAND = (
    "uvicorn",
    "clientbridge.main:app",
    "--host",
    "0.0.0.0",
    "--port",
    str(API_PORT),
    "--workers",
    str(API_WORKERS),
    "--timeout-graceful-shutdown",
    str(DRAIN_SECONDS),
    "--no-proxy-headers",
)
WORKER_COMMAND = ("arq", "clientbridge.tasks.worker.WorkerSettings")
# arq --check reads the health key the worker refreshes every health_check_interval
WORKER_CHECK = ("arq", "--check", "clientbridge.tasks.worker.WorkerSettings")
MIGRATE_COMMAND = ("migrate",)
AUTH_CONFIG_DIR = "/etc/config/auth"
AUTH_SERVE = ("kratos", *derived.AUTH_COMMAND)
AUTH_MIGRATE = ("kratos", "migrate", "sql", "up", "-e", "--yes")
POWERSYNC_CONFIG_DIR = "/config"
POWERSYNC_START = ("node", "service/lib/entry.js", "start", "-r", "unified")
# its source and storage pools (max_pool_size defaults to 8 each) and the replication streams
POWERSYNC_CONNECTIONS = 20
MIGRATE_CONNECTIONS = 8  # db_access as the admin, Alembic as the migrator, then the auth service

# secrets secrets_init.py generates; the rest are added to Secret Manager by hand
GENERATED = (
    "ADMIN_DATABASE_URL",
    "MIGRATION_DATABASE_URL",
    "DATABASE_URL",
    "POWERSYNC_SOURCE_DATABASE_URL",
    "POWERSYNC_STORAGE_DATABASE_URL",
    "AUTH_DATABASE_URL",
    "JWT_SECRET",
    "POWERSYNC_PRIVATE_KEY_PEM",
    "AUTH_EMAIL_HOOK_SECRET",
    "AUTH_COOKIE_SECRET",
    "AUTH_CIPHER_SECRET",
    "S3_ACCESS_KEY",
    "S3_SECRET_KEY",
    "POWERSYNC_KID",
    # a JSON object of retired key IDs to public PEMs, {} until a rotation
    "POWERSYNC_PREVIOUS_PUBLIC_KEYS",
)
PROVIDED = (
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_THIN_WEBHOOK_SECRET",
    "STRIPE_PLATFORM_WEBHOOK_SECRET",
    "STRIPE_PORTAL_CONFIGURATION",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_SMS_FROM",
    "RESEND_API_KEY",
    "RESEND_WEBHOOK_SECRET",
    "EXPO_ACCESS_TOKEN",
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
)
CATALOG = GENERATED + PROVIDED

# each container's environment variable → the secret it is read from
_BACKEND_NAMES = (
    "DATABASE_URL",
    "JWT_SECRET",
    "S3_ACCESS_KEY",
    "S3_SECRET_KEY",
    "POWERSYNC_PRIVATE_KEY_PEM",
    "POWERSYNC_KID",
    "POWERSYNC_PREVIOUS_PUBLIC_KEYS",
    "AUTH_EMAIL_HOOK_SECRET",
    *(name for name in PROVIDED if not name.startswith("GOOGLE_OAUTH_")),
)
BACKEND_SECRETS: Mapping[str, str] = {name: name for name in _BACKEND_NAMES}
# db_access.py and Alembic build Settings too, so the migrate step passes the same startup check
MIGRATE_SECRETS: Mapping[str, str] = {
    **BACKEND_SECRETS,
    **{
        name: name
        for name in (
            "ADMIN_DATABASE_URL",
            "MIGRATION_DATABASE_URL",
            "POWERSYNC_SOURCE_DATABASE_URL",
            "POWERSYNC_STORAGE_DATABASE_URL",
            "AUTH_DATABASE_URL",
        )
    },
}
# core/deployment.py names the variables auth and PowerSync read; these name their secrets
AUTH_SECRETS: Mapping[str, str] = dict(
    zip(
        derived.AUTH_SECRETS,
        (
            "AUTH_DATABASE_URL",
            "AUTH_COOKIE_SECRET",
            "AUTH_CIPHER_SECRET",
            "AUTH_EMAIL_HOOK_SECRET",
            "GOOGLE_OAUTH_CLIENT_ID",
            "GOOGLE_OAUTH_CLIENT_SECRET",
        ),
        strict=True,
    )
)
AUTH_MIGRATE_SECRETS: Mapping[str, str] = {"DSN": "AUTH_DATABASE_URL"}
POWERSYNC_SECRETS: Mapping[str, str] = dict(
    zip(
        derived.POWERSYNC_SECRETS,
        ("POWERSYNC_SOURCE_DATABASE_URL", "POWERSYNC_STORAGE_DATABASE_URL"),
        strict=True,
    )
)
POWERSYNC_FILES = ("powersync.deployed.yaml", "sync-rules.yaml")
# workloads that reach the database or Secret Manager, each with its own Google service account
ACCOUNTS: Mapping[str, Sequence[Mapping[str, str]]] = {
    "api": (BACKEND_SECRETS,),
    "worker": (BACKEND_SECRETS,),
    "migrate": (MIGRATE_SECRETS, AUTH_MIGRATE_SECRETS),
    "auth": (AUTH_SECRETS,),
    "powersync": (POWERSYNC_SECRETS,),
}


def readers(workload: str) -> set[str]:
    return {secret for mapping in ACCOUNTS[workload] for secret in mapping.values()}


# numeric, because runAsNonRoot cannot verify a named or missing USER in the image
IMAGE_USERS: Mapping[str, tuple[int, int]] = {
    "backend": (10001, 10001),
    "web": (10001, 10001),
    "auth": (10000, 101),
    "powersync": (901, 901),
    "redis": (999, 999),  # the image's USER is root, and its entrypoint skips gosu when not root
    "proxy": (65532, 65532),
}


def upstream_images(compose: Path) -> dict[str, str]:
    """The digest pins docker-compose.yml holds, so the cluster runs what local runs do."""
    wanted = {
        "auth": "oryd/kratos",
        "powersync": "journeyapps/powersync-service",
        "redis": "redis",
        "proxy": "gcr.io/cloud-sql-connectors/cloud-sql-proxy",
    }
    services = yaml.safe_load(compose.read_text())["services"]
    pinned: dict[str, str] = {}
    for service in services.values():
        image = str(service.get("image", ""))
        repository, _, digest = image.partition("@")
        for key, name in wanted.items():
            if repository == name and digest.startswith("sha256:"):
                pinned[key] = image
    missing = [wanted[key] for key in wanted if key not in pinned]
    if missing:
        raise ValueError(f"docker-compose.yml needs a digest-pinned image for {', '.join(missing)}")
    return pinned


def internal(env: Environment, service: str, port: int) -> str:
    return f"http://{service}.{env.namespace}.svc.cluster.local:{port}"


def _plain(values: Mapping[str, str]) -> list[k8s.core.v1.EnvVarArgs]:
    return [k8s.core.v1.EnvVarArgs(name=name, value=value) for name, value in values.items()]


def backend_env(env: Environment, bucket: pulumi.Input[str]) -> list[k8s.core.v1.EnvVarArgs]:
    """The API, worker and migrate settings; every public URL derives from BASE_DOMAIN."""
    return [
        *_plain(
            {
                "ENV": env.name,
                "BASE_DOMAIN": env.base_domain,
                "TRUSTED_PROXY_HOPS": str(TRUSTED_PROXY_HOPS),
                "REDIS_URL": f"redis://redis.{env.namespace}.svc.cluster.local:{REDIS_PORT}/0",
                "S3_ENDPOINT": "https://storage.googleapis.com",
                "S3_REGION": "auto",
                "AUTH_ADMIN_URL": internal(env, "auth", AUTH_ADMIN_PORT),
                "AUTH_INTERNAL_URL": internal(env, "auth", AUTH_PUBLIC_PORT),
                "POWERSYNC_USE_RS256": "true",
                "DB_POOL_SIZE": str(DB_POOL_SIZE),
                "DB_MAX_OVERFLOW": str(DB_MAX_OVERFLOW),
                "EMAIL_FROM": f"Clientbridge <no-reply@{env.base_domain}>",
            }
        ),
        k8s.core.v1.EnvVarArgs(name="S3_BUCKET", value=bucket),
    ]


def auth_env(env: Environment) -> list[k8s.core.v1.EnvVarArgs]:
    return _plain(
        derived.auth_env(
            env.base_domain,
            api_url=internal(env, "api", API_PORT),
            admin_url=internal(env, "auth", AUTH_ADMIN_PORT),
        )
    )


def powersync_env(env: Environment) -> list[k8s.core.v1.EnvVarArgs]:
    return _plain(derived.powersync_env(api_url=internal(env, "api", API_PORT)))


def web_env(env: Environment, stripe_publishable_key: str) -> list[k8s.core.v1.EnvVarArgs]:
    return _plain(
        {
            "BASE_DOMAIN": env.base_domain,
            "ENVIRONMENT": env.web_environment,
            "STRIPE_PUBLISHABLE_KEY": stripe_publishable_key,
        }
    )


def with_secrets(command: Sequence[str], secrets: Mapping[str, str]) -> list[str]:
    """Export each mounted secret file as its variable, then run the image's command."""
    # a plain assignment, unlike export, fails the script when cat finds no file
    exports = [
        f'{variable}="$(cat {SECRETS_DIR}/{secret})"; export {variable}'
        for variable, secret in sorted(secrets.items())
    ]
    return [
        "/bin/sh",
        "-c",
        "\n".join(["set -eu", *exports, 'exec "$@"']),
        "with-secrets",
        *command,
    ]


def secret_volume(
    ctx: "Context", name: str, files: set[str]
) -> tuple[k8s.core.v1.VolumeArgs, pulumi.Resource]:
    """Mount the pod's secrets from Secret Manager through GKE's managed CSI add-on."""
    names = sorted(files)
    listing = pulumi.Output.all(*(ctx.secrets[file] for file in names)).apply(
        lambda resources: yaml.safe_dump(
            [
                {"resourceName": f"{resource}/versions/latest", "path": file}
                for resource, file in zip(resources, names, strict=True)
            ]
        )
    )
    provider_class = k8s.apiextensions.CustomResource(
        f"{ctx.env.name}-{name}-secrets",
        api_version="secrets-store.csi.x-k8s.io/v1",
        kind="SecretProviderClass",
        metadata=k8s.meta.v1.ObjectMetaArgs(name=name, namespace=ctx.env.namespace),
        spec={"provider": "gke", "parameters": {"secrets": listing}},
        opts=ctx.options(),
    )
    volume = k8s.core.v1.VolumeArgs(
        name="secrets",
        csi=k8s.core.v1.CSIVolumeSourceArgs(
            driver="secrets-store-gke.csi.k8s.io",
            read_only=True,
            volume_attributes={"secretProviderClass": name},
        ),
    )
    return volume, provider_class


SECRETS_MOUNT = k8s.core.v1.VolumeMountArgs(name="secrets", mount_path=SECRETS_DIR, read_only=True)


def resources(size: Size) -> k8s.core.v1.ResourceRequirementsArgs:
    # Autopilot sets limits equal to requests unless bursting is allowed, which it is by default
    return k8s.core.v1.ResourceRequirementsArgs(requests={"cpu": size.cpu, "memory": size.memory})


def security(image: str, *, read_only: bool = False) -> k8s.core.v1.SecurityContextArgs:
    user, group = IMAGE_USERS[image]
    return k8s.core.v1.SecurityContextArgs(
        allow_privilege_escalation=False,
        run_as_non_root=True,
        run_as_user=user,
        run_as_group=group,
        read_only_root_filesystem=read_only or None,
        capabilities=k8s.core.v1.CapabilitiesArgs(drop=["ALL"]),
    )


DRAIN = k8s.core.v1.LifecycleArgs(
    pre_stop=k8s.core.v1.LifecycleHandlerArgs(
        sleep=k8s.core.v1.SleepActionArgs(seconds=DRAIN_DELAY_SECONDS)
    )
)


def peak_connections(env: Environment) -> int:
    """Database connections one environment opens at most: a rollout surging the API and auth."""
    per_process = DB_POOL_SIZE + DB_MAX_OVERFLOW
    api = (env.api.replicas + 1) * API_WORKERS * per_process
    worker = env.worker.replicas * per_process
    auth = (env.auth.replicas + 1) * AUTH_MAX_CONNS
    steady_api = env.api.replicas * API_WORKERS * per_process
    steady_auth = env.auth.replicas * AUTH_MAX_CONNS
    rollout = api + worker + auth + POWERSYNC_CONNECTIONS
    # the migrate Job runs before the rollout, beside the old pods
    migrating = steady_api + worker + steady_auth + POWERSYNC_CONNECTIONS + MIGRATE_CONNECTIONS
    return max(rollout, migrating)


def pod(
    workload: Workload,
    account: str,
    containers: Sequence[k8s.core.v1.ContainerArgs],
    *,
    init_containers: Sequence[k8s.core.v1.ContainerArgs] = (),
    volumes: Sequence[k8s.core.v1.VolumeArgs] = (),
    restart_policy: str | None = None,
) -> k8s.core.v1.PodSpecArgs:
    spot = workload.spot
    return k8s.core.v1.PodSpecArgs(
        service_account_name=account,
        automount_service_account_token=False,
        containers=list(containers),
        init_containers=list(init_containers) or None,
        volumes=list(volumes) or None,
        restart_policy=restart_policy,
        security_context=k8s.core.v1.PodSecurityContextArgs(
            run_as_non_root=True,
            seccomp_profile=k8s.core.v1.SeccompProfileArgs(type="RuntimeDefault"),
        ),
        # the class decides Spot; GKE refuses a gke-spot selector beside a custom compute class
        node_selector={"cloud.google.com/compute-class": compute.class_for(spot)},
        tolerations=[
            k8s.core.v1.TolerationArgs(
                key="cloud.google.com/gke-spot", operator="Equal", value="true", effect="NoSchedule"
            )
        ]
        if spot
        else None,
        termination_grace_period_seconds=GRACE_SECONDS,
    )


def config_digest(*parts: str) -> str:
    return hashlib.sha256("\n".join(parts).encode()).hexdigest()[:10]


@dataclass(frozen=True)
class Context:
    """What one environment's workloads are built from, much of it read from the cloud stack."""

    env: Environment
    provider: k8s.Provider
    scaffolding: Sequence[pulumi.Resource]  # the service accounts and network policies
    images: Images
    registry: pulumi.Output[str]
    upstream: Mapping[str, str]
    connection_name: pulumi.Output[str]
    bucket: pulumi.Output[str]
    secrets: Mapping[str, pulumi.Output[str]]  # Secret Manager resource names by catalog name
    stripe_publishable_key: str
    allow_schema_ahead: bool

    @property
    def backend_image(self) -> pulumi.Output[str]:
        return self.registry.apply(lambda registry: f"{registry}/backend@{self.images.backend}")

    @property
    def web_image(self) -> pulumi.Output[str]:
        return self.registry.apply(lambda registry: f"{registry}/web@{self.images.web}")

    def options(
        self,
        depends_on: Sequence[pulumi.Resource] = (),
        timeouts: pulumi.CustomTimeouts | None = None,
    ) -> pulumi.ResourceOptions:
        return pulumi.ResourceOptions(
            provider=self.provider,
            depends_on=[*self.scaffolding, *depends_on],
            custom_timeouts=timeouts,
        )

    def metadata(self, name: str) -> k8s.meta.v1.ObjectMetaArgs:
        return k8s.meta.v1.ObjectMetaArgs(
            name=name, namespace=self.env.namespace, labels={"app": name}
        )


def deployment(
    ctx: Context,
    name: str,
    workload: Workload,
    spec: k8s.core.v1.PodSpecArgs,
    *,
    depends_on: Sequence[pulumi.Resource] = (),
    single: bool = False,
) -> k8s.apps.v1.Deployment:
    """A Deployment that surges one new pod before the old one stops, or replaces it if single."""
    strategy = (
        k8s.apps.v1.DeploymentStrategyArgs(type="Recreate")
        if single
        else k8s.apps.v1.DeploymentStrategyArgs(
            type="RollingUpdate",
            rolling_update=k8s.apps.v1.RollingUpdateDeploymentArgs(max_surge=1, max_unavailable=0),
        )
    )
    if workload.replicas > 1:
        # a voluntary eviction (a node upgrade or repair) waits until another pod is ready
        k8s.policy.v1.PodDisruptionBudget(
            f"{ctx.env.name}-{name}",
            metadata=ctx.metadata(name),
            spec=k8s.policy.v1.PodDisruptionBudgetSpecArgs(
                min_available=1,
                selector=k8s.meta.v1.LabelSelectorArgs(match_labels={"app": name}),
            ),
            opts=ctx.options(),
        )
    return k8s.apps.v1.Deployment(
        f"{ctx.env.name}-{name}",
        metadata=ctx.metadata(name),
        spec=k8s.apps.v1.DeploymentSpecArgs(
            replicas=workload.replicas,
            selector=k8s.meta.v1.LabelSelectorArgs(match_labels={"app": name}),
            strategy=strategy,
            template=k8s.core.v1.PodTemplateSpecArgs(
                metadata=k8s.meta.v1.ObjectMetaArgs(labels={"app": name}), spec=spec
            ),
        ),
        opts=ctx.options(depends_on),
    )


def service(ctx: Context, name: str, ports: Mapping[str, int]) -> k8s.core.v1.Service:
    return k8s.core.v1.Service(
        f"{ctx.env.name}-{name}",
        metadata=ctx.metadata(name),
        spec=k8s.core.v1.ServiceSpecArgs(
            type="ClusterIP",
            selector={"app": name},
            ports=[
                k8s.core.v1.ServicePortArgs(name=port_name, port=port, target_port=port)
                for port_name, port in ports.items()
            ],
        ),
        opts=ctx.options(),
    )
