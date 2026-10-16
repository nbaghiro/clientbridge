"""Secret Manager containers per environment and who may read them; Pulumi holds no value."""

from collections.abc import Mapping, Sequence

import pulumi
import pulumi_gcp as gcp

from environments import Environment


def secret_id(env: Environment, name: str) -> str:
    return f"{env.name}-{name.lower().replace('_', '-')}"


def create(
    region: str,
    env: Environment,
    names: Sequence[str],
    readers: Mapping[str, Sequence[pulumi.Output[str]]],
) -> dict[str, gcp.secretmanager.Secret]:
    """Empty secrets: secrets_init.py adds the generated versions and a person the provided ones."""
    unknown = set(readers) - set(names)
    if unknown:
        raise ValueError(f"secrets outside the catalog: {', '.join(sorted(unknown))}")
    secrets: dict[str, gcp.secretmanager.Secret] = {}
    for name in names:
        key = secret_id(env, name)
        secret = gcp.secretmanager.Secret(
            key,
            secret_id=key,
            labels={"environment": env.name},
            replication={"user_managed": {"replicas": [{"location": region}]}},
        )
        members = readers.get(name, ())
        if members:
            # authoritative, so a reader removed here loses access on the next run
            gcp.secretmanager.SecretIamBinding(
                key,
                secret_id=secret.id,
                role="roles/secretmanager.secretAccessor",
                members=list(members),
            )
        secrets[name] = secret
    return secrets
