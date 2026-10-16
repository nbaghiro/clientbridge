"""The migrate Job that runs before every rollout: db_access roles, Alembic, grants, then auth."""

import pulumi
import pulumi_kubernetes as k8s

from kubernetes import settings, sidecar

NAME = "migrate"
DEADLINE_SECONDS = 1200


def allow_ahead(ctx: settings.Context) -> list[k8s.core.v1.EnvVarArgs]:
    """A rollback's migrate skips a database whose revision the older image does not know."""
    if not ctx.allow_schema_ahead:
        return []
    return [k8s.core.v1.EnvVarArgs(name="MIGRATE_ALLOW_AHEAD", value="1")]


def create(ctx: settings.Context) -> k8s.batch.v1.Job:
    """Named after the images it migrates for, so each deploy runs it once; a failure stops it."""
    workload = ctx.env.migrate
    auth_image = ctx.upstream["auth"]
    backend = k8s.core.v1.ContainerArgs(
        name=NAME,
        image=ctx.backend_image,
        command=settings.with_secrets(settings.MIGRATE_COMMAND, settings.MIGRATE_SECRETS),
        env=[*settings.backend_env(ctx.env, ctx.bucket), *allow_ahead(ctx)],
        volume_mounts=[settings.SECRETS_MOUNT],
        resources=settings.resources(workload.size),
        security_context=settings.security("backend"),
    )
    # db_access roles creates the auth role and database, so auth migrates after the backend
    auth = k8s.core.v1.ContainerArgs(
        name="auth-migrate",
        image=auth_image,
        command=settings.with_secrets(settings.AUTH_MIGRATE, settings.AUTH_MIGRATE_SECRETS),
        volume_mounts=[settings.SECRETS_MOUNT],
        resources=settings.resources(workload.size),
        security_context=settings.security("auth"),
    )
    volume, provider_class = settings.secret_volume(ctx, NAME, settings.readers(NAME))
    spec = settings.pod(
        workload,
        NAME,
        [auth],
        init_containers=[sidecar.proxy(ctx.upstream["proxy"], ctx.connection_name), backend],
        volumes=[volume],
        restart_policy="Never",
    )
    name = f"{NAME}-{settings.config_digest(ctx.images.backend, auth_image)}"
    return k8s.batch.v1.Job(
        f"{ctx.env.name}-{NAME}",
        metadata=k8s.meta.v1.ObjectMetaArgs(
            name=name,
            namespace=ctx.env.namespace,
            labels={"app": NAME},
            # a failed run is replaced by the next deploy rather than left failed under its name
            annotations={"pulumi.com/replaceUnready": "true"},
        ),
        spec=k8s.batch.v1.JobSpecArgs(
            backoff_limit=ctx.env.migrate_retries,
            active_deadline_seconds=DEADLINE_SECONDS,
            template=k8s.core.v1.PodTemplateSpecArgs(
                metadata=k8s.meta.v1.ObjectMetaArgs(labels={"app": NAME}), spec=spec
            ),
        ),
        # Pulumi waits for the Job to succeed; the Deployments that depend on it wait with it
        opts=ctx.options(
            [provider_class],
            pulumi.CustomTimeouts(create=f"{DEADLINE_SECONDS}s", update=f"{DEADLINE_SECONDS}s"),
        ),
    )
