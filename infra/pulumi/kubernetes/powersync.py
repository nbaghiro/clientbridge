"""PowerSync: replication and the sync API in one pod, and a daily compaction of its storage."""

from collections.abc import Sequence

import pulumi
import pulumi_kubernetes as k8s

from environments import POWERSYNC_PORT
from kubernetes import settings, sidecar

NAME = "powersync"
CONFIG = settings.REPO / "infra" / "powersync"
COMPACT = "powersync-compact"
# the pinned image never compacts on its own; one environment at a time, done before 07:00 backups
COMPACT_SCHEDULES = {"prod": "0 6 * * *", "staging": "30 6 * * *"}
COMPACT_DEADLINE_SECONDS = 1500


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
    proxy = [sidecar.proxy(ctx.upstream["proxy"], ctx.connection_name)]
    volumes = [
        volume,
        k8s.core.v1.VolumeArgs(
            name="config",
            config_map=k8s.core.v1.ConfigMapVolumeSourceArgs(name=config.metadata.name),
        ),
    ]
    spec = settings.pod(workload, NAME, [container], init_containers=proxy, volumes=volumes)
    settings.service(ctx, NAME, {"http": POWERSYNC_PORT})
    _compaction(ctx, container, proxy, volumes, [*migrate, provider_class])
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


def _compaction(
    ctx: settings.Context,
    service: k8s.core.v1.ContainerArgs,
    proxy: Sequence[k8s.core.v1.ContainerArgs],
    volumes: Sequence[k8s.core.v1.VolumeArgs],
    after: Sequence[pulumi.Resource],
) -> k8s.batch.v1.CronJob:
    """Drop superseded operations from the buckets, so a new device downloads current rows."""
    container = k8s.core.v1.ContainerArgs(
        name=COMPACT,
        image=service.image,
        command=settings.with_secrets(settings.POWERSYNC_COMPACT, settings.POWERSYNC_SECRETS),
        env=service.env,
        volume_mounts=service.volume_mounts,
        resources=service.resources,
        security_context=service.security_context,
    )
    spec = settings.pod(
        ctx.env.powersync,
        NAME,
        [container],
        init_containers=proxy,
        volumes=volumes,
        restart_policy="Never",
    )
    labels = {"app": COMPACT}
    return k8s.batch.v1.CronJob(
        f"{ctx.env.name}-{COMPACT}",
        metadata=ctx.metadata(COMPACT),
        spec=k8s.batch.v1.CronJobSpecArgs(
            schedule=COMPACT_SCHEDULES[ctx.env.name],
            time_zone="Etc/UTC",
            concurrency_policy="Forbid",
            starting_deadline_seconds=COMPACT_DEADLINE_SECONDS,
            successful_jobs_history_limit=1,
            failed_jobs_history_limit=2,
            job_template=k8s.batch.v1.JobTemplateSpecArgs(
                metadata=k8s.meta.v1.ObjectMetaArgs(labels=labels),
                spec=k8s.batch.v1.JobSpecArgs(
                    backoff_limit=1,
                    active_deadline_seconds=COMPACT_DEADLINE_SECONDS,
                    template=k8s.core.v1.PodTemplateSpecArgs(
                        metadata=k8s.meta.v1.ObjectMetaArgs(labels=labels), spec=spec
                    ),
                ),
            ),
        ),
        opts=ctx.options(after),
    )
