"""The arq worker on Spot pods, as one replica so each cron run fires once."""

from collections.abc import Sequence

import pulumi
import pulumi_kubernetes as k8s

from kubernetes import settings, sidecar

NAME = "worker"


def create(ctx: settings.Context, migrate: Sequence[pulumi.Resource]) -> k8s.apps.v1.Deployment:
    workload = ctx.env.worker
    container = k8s.core.v1.ContainerArgs(
        name=NAME,
        image=ctx.backend_image,
        command=settings.with_secrets(settings.WORKER_COMMAND, settings.BACKEND_SECRETS),
        env=settings.backend_env(ctx.env, ctx.bucket),
        volume_mounts=[settings.SECRETS_MOUNT],
        resources=settings.resources(workload.size),
        security_context=settings.security("backend"),
        # arq refreshes its health key once per health_check_interval, so this catches a hung loop
        liveness_probe=k8s.core.v1.ProbeArgs(
            exec_=k8s.core.v1.ExecActionArgs(
                command=settings.with_secrets(settings.WORKER_CHECK, settings.BACKEND_SECRETS)
            ),
            initial_delay_seconds=120,
            period_seconds=300,
            timeout_seconds=30,
            failure_threshold=2,
        ),
    )
    volume, provider_class = settings.secret_volume(ctx, NAME, settings.readers(NAME))
    spec = settings.pod(
        workload,
        NAME,
        [container],
        init_containers=[sidecar.proxy(ctx.upstream["proxy"], ctx.connection_name)],
        volumes=[volume],
    )
    return settings.deployment(
        ctx, NAME, workload, spec, depends_on=[*migrate, provider_class], single=True
    )
