"""Set up an environment's mobile app on EAS, Firebase, Apple and Google Play from one env file."""

import argparse
import base64
import json
import os
import secrets
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from bootstrap import use_state
from environments import Environment
from providers_init import Report, read_values
from secrets_init import GoogleCloud, environment

PROGRAM = Path(__file__).resolve().parent
MOBILE = PROGRAM.parents[1] / "frontend" / "apps" / "mobile"
EXPO_GRAPHQL = "https://api.expo.dev/graphql"
APP_STORE_CONNECT = "https://api.appstoreconnect.apple.com/v1"
EXPO_OWNER = "clientbridge-ca"
EXPO_SLUG = "clientbridge"
IAM = "https://iam.googleapis.com/v1"
# the Developer robot that builds, submits and publishes updates; never the cluster's push token
REQUIRED = ("EAS_ROBOT_TOKEN",)
APPLE = (
    "APPLE_TEAM_ID",
    "ASC_API_KEY_ID",
    "ASC_API_ISSUER_ID",
    "ASC_API_KEY_PATH",
    "APNS_KEY_ID",
    "APNS_KEY_PATH",
)


@dataclass(frozen=True)
class Variable:
    id: str
    value: str


@dataclass(frozen=True)
class AndroidCredentials:
    id: str
    fcm_email: str | None
    submit_email: str | None


@dataclass(frozen=True)
class IosCredentials:
    id: str
    push_key: str | None
    asc_key: str | None
    distribution_certificate: bool
    app_store_build: str | None = None  # the App Store build credentials, once they exist


@dataclass(frozen=True)
class Signing:
    """A distribution certificate and its App Store profile, as EAS stores them."""

    certificate_id: str
    p12: str
    password: str
    private_key: str
    profile_id: str
    profile: str


@dataclass(frozen=True)
class Apple:
    team_id: str
    asc_key_id: str
    asc_issuer_id: str
    asc_key: str  # the .p8 contents
    apns_key_id: str
    apns_key: str


class Eas(Protocol):
    def variables(self, environment: str) -> dict[str, Variable]: ...

    def create_variable(self, environment: str, name: str, value: str) -> None: ...

    def update_variable(self, variable: Variable, value: str) -> None: ...

    def android(self, bundle_id: str) -> AndroidCredentials: ...

    def upload_google_key(self, key: str) -> str: ...

    def set_fcm_key(self, credentials: AndroidCredentials, key_id: str) -> None: ...

    def set_submit_key(self, credentials: AndroidCredentials, key_id: str) -> None: ...

    def ios(self, team_id: str, bundle_id: str) -> IosCredentials: ...

    def set_push_key(
        self, credentials: IosCredentials, team_id: str, key_id: str, p8: str
    ) -> None: ...

    def set_asc_key(
        self, credentials: IosCredentials, team_id: str, key_id: str, issuer: str, p8: str
    ) -> None: ...

    def set_signing(
        self, credentials: IosCredentials, team_id: str, bundle_id: str, signing: Signing
    ) -> None: ...


class Developer(Protocol):
    def create_certificate(self, csr: str) -> tuple[str, str]: ...

    def bundle_id(self, identifier: str) -> str: ...

    def create_profile(self, name: str, bundle: str, certificate: str) -> tuple[str, str]: ...


class Keys(Protocol):
    def create_key(self, service_account: str) -> tuple[str, str]: ...

    def delete_key(self, name: str) -> None: ...

    def prune(self, service_account: str, keep: str) -> int: ...


def replace_key(keys: Keys, service_account: str, upload: Callable[[str], None]) -> int:
    """A new key on EAS and no other left in Google Cloud; returns the old keys deleted."""
    name, key = keys.create_key(service_account)
    try:
        upload(key)
    except BaseException:
        keys.delete_key(name)
        raise
    return keys.prune(service_account, name)


