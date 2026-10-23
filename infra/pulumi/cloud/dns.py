"""One zone per environment: its hosts at the Gateway, its mail records, and the apex's mail."""

from collections.abc import Mapping, Sequence

import pulumi
import pulumi_gcp as gcp

from environments import HOSTS, Environment, Record

TTL = 300
MAIL_TTL = 3600
WWW = "www"  # redirected to the apex by the Gateway
# Google Workspace receives the domain's mail; these are the records it has at the registrar
WORKSPACE_MX = (
    "1 aspmx.l.google.com.",
    "5 alt1.aspmx.l.google.com.",
    "5 alt2.aspmx.l.google.com.",
    "10 alt3.aspmx.l.google.com.",
    "10 alt4.aspmx.l.google.com.",
)
SPF = "v=spf1 include:_spf.google.com ~all"
DMARC = "v=DMARC1; p=none;"
TXT_CHUNK = 255  # the longest string one TXT record string may hold


def zone(env: Environment) -> gcp.dns.ManagedZone:
    return gcp.dns.ManagedZone(
        f"{env.name}-zone",
        name=env.base_domain.replace(".", "-"),
        dns_name=f"{env.base_domain}.",
        visibility="public",
        opts=pulumi.ResourceOptions(protect=True),
    )


def parent(env: Environment, envs: Sequence[Environment]) -> Environment | None:
    """The environment whose zone sits above this one's, as clientbridge.ca does staging's."""
    above = [other for other in envs if env.base_domain.endswith(f".{other.base_domain}")]
    return max(above, key=lambda other: len(other.base_domain)) if above else None


def hosts(managed: gcp.dns.ManagedZone, env: Environment, address: pulumi.Input[str]) -> None:
    named = [*(env.host(host) for host in HOSTS), f"{WWW}.{env.base_domain}"]
    # a wildcard stops at a delegated zone, so production's does not answer for staging's names
    for resource, name in [
        *((name, name) for name in named),
        (f"pages.{env.base_domain}", env.pages),
    ]:
        gcp.dns.RecordSet(
            resource,
            managed_zone=managed.name,
            name=f"{name}.",
            type="A",
            ttl=TTL,
            rrdatas=[address],
        )


def delegate(parent: gcp.dns.ManagedZone, child: gcp.dns.ManagedZone, domain: str) -> None:
    """Hands a subdomain such as staging. to its own zone from the zone above it."""
    gcp.dns.RecordSet(
        f"{domain}-ns",
        managed_zone=parent.name,
        name=f"{domain}.",
        type="NS",
        ttl=MAIL_TTL,
        rrdatas=child.name_servers,
    )


def txt(value: str) -> str:
    """One TXT record value as Cloud DNS takes it: quoted strings of at most 255 characters."""
    chunks = [value[i : i + TXT_CHUNK] for i in range(0, len(value), TXT_CHUNK)] or [""]
    return " ".join(f'"{chunk}"' for chunk in chunks)


def mail(
    managed: gcp.dns.ManagedZone,
    env: Environment,
    records: Mapping[str, Sequence[Record]],
    *,
    apex: bool,
) -> None:
    """The environment's Resend records, and on the registered domain Workspace's MX, SPF, DMARC."""
    if apex:
        _record(managed, env.base_domain, "MX", list(WORKSPACE_MX))
        _record(managed, env.base_domain, "TXT", [txt(SPF)])
        _record(managed, f"_dmarc.{env.base_domain}", "TXT", [txt(DMARC)])
    for record in records.get(env.name, ()):
        data = [txt(each) if record.type == "TXT" else each for each in record.data]
        _record(managed, f"{record.name}.{env.base_domain}", record.type, data)


def _record(managed: gcp.dns.ManagedZone, name: str, kind: str, data: list[str]) -> None:
    gcp.dns.RecordSet(
        f"{name}-{kind.lower()}",
        managed_zone=managed.name,
        name=f"{name}.",
        type=kind,
        ttl=MAIL_TTL,
        rrdatas=data,
    )
