"""The cluster's compute classes: E2 nodes with small boot disks, to fit the regional SSD quota."""

import pulumi
import pulumi_kubernetes as k8s

ON_DEMAND = "small-disk"
SPOT = "small-disk-spot"
# a new project's 250 GB pd-balanced quota fits two default 100 GB boot disks, or eight of these
BOOT_DISK = {"bootDiskType": "pd-balanced", "bootDiskSize": 30}


def class_for(spot: bool) -> str:
    return SPOT if spot else ON_DEMAND


def create(provider: k8s.Provider) -> list[k8s.apiextensions.CustomResource]:
    return [
        k8s.apiextensions.CustomResource(
            name,
            api_version="cloud.google.com/v1",
            kind="ComputeClass",
            metadata=k8s.meta.v1.ObjectMetaArgs(name=name),
            spec={
                "priorities": [{"machineFamily": "e2", "spot": spot, "storage": BOOT_DISK}],
                "nodePoolAutoCreation": {"enabled": True},
                # a node that cannot be made this way is still better than an unscheduled pod
                "whenUnsatisfiable": "ScaleUpAnyway",
            },
            opts=pulumi.ResourceOptions(provider=provider),
        )
        for name, spot in ((ON_DEMAND, False), (SPOT, True))
    ]
