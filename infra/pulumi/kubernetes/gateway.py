"""One global external Gateway on a static IP for both environments, and an HTTPRoute per host."""

from collections.abc import Sequence

import pulumi
import pulumi_gcp as gcp
import pulumi_kubernetes as k8s

from environments import (
    API_PORT,
    AUTH_PUBLIC_PORT,
    HOSTS,
    POWERSYNC_PORT,
    WEB_PORT,
    Environment,
    Host,
)
from kubernetes import settings

NAMESPACE = "gateway"
NAME = "clientbridge"
SYNC_TIMEOUT_SECONDS = 3600  # PowerSync streams stay open; the default 30 seconds would cut them
# each host's Service: the web image serves the site, app and Connect hosts by Host header
BACKENDS: dict[Host, tuple[str, int]] = {
    "site": ("web", WEB_PORT),
    "app": ("web", WEB_PORT),
    "admin": ("web", WEB_PORT),
    "book": ("web", WEB_PORT),
    "pay": ("web", WEB_PORT),
    "shop": ("web", WEB_PORT),
    "api": ("api", API_PORT),
    "sync": ("powersync", POWERSYNC_PORT),
}
# the load balancer's own health checks, which do not read the pods' readiness probes
HEALTH_CHECKS: dict[str, tuple[int, str]] = {
    "api": (API_PORT, "/health"),
    "auth": (AUTH_PUBLIC_PORT, "/health/ready"),
    "web": (WEB_PORT, "/robots.txt"),
    "powersync": (POWERSYNC_PORT, "/probes/liveness"),
}


def address() -> gcp.compute.GlobalAddress:
    return gcp.compute.GlobalAddress("gateway", address_type="EXTERNAL", ip_version="IPV4")


def section(env: Environment, host: str) -> str:
    return f"{env.name}-{host}"


def _only(namespace_name: str) -> dict[str, object]:
    # Kubernetes sets this label to the namespace's name, so no other namespace can claim it
    return {
        "namespaces": {
            "from": "Selector",
            "selector": {"matchLabels": {"kubernetes.io/metadata.name": namespace_name}},
        }
    }


def listener(env: Environment, host: Host) -> dict[str, object]:
    """One host of one environment, taking routes only from that environment's namespace."""
    return {
        "name": section(env, host),
        "protocol": "HTTPS",
        "port": 443,
        "hostname": env.host(host),
        "allowedRoutes": _only(env.namespace),
    }


def redirect_listener(env: Environment) -> dict[str, object]:
    return {
        "name": section(env, "www"),
        "protocol": "HTTPS",
        "port": 443,
        "hostname": f"www.{env.base_domain}",
        "allowedRoutes": _only(NAMESPACE),
    }


def create(
    ip: gcp.compute.GlobalAddress,
    certificate_map: gcp.certificatemanager.CertificateMap,
    provider: k8s.Provider,
    envs: Sequence[Environment],
) -> k8s.apiextensions.CustomResource:
    options = pulumi.ResourceOptions(provider=provider)
    edge = k8s.core.v1.Namespace(
        NAMESPACE, metadata=k8s.meta.v1.ObjectMetaArgs(name=NAMESPACE), opts=options
    )
    scoped = pulumi.ResourceOptions(provider=provider, depends_on=[edge])
    gateway = k8s.apiextensions.CustomResource(
        NAME,
        api_version="gateway.networking.k8s.io/v1",
        kind="Gateway",
        metadata=k8s.meta.v1.ObjectMetaArgs(
            name=NAME,
            namespace=NAMESPACE,
            annotations={"networking.gke.io/certmap": certificate_map.name},
        ),
        spec={
            "gatewayClassName": "gke-l7-global-external-managed",
            "addresses": [{"type": "NamedAddress", "value": ip.name}],
            "listeners": [
                *(listener(env, host) for env in envs for host in HOSTS),
                *(redirect_listener(env) for env in envs),
                {
                    "name": "http",
                    "protocol": "HTTP",
                    "port": 80,
                    "allowedRoutes": {"namespaces": {"from": "Same"}},
                },
            ],
        },
        opts=scoped,
    )
    k8s.apiextensions.CustomResource(
        "https-redirect",
        api_version="gateway.networking.k8s.io/v1",
        kind="HTTPRoute",
        metadata=k8s.meta.v1.ObjectMetaArgs(name="https-redirect", namespace=NAMESPACE),
        spec={
            "parentRefs": [{"name": NAME, "sectionName": "http"}],
            "rules": [
                {
                    "filters": [
                        {
                            "type": "RequestRedirect",
                            "requestRedirect": {"scheme": "https", "statusCode": 301},
                        }
                    ]
                }
            ],
        },
        opts=pulumi.ResourceOptions(provider=provider, depends_on=[gateway]),
    )
    for env in envs:
        k8s.apiextensions.CustomResource(
            f"{env.name}-www-redirect",
            api_version="gateway.networking.k8s.io/v1",
            kind="HTTPRoute",
            metadata=k8s.meta.v1.ObjectMetaArgs(name=f"{env.name}-www", namespace=NAMESPACE),
            spec={
                "parentRefs": [{"name": NAME, "sectionName": section(env, "www")}],
                "hostnames": [f"www.{env.base_domain}"],
                "rules": [
                    {
                        "filters": [
                            {
                                "type": "RequestRedirect",
                                "requestRedirect": {
                                    "scheme": "https",
                                    "hostname": env.base_domain,
                                    "statusCode": 301,
                                },
                            }
                        ]
                    }
                ],
            },
            opts=pulumi.ResourceOptions(provider=provider, depends_on=[gateway]),
        )
    return gateway


