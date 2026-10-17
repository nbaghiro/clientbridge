"""Redis for the job queue only: no persistence, and no eviction, so no queued job is dropped."""

import pulumi_kubernetes as k8s

from environments import REDIS_PORT
from kubernetes import settings

NAME = "redis"
MAX_MEMORY = "96mb"  # under the 128 MiB request, leaving room for the server itself


def create(ctx: settings.Context) -> k8s.apps.v1.Deployment:
    workload = ctx.env.redis
    probe = k8s.core.v1.ProbeArgs(
        tcp_socket=k8s.core.v1.TCPSocketActionArgs(port=REDIS_PORT), period_seconds=10
    )
    container = k8s.core.v1.ContainerArgs(
        name=NAME,
        image=ctx.upstream["redis"],
        args=[
            "redis-server",
            "--save",
            "",
            "--appendonly",
            "no",
            "--maxmemory",
            MAX_MEMORY,
            "--maxmemory-policy",
            "noeviction",
        ],
        ports=[k8s.core.v1.ContainerPortArgs(name="redis", container_port=REDIS_PORT)],
        resources=settings.resources(workload.size),
        security_context=settings.security("redis"),
        readiness_probe=probe,
        liveness_probe=probe,
    )
    settings.service(ctx, NAME, {"redis": REDIS_PORT})
    spec = settings.pod(workload, NAME, [container])
    return settings.deployment(ctx, NAME, workload, spec, single=True)
