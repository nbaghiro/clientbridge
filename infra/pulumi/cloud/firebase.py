"""Firebase on the project for Android push, and the account that uploads to Google Play."""

from collections.abc import Sequence
from dataclasses import dataclass

import pulumi
import pulumi_gcp as gcp

from environments import Environment


@dataclass(frozen=True)
class Push:
    # Expo's push service sends through FCM v1 as this account, with a key mobile_init.py creates
    sender: gcp.serviceaccount.Account
    services_file: pulumi.Output[
        str
    ]  # google-services.json, base64, which the Android build embeds


def create(project: str, envs: Sequence[Environment]) -> dict[str, Push]:
    firebase = gcp.firebase.Project("firebase", project=project)
    pushes: dict[str, Push] = {}
    for env in envs:
        app = gcp.firebase.AndroidApp(
            f"{env.name}-android",
            project=project,
            display_name=env.mobile.name,
            package_name=env.mobile.bundle_id,
            # Firebase never reuses a deleted app's id, so destroying the stack leaves it in place
            deletion_policy="ABANDON",
            opts=pulumi.ResourceOptions(depends_on=[firebase]),
        )
        sender = gcp.serviceaccount.Account(
            f"{env.name}-push",
            account_id=f"cb-{env.name}-push",
            display_name=f"Clientbridge {env.name} push",
        )
        gcp.projects.IAMMember(
            f"{env.name}-push-fcm",
            project=project,
            role="roles/firebasecloudmessaging.admin",
            member=sender.email.apply(lambda email: f"serviceAccount:{email}"),
        )
        config = gcp.firebase.get_android_app_config_output(app_id=app.app_id, project=project)
        pushes[env.name] = Push(sender, config.config_file_contents)
    return pushes


def play_publisher() -> gcp.serviceaccount.Account:
    """Granted release rights in Play Console by hand, since Play has no API for its users."""
    return gcp.serviceaccount.Account(
        "play-publisher", account_id="cb-play-publisher", display_name="Clientbridge Play uploads"
    )
