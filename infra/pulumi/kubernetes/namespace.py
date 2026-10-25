"""The cluster provider, each environment's namespace and deploy Role, its accounts and policies."""

import json
from collections.abc import Mapping, Sequence

import pulumi
import pulumi_kubernetes as k8s

from environments import (
    API_PORT,
    AUTH_ADMIN_PORT,
    AUTH_PUBLIC_PORT,
    POWERSYNC_PORT,
    REDIS_PORT,
    WEB_PORT,
    Environment,
)

UNBOUND_ACCOUNTS = ("web", "redis")  # workloads that call no Google API
DEPLOY_ROLE = "deployer"
# everything an environment stack applies or waits on, and nothing outside its namespace
DEPLOY_RULES: tuple[tuple[str, tuple[str, ...], tuple[str, ...]], ...] = (
    ("", ("services", "serviceaccounts", "configmaps"), ("*",)),
    # Pulumi waits on a Deployment by watching its pods and their volume claims
    ("", ("pods", "events", "endpoints", "persistentvolumeclaims"), ("get", "list", "watch")),
    ("", ("pods/log",), ("get",)),  # why a migrate Job failed, in the deploy's log
    ("apps", ("deployments",), ("*",)),
    ("apps", ("replicasets",), ("get", "list", "watch")),
    ("batch", ("jobs", "cronjobs"), ("*",)),
    ("policy", ("poddisruptionbudgets",), ("*",)),
    ("discovery.k8s.io", ("endpointslices",), ("get", "list", "watch")),
    ("networking.k8s.io", ("networkpolicies",), ("*",)),
    ("gateway.networking.k8s.io", ("httproutes",), ("*",)),
    ("networking.gke.io", ("healthcheckpolicies", "gcpbackendpolicies"), ("*",)),
    ("secrets-store.csi.x-k8s.io", ("secretproviderclasses",), ("*",)),
)


def provider(name: str, endpoint: pulumi.Input[str]) -> k8s.Provider:
    """Reach the control plane through its DNS endpoint, authenticated by gke-gcloud-auth-plugin."""
    kubeconfig = pulumi.Output.from_input(endpoint).apply(
        lambda host: json.dumps(
            {
                "apiVersion": "v1",
                "kind": "Config",
                "clusters": [{"name": "gke", "cluster": {"server": f"https://{host}"}}],
                "users": [
                    {
                        "name": "gke",
                        "user": {
                            "exec": {
                                "apiVersion": "client.authentication.k8s.io/v1beta1",
                                "command": "gke-gcloud-auth-plugin",
                                "provideClusterInfo": True,
                                "interactiveMode": "Never",
                                "installHint": "gcloud components install gke-gcloud-auth-plugin",
                            }
                        },
                    }
                ],
                "contexts": [{"name": "gke", "context": {"cluster": "gke", "user": "gke"}}],
                "current-context": "gke",
            }
        )
    )
    # it holds no credential (the exec plugin authenticates), so it is not marked secret
    return k8s.Provider(name, kubeconfig=kubeconfig)


def create(
    env: Environment, deployer: pulumi.Input[str], provider: k8s.Provider
) -> k8s.core.v1.Namespace:
    """The namespace, and a Role that lets only its own CI deployer change what is inside it."""
    namespace = k8s.core.v1.Namespace(
        env.namespace,
        metadata=k8s.meta.v1.ObjectMetaArgs(
            name=env.namespace,
            labels={"clientbridge.ca/environment": env.name},
        ),
        opts=pulumi.ResourceOptions(provider=provider),
    )
    scoped = pulumi.ResourceOptions(provider=provider, depends_on=[namespace])
    k8s.rbac.v1.Role(
        f"{env.name}-{DEPLOY_ROLE}",
        metadata=k8s.meta.v1.ObjectMetaArgs(name=DEPLOY_ROLE, namespace=env.namespace),
        rules=[
            k8s.rbac.v1.PolicyRuleArgs(
                api_groups=[group], resources=list(resources), verbs=list(verbs)
            )
            for group, resources, verbs in DEPLOY_RULES
        ],
        opts=scoped,
    )
    k8s.rbac.v1.RoleBinding(
        f"{env.name}-{DEPLOY_ROLE}",
        metadata=k8s.meta.v1.ObjectMetaArgs(name=DEPLOY_ROLE, namespace=env.namespace),
        role_ref=k8s.rbac.v1.RoleRefArgs(
            api_group="rbac.authorization.k8s.io", kind="Role", name=DEPLOY_ROLE
        ),
        # GKE names a Google service account by its email
        subjects=[
            k8s.rbac.v1.SubjectArgs(
                kind="User", name=deployer, api_group="rbac.authorization.k8s.io"
            )
        ],
        opts=scoped,
    )
    return namespace


