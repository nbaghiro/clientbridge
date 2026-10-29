"""Production and staging: what differs between them, and the stack's configuration."""

import re
from dataclasses import dataclass
from typing import Literal

import pulumi

Name = Literal["prod", "staging"]
Host = Literal["site", "app", "admin", "book", "pay", "shop", "api", "sync"]
HOSTS: tuple[Host, ...] = ("site", "app", "admin", "book", "pay", "shop", "api", "sync")


@dataclass(frozen=True)
class Size:
    cpu: str
    memory: str


@dataclass(frozen=True)
class Workload:
    size: Size
    spot: bool
    replicas: int = 1


@dataclass(frozen=True)
class Mobile:
    """The environment's app: its store identity, EAS build profile and update channel."""

    bundle_id: str  # the iOS bundle id and the Android package
    name: str
    channel: str  # the eas.json build profile and the EAS Update channel, by the same name
    eas_environment: Literal["preview", "production"]  # where its EAS variables live
    # whether its Android build goes to Google Play; staging's installs from an EAS link instead
    play_store: bool
    # Apple grants the Tap to Pay entitlement on request; the build adds it once this is set
    tap_to_pay: bool


@dataclass(frozen=True)
class Environment:
    name: Name  # the backend's ENV
    base_domain: str
    namespace: str
    # databases and roles share one instance, so each environment's names carry its own prefix
    prefix: str
    web_environment: str  # the web image's ENVIRONMENT; only "production" allows indexing
    github_environment: str  # the GitHub environment whose jobs may deploy it
    api: Workload
    worker: Workload
    migrate: Workload
    auth: Workload
    powersync: Workload
    web: Workload
    redis: Workload
    # staging's migrate pod runs on Spot and its steps are idempotent; a failed prod run stops
    migrate_retries: int
    # the nightly demo seed's size where the environment seeds the demo businesses
    demo: Workload | None
    mobile: Mobile

    def host(self, host: Host) -> str:
        return self.base_domain if host == "site" else f"{host}.{self.base_domain}"

    def url(self, host: Host) -> str:
        return f"https://{self.host(host)}"

    @property
    def pages(self) -> str:
        """Every business's public page, a subdomain named by its slug."""
        return f"*.{self.base_domain}"


# the ports the images listen on: backend/Dockerfile, frontend/Dockerfile and the upstream images
API_PORT = 8701
WEB_PORT = 8080
AUTH_PUBLIC_PORT = 4433
AUTH_ADMIN_PORT = 4434
POWERSYNC_PORT = 8080
REDIS_PORT = 6379
SERVED_PORTS = (API_PORT, WEB_PORT, AUTH_PUBLIC_PORT, POWERSYNC_PORT)

PROXY = Size(
    "50m", "128Mi"
)  # the Cloud SQL Auth Proxy sidecar in every pod that reaches the database
# the demo seed's own Postgres; one core keeps the seed pod inside one existing node
SCRATCH = Size("1", "2Gi")


