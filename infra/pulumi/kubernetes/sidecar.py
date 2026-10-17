"""The Cloud SQL Auth Proxy as a native sidecar, authenticated by the pod's Workload Identity."""

import pulumi
import pulumi_kubernetes as k8s

from environments import PROXY
from kubernetes import settings

HEALTH_PORT = 9090


def proxy(image: str, connection_name: pulumi.Input[str]) -> k8s.core.v1.ContainerArgs:
    # an init container with restartPolicy Always starts first and stops after the app containers
    return k8s.core.v1.ContainerArgs(
        name="cloud-sql-proxy",
        image=image,
        restart_policy="Always",
        args=pulumi.Output.from_input(connection_name).apply(
            lambda name: [
                "--private-ip",
                "--port=5432",
                "--structured-logs",
                "--health-check",
                "--http-address=0.0.0.0",
                f"--http-port={HEALTH_PORT}",
                "--exit-zero-on-sigterm",
                name,
            ]
        ),
        resources=settings.resources(PROXY),
        security_context=settings.security("proxy", read_only=True),
        startup_probe=k8s.core.v1.ProbeArgs(
            http_get=k8s.core.v1.HTTPGetActionArgs(path="/startup", port=HEALTH_PORT),
            period_seconds=1,
            failure_threshold=60,
        ),
        liveness_probe=k8s.core.v1.ProbeArgs(
            http_get=k8s.core.v1.HTTPGetActionArgs(path="/liveness", port=HEALTH_PORT),
            period_seconds=10,
        ),
    )
