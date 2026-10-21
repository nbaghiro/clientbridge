"""Native sidecars: the Cloud SQL Auth Proxy, and the demo seed's scratch Postgres."""

import pulumi
import pulumi_kubernetes as k8s

from environments import PROXY, SCRATCH
from kubernetes import settings

HEALTH_PORT = 9090
# beside the proxy's 5432, on loopback only, so nothing outside the pod can reach it
SCRATCH_PORT = 5433
SCRATCH_URL = f"postgresql://postgres@127.0.0.1:{SCRATCH_PORT}/scratch"
SCRATCH_DATA = "/var/lib/postgresql/data"
SCRATCH_SOCKETS = "/var/run/postgresql"
# throwaway data: a crash fails the seed, which then copies nothing
SCRATCH_SETTINGS = {
    "port": str(SCRATCH_PORT),
    "listen_addresses": "127.0.0.1",
    "fsync": "off",
    "synchronous_commit": "off",
    "full_page_writes": "off",
    "wal_level": "minimal",
    "max_wal_senders": "0",
    "max_wal_size": "256MB",
}


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


def scratch(image: str) -> tuple[k8s.core.v1.ContainerArgs, list[k8s.core.v1.VolumeArgs]]:
    """An empty Postgres for the pod's lifetime; it trusts loopback logins and holds no secret."""
    volumes = {"scratch-data": SCRATCH_DATA, "scratch-sockets": SCRATCH_SOCKETS}
    container = k8s.core.v1.ContainerArgs(
        name="scratch-postgres",
        image=image,
        restart_policy="Always",
        args=[
            "postgres",
            *(arg for name, value in SCRATCH_SETTINGS.items() for arg in ("-c", f"{name}={value}")),
        ],
        env=[
            k8s.core.v1.EnvVarArgs(name="POSTGRES_HOST_AUTH_METHOD", value="trust"),
            # initdb needs a directory it owns, and the emptyDir's root belongs to root
            k8s.core.v1.EnvVarArgs(name="PGDATA", value=f"{SCRATCH_DATA}/pgdata"),
        ],
        volume_mounts=[
            k8s.core.v1.VolumeMountArgs(name=name, mount_path=path)
            for name, path in volumes.items()
        ],
        resources=settings.resources(SCRATCH),
        security_context=settings.security("postgres", read_only=True),
        startup_probe=k8s.core.v1.ProbeArgs(
            exec_=k8s.core.v1.ExecActionArgs(
                command=["pg_isready", "--host=127.0.0.1", f"--port={SCRATCH_PORT}"]
            ),
            period_seconds=1,
            failure_threshold=60,
        ),
    )
    return container, [
        k8s.core.v1.VolumeArgs(
            name=name, empty_dir=k8s.core.v1.EmptyDirVolumeSourceArgs(size_limit="1Gi")
        )
        for name in volumes
    ]
