"""The Google Cloud APIs the stacks use, enabled before any resource that needs them."""

import pulumi
import pulumi_gcp as gcp

# serviceusage and cloudresourcemanager are enabled by hand first: Pulumi needs them for the rest
APIS = (
    "androidpublisher.googleapis.com",
    "apikeys.googleapis.com",
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "certificatemanager.googleapis.com",
    "clouderrorreporting.googleapis.com",
    "cloudkms.googleapis.com",
    "cloudquotas.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "compute.googleapis.com",
    "container.googleapis.com",
    "dns.googleapis.com",
    "fcm.googleapis.com",
    "fcmregistrations.googleapis.com",
    "firebase.googleapis.com",
    "firebaseinstallations.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "mybusinessaccountmanagement.googleapis.com",
    "mybusinessbusinessinformation.googleapis.com",
    "mybusinesslodging.googleapis.com",
    "mybusinessnotifications.googleapis.com",
    "mybusinessplaceactions.googleapis.com",
    "mybusinessverifications.googleapis.com",
    "secretmanager.googleapis.com",
    "servicenetworking.googleapis.com",
    "serviceusage.googleapis.com",
    "sqladmin.googleapis.com",
    "storage.googleapis.com",
    "sts.googleapis.com",
)

# Google lets a project enable the reviews API only once it approves Business Profile access
AFTER_APPROVAL = ("mybusiness.googleapis.com",)

_SERVICE_TYPE = "gcp:projects/service:Service"


def create(project: str, approved: bool) -> list[gcp.projects.Service]:
    return [
        gcp.projects.Service(
            api.removesuffix(".googleapis.com"),
            project=project,
            service=api,
            # destroying the stack must not switch off APIs other projects or tools rely on
            disable_on_destroy=False,
            disable_dependent_services=False,
        )
        for api in (*APIS, *(AFTER_APPROVAL if approved else ()))
    ]


def require(services: list[gcp.projects.Service]) -> None:
    """Make every later Google Cloud resource in the stack wait for the APIs."""

    def wait(
        args: pulumi.ResourceTransformationArgs,
    ) -> pulumi.ResourceTransformationResult | None:
        if not args.type_.startswith("gcp:") or args.type_ == _SERVICE_TYPE:
            return None
        return pulumi.ResourceTransformationResult(
            props=args.props,
            opts=pulumi.ResourceOptions.merge(
                args.opts, pulumi.ResourceOptions(depends_on=services)
            ),
        )

    pulumi.runtime.register_stack_transformation(wait)