def build(prod_domain: str, staging_domain: str) -> tuple[Environment, Environment]:
    # two of each served workload, so a node upgrade evicting one pod drops no request
    prod = Environment(
        name="prod",
        base_domain=prod_domain,
        namespace="prod",
        prefix="",
        web_environment="production",
        github_environment="production",
        api=Workload(Size("500m", "1Gi"), spot=False, replicas=2),
        # each job commits after every send, so a preempted run resends nothing
        worker=Workload(Size("250m", "512Mi"), spot=True),
        migrate=Workload(Size("250m", "512Mi"), spot=False),
        auth=Workload(Size("100m", "256Mi"), spot=False, replicas=2),
        powersync=Workload(Size("250m", "768Mi"), spot=False),
        web=Workload(Size("100m", "256Mi"), spot=False, replicas=2),
        redis=Workload(Size("50m", "128Mi"), spot=False),
        migrate_retries=0,
        demo=None,
        mobile=Mobile(
            bundle_id="ca.clientbridge.app",
            name="Clientbridge",
            channel="production",
            eas_environment="production",
            play_store=True,
            tap_to_pay=False,
        ),
    )
    staging = Environment(
        name="staging",
        base_domain=staging_domain,
        namespace="staging",
        prefix="staging_",
        web_environment="staging",
        github_environment="staging",
        api=Workload(Size("250m", "512Mi"), spot=True),
        worker=Workload(Size("250m", "512Mi"), spot=True),
        migrate=Workload(Size("250m", "512Mi"), spot=True),
        auth=Workload(Size("100m", "256Mi"), spot=True),
        powersync=Workload(Size("250m", "768Mi"), spot=True),
        web=Workload(Size("100m", "256Mi"), spot=True),
        redis=Workload(Size("50m", "128Mi"), spot=True),
        migrate_retries=2,
        # the seed holds every business's graph (about 300 MB) and two writers of one each (200 MB)
        demo=Workload(Size("1", "2Gi"), spot=True),
        # a separate app, so testers keep it beside the store one
        mobile=Mobile(
            bundle_id="ca.clientbridge.app.staging",
            name="Clientbridge Staging",
            channel="staging",
            eas_environment="preview",
            play_store=False,
            tap_to_pay=False,
        ),
    )
    return prod, staging


CLOUD_STACK = "cloud"


def environments() -> tuple[Environment, Environment]:
    config = pulumi.Config()
    return build(config.require("prodBaseDomain"), config.require("stagingBaseDomain"))


RecordType = Literal["CNAME", "MX", "TXT"]
RECORD_TYPES: tuple[RecordType, ...] = ("CNAME", "MX", "TXT")


@dataclass(frozen=True)
class Record:
    """A mail record a provider issues (Resend's DKIM and return path), under one base domain."""

    name: str  # relative to the environment's base domain, such as resend._domainkey or send
    type: RecordType
    data: tuple[str, ...]


@dataclass(frozen=True)
class StripeSandbox:
    """The Stripe test platform's keys, for the real-Stripe runs; the merchants are in the pool."""

    secret_key: pulumi.Output[str]
    publishable_key: pulumi.Output[str]


STRIPE_SANDBOX_SECRETS = ("stripeTestSecretKey", "stripeTestPublishableKey")


def stripe_test_key(value: str, prefixes: tuple[str, ...], name: str) -> str:
    if not value.startswith(prefixes):
        raise ValueError(f"clientbridge:{name} must be a Stripe test-mode key: {prefixes}")
    return value


def stripe_sandbox(config: pulumi.Config) -> StripeSandbox | None:
    """None until both keys are set, so the secrets appear in one deliberate change."""
    secret, publishable = (config.get_secret(name) for name in STRIPE_SANDBOX_SECRETS)
    if secret is None and publishable is None:
        return None
    if secret is None or publishable is None:
        raise ValueError(
            f"the Stripe sandbox needs both keys: clientbridge:{STRIPE_SANDBOX_SECRETS}"
        )
    return StripeSandbox(
        secret_key=secret.apply(
            lambda v: stripe_test_key(v, ("sk_test_", "rk_test_"), "stripeTestSecretKey")
        ),
        publishable_key=publishable.apply(
            lambda v: stripe_test_key(v, ("pk_test_",), "stripeTestPublishableKey")
        ),
    )


@dataclass(frozen=True)
class Cloud:
    """The cloud stack: everything both environments share, applied by an administrator."""

    project: str
    region: str
    database_zone: str
    github_repository: str
    alert_email: str
    billing_account: str
    budget_amount: str
    budget_currency: str
    # the environments this project runs; production joins with one config change
    environments: tuple[Environment, ...]
    mail_records: dict[str, tuple[Record, ...]]  # by environment name
    # SHA-1 of each environment's Android signing certificates, the only apps its push key serves
    signing_certs: dict[str, tuple[str, ...]]
    state_bucket: str  # the Pulumi state bucket and KMS key the bootstrap created
    state_key: str
    github_reviewer: str  # the GitHub user who approves production deploys
    stripe_sandbox: StripeSandbox | None  # the Stripe test keys Actions reads, once configured


