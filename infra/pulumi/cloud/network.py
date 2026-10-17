"""The VPC, its subnet with the cluster's ranges, private service access for Cloud SQL and NAT."""

from dataclasses import dataclass

import pulumi_gcp as gcp

from environments import SERVED_PORTS

NODES = "10.10.0.0/20"
PODS = "10.16.0.0/14"
SERVICES = "10.20.0.0/20"
PODS_RANGE = "pods"
SERVICES_RANGE = "services"
# where Google's load balancers and their health checks reach pods from
GOOGLE_FRONT_ENDS = ("35.191.0.0/16", "130.211.0.0/22")


@dataclass(frozen=True)
class Network:
    vpc: gcp.compute.Network
    subnet: gcp.compute.Subnetwork
    private_services: gcp.servicenetworking.Connection


def create(region: str) -> Network:
    vpc = gcp.compute.Network(
        "clientbridge", auto_create_subnetworks=False, routing_mode="REGIONAL"
    )
    subnet = gcp.compute.Subnetwork(
        "clientbridge",
        network=vpc.id,
        region=region,
        ip_cidr_range=NODES,
        private_ip_google_access=True,
        secondary_ip_ranges=[
            {"range_name": PODS_RANGE, "ip_cidr_range": PODS},
            {"range_name": SERVICES_RANGE, "ip_cidr_range": SERVICES},
        ],
    )
    peering_range = gcp.compute.GlobalAddress(
        "private-services",
        network=vpc.id,
        purpose="VPC_PEERING",
        address_type="INTERNAL",
        prefix_length=20,
    )
    private_services = gcp.servicenetworking.Connection(
        "private-services",
        network=vpc.id,
        service="servicenetworking.googleapis.com",
        reserved_peering_ranges=[peering_range.name],
    )
    router = gcp.compute.Router("clientbridge", network=vpc.id, region=region)
    # outbound calls to Stripe, Twilio, Resend and Expo leave the private nodes through NAT
    gcp.compute.RouterNat(
        "clientbridge",
        router=router.name,
        region=region,
        nat_ip_allocate_option="AUTO_ONLY",
        source_subnetwork_ip_ranges_to_nat="ALL_SUBNETWORKS_ALL_IP_RANGES",
        log_config={"enable": True, "filter": "ERRORS_ONLY"},
    )
    gcp.compute.Firewall(
        "load-balancer-to-pods",
        network=vpc.id,
        direction="INGRESS",
        source_ranges=list(GOOGLE_FRONT_ENDS),
        destination_ranges=[PODS],
        allows=[{"protocol": "tcp", "ports": sorted({str(port) for port in SERVED_PORTS})}],
    )
    return Network(vpc=vpc, subnet=subnet, private_services=private_services)
