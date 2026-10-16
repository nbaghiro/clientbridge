"""The API: FastAPI behind the Gateway on api.D, with its Auth Proxy sidecar."""

from collections.abc import Sequence

import pulumi
import pulumi_kubernetes as k8s

from environments import API_PORT
from kubernetes import settings, sidecar

NAME = "api"


def create(ctx: settings.Context, migrate: Sequence[pulumi.Resource]) -> k8s.apps.v1.Deployment:
    workload = ctx.env.api
    container = k8s.core.v1.ContainerArgs(
        name=NAME,
        image=ctx.backend_image,
        command=settings.with_secrets(settings.API_COMMAND, settings.BACKEND_SECRETS),
        env=settings.backend_env(ctx.env, ctx.bucket),
        ports=[k8s.core.v1.ContainerPortArgs(name="http", container_port=API_PORT)],
        volume_mounts=[settings.SECRETS_MOUNT],
        resources=settings.resources(workload.size),
        security_context=settings.security("backend"),
        lifecycle=settings.DRAIN,
        startup_probe=_probe("/health", period=2, failures=60),
        readiness_probe=_probe("/ready", period=5, failures=2),
        liveness_probe=_probe("/health", period=10, failures=3),
    )
    volume, provider_class = settings.secret_volume(ctx, NAME, settings.readers(NAME))
    spec = settings.pod(
        workload,
        NAME,
        [container],
        init_containers=[sidecar.proxy(ctx.upstream["proxy"], ctx.connection_name)],
        volumes=[volume],
    )
    settings.service(ctx, NAME, {"http": API_PORT})
    return settings.deployment(ctx, NAME, workload, spec, depends_on=[*migrate, provider_class])


def _probe(path: str, *, period: int, failures: int) -> k8s.core.v1.ProbeArgs:
    return k8s.core.v1.ProbeArgs(
        http_get=k8s.core.v1.HTTPGetActionArgs(path=path, port=API_PORT),
        period_seconds=period,
        failure_threshold=failures,
    )
