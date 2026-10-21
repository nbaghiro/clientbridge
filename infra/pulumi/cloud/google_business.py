"""Business Profile credential encryption, isolated from Pulumi's state encryption key."""

from collections.abc import Sequence

import pulumi
import pulumi_gcp as gcp

from environments import Environment

APIS = (
    "mybusiness.googleapis.com",
    "mybusinessaccountmanagement.googleapis.com",
    "mybusinessbusinessinformation.googleapis.com",
    "mybusinessverifications.googleapis.com",
    "mybusinessnotifications.googleapis.com",
    "mybusinessplaceactions.googleapis.com",
    "mybusinesslodging.googleapis.com",
    "cloudkms.googleapis.com",
)


def create(
    project: str, region: str, env: Environment, members: Sequence[pulumi.Input[str]]
) -> gcp.kms.CryptoKey:
    ring = gcp.kms.KeyRing(
        f"{env.name}-google-business",
        project=project,
        location=region,
        name=f"{env.name}-google-business",
    )
    key = gcp.kms.CryptoKey(
        f"{env.name}-google-business-tokens",
        key_ring=ring.id,
        name="credentials",
        rotation_period="7776000s",
        opts=pulumi.ResourceOptions(protect=True),
    )
    gcp.kms.CryptoKeyIAMBinding(
        f"{env.name}-google-business-cryptors",
        crypto_key_id=key.id,
        role="roles/cloudkms.cryptoKeyEncrypterDecrypter",
        members=members,
    )
    return key
