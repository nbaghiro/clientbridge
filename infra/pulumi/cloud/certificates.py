"""Certificate Manager wildcard and apex certificates per environment, by DNS authorization."""

from collections.abc import Mapping, Sequence

import pulumi_gcp as gcp

from environments import Environment

MAP = "clientbridge"


def create(
    zones: Mapping[str, gcp.dns.ManagedZone], envs: Sequence[Environment]
) -> gcp.certificatemanager.CertificateMap:
    certificate_map = gcp.certificatemanager.CertificateMap("gateway", name=MAP)
    for index, env in enumerate(envs):
        # one authorization covers the apex and its wildcard, so *.D never needs an HTTP challenge
        authorization = gcp.certificatemanager.DnsAuthorization(
            env.name, name=f"{env.name}-domain", domain=env.base_domain
        )
        record = authorization.dns_resource_records.apply(lambda records: records[0])
        gcp.dns.RecordSet(
            f"{env.name}-certificate-authorization",
            managed_zone=zones[env.name].name,
            name=record.apply(lambda each: each.name or ""),
            type=record.apply(lambda each: each.type or "CNAME"),
            ttl=300,
            rrdatas=[record.apply(lambda each: each.data or "")],
        )
        certificate = gcp.certificatemanager.Certificate(
            env.name,
            name=f"{env.name}-domains",
            scope="DEFAULT",
            managed={
                "domains": [env.base_domain, f"*.{env.base_domain}"],
                "dns_authorizations": [authorization.id],
            },
        )
        for hostname in (env.base_domain, f"*.{env.base_domain}"):
            gcp.certificatemanager.CertificateMapEntry(
                hostname.replace("*", "wildcard"),
                name=hostname.replace("*", "wildcard").replace(".", "-"),
                map=certificate_map.name,
                hostname=hostname,
                certificates=[certificate.id],
            )
        if index == 0:
            # clients that send no SNI get the first environment's certificate
            gcp.certificatemanager.CertificateMapEntry(
                "primary",
                name="primary",
                map=certificate_map.name,
                matcher="PRIMARY",
                certificates=[certificate.id],
            )
    return certificate_map