def routes(env: Environment, provider: k8s.Provider, depends_on: list[pulumi.Resource]) -> None:
    """The environment's routes on the cloud stack's Gateway, which they name by namespace."""
    options = pulumi.ResourceOptions(provider=provider, depends_on=depends_on)
    for host in HOSTS:
        parent = [{"name": NAME, "namespace": NAMESPACE, "sectionName": section(env, host)}]
        service, port = BACKENDS[host]
        rules: list[dict[str, object]] = []
        if host == "api":
            # only the auth prefix is rewritten; API paths stay intact for webhook signatures
            rules.append(
                {
                    "matches": [{"path": {"type": "PathPrefix", "value": settings.AUTH_PREFIX}}],
                    "filters": [
                        {
                            "type": "URLRewrite",
                            "urlRewrite": {
                                "path": {"type": "ReplacePrefixMatch", "replacePrefixMatch": "/"}
                            },
                        }
                    ],
                    "backendRefs": [{"name": "auth", "port": AUTH_PUBLIC_PORT}],
                }
            )
        if host == "site":
            rules.append(
                {
                    "matches": [{"path": {"type": "Exact", "value": "/contact"}, "method": "POST"}],
                    "backendRefs": [{"name": "api", "port": API_PORT}],
                }
            )
        rules.append({"backendRefs": [{"name": service, "port": port}]})
        k8s.apiextensions.CustomResource(
            f"{env.name}-{host}",
            api_version="gateway.networking.k8s.io/v1",
            kind="HTTPRoute",
            metadata=k8s.meta.v1.ObjectMetaArgs(name=host, namespace=env.namespace),
            spec={"parentRefs": parent, "hostnames": [env.host(host)], "rules": rules},
            opts=options,
        )
    for service, (port, path) in HEALTH_CHECKS.items():
        k8s.apiextensions.CustomResource(
            f"{env.name}-{service}-health",
            api_version="networking.gke.io/v1",
            kind="HealthCheckPolicy",
            metadata=k8s.meta.v1.ObjectMetaArgs(name=service, namespace=env.namespace),
            spec={
                "default": {
                    "config": {
                        "type": "HTTP",
                        "httpHealthCheck": {
                            "portSpecification": "USE_FIXED_PORT",
                            "port": port,
                            "requestPath": path,
                        },
                    }
                },
                "targetRef": {"group": "", "kind": "Service", "name": service},
            },
            opts=options,
        )
    k8s.apiextensions.CustomResource(
        f"{env.name}-sync-timeout",
        api_version="networking.gke.io/v1",
        kind="GCPBackendPolicy",
        metadata=k8s.meta.v1.ObjectMetaArgs(name="powersync", namespace=env.namespace),
        spec={
            "default": {"timeoutSec": SYNC_TIMEOUT_SECONDS},
            "targetRef": {"group": "", "kind": "Service", "name": "powersync"},
        },
        opts=options,
    )