def load_cloud() -> Cloud:
    config = pulumi.Config()
    gcp = pulumi.Config("gcp")
    # the Billing Budgets API refuses user credentials unless a quota project is named
    if not gcp.get_bool("userProjectOverride") or not gcp.get("billingProject"):
        raise ValueError(
            "the cloud stack needs gcp:userProjectOverride true and gcp:billingProject set"
        )
    every = environments()
    enabled = config.get_object("environments") or [env.name for env in every]
    if not isinstance(enabled, list) or not enabled:
        raise ValueError("clientbridge:environments must list at least one environment")
    unknown = {str(name) for name in enabled} - {env.name for env in every}
    if unknown:
        raise ValueError(f"clientbridge:environments names no environment: {sorted(unknown)}")
    envs = tuple(env for env in every if env.name in enabled)
    return Cloud(
        project=gcp.require("project"),
        region=gcp.require("region"),
        database_zone=config.require("databaseZone"),
        github_repository=config.require("githubRepository"),
        alert_email=config.require("alertEmail"),
        billing_account=config.require("billingAccount"),
        budget_amount=config.require("budgetAmount"),
        budget_currency=config.require("budgetCurrency"),
        environments=envs,
        mail_records=mail_records(config.get_object("mailRecords") or {}, every, envs),
        signing_certs=signing_certs(config.get_object("androidSigningCerts") or {}, every, envs),
        state_bucket=config.require("stateBucket"),
        state_key=config.require("stateKey"),
        github_reviewer=config.require("githubReviewer"),
        stripe_sandbox=stripe_sandbox(config),
    )


SHA1_FINGERPRINT = re.compile(r"([0-9A-F]{2}:){19}[0-9A-F]{2}")


def signing_certs(
    raw: object, every: tuple[Environment, ...], envs: tuple[Environment, ...]
) -> dict[str, tuple[str, ...]]:
    if not isinstance(raw, dict):
        raise ValueError("clientbridge:androidSigningCerts must map an environment name to a list")
    unknown = {str(key) for key in raw} - {env.name for env in every}
    if unknown:
        raise ValueError(
            f"clientbridge:androidSigningCerts names no environment: {sorted(unknown)}"
        )
    parsed: dict[str, tuple[str, ...]] = {}
    for env in envs:
        entries = raw.get(env.name) or []
        if not isinstance(entries, list):
            raise ValueError(f"clientbridge:androidSigningCerts.{env.name} must be a list")
        certs = tuple(str(each).upper() for each in entries)
        bad = [each for each in certs if not SHA1_FINGERPRINT.fullmatch(each)]
        if bad:
            raise ValueError(
                f"clientbridge:androidSigningCerts.{env.name} holds no SHA-1 fingerprint: {bad}"
            )
        parsed[env.name] = certs
    return parsed


def mail_records(
    raw: object, every: tuple[Environment, ...], envs: tuple[Environment, ...]
) -> dict[str, tuple[Record, ...]]:
    """The enabled environments' records; a disabled one's may wait in the config for its turn."""
    if not isinstance(raw, dict):
        raise ValueError("clientbridge:mailRecords must map an environment name to its records")
    names = {env.name for env in every}
    unknown = {str(key) for key in raw} - names
    if unknown:
        raise ValueError(f"clientbridge:mailRecords names no environment: {sorted(unknown)}")
    parsed: dict[str, tuple[Record, ...]] = {}
    for env in envs:
        entries = raw.get(env.name) or []
        if not isinstance(entries, list):
            raise ValueError(f"clientbridge:mailRecords.{env.name} must be a list")
        records = tuple(_record(env, entry) for entry in entries)
        taken = [(record.name, record.type) for record in records]
        cnames = {record.name for record in records if record.type == "CNAME"}
        if len(set(taken)) != len(taken) or any(
            name in cnames and kind != "CNAME" for name, kind in taken
        ):
            raise ValueError(f"clientbridge:mailRecords.{env.name} repeats a name")
        parsed[env.name] = records
    return parsed