def desired_variables(env: Environment, stripe_publishable_key: str) -> dict[str, str]:
    """What app.config.ts reads, identical for the environment's builds and its updates."""
    return {
        "APP_ID": env.mobile.bundle_id,
        "APP_NAME": env.mobile.name,
        "BASE_DOMAIN": env.base_domain,
        "STRIPE_PUBLISHABLE_KEY": stripe_publishable_key,
        "STRIPE_TERMINAL_SIMULATED": "false",
        "TAP_TO_PAY": "true" if env.mobile.tap_to_pay else "false",
    }


def variables(eas: Eas, env: Environment, desired: Mapping[str, str], report: Report) -> None:
    environment_name = env.mobile.eas_environment
    current = eas.variables(environment_name)
    for name, value in desired.items():
        existing = current.get(name)
        if existing is None:
            eas.create_variable(environment_name, name, value)
            report.add(f"eas {environment_name} {name}: created")
        elif existing.value != value:
            eas.update_variable(existing, value)
            report.add(f"eas {environment_name} {name}: updated")
        else:
            report.add(f"eas {environment_name} {name}: kept")


def android(
    eas: Eas,
    keys: Keys,
    env: Environment,
    push_sender: str,
    play_publisher: str,
    report: Report,
) -> None:
    """FCM v1 sends as the push account; Play uploads, for a Play app, as the publisher account."""
    credentials = eas.android(env.mobile.bundle_id)
    if credentials.fcm_email == push_sender:
        report.add(f"eas {env.mobile.bundle_id} FCM key: kept")
    else:
        pruned = replace_key(
            keys, push_sender, lambda key: eas.set_fcm_key(credentials, eas.upload_google_key(key))
        )
        report.add(f"eas {env.mobile.bundle_id} FCM key: created for {push_sender}, {pruned} old")
    if not env.mobile.play_store:
        return
    if credentials.submit_email == play_publisher:
        report.add(f"eas {env.mobile.bundle_id} Play key: kept")
    else:
        pruned = replace_key(
            keys,
            play_publisher,
            lambda key: eas.set_submit_key(credentials, eas.upload_google_key(key)),
        )
        report.add(
            f"eas {env.mobile.bundle_id} Play key: created for {play_publisher}, {pruned} old"
        )


def ios(
    eas: Eas, developer: Developer | None, env: Environment, apple: Apple | None, report: Report
) -> None:
    """The push and App Store Connect keys, and a distribution certificate when EAS has none."""
    if apple is None or developer is None:
        report.add("ios: waiting on the Apple developer account; add the APPLE_ values and rerun")
        return
    credentials = eas.ios(apple.team_id, env.mobile.bundle_id)
    if credentials.push_key == apple.apns_key_id:
        report.add(f"eas {env.mobile.bundle_id} push key: kept")
    else:
        eas.set_push_key(credentials, apple.team_id, apple.apns_key_id, apple.apns_key)
        report.add(f"eas {env.mobile.bundle_id} push key: set to {apple.apns_key_id}")
    if credentials.asc_key == apple.asc_key_id:
        report.add(f"eas {env.mobile.bundle_id} App Store Connect key: kept")
    else:
        eas.set_asc_key(
            credentials, apple.team_id, apple.asc_key_id, apple.asc_issuer_id, apple.asc_key
        )
        report.add(f"eas {env.mobile.bundle_id} App Store Connect key: set to {apple.asc_key_id}")
    if credentials.distribution_certificate:
        report.add(f"eas {env.mobile.bundle_id} distribution certificate: kept")
        return
    created = signing(developer, env.mobile.bundle_id, secrets.token_urlsafe(24))
    eas.set_signing(credentials, apple.team_id, env.mobile.bundle_id, created)
    report.add(
        f"eas {env.mobile.bundle_id} distribution certificate {created.certificate_id} "
        f"and App Store profile {created.profile_id}: created"
    )


def signing(developer: Developer, bundle_id: str, password: str) -> Signing:
    key, csr = signing_request()
    certificate_id, certificate = developer.create_certificate(csr)
    profile_id, profile = developer.create_profile(
        f"{bundle_id} App Store {certificate_id}", developer.bundle_id(bundle_id), certificate_id
    )
    return Signing(
        certificate_id=certificate_id,
        p12=p12(key, certificate, password),
        password=password,
        private_key=key,
        profile_id=profile_id,
        profile=profile,
    )


