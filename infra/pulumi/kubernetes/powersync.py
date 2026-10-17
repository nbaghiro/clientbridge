"""PowerSync: replication and the sync API in one pod, with infra/powersync as a ConfigMap."""

from collections.abc import Sequence

import pulumi
import pulumi_kubernetes as k8s

from environments import POWERSYNC_PORT
from kubernetes import settings, sidecar

NAME = "powersync"
CONFIG = settings.REPO / "infra" / "powersync"


def create(ctx: settings.Context, migrate: Sequence[pulumi.Resource]) -> k8s.apps.v1.Deployment:
    workload = ctx.env.powersync
    config = k8s.core.v1.ConfigMap(
        f"{ctx.env.name}-{NAME}",
        metadata=k8s.meta.v1.ObjectMetaArgs(namespace=ctx.env.namespace, labels={"app": NAME}),
        data={name: (CONFIG / name).read_text() for name in settings.POWERSYNC_FILES},
        opts=ctx.options(),
    )
    container = k8s.core.v1.ContainerArgs(
        name=NAME,
        image=ctx.upstream["powersync"],
        command=settings.with_secrets(settings.POWERSYNC_START, settings.POWERSYNC_SECRETS),
        env=settings.powersync_env(ctx.env),
        ports=[k8s.core.v1.ContainerPortArgs(name="http", container_port=POWERSYNC_PORT)],
        volume_mounts=[
            settings.SECRETS_MOUNT,
            k8s.core.v1.VolumeMountArgs(
                name="config", mount_path=settings.POWERSYNC_CONFIG_DIR, read_only=True
            ),
        ],
        resources=settings.resources(workload.size),
        security_context=settings.security("powersync"),
        startup_probe=_probe("/probes/startup", failures=60),
        readiness_probe=_probe("/probes/readiness", failures=3),
        liveness_probe=_probe("/probes/liveness", failures=3),
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
    settings.service(ctx, NAME, {"http": POWERSYNC_PORT})
    # one replicating pod at a time: a second would compete for the replication slot
    return settings.deployment(
        ctx, NAME, workload, spec, depends_on=[*migrate, provider_class], single=True
    )


def _probe(path: str, *, failures: int) -> k8s.core.v1.ProbeArgs:
    return k8s.core.v1.ProbeArgs(
        http_get=k8s.core.v1.HTTPGetActionArgs(path=path, port=POWERSYNC_PORT),
        period_seconds=5,
        failure_threshold=failures,
    )