def _record(env: Environment, entry: object) -> Record:
    if not isinstance(entry, dict):
        raise ValueError(f"clientbridge:mailRecords.{env.name} holds a record that is not a map")
    name, kind, data = entry.get("name"), entry.get("type"), entry.get("data")
    reserved = {"", "@", "www", "_dmarc", *HOSTS}
    if not isinstance(name, str) or name in reserved or name.endswith("."):
        raise ValueError(f"clientbridge:mailRecords.{env.name}: {name!r} is not a free subdomain")
    matching: list[RecordType] = [each for each in RECORD_TYPES if each == kind]
    if not matching:
        raise ValueError(f"clientbridge:mailRecords.{env.name}.{name}: type is not {RECORD_TYPES}")
    if not isinstance(data, list) or not data or not all(isinstance(each, str) for each in data):
        raise ValueError(f"clientbridge:mailRecords.{env.name}.{name}: data must list strings")
    return Record(name=name, type=matching[0], data=tuple(str(each) for each in data))


@dataclass(frozen=True)
class Images:
    backend: str  # sha256:… digests, set by CI
    web: str


@dataclass(frozen=True)
class AppLinks:
    """What app.<base> publishes to vouch for the mobile app: Apple's team and Android's keys."""

    apple_team_id: str  # empty until the Apple developer account exists
    android_fingerprints: tuple[str, ...]  # SHA-256 of each Android signing certificate


@dataclass(frozen=True)
class Deployment:
    """One environment's stack: its namespace's workloads, deployed by CI with two digests."""

    env: Environment
    images: Images
    stripe_publishable_key: str
    app_links: AppLinks
    cloud_stack: str  # the fully qualified name of the cloud stack it reads
    # empty for the shared instance; a restored clone's name points this environment at it
    database_instance: str
    # true only for the deploy workflow's rollback run, which may find the schema ahead of the image
    allow_schema_ahead: bool


def load_deployment(stack: str) -> Deployment:
    config = pulumi.Config()
    matching = [env for env in environments() if env.name == stack]
    if not matching:
        raise ValueError(f"stack {stack} is neither {CLOUD_STACK} nor an environment")
    return Deployment(
        env=matching[0],
        images=Images(_digest(config, "backendDigest"), _digest(config, "webDigest")),
        stripe_publishable_key=config.get("stripePublishableKey") or "",
        app_links=_app_links(config),
        cloud_stack=config.get("cloudStack")
        or f"{pulumi.get_organization()}/{pulumi.get_project()}/{CLOUD_STACK}",
        database_instance=config.get("databaseInstance") or "",
        allow_schema_ahead=config.get_bool("allowSchemaAhead") or False,
    )


APPLE_TEAM_ID = re.compile(r"[A-Z0-9]{10}")
CERT_FINGERPRINT = re.compile(r"([0-9A-F]{2}:){31}[0-9A-F]{2}")


def _app_links(config: pulumi.Config) -> AppLinks:
    team = config.get("appleTeamId") or ""
    if team and not APPLE_TEAM_ID.fullmatch(team):
        raise ValueError("clientbridge:appleTeamId must be the 10-character Apple team id")
    raw = config.get_object("androidCertFingerprints") or []
    if not isinstance(raw, list):
        raise ValueError("clientbridge:androidCertFingerprints must be a list")
    fingerprints = tuple(str(each).upper() for each in raw)
    bad = [each for each in fingerprints if not CERT_FINGERPRINT.fullmatch(each)]
    if bad:
        raise ValueError(
            f"clientbridge:androidCertFingerprints holds no SHA-256 fingerprint: {bad}"
        )
    return AppLinks(team, fingerprints)


def _digest(config: pulumi.Config, key: str) -> str:
    # a run without digests stops instead of changing what the environment runs
    value = config.get(key)
    if not value or not value.startswith("sha256:") or len(value) != 71:
        raise ValueError(
            f"clientbridge:{key} must be an image digest (sha256:…); "
            "`pulumi stack output images` shows the deployed ones"
        )
    return value