def _openssl(*args: str, data: bytes | None = None, env: Mapping[str, str] | None = None) -> bytes:
    return subprocess.run(
        ["openssl", *args],
        input=data,
        capture_output=True,
        check=True,
        env={**os.environ, **(env or {})},
    ).stdout


def signing_request() -> tuple[str, str]:
    """A new RSA key and the certificate signing request Apple signs, both PEM."""
    with tempfile.TemporaryDirectory() as directory:
        key = Path(directory) / "key.pem"
        csr = _openssl(
            "req",
            "-new",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-keyout",
            str(key),
            "-subj",
            "/CN=Clientbridge distribution",
        )
        return key.read_text(), csr.decode()


def p12(key: str, certificate: str, password: str) -> str:
    """Apple's DER certificate and its key as a base64 .p12, in the algorithms Keychain reads."""
    with tempfile.TemporaryDirectory() as directory:
        key_path = Path(directory) / "key.pem"
        key_path.write_text(key)
        pem_path = Path(directory) / "certificate.pem"
        pem_path.write_bytes(_openssl("x509", "-inform", "DER", data=base64.b64decode(certificate)))
        exported = _openssl(
            "pkcs12",
            "-export",
            "-inkey",
            str(key_path),
            "-in",
            str(pem_path),
            "-keypbe",
            "PBE-SHA1-3DES",
            "-certpbe",
            "PBE-SHA1-3DES",
            "-macalg",
            "sha1",
            "-passout",
            "env:P12_PASSWORD",
            env={"P12_PASSWORD": password},
        )
        return base64.b64encode(exported).decode()


def raw_signature(der: bytes) -> bytes:
    """An ECDSA signature from DER (a SEQUENCE of r and s) as the 64 bytes ES256 expects."""
    if der[0] != 0x30:
        raise ValueError("not a DER signature")
    raw = b""
    index = 2
    for _ in range(2):
        if der[index] != 0x02:
            raise ValueError("not a DER integer")
        length = der[index + 1]
        value = der[index + 2 : index + 2 + length].lstrip(b"\x00")
        raw += value.rjust(32, b"\x00")
        index += 2 + length
    return raw


def _base64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def asc_token(apple: Apple, now: int) -> str:
    """The App Store Connect API's bearer token, signed with the API key for twenty minutes."""
    header = {"alg": "ES256", "kid": apple.asc_key_id, "typ": "JWT"}
    claims = {
        "iss": apple.asc_issuer_id,
        "iat": now,
        "exp": now + 1200,
        "aud": "appstoreconnect-v1",
    }
    unsigned = ".".join(_base64url(json.dumps(part).encode()) for part in (header, claims))
    with tempfile.TemporaryDirectory() as directory:
        key = Path(directory) / "asc.p8"
        key.write_text(apple.asc_key)
        der = _openssl("dgst", "-sha256", "-sign", str(key), data=unsigned.encode())
    return f"{unsigned}.{_base64url(raw_signature(der))}"


def apple_values(values: Mapping[str, str]) -> Apple | None:
    given = [key for key in APPLE if values.get(key)]
    if not given:
        return None
    missing = [key for key in APPLE if not values.get(key)]
    if missing:
        raise SystemExit(f"the Apple values are incomplete; missing {', '.join(missing)}")
    return Apple(
        team_id=values["APPLE_TEAM_ID"],
        asc_key_id=values["ASC_API_KEY_ID"],
        asc_issuer_id=values["ASC_API_ISSUER_ID"],
        asc_key=Path(values["ASC_API_KEY_PATH"]).expanduser().read_text(),
        apns_key_id=values["APNS_KEY_ID"],
        apns_key=Path(values["APNS_KEY_PATH"]).expanduser().read_text(),
    )