def scaffolding(
    env: Environment, accounts: Mapping[str, pulumi.Input[str]], provider: k8s.Provider
) -> list[pulumi.Resource]:
    """What the pods need first: their service accounts and the network policies."""
    options = pulumi.ResourceOptions(provider=provider)
    created: list[pulumi.Resource] = []
    for name, email in accounts.items():
        created.append(
            k8s.core.v1.ServiceAccount(
                f"{env.name}-{name}",
                metadata=k8s.meta.v1.ObjectMetaArgs(
                    name=name,
                    namespace=env.namespace,
                    annotations={"iam.gke.io/gcp-service-account": email},
                ),
                automount_service_account_token=False,
                opts=options,
            )
        )
    for name in UNBOUND_ACCOUNTS:
        created.append(
            k8s.core.v1.ServiceAccount(
                f"{env.name}-{name}",
                metadata=k8s.meta.v1.ObjectMetaArgs(name=name, namespace=env.namespace),
                automount_service_account_token=False,
                opts=options,
            )
        )
    created.extend(_policies(env, options))
    return created


def _policies(env: Environment, options: pulumi.ResourceOptions) -> list[pulumi.Resource]:
    created: list[pulumi.Resource] = []

    def policy(
        name: str, app: str | None, rules: Sequence[k8s.networking.v1.NetworkPolicyIngressRuleArgs]
    ) -> None:
        created.append(
            k8s.networking.v1.NetworkPolicy(
                f"{env.name}-{name}",
                metadata=k8s.meta.v1.ObjectMetaArgs(name=name, namespace=env.namespace),
                spec=k8s.networking.v1.NetworkPolicySpecArgs(
                    pod_selector=k8s.meta.v1.LabelSelectorArgs(
                        match_labels={"app": app} if app else None
                    ),
                    policy_types=["Ingress"],
                    ingress=list(rules),
                ),
                opts=options,
            )
        )

    def ports(*numbers: int) -> list[k8s.networking.v1.NetworkPolicyPortArgs]:
        return [
            k8s.networking.v1.NetworkPolicyPortArgs(port=number, protocol="TCP")
            for number in numbers
        ]

    def from_apps(*apps: str) -> list[k8s.networking.v1.NetworkPolicyPeerArgs]:
        return [
            k8s.networking.v1.NetworkPolicyPeerArgs(
                pod_selector=k8s.meta.v1.LabelSelectorArgs(match_labels={"app": app})
            )
            for app in apps
        ]

    policy("default-deny", None, [])
    # behind the Gateway, whose load balancer reaches pods from Google's front-end ranges
    for app, port in (("api", API_PORT), ("web", WEB_PORT), ("powersync", POWERSYNC_PORT)):
        policy(
            f"{app}-public",
            app,
            [k8s.networking.v1.NetworkPolicyIngressRuleArgs(ports=ports(port))],
        )
    policy(
        "auth",
        "auth",
        [
            k8s.networking.v1.NetworkPolicyIngressRuleArgs(ports=ports(AUTH_PUBLIC_PORT)),
            # the admin API manages identities and sessions: the backend, and staging's demo seed
            k8s.networking.v1.NetworkPolicyIngressRuleArgs(
                ports=ports(AUTH_ADMIN_PORT),
                from_=from_apps("api", "worker", *(["seed"] if env.demo else [])),
            ),
        ],
    )
    policy(
        "redis",
        "redis",
        [
            k8s.networking.v1.NetworkPolicyIngressRuleArgs(
                ports=ports(REDIS_PORT), from_=from_apps("api", "worker")
            )
        ],
    )
    return created
