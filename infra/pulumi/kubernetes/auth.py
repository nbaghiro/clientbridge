"""The auth service (Ory Kratos): infra/auth as a ConfigMap, its public API at api.D/auth."""

from collections.abc import Sequence
from pathlib import Path

import pulumi
import pulumi_kubernetes as k8s

from environments import AUTH_ADMIN_PORT, AUTH_PUBLIC_PORT
from kubernetes import settings, sidecar

NAME = "auth"
CONFIG = settings.REPO / "infra" / "auth"


def config_files(directory: Path = CONFIG) -> dict[str, str]:
    # standalone.sh starts Kratos for CI's backend tests and is not configuration
    return {
        path.name: path.read_text()
        for path in sorted(directory.iterdir())
        if path.is_file() and path.suffix != ".sh"
    }


def create(ctx: settings.Context, migrate: Sequence[pulumi.Resource]) -> k8s.apps.v1.Deployment:
    workload = ctx.env.auth
    # auto-named, so a changed file creates a new ConfigMap and rolls the pods onto it
    config = k8s.core.v1.ConfigMap(
        f"{ctx.env.name}-{NAME}",
        metadata=k8s.meta.v1.ObjectMetaArgs(namespace=ctx.env.namespace, labels={"app": NAME}),
        data=config_files(),
        opts=ctx.options(),
    )
    container = k8s.core.v1.ContainerArgs(
        name=NAME,
        image=ctx.upstream["auth"],
        command=settings.with_secrets(settings.AUTH_SERVE, settings.AUTH_SECRETS),
        env=settings.auth_env(ctx.env),
        ports=[
            k8s.core.v1.ContainerPortArgs(name="public", container_port=AUTH_PUBLIC_PORT),
            k8s.core.v1.ContainerPortArgs(name="admin", container_port=AUTH_ADMIN_PORT),
        ],
        volume_mounts=[
            settings.SECRETS_MOUNT,
            k8s.core.v1.VolumeMountArgs(
                name="config", mount_path=settings.AUTH_CONFIG_DIR, read_only=True
            ),
        ],
        resources=settings.resources(workload.size),
        security_context=settings.security(NAME),
        lifecycle=settings.DRAIN,
        readiness_probe=_probe("/health/ready"),
        liveness_probe=_probe("/health/alive"),
    )
    volume, provider_class = settings.secret_volume(ctx, NAME, settings.readers(NAME))
    spec = settings.pod(
        workload,
        NAME,
        [container],
        init_containers=[sidecar.proxy(ctx.upstream["proxy"], ctx.connection_name)],
        volumes=[
            volume,
            k8s.core.v1.VolumeArgs(
                name="config",
                config_map=k8s.core.v1.ConfigMapVolumeSourceArgs(name=config.metadata.name),
            ),
        ],
    )
    settings.service(ctx, NAME, {"public": AUTH_PUBLIC_PORT, "admin": AUTH_ADMIN_PORT})
    return settings.deployment(ctx, NAME, workload, spec, depends_on=[*migrate, provider_class])


def _probe(path: str) -> k8s.core.v1.ProbeArgs:
    return k8s.core.v1.ProbeArgs(
        http_get=k8s.core.v1.HTTPGetActionArgs(path=path, port=AUTH_PUBLIC_PORT),
        period_seconds=10,
    )