class ExpoApi:
    """EAS's GraphQL API, which its CLI uses too; the CLI has no prompt-free credential commands."""

    def __init__(self, token: str) -> None:
        self.token = token
        found = self._call(
            "query($name: String!) { app { byFullName(fullName: $name) "
            "{ id ownerAccount { id } } } }",
            {"name": f"@{EXPO_OWNER}/{EXPO_SLUG}"},
        )
        app = _dig(found, "app", "byFullName")
        self.app_id = str(app["id"])
        self.account_id = str(_dig(app, "ownerAccount")["id"])

    def _call(self, document: str, variables: Mapping[str, object]) -> dict[str, object]:
        request = urllib.request.Request(
            EXPO_GRAPHQL,
            data=json.dumps({"query": document, "variables": variables}).encode(),
            method="POST",
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
                # EAS's edge refuses urllib's default agent
                "User-Agent": "clientbridge-infra",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                parsed: object = json.loads(response.read())
        except urllib.error.HTTPError as error:
            raise SystemExit(f"EAS answered {error.code}: {error.read().decode()[:2000]}") from None
        if not isinstance(parsed, dict):
            raise SystemExit("EAS answered without a JSON object")
        errors = parsed.get("errors")
        if errors:
            messages = [each.get("message") for each in errors if isinstance(each, dict)]
            raise SystemExit(f"EAS refused the request: {messages}")
        data = parsed.get("data")
        return data if isinstance(data, dict) else {}

    def variables(self, environment: str) -> dict[str, Variable]:
        found = self._call(
            "query($id: String!, $env: EnvironmentVariableEnvironment) { app { byId(appId: $id) "
            "{ environmentVariablesIncludingSensitive(environment: $env) { id name value } } } }",
            {"id": self.app_id, "env": environment},
        )
        listed = _dig(found, "app", "byId").get("environmentVariablesIncludingSensitive")
        entries = (
            [each for each in listed if isinstance(each, dict)] if isinstance(listed, list) else []
        )
        return {
            str(each["name"]): Variable(str(each["id"]), str(each.get("value") or ""))
            for each in entries
        }

    def create_variable(self, environment: str, name: str, value: str) -> None:
        data = {
            "name": name,
            "value": value,
            "environments": [environment],
            "visibility": "PUBLIC",
            "type": "STRING",
        }
        self._call(
            "mutation($data: CreateEnvironmentVariableInput!, $app: ID!) { environmentVariable "
            "{ createEnvironmentVariableForApp(environmentVariableData: $data, appId: $app) "
            "{ id } } }",
            {"data": data, "app": self.app_id},
        )

    def update_variable(self, variable: Variable, value: str) -> None:
        self._call(
            "mutation($data: UpdateEnvironmentVariableInput!) { environmentVariable "
            "{ updateEnvironmentVariable(environmentVariableData: $data) { id } } }",
            {"data": {"id": variable.id, "value": value}},
        )

    def android(self, bundle_id: str) -> AndroidCredentials:
        query = (
            "query($id: String!, $bundle: String!) { app { byId(appId: $id) { "
            "androidAppCredentials(filter: { applicationIdentifier: $bundle }) { id "
            "googleServiceAccountKeyForFcmV1 { clientEmail } "
            "googleServiceAccountKeyForSubmissions { clientEmail } } } } }"
        )
        found = _dig(self._call(query, {"id": self.app_id, "bundle": bundle_id}), "app", "byId")
        listed = found.get("androidAppCredentials")
        if not isinstance(listed, list) or not listed:
            self._call(
                "mutation($app: ID!, $bundle: String!) { androidAppCredentials { "
                "createAndroidAppCredentials(androidAppCredentialsInput: {}, appId: $app, "
                "applicationIdentifier: $bundle) { id } } }",
                {"app": self.app_id, "bundle": bundle_id},
            )
            return self.android(bundle_id)
        each = listed[0] if isinstance(listed[0], dict) else {}
        return AndroidCredentials(
            id=str(each.get("id")),
            fcm_email=_email(each.get("googleServiceAccountKeyForFcmV1")),
            submit_email=_email(each.get("googleServiceAccountKeyForSubmissions")),
        )

    def upload_google_key(self, key: str) -> str:
        created = self._call(
            "mutation($key: JSONObject!, $account: ID!) { googleServiceAccountKey { "
            "createGoogleServiceAccountKey(googleServiceAccountKeyInput: { jsonKey: $key }, "
            "accountId: $account) { id } } }",
            {"key": json.loads(key), "account": self.account_id},
        )
        return str(_dig(created, "googleServiceAccountKey", "createGoogleServiceAccountKey")["id"])

    def set_fcm_key(self, credentials: AndroidCredentials, key_id: str) -> None:
        self._call(
            "mutation($id: ID!, $key: ID!) { androidAppCredentials { "
            "setGoogleServiceAccountKeyForFcmV1(id: $id, googleServiceAccountKeyId: $key) "
            "{ id } } }",
            {"id": credentials.id, "key": key_id},
        )

    def set_submit_key(self, credentials: AndroidCredentials, key_id: str) -> None:
        self._call(
            "mutation($id: ID!, $key: ID!) { androidAppCredentials { "
            "setGoogleServiceAccountKeyForSubmissions(id: $id, googleServiceAccountKeyId: $key) "
            "{ id } } }",
            {"id": credentials.id, "key": key_id},
        )

    def _team(self, team_id: str) -> str:
        found = self._call(
            "query($id: String!, $team: String!) { app { byId(appId: $id) { ownerAccount { "
            "appleTeamsPaginated(first: 1, filter: { appleTeamIdentifier: $team }) "
            "{ edges { node { id } } } } } } }",
            {"id": self.app_id, "team": team_id},
        )
        edges = _dig(found, "app", "byId", "ownerAccount", "appleTeamsPaginated").get("edges")
        if isinstance(edges, list) and edges and isinstance(edges[0], dict):
            return str(_dig(edges[0], "node")["id"])
        created = self._call(
            "mutation($team: String!, $account: ID!) { appleTeam { createAppleTeam("
            "appleTeamInput: { appleTeamIdentifier: $team }, accountId: $account) { id } } }",
            {"team": team_id, "account": self.account_id},
        )
        return str(_dig(created, "appleTeam", "createAppleTeam")["id"])

    def _app_identifier(self, team: str, bundle_id: str) -> str:
        found = self._call(
            "query($id: String!, $bundle: String!) { app { byId(appId: $id) { ownerAccount { "
            "appleAppIdentifiers(bundleIdentifier: $bundle) { id } } } } }",
            {"id": self.app_id, "bundle": bundle_id},
        )
        listed = _dig(found, "app", "byId", "ownerAccount").get("appleAppIdentifiers")
        if isinstance(listed, list) and listed and isinstance(listed[0], dict):
            return str(listed[0]["id"])
        created = self._call(
            "mutation($bundle: String!, $team: ID!, $account: ID!) { appleAppIdentifier { "
            "createAppleAppIdentifier(appleAppIdentifierInput: { bundleIdentifier: $bundle, "
            "appleTeamId: $team }, accountId: $account) { id } } }",
            {"bundle": bundle_id, "team": team, "account": self.account_id},
        )
        return str(_dig(created, "appleAppIdentifier", "createAppleAppIdentifier")["id"])

    def ios(self, team_id: str, bundle_id: str) -> IosCredentials:
        team = self._team(team_id)
        identifier = self._app_identifier(team, bundle_id)
        query = (
            "query($id: String!, $identifier: String!) { app { byId(appId: $id) { "
            "iosAppCredentials(filter: { appleAppIdentifierId: $identifier }) { id "
            "pushKey { keyIdentifier } appStoreConnectApiKeyForSubmissions { keyIdentifier } "
            "iosAppBuildCredentialsList { id iosDistributionType distributionCertificate { id } } "
            "} } } }"
        )
        found = _dig(self._call(query, {"id": self.app_id, "identifier": identifier}), "app")
        listed = _dig(found, "byId").get("iosAppCredentials")
        if not isinstance(listed, list) or not listed:
            self._call(
                "mutation($team: ID!, $app: ID!, $identifier: ID!) { iosAppCredentials { "
                "createIosAppCredentials(iosAppCredentialsInput: { appleTeamId: $team }, "
                "appId: $app, appleAppIdentifierId: $identifier) { id } } }",
                {"team": team, "app": self.app_id, "identifier": identifier},
            )
            return self.ios(team_id, bundle_id)
        each = listed[0] if isinstance(listed[0], dict) else {}
        builds = each.get("iosAppBuildCredentialsList")
        app_store = [
            build
            for build in (builds if isinstance(builds, list) else [])
            if isinstance(build, dict) and build.get("iosDistributionType") == "APP_STORE"
        ]
        return IosCredentials(
            id=str(each.get("id")),
            push_key=_key_identifier(each.get("pushKey")),
            asc_key=_key_identifier(each.get("appStoreConnectApiKeyForSubmissions")),
            distribution_certificate=any(
                build.get("distributionCertificate") for build in app_store
            ),
            app_store_build=str(app_store[0]["id"]) if app_store else None,
        )

    def set_push_key(self, credentials: IosCredentials, team_id: str, key_id: str, p8: str) -> None:
        created = self._call(
            "mutation($input: ApplePushKeyInput!, $account: ID!) { applePushKey { "
            "createApplePushKey(applePushKeyInput: $input, accountId: $account) { id } } }",
            {
                "input": {"keyP8": p8, "keyIdentifier": key_id, "appleTeamId": self._team(team_id)},
                "account": self.account_id,
            },
        )
        self._call(
            "mutation($id: ID!, $key: ID!) { iosAppCredentials { "
            "setPushKey(id: $id, pushKeyId: $key) { id } } }",
            {
                "id": credentials.id,
                "key": _dig(created, "applePushKey", "createApplePushKey")["id"],
            },
        )

    def set_asc_key(
        self, credentials: IosCredentials, team_id: str, key_id: str, issuer: str, p8: str
    ) -> None:
        created = self._call(
            "mutation($input: AppStoreConnectApiKeyInput!, $account: ID!) { "
            "appStoreConnectApiKey { createAppStoreConnectApiKey("
            "appStoreConnectApiKeyInput: $input, accountId: $account) { id } } }",
            {
                "input": {
                    "keyIdentifier": key_id,
                    "issuerIdentifier": issuer,
                    "keyP8": p8,
                    "name": f"clientbridge {key_id}",
                    "appleTeamId": self._team(team_id),
                },
                "account": self.account_id,
            },
        )
        key = _dig(created, "appStoreConnectApiKey", "createAppStoreConnectApiKey")["id"]
        # the same key lets a prompt-free build create provisioning profiles
        self._call(
            "mutation($id: ID!, $input: IosAppCredentialsInput!) { iosAppCredentials { "
            "updateIosAppCredentials(id: $id, iosAppCredentialsInput: $input) { id } } }",
            {
                "id": credentials.id,
                "input": {
                    "appStoreConnectApiKeyForSubmissionsId": key,
                    "appStoreConnectApiKeyForBuildsId": key,
                },
            },
        )

    def set_signing(
        self, credentials: IosCredentials, team_id: str, bundle_id: str, signing: Signing
    ) -> None:
        team = self._team(team_id)
        certificate = self._call(
            "mutation($input: AppleDistributionCertificateInput!, $account: ID!) { "
            "appleDistributionCertificate { createAppleDistributionCertificate("
            "appleDistributionCertificateInput: $input, accountId: $account) { id } } }",
            {
                "input": {
                    "certP12": signing.p12,
                    "certPassword": signing.password,
                    "certPrivateSigningKey": signing.private_key,
                    "developerPortalIdentifier": signing.certificate_id,
                    "appleTeamId": team,
                },
                "account": self.account_id,
            },
        )
        certificate_id = _dig(
            certificate, "appleDistributionCertificate", "createAppleDistributionCertificate"
        )["id"]
        profile = self._call(
            "mutation($input: AppleProvisioningProfileInput!, $account: ID!, $identifier: ID!) { "
            "appleProvisioningProfile { createAppleProvisioningProfile("
            "appleProvisioningProfileInput: $input, accountId: $account, "
            "appleAppIdentifierId: $identifier) { id } } }",
            {
                "input": {
                    "appleProvisioningProfile": signing.profile,
                    "developerPortalIdentifier": signing.profile_id,
                },
                "account": self.account_id,
                "identifier": self._app_identifier(team, bundle_id),
            },
        )
        profile_id = _dig(profile, "appleProvisioningProfile", "createAppleProvisioningProfile")[
            "id"
        ]
        if credentials.app_store_build is None:
            self._call(
                "mutation($input: IosAppBuildCredentialsInput!, $credentials: ID!) { "
                "iosAppBuildCredentials { createIosAppBuildCredentials("
                "iosAppBuildCredentialsInput: $input, iosAppCredentialsId: $credentials) "
                "{ id } } }",
                {
                    "input": {
                        "iosDistributionType": "APP_STORE",
                        "distributionCertificateId": certificate_id,
                        "provisioningProfileId": profile_id,
                    },
                    "credentials": credentials.id,
                },
            )
            return
        self._call(
            "mutation($id: ID!, $certificate: ID!, $profile: ID!) { iosAppBuildCredentials { "
            "setDistributionCertificate(id: $id, distributionCertificateId: $certificate) { id } "
            "setProvisioningProfile(id: $id, provisioningProfileId: $profile) { id } } }",
            {
                "id": credentials.app_store_build,
                "certificate": certificate_id,
                "profile": profile_id,
            },
        )


class AppStoreConnect:
    """The App Store Connect API, signed in with the account's API key."""

    def __init__(self, apple: Apple) -> None:
        self.apple = apple

    def _call(self, method: str, path: str, body: object = None) -> dict[str, object]:
        request = urllib.request.Request(
            f"{APP_STORE_CONNECT}{path}",
            data=None if body is None else json.dumps(body).encode(),
            method=method,
            headers={
                "Authorization": f"Bearer {asc_token(self.apple, int(time.time()))}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                parsed: object = json.loads(response.read())
        except urllib.error.HTTPError as error:
            raise SystemExit(
                f"App Store Connect answered {error.code}: {error.read().decode()[:2000]}"
            ) from None
        if not isinstance(parsed, dict):
            raise SystemExit("App Store Connect answered without a JSON object")
        return {str(key): value for key, value in parsed.items()}

    def create_certificate(self, csr: str) -> tuple[str, str]:
        body = {
            "data": {
                "type": "certificates",
                "attributes": {"certificateType": "IOS_DISTRIBUTION", "csrContent": csr},
            }
        }
        created = _dig(self._call("POST", "/certificates", body), "data")
        return str(created["id"]), str(_dig(created, "attributes")["certificateContent"])

    def bundle_id(self, identifier: str) -> str:
        query = urllib.parse.urlencode({"filter[identifier]": identifier})
        found = self._call("GET", f"/bundleIds?{query}").get("data")
        for each in found if isinstance(found, list) else []:
            if isinstance(each, dict) and _dig(each, "attributes").get("identifier") == identifier:
                return str(each["id"])
        raise SystemExit(f"{identifier} is not registered under Identifiers in the Apple account")

    def create_profile(self, name: str, bundle: str, certificate: str) -> tuple[str, str]:
        body = {
            "data": {
                "type": "profiles",
                "attributes": {"name": name, "profileType": "IOS_APP_STORE"},
                "relationships": {
                    "bundleId": {"data": {"type": "bundleIds", "id": bundle}},
                    "certificates": {"data": [{"type": "certificates", "id": certificate}]},
                },
            }
        }
        created = _dig(self._call("POST", "/profiles", body), "data")
        return str(created["id"]), str(_dig(created, "attributes")["profileContent"])


def _dig(data: Mapping[str, object], *path: str) -> dict[str, object]:
    current: object = data
    for key in path:
        current = current.get(key) if isinstance(current, dict) else None
    if not isinstance(current, dict):
        raise SystemExit(f"the answer has no {'.'.join(path)}")
    return current


def _email(key: object) -> str | None:
    return str(key.get("clientEmail")) if isinstance(key, dict) else None


def _key_identifier(key: object) -> str | None:
    return str(key.get("keyIdentifier")) if isinstance(key, dict) else None


class ServiceAccountKeys(GoogleCloud):
    def _keys(self, service_account: str) -> str:
        return f"{IAM}/projects/{self.project}/serviceAccounts/{service_account}/keys"

    def create_key(self, service_account: str) -> tuple[str, str]:
        created = self._call("POST", self._keys(service_account), {})
        name, data = created.get("name"), created.get("privateKeyData")
        if not isinstance(name, str) or not isinstance(data, str):
            raise SystemExit(f"creating a key for {service_account} returned none")
        return name, base64.b64decode(data).decode()

    def delete_key(self, name: str) -> None:
        self._call("DELETE", f"{IAM}/{name}")

    def prune(self, service_account: str, keep: str) -> int:
        listed = self._call("GET", f"{self._keys(service_account)}?keyTypes=USER_MANAGED").get(
            "keys"
        )
        names = [
            str(each.get("name"))
            for each in (listed if isinstance(listed, list) else [])
            if isinstance(each, dict) and each.get("name") != keep
        ]
        for name in names:
            self.delete_key(name)
        return len(names)


def pulumi_output(*args: str) -> str:
    return subprocess.run(
        ["pulumi", *args], cwd=PROGRAM, check=True, capture_output=True, text=True
    ).stdout.strip()


def github_settings(env: Environment, token: str, platforms: str) -> None:
    """deploy-mobile.yml's token and platforms, only on the environment whose jobs may use them."""
    target = ["--env", env.github_environment]
    # on stdin, so the token stays out of the process list
    subprocess.run(
        ["gh", "secret", "set", "EXPO_TOKEN", *target], input=token, text=True, check=True
    )
    subprocess.run(
        ["gh", "variable", "set", "EAS_PLATFORMS", *target, "--body", platforms], check=True
    )


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env", required=True, choices=["staging", "prod"])
    parser.add_argument("--project", required=True, help="the Google Cloud project id")
    parser.add_argument("--env-file", required=True, type=Path, help="the provider credentials")
    args = parser.parse_args(argv)
    env = environment(str(args.env))
    use_state(str(args.project))
    values = read_values(Path(args.env_file), REQUIRED)
    token = values["EAS_ROBOT_TOKEN"]
    # the cluster holds the push token, so a leaked pod must not be able to publish an update
    if token == values.get("EXPO_ACCESS_TOKEN"):
        raise SystemExit(
            "EAS_ROBOT_TOKEN and EXPO_ACCESS_TOKEN must be two robots; see .env.staging.example"
        )
    apple = apple_values(values)
    shared = json.loads(
        pulumi_output("stack", "output", "environments", "--stack", "cloud", "--json")
    )
    outputs = shared[env.name]
    publisher = pulumi_output("stack", "output", "playPublisher", "--stack", "cloud")
    stripe_key = pulumi_output(
        "config", "get", "--stack", env.name, "clientbridge:stripePublishableKey"
    )
    eas = ExpoApi(token)
    report = Report([])
    variables(eas, env, desired_variables(env, stripe_key), report)
    android(
        eas,
        ServiceAccountKeys(str(args.project)),
        env,
        str(outputs["pushSender"]),
        publisher,
        report,
    )
    ios(eas, None if apple is None else AppStoreConnect(apple), env, apple, report)
    # iOS builds need the Apple account's certificate, so until then only Android ships
    platforms = "android ios" if apple is not None else "android"
    github_settings(env, token, platforms)
    report.add(f"github {env.github_environment} EXPO_TOKEN and EAS_PLATFORMS={platforms}: set")
    print("\n".join(report.lines))


if __name__ == "__main__":
    main()
