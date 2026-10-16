"""The web image: Caddy serving the site, the staff app and Connect, with a runtime config.js."""

from collections.abc import Sequence

import pulumi
import pulumi_kubernetes as k8s

from environments import WEB_PORT
from kubernetes import settings

NAME = "web"
HEALTH_PATH = "/robots.txt"  # answered for any host, so probes need no Host header


def create(ctx: settings.Context, migrate: Sequence[pulumi.Resource]) -> k8s.apps.v1.Deployment:
    workload = ctx.env.web
    probe = k8s.core.v1.ProbeArgs(
        http_get=k8s.core.v1.HTTPGetActionArgs(path=HEALTH_PATH, port=WEB_PORT), period_seconds=10
    )
    container = k8s.core.v1.ContainerArgs(
        name=NAME,
        image=ctx.web_image,
        env=settings.web_env(ctx.env, ctx.stripe_publishable_key, ctx.app_links),
        ports=[k8s.core.v1.ContainerPortArgs(name="http", container_port=WEB_PORT)],
        resources=settings.resources(workload.size),
        security_context=settings.security("web"),
        lifecycle=settings.DRAIN,
        readiness_probe=probe,
        liveness_probe=probe,
    )
    settings.service(ctx, NAME, {"http": WEB_PORT})
    # a failed migration leaves the old frontend running against the old API
    return settings.deployment(
        ctx, NAME, workload, settings.pod(workload, NAME, [container]), depends_on=migrate
    )
