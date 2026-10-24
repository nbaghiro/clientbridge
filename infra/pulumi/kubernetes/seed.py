"""Staging's demo Job after migrate: seed a scratch Postgres, copy it over, then link Stripe."""

import pulumi
import pulumi_kubernetes as k8s

from kubernetes import migrate, settings, sidecar

NAME = "seed"
# the copy is bound by Cloud SQL's shared core, so the deploy starts the Job and doesn't wait for it
DEADLINE_SECONDS = 3600
# one writer per core of the pod, the seed's and its scratch Postgres's together
JOBS = 2
# a round trip through the Cloud SQL proxy costs milliseconds, so the seed writes locally first
COMMAND = (
    "/bin/sh",
    "-c",
    f"python -m scripts.seed_demo --jobs {JOBS} --scratch {sidecar.SCRATCH_URL} --prune-logins"
    " && python -m scripts.stripe_setup --link-only --apply",
)


def create(ctx: settings.Context, after: list[pulumi.Resource]) -> k8s.batch.v1.Job:
    """Runs as the migrate account, whose secrets hold the owner's database URL and Stripe key."""
    workload = ctx.env.demo
    if workload is None:
        raise ValueError(f"{ctx.env.name} doesn't seed the demo businesses")
    seed = k8s.core.v1.ContainerArgs(
        name=NAME,
        image=ctx.backend_image,
        command=settings.with_secrets(COMMAND, settings.MIGRATE_SECRETS),
        env=settings.backend_env(ctx.env, ctx.bucket),
        volume_mounts=[settings.SECRETS_MOUNT],
        resources=settings.resources(workload.size),
        security_context=settings.security("backend"),
    )
    volume, provider_class = settings.secret_volume(ctx, NAME, settings.readers(migrate.NAME))
    scratch, scratch_volumes = sidecar.scratch(ctx.upstream["postgres"])
    spec = settings.pod(
        workload,
        migrate.NAME,
        [seed],
        init_containers=[sidecar.proxy(ctx.upstream["proxy"], ctx.connection_name), scratch],
        volumes=[volume, *scratch_volumes],
        restart_policy="Never",
    )
    # a new image, command or deadline starts a fresh Job, since Pulumi never reruns one
    digest = settings.config_digest(ctx.images.backend, *COMMAND, str(DEADLINE_SECONDS))
    return k8s.batch.v1.Job(
        f"{ctx.env.name}-{NAME}",
        metadata=k8s.meta.v1.ObjectMetaArgs(
            name=f"{NAME}-{digest}",
            namespace=ctx.env.namespace,
            labels={"app": NAME},
            annotations={"pulumi.com/skipAwait": "true"},
        ),
        spec=k8s.batch.v1.JobSpecArgs(
            backoff_limit=ctx.env.migrate_retries,
            active_deadline_seconds=DEADLINE_SECONDS,
            template=k8s.core.v1.PodTemplateSpecArgs(
                metadata=k8s.meta.v1.ObjectMetaArgs(labels={"app": NAME}), spec=spec
            ),
        ),
        opts=ctx.options([provider_class, *after]),
    )
