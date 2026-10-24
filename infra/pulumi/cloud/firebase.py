"""Firebase on the project for Android push, and the account that uploads to Google Play."""

from collections.abc import Sequence
from dataclasses import dataclass

import pulumi
import pulumi_gcp as gcp

from environments import Environment

# what the app's Firebase Messaging client calls to register for push; sending uses the sender
PUSH_APIS = ("fcmregistrations.googleapis.com", "firebaseinstallations.googleapis.com")


@dataclass(frozen=True)
class Push:
    # Expo's push service sends through FCM v1 as this account, with a key mobile_init.py creates
    sender: gcp.serviceaccount.Account
    services_file: pulumi.Output[
        str
    ]  # google-services.json, base64, which the Android build embeds


def create(
    project: str, envs: Sequence[Environment], certs: dict[str, tuple[str, ...]]
) -> dict[str, Push]:
    firebase = gcp.firebase.Project("firebase", project=project)
    pushes: dict[str, Push] = {}
    for env in envs:
        key = _key(env, certs[env.name])
        app = gcp.firebase.AndroidApp(
            f"{env.name}-android",
            project=project,
            display_name=env.mobile.name,
            package_name=env.mobile.bundle_id,
            api_key_id=key.uid,
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


def _key(env: Environment, certs: tuple[str, ...]) -> gcp.projects.ApiKey:
    """The key google-services.json carries, which ships in the app and so is public by design."""
    # Firebase's own key serves any caller and most Firebase APIs; this one serves only push
    return gcp.projects.ApiKey(
        f"{env.name}-android-push",
        name=f"{env.name}-android-push",
        display_name=f"Clientbridge {env.name} Android push",
        restrictions=gcp.projects.ApiKeyRestrictionsArgs(
            api_targets=[
                gcp.projects.ApiKeyRestrictionsApiTargetArgs(service=api) for api in PUSH_APIS
            ],
            android_key_restrictions=gcp.projects.ApiKeyRestrictionsAndroidKeyRestrictionsArgs(
                allowed_applications=[
                    gcp.projects.ApiKeyRestrictionsAndroidKeyRestrictionsAllowedApplicationArgs(
                        package_name=env.mobile.bundle_id, sha1_fingerprint=cert
                    )
                    for cert in certs
                ]
            )
            if certs
            else None,
        ),
    )


def play_publisher() -> gcp.serviceaccount.Account:
    """Granted release rights in Play Console by hand, since Play has no API for its users."""
    return gcp.serviceaccount.Account(
        "play-publisher", account_id="cb-play-publisher", display_name="Clientbridge Play uploads"
    )
