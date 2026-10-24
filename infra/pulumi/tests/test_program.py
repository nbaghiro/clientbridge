"""Build the cloud, staging and prod stacks against Pulumi's mocks and check their invariants."""

import asyncio
import json
import runpy
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pulumi
import pytest
import yaml
from clientbridge.core import deployment
from google.protobuf import json_format
from pulumi.runtime import mocks
from pulumi.runtime.proto import resource_pb2
from pulumi.runtime.settings import get_root_resource
from pulumi.runtime.stack import Stack

import environments
from cloud import cluster, database, identity, services
from environments import HOSTS
from kubernetes import settings

PROGRAM = Path(__file__).resolve().parents[1]
WORKFLOWS = PROGRAM.parents[1] / ".github" / "workflows"
EAS = PROGRAM.parents[1] / "frontend" / "apps" / "mobile" / "eas.json"
BACKEND = "sha256:" + "b" * 64
WEB = "sha256:" + "c" * 64
SECRET_SIG = "4dabf18193072939515e22adb298388d"
DOMAINS = {"prod": "clientbridge.ca", "staging": "staging.clientbridge.ca"}


@dataclass
class Registered:
    type: str
    name: str
    urn: str
    inputs: dict[str, object]
    dependencies: list[str]


@dataclass
class Built:
    resources: list[Registered]
    outputs: dict[str, object]
    secret_outputs: bool


class Recorder(mocks.MockMonitor):
    def __init__(self, fakes: mocks.Mocks) -> None:
        super().__init__(fakes)
        self.registered: list[Registered] = []

    def RegisterResource(
        self, request: resource_pb2.RegisterResourceRequest
    ) -> resource_pb2.RegisterResourceResponse:
        response: resource_pb2.RegisterResourceResponse = super().RegisterResource(request)
        self.registered.append(
            Registered(
                type=request.type,
                name=request.name,
                urn=response.urn,
                inputs=json_format.MessageToDict(request.object),
                dependencies=list(request.dependencies),
            )
        )
        return response


class Fakes(mocks.Mocks):
    def __init__(self, cloud_outputs: dict[str, object] | None = None) -> None:
        self.cloud_outputs = cloud_outputs or {}

    def new_resource(self, args: mocks.MockResourceArgs) -> tuple[str, dict[str, object]]:
        state: dict[str, object] = dict(args.inputs)
        match args.typ:
            case "gcp:serviceaccount/account:Account":
                state["email"] = f"{args.inputs['accountId']}@project.iam.gserviceaccount.com"
            case "gcp:container/cluster:Cluster":
                state["controlPlaneEndpointsConfig"] = {
                    "dnsEndpointConfig": {"endpoint": "gke-1234.us-east1.gke.goog"}
                }
            case "gcp:sql/databaseInstance:DatabaseInstance":
                state["connectionName"] = "project:us-east1:clientbridge"
                state["name"] = args.inputs["name"]
            case "gcp:certificatemanager/dnsAuthorization:DnsAuthorization":
                domain = args.inputs["domain"]
                state["dnsResourceRecords"] = [
                    {"name": f"_acme-challenge.{domain}.", "type": "CNAME", "data": "x."}
                ]
            case "gcp:compute/globalAddress:GlobalAddress":
                state["address"] = "203.0.113.10"
            case "gcp:secretmanager/secret:Secret":
                state["id"] = f"projects/project/secrets/{args.inputs['secretId']}"
            case "gcp:storage/bucket:Bucket":
                state["name"] = args.inputs["name"]
            case "gcp:firebase/androidApp:AndroidApp":
                state["appId"] = f"1:123456789:android:{args.name}"
            case "pulumi:pulumi:StackReference":
                state["outputs"] = self.cloud_outputs
            case _:
                pass
        return str(state.get("id") or f"{args.name}-id"), state

    def call(self, args: mocks.MockCallArgs) -> tuple[dict[str, object], list[tuple[str, str]]]:
        if args.token == "gcp:organizations/getProject:getProject":
            return {"number": "123456789"}, []
        if args.token == "github:index/getUser:getUser":
            return {"id": "12300880", "login": str(args.args.get("username"))}, []
        if args.token == "gcp:firebase/getAndroidAppConfig:getAndroidAppConfig":
            return {"configFileContents": f"services-{args.args.get('appId')}"}, []
        return {}, []


def config_for(stack: str) -> dict[str, str]:
    project = yaml.safe_load((PROGRAM / "Pulumi.yaml").read_text())["config"]
    config = {f"clientbridge:{key}": str(each["default"]) for key, each in project.items()}
    stack_config = yaml.safe_load((PROGRAM / f"Pulumi.{stack}.yaml").read_text())["config"]
    config |= {
        key: value if isinstance(value, str) else json.dumps(value)
        for key, value in stack_config.items()
    }
    return config


def run(stack: str, config: dict[str, str], fakes: Fakes) -> Built:
    pulumi.runtime.set_all_config(config)
    # Python 3.14 creates no default event loop, and the mocked runtime schedules on the current one
    asyncio.set_event_loop(asyncio.new_event_loop())
    recorder = Recorder(fakes)
    mocks.set_mocks(
        fakes,
        project="clientbridge",
        stack=stack,
        preview=False,
        monitor=recorder,
        organization="clientbridge",
    )
    exports: dict[str, object] = {}
    combined: list[pulumi.Output[dict[str, object]]] = []

    def program() -> pulumi.Output[None]:
        runpy.run_path(str(PROGRAM / "__main__.py"))
        root = get_root_resource()
        assert isinstance(root, Stack)
        # the mocked runtime never registers the stack's outputs, so resolve them here
        combined.append(pulumi.Output.from_input(dict(root.outputs)))
        return combined[0].apply(exports.update)

    pulumi.runtime.test(program)()
    # an output built from a secret is secret, so this is true if any export carries one
    secret = asyncio.get_event_loop().run_until_complete(combined[0].is_secret())
    return Built(recorder.registered, exports, secret)


BOTH = {"clientbridge:environments": json.dumps(["prod", "staging"])}


def build_cloud(extra: dict[str, str] | None = None) -> Built:
    """The cloud stack with both environments, as it runs once production is enabled."""
    return run("cloud", config_for("cloud") | BOTH | (extra or {}), Fakes())


def build_environment(
    name: str,
    cloud: Built,
    backend: str | None = BACKEND,
    web: str | None = WEB,
    extra: dict[str, str] | None = None,
) -> Built:
    config = config_for(name)
    for key, digest in (("backendDigest", backend), ("webDigest", web)):
        if digest is not None:
            config[f"clientbridge:{key}"] = digest
    return run(name, config | (extra or {}), Fakes(cloud.outputs))


@pytest.fixture(scope="module")
def cloud() -> Built:
    return build_cloud()


@pytest.fixture(scope="module")
def stacks(cloud: Built) -> dict[str, Built]:
    return {name: build_environment(name, cloud) for name in ("prod", "staging")}


def of_type(built: Built, kind: str) -> list[Registered]:
    return [each for each in built.resources if each.type == kind]


def named(built: Built, kind: str, name: str) -> Registered:
    (found,) = [
        each for each in of_type(built, kind) if dig(each.inputs, "metadata", "name") == name
    ]
    return found


def dig(value: object, *keys: str) -> object:
    for key in keys:
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


def keys(value: object) -> set[str]:
    return {str(key) for key in value} if isinstance(value, dict) else set()


def listed(value: object) -> list[object]:
    return list(value) if isinstance(value, list) else []


def strings(value: object) -> Iterator[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for each in value.values():
            yield from strings(each)
    elif isinstance(value, list):
        for each in value:
            yield from strings(each)


def secret_values(value: object) -> Iterator[object]:
    if isinstance(value, dict):
        if SECRET_SIG in value:
            yield value
        for each in value.values():
            yield from secret_values(each)
    elif isinstance(value, list):
        for each in value:
            yield from secret_values(each)


def env_vars(container: object) -> dict[str, object]:
    return {str(dig(each, "name")): dig(each, "value") for each in listed(dig(container, "env"))}


def exported(container: object) -> set[str]:
    script = str(listed(dig(container, "command"))[2])
    return {line.split("=")[0].removeprefix("export ") for line in script.splitlines()[1:-1]}


def containers(deployment_: Registered) -> list[object]:
    return listed(dig(deployment_.inputs, "spec", "template", "spec", "containers"))


def test_the_cloud_stack_runs_no_workloads(cloud: Built) -> None:
    kinds = {each.type for each in cloud.resources}
    assert not kinds & {"kubernetes:apps/v1:Deployment", "kubernetes:batch/v1:Job"}
    assert len(of_type(cloud, "kubernetes:core/v1:Namespace")) == 3  # gateway, prod, staging


def test_an_environment_stack_touches_only_its_own_namespace(stacks: dict[str, Built]) -> None:
    for name, built in stacks.items():
        assert not [each.type for each in built.resources if each.type.startswith("gcp:")]
        for each in built.resources:
            if each.type.startswith("kubernetes:") and each.type != "pulumi:providers:kubernetes":
                assert dig(each.inputs, "metadata", "namespace") == name, (each.type, each.name)


def test_every_host_has_a_route_and_a_record(cloud: Built, stacks: dict[str, Built]) -> None:
    records = {dig(each.inputs, "name") for each in of_type(cloud, "gcp:dns/recordSet:RecordSet")}
    for name, built in stacks.items():
        base = DOMAINS[name]
        expected = {base if host == "site" else f"{host}.{base}" for host in HOSTS} | {f"*.{base}"}
        routes = of_type(built, "kubernetes:gateway.networking.k8s.io/v1:HTTPRoute")
        hostnames = {h for route in routes for h in strings(dig(route.inputs, "spec", "hostnames"))}
        assert hostnames == expected
        assert {f"{host}." for host in expected} <= records


def test_api_host_sends_the_auth_prefix_to_the_auth_service(stacks: dict[str, Built]) -> None:
    for built in stacks.values():
        api = named(built, "kubernetes:gateway.networking.k8s.io/v1:HTTPRoute", "api")
        auth, rest = listed(dig(api.inputs, "spec", "rules"))
        assert dig(auth, "matches") == [{"path": {"type": "PathPrefix", "value": "/auth"}}]
        assert dig(auth, "filters") == [
            {
                "type": "URLRewrite",
                "urlRewrite": {"path": {"type": "ReplacePrefixMatch", "replacePrefixMatch": "/"}},
            }
        ]
        assert dig(auth, "backendRefs") == [{"name": "auth", "port": 4433}]
        assert dig(rest, "filters") is None
        assert dig(rest, "backendRefs") == [{"name": "api", "port": 8701}]


def test_sync_keeps_streams_open_for_an_hour(stacks: dict[str, Built]) -> None:
    for built in stacks.values():
        (policy,) = of_type(built, "kubernetes:networking.gke.io/v1:GCPBackendPolicy")
        assert dig(policy.inputs, "spec", "default", "timeoutSec") == 3600
        assert dig(policy.inputs, "spec", "targetRef", "name") == "powersync"


def test_staging_runs_on_spot_and_production_only_its_worker(stacks: dict[str, Built]) -> None:
    for env, built in stacks.items():
        deployments = of_type(built, "kubernetes:apps/v1:Deployment")
        assert len(deployments) == 6
        for each in deployments:
            name = dig(each.inputs, "metadata", "name")
            selector = dig(each.inputs, "spec", "template", "spec", "nodeSelector")
            spot = env == "staging" or name == "worker"
            spot = env == "staging" or name == "worker"
            klass = "small-disk-spot" if spot else "small-disk"
            assert selector == {"cloud.google.com/compute-class": klass}, (env, name)


def test_nodes_boot_from_small_disks_to_fit_the_ssd_quota(cloud: Built) -> None:
    classes = {
        str(dig(each.inputs, "metadata", "name")): each.inputs
        for each in of_type(cloud, "kubernetes:cloud.google.com/v1:ComputeClass")
    }
    assert set(classes) == {"small-disk", "small-disk-spot"}
    for name, spec in classes.items():
        (priority,) = listed(dig(spec, "spec", "priorities"))
        assert float(str(dig(priority, "storage", "bootDiskSize"))) <= 50
        assert dig(priority, "spot") is (name == "small-disk-spot")


def test_requests_follow_the_plan(stacks: dict[str, Built]) -> None:
    expected = {
        ("prod", "api"): {"cpu": "500m", "memory": "1Gi"},
        ("staging", "api"): {"cpu": "250m", "memory": "512Mi"},
        ("prod", "powersync"): {"cpu": "250m", "memory": "768Mi"},
        ("prod", "redis"): {"cpu": "50m", "memory": "128Mi"},
    }
    for (env, name), requests in expected.items():
        each = named(stacks[env], "kubernetes:apps/v1:Deployment", name)
        assert dig(containers(each)[0], "resources", "requests") == requests


def test_auth_runs_with_the_derived_environment_and_its_secrets(stacks: dict[str, Built]) -> None:
    for env, built in stacks.items():
        (container,) = containers(named(built, "kubernetes:apps/v1:Deployment", "auth"))
        namespace = f"{env}.svc.cluster.local"
        assert env_vars(container) == deployment.auth_env(
            DOMAINS[env],
            api_url=f"http://api.{namespace}:8701",
            admin_url=f"http://auth.{namespace}:4434",
        )
        assert exported(container) == set(deployment.AUTH_SECRETS)
        assert listed(dig(container, "command"))[4:] == ["kratos", *deployment.AUTH_COMMAND]


def test_powersync_runs_its_deployed_config_with_its_secrets(stacks: dict[str, Built]) -> None:
    for env, built in stacks.items():
        (container,) = containers(named(built, "kubernetes:apps/v1:Deployment", "powersync"))
        environment = deployment.powersync_env(api_url=f"http://api.{env}.svc.cluster.local:8701")
        assert env_vars(container) == environment
        assert exported(container) == set(deployment.POWERSYNC_SECRETS)
        (config,) = [
            each
            for each in of_type(built, "kubernetes:core/v1:ConfigMap")
            if dig(each.inputs, "metadata", "labels", "app") == "powersync"
        ]
        files = keys(dig(config.inputs, "data"))
        assert files == {"powersync.deployed.yaml", "sync-rules.yaml"}
        assert environment["POWERSYNC_CONFIG_PATH"] == "/config/powersync.deployed.yaml"


def test_the_database_keeps_point_in_time_recovery_and_logical_decoding(cloud: Built) -> None:
    (instance,) = of_type(cloud, "gcp:sql/databaseInstance:DatabaseInstance")
    config = dig(instance.inputs, "settings")
    assert dig(config, "tier") == "db-g1-small"
    assert dig(config, "availabilityType") == "ZONAL"
    assert dig(config, "backupConfiguration", "pointInTimeRecoveryEnabled") is True
    assert dig(config, "backupConfiguration", "transactionLogRetentionDays") == 7
    assert dig(config, "ipConfiguration", "ipv4Enabled") is False
    assert dig(config, "ipConfiguration", "sslMode") == "ENCRYPTED_ONLY"
    flags = {dig(f, "name"): dig(f, "value") for f in listed(dig(config, "databaseFlags"))}
    assert flags["cloudsql.logical_decoding"] == "on"
    assert dig(instance.inputs, "deletionProtection") is True
    # db_access.py creates every database as the environment's admin, so cloudsqlsuperuser owns none
    assert not of_type(cloud, "gcp:sql/database:Database")


def test_no_stack_holds_a_secret_value(cloud: Built, stacks: dict[str, Built]) -> None:
    for built in [cloud, *stacks.values()]:
        assert not built.secret_outputs
        kinds = {each.type for each in built.resources}
        assert not {kind for kind in kinds if kind.startswith(("random:", "tls:"))}
        assert not kinds & {
            "gcp:secretmanager/secretVersion:SecretVersion",
            "gcp:storage/hmacKey:HmacKey",
        }
        for each in built.resources:
            assert not list(secret_values(each.inputs)), (each.type, each.name)
    # Cloud SQL requires a password for a built-in user, so secrets_init.py creates the admins
    assert not of_type(cloud, "gcp:sql/user:User")
    (instance,) = of_type(cloud, "gcp:sql/databaseInstance:DatabaseInstance")
    assert "rootPassword" not in instance.inputs


def test_every_catalog_secret_is_an_empty_container(cloud: Built) -> None:
    ids = {
        str(dig(each.inputs, "secretId"))
        for each in of_type(cloud, "gcp:secretmanager/secret:Secret")
    }
    for env in DOMAINS:
        for name in settings.CATALOG:
            assert f"{env}-{name.lower().replace('_', '-')}" in ids


def test_only_its_own_migrate_job_reads_an_environments_admin(cloud: Built) -> None:
    for env in DOMAINS:
        assert dig(cloud.outputs, "environments", env, "adminUser") == f"{env}_admin"
        (binding,) = [
            each
            for each in of_type(cloud, "gcp:secretmanager/secretIamBinding:SecretIamBinding")
            if each.name == f"{env}-admin-database-url"
        ]
        members = [str(member) for member in listed(dig(binding.inputs, "members"))]
        assert len(members) == 2
        assert members[0] == f"serviceAccount:cb-{env}-migrate@project.iam.gserviceaccount.com"
        assert members[1].endswith(f"/subject/ns/{env}/sa/migrate")


def test_pods_mount_the_cloud_stacks_secrets(stacks: dict[str, Built]) -> None:
    for env, built in stacks.items():
        listing = named(
            built, "kubernetes:secrets-store.csi.x-k8s.io/v1:SecretProviderClass", "api"
        )
        entries = yaml.safe_load(str(dig(listing.inputs, "spec", "parameters", "secrets")))
        assert {each["path"] for each in entries} == settings.readers("api")
        for each in entries:
            secret_id = f"{env}-{each['path'].lower().replace('_', '-')}"
            assert each["resourceName"] == f"projects/project/secrets/{secret_id}/versions/latest"


def jobs(built: Built, prefix: str) -> list[Registered]:
    return [
        each
        for each in of_type(built, "kubernetes:batch/v1:Job")
        if str(dig(each.inputs, "metadata", "name")).startswith(f"{prefix}-")
    ]


def migrate_job(built: Built) -> Registered:
    (job,) = jobs(built, "migrate")
    return job


def test_migrate_runs_before_the_deployments_that_need_it(stacks: dict[str, Built]) -> None:
    for env, built in stacks.items():
        job = migrate_job(built)
        assert str(dig(job.inputs, "metadata", "name")).startswith("migrate-")
        for each in of_type(built, "kubernetes:apps/v1:Deployment"):
            name = dig(each.inputs, "metadata", "name")
            needs = name in ("api", "worker", "auth", "powersync", "web")
            assert (job.urn in each.dependencies) == needs, (env, name)


def test_a_new_backend_digest_runs_a_new_migrate_job(cloud: Built) -> None:
    def job_name(digest: str) -> object:
        job = migrate_job(build_environment("staging", cloud, backend=digest))
        return dig(job.inputs, "metadata", "name")

    assert job_name(BACKEND) != job_name("sha256:" + "d" * 64)


def migrate_env(built: Built) -> dict[str, object]:
    job = migrate_job(built)
    init = listed(dig(job.inputs, "spec", "template", "spec", "initContainers"))
    (backend,) = [each for each in init if dig(each, "name") == "migrate"]
    return env_vars(backend)


def test_only_a_rollback_lets_migrate_skip_a_newer_schema(
    cloud: Built, stacks: dict[str, Built]
) -> None:
    for built in stacks.values():
        assert "MIGRATE_ALLOW_AHEAD" not in migrate_env(built)
    for value, expected in (("false", None), ("true", "1")):
        for env in ("prod", "staging"):
            built = build_environment(env, cloud, extra={"clientbridge:allowSchemaAhead": value})
            assert migrate_env(built).get("MIGRATE_ALLOW_AHEAD") == expected, (env, value)
            for deployment_ in of_type(built, "kubernetes:apps/v1:Deployment"):
                for container in containers(deployment_):
                    assert "MIGRATE_ALLOW_AHEAD" not in env_vars(container)


def test_an_environment_stack_without_digests_stops(cloud: Built) -> None:
    with pytest.raises(Exception, match="backendDigest must be an image digest"):
        build_environment("prod", cloud, backend=None, web=None)


def test_only_the_backend_and_stagings_seed_reach_the_auth_admin_port(
    stacks: dict[str, Built],
) -> None:
    for env, built in stacks.items():
        policy = named(built, "kubernetes:networking.k8s.io/v1:NetworkPolicy", "auth")
        rules = listed(dig(policy.inputs, "spec", "ingress"))
        admin = [r for r in rules if dig(r, "ports") == [{"port": 4434, "protocol": "TCP"}]]
        assert len(admin) == 1
        callers = ["api", "worker", *(["seed"] if env == "staging" else [])]
        assert dig(admin[0], "from") == [
            {"podSelector": {"matchLabels": {"app": app}}} for app in callers
        ]
        public = [r for r in rules if r is not admin[0]]
        assert all(dig(r, "ports") == [{"port": 4433, "protocol": "TCP"}] for r in public)
        named(built, "kubernetes:networking.k8s.io/v1:NetworkPolicy", "default-deny")


def test_each_namespace_admits_only_its_own_deployer(cloud: Built) -> None:
    for env in DOMAINS:
        (binding,) = [
            each
            for each in of_type(cloud, "kubernetes:rbac.authorization.k8s.io/v1:RoleBinding")
            if dig(each.inputs, "metadata", "namespace") == env
        ]
        subjects = listed(dig(binding.inputs, "subjects"))
        assert [dig(s, "name") for s in subjects] == [
            f"cb-deploy-{env}@project.iam.gserviceaccount.com"
        ]


def test_ci_identities_are_bound_to_this_repository_main_and_environment(cloud: Built) -> None:
    (provider,) = of_type(
        cloud, "gcp:iam/workloadIdentityPoolProvider:WorkloadIdentityPoolProvider"
    )
    assert dig(provider.inputs, "attributeCondition") == (
        "assertion.repository == 'nbaghiro/clientbridge' && assertion.ref == 'refs/heads/main'"
    )
    mapping = dig(provider.inputs, "attributeMapping")
    assert dig(mapping, "attribute.subject_ref") == "assertion.sub + '@' + assertion.ref"
    assert dig(mapping, "attribute.repository_ref") == "assertion.repository + '@' + assertion.ref"
    members = {
        each.name: str(dig(each.inputs, "member"))
        for each in of_type(cloud, "gcp:serviceaccount/iAMMember:IAMMember")
    }
    assert members["builder-github"].startswith("principalSet://")
    assert members["builder-github"].endswith(
        "/attribute.repository_ref/nbaghiro/clientbridge@refs/heads/main"
    )
    for env, github_environment in (("prod", "production"), ("staging", "staging")):
        member = members[f"deploy-{env}-github"]
        assert member.startswith("principalSet://")
        assert member.endswith(
            "/attribute.subject_ref/"
            f"repo:nbaghiro/clientbridge:environment:{github_environment}@refs/heads/main"
        )
    roles = {
        (each.name, dig(each.inputs, "role"))
        for each in of_type(cloud, "gcp:projects/iAMMember:IAMMember")
        if each.name.startswith("deploy-")
    }
    assert roles == {
        ("deploy-prod-cluster", "roles/container.clusterViewer"),
        ("deploy-staging-cluster", "roles/container.clusterViewer"),
    }


def test_the_cloud_stack_exports_what_environment_stacks_read(cloud: Built) -> None:
    for env in DOMAINS:
        shared = dig(cloud.outputs, "environments", env)
        assert keys(dig(shared, "accounts")) == set(settings.ACCOUNTS)
        assert keys(dig(shared, "secrets")) == set(settings.CATALOG)
        assert dig(shared, "bucket") == f"{config_for('cloud')['gcp:project']}-{env}-files"
    assert dig(cloud.outputs, "cluster", "endpoint") == "gke-1234.us-east1.gke.goog"


def workflow(name: str) -> dict[str, object]:
    loaded: object = yaml.safe_load((WORKFLOWS / name).read_text())
    assert isinstance(loaded, dict)
    return {str(key): value for key, value in loaded.items()}


def test_deploys_start_only_from_this_repositorys_main() -> None:
    images = dig(workflow("deploy.yml"), "jobs", "images")
    condition = " ".join(str(dig(images, "if")).split())
    assert (
        "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'" in condition
    )
    for guard in (
        "github.event.workflow_run.conclusion == 'success'",
        "github.event.workflow_run.event == 'push'",
        "github.event.workflow_run.head_branch == 'main'",
        "github.event.workflow_run.head_repository.full_name == github.repository",
    ):
        assert guard in condition
    assert "github.event.workflow_run.head_sha" in str(dig(images, "env", "SHA"))


def test_each_environment_deploys_one_at_a_time_and_never_cancels() -> None:
    assert "concurrency" not in workflow("deploy.yml")
    called = workflow("deploy-environment.yml")
    assert "concurrency" not in called
    assert dig(called, "jobs", "deploy", "concurrency") == {
        "group": "deploy-${{ inputs.environment }}",
        "cancel-in-progress": False,
    }
    production = dig(workflow("deploy.yml"), "jobs", "production", "if")
    assert "needs.staging.outputs.deployed == 'true'" in str(production)


def test_deploy_jobs_hold_only_what_they_need() -> None:
    for name in ("deploy.yml", "deploy-environment.yml"):
        each = workflow(name)
        assert each["permissions"] == {}
        jobs = dig(each, "jobs")
        assert isinstance(jobs, dict)
        for name_, job in jobs.items():
            # the app jobs reach EAS with its token, so they need no Google identity
            wanted = (
                {"contents": "read"}
                if name_.endswith("-mobile")
                else {
                    "contents": "read",
                    "id-token": "write",
                }
            )
            assert dig(job, "permissions") == wanted
    steps = listed(dig(workflow("deploy-environment.yml"), "jobs", "deploy", "steps"))
    # the state is in the project's bucket, reached with the deployer's own Google credentials
    assert not [s for s in steps if "PULUMI_ACCESS_TOKEN" in keys(dig(s, "env"))]
    (up,) = [s for s in steps if dig(s, "name") == "pulumi up"]
    assert 'pulumi login "$PULUMI_BACKEND_URL"' in str(dig(up, "run"))
    env = dig(workflow("deploy-environment.yml"), "jobs", "deploy", "env")
    assert dig(env, "PULUMI_BACKEND_URL") == "${{ vars.PULUMI_BACKEND_URL }}"


def test_production_waits_until_the_project_runs_it() -> None:
    production = dig(workflow("deploy.yml"), "jobs", "production", "if")
    assert "vars.DEPLOY_PRODUCTION == 'true'" in str(production)


def test_only_the_rollback_run_lets_migrate_skip_a_newer_schema() -> None:
    deploy = workflow("deploy.yml")
    # YAML 1.1 reads the key on: as True
    rollback = dig(deploy, "True", "workflow_dispatch", "inputs", "rollback")
    assert dig(rollback, "type") == "boolean"
    assert dig(rollback, "default") is False
    for name in ("staging", "production"):
        given = dig(deploy, "jobs", name, "with", "allow_schema_ahead")
        assert given == (
            "${{ github.event_name == 'workflow_dispatch' && inputs.rollback == true }}"
        ), name
    given = listed(dig(deploy, "jobs", "images", "steps"))[0]
    assert "a rollback needs both earlier digests" in str(dig(given, "run"))
    called = workflow("deploy-environment.yml")
    steps = listed(dig(called, "jobs", "deploy", "steps"))
    (up,) = [each for each in steps if dig(each, "name") == "pulumi up"]
    assert dig(up, "env", "ALLOW_SCHEMA_AHEAD") == "${{ inputs.allow_schema_ahead }}"
    assert '--config "clientbridge:allowSchemaAhead=$ALLOW_SCHEMA_AHEAD"' in str(dig(up, "run"))
    others = [each for each in steps if each is not up]
    assert not any("allowSchemaAhead" in text for text in strings(others))
    assert not any("MIGRATE_ALLOW_AHEAD" in text for text in strings([deploy, called]))


def image_user(image: str) -> tuple[int, int]:
    kinds = {
        "/backend@": "backend",
        "/web@": "web",
        "oryd/kratos@": "auth",
        "journeyapps/powersync-service@": "powersync",
        "redis@": "redis",
        "cloud-sql-proxy@": "proxy",
        f"postgres:{database.MAJOR_VERSION}@": "postgres",
    }
    (kind,) = [kind for marker, kind in kinds.items() if marker in image]
    return settings.IMAGE_USERS[kind]


def pod_specs(built: Built) -> list[object]:
    return [
        dig(each.inputs, "spec", "template", "spec")
        for each in [
            *of_type(built, "kubernetes:apps/v1:Deployment"),
            *of_type(built, "kubernetes:batch/v1:Job"),
        ]
    ]


def test_every_container_runs_as_its_images_numeric_user(stacks: dict[str, Built]) -> None:
    for built in stacks.values():
        for spec in pod_specs(built):
            assert dig(spec, "securityContext", "runAsNonRoot") is True
            for container in [
                *listed(dig(spec, "containers")),
                *listed(dig(spec, "initContainers")),
            ]:
                context = dig(container, "securityContext")
                user, group = image_user(str(dig(container, "image")))
                assert user > 0
                assert dig(context, "runAsNonRoot") is True
                assert (dig(context, "runAsUser"), dig(context, "runAsGroup")) == (user, group)


def test_the_nodes_run_as_their_own_least_privilege_account(cloud: Built) -> None:
    (gke,) = of_type(cloud, "gcp:container/cluster:Cluster")
    defaults = dig(gke.inputs, "clusterAutoscaling", "autoProvisioningDefaults")
    assert dig(defaults, "serviceAccount") == "cb-nodes@project.iam.gserviceaccount.com"
    roles = {
        dig(each.inputs, "role")
        for each in of_type(cloud, "gcp:projects/iAMMember:IAMMember")
        if dig(each.inputs, "member") == "serviceAccount:cb-nodes@project.iam.gserviceaccount.com"
    }
    assert roles == set(cluster.NODE_ROLES)
    (pull,) = [
        each
        for each in of_type(cloud, "gcp:artifactregistry/repositoryIamMember:RepositoryIamMember")
        if each.name == "nodes-pull"
    ]
    assert dig(pull.inputs, "role") == "roles/artifactregistry.reader"


def test_the_budget_is_created_with_a_quota_project() -> None:
    config = config_for("cloud")
    assert config["gcp:userProjectOverride"] == "true"
    assert config["gcp:billingProject"] == config["gcp:project"]
    del config["gcp:billingProject"]
    with pytest.raises(Exception, match="gcp:billingProject"):
        run("cloud", config, Fakes())


def records(cloud: Built) -> dict[tuple[str, str], list[str]]:
    return {
        (str(dig(each.inputs, "name")), str(dig(each.inputs, "type"))): [
            str(value) for value in listed(dig(each.inputs, "rrdatas"))
        ]
        for each in of_type(cloud, "gcp:dns/recordSet:RecordSet")
    }


def test_the_zone_keeps_workspace_mail_and_the_resend_records(cloud: Built) -> None:
    found = records(cloud)
    assert found[("clientbridge.ca.", "MX")] == [
        "1 aspmx.l.google.com.",
        "5 alt1.aspmx.l.google.com.",
        "5 alt2.aspmx.l.google.com.",
        "10 alt3.aspmx.l.google.com.",
        "10 alt4.aspmx.l.google.com.",
    ]
    assert found[("clientbridge.ca.", "TXT")] == ['"v=spf1 include:_spf.google.com ~all"']
    assert found[("_dmarc.clientbridge.ca.", "TXT")] == ['"v=DMARC1; p=none;"']
    assert found[("send.clientbridge.ca.", "CNAME")] == ["send.forge.rmta.net."]
    assert found[("rsend.clientbridge.ca.", "CNAME")] == ["rsend.forge.rmta.net."]
    assert found[("resend._domainkey.clientbridge.ca.", "TXT")][0].startswith('"p=MIGf')
    (dkim,) = found[("google._domainkey.clientbridge.ca.", "TXT")]
    chunks = dkim.split(" ")
    assert len(chunks) == 2 and all(len(chunk) <= 257 for chunk in chunks)
    for domain in DOMAINS.values():
        assert (f"www.{domain}.", "A") in found


def test_mail_records_cannot_take_a_host() -> None:
    envs = environments.build("clientbridge.ca", "staging.clientbridge.ca")
    for wrong in (
        {"prod": [{"name": "api", "type": "CNAME", "data": ["x."]}]},
        {"prod": [{"name": "send", "type": "A", "data": ["203.0.113.1"]}]},
        {
            "prod": [
                {"name": "send", "type": "CNAME", "data": ["a."]},
                {"name": "send", "type": "TXT", "data": ["b"]},
            ]
        },
        {"qa": []},
    ):
        with pytest.raises(ValueError, match="mailRecords"):
            environments.mail_records(wrong, envs, envs)


def test_www_redirects_to_the_apex(cloud: Built) -> None:
    for env, domain in DOMAINS.items():
        route = named(cloud, "kubernetes:gateway.networking.k8s.io/v1:HTTPRoute", f"{env}-www")
        assert dig(route.inputs, "spec", "hostnames") == [f"www.{domain}"]
        assert listed(dig(route.inputs, "spec", "parentRefs")) == [
            {"name": "clientbridge", "sectionName": f"{env}-www"}
        ]
        (rule,) = listed(dig(route.inputs, "spec", "rules"))
        (redirect,) = listed(dig(rule, "filters"))
        assert dig(redirect, "requestRedirect") == {
            "scheme": "https",
            "hostname": domain,
            "statusCode": 301,
        }


def proxy_targets(built: Built) -> set[str]:
    return {
        str(listed(dig(container, "args"))[-1])
        for spec in pod_specs(built)
        for container in listed(dig(spec, "initContainers"))
        if dig(container, "name") == "cloud-sql-proxy"
    }


def test_an_environment_can_point_at_a_restored_instance(
    cloud: Built, stacks: dict[str, Built]
) -> None:
    config = config_for("staging") | {
        "clientbridge:backendDigest": BACKEND,
        "clientbridge:webDigest": WEB,
        "clientbridge:databaseInstance": "clientbridge-restore-20261013",
    }
    restored = run("staging", config, Fakes(cloud.outputs))
    assert proxy_targets(restored) == {"project:us-east1:clientbridge-restore-20261013"}
    assert (
        restored.outputs["databaseConnection"] == "project:us-east1:clientbridge-restore-20261013"
    )
    for built in stacks.values():
        assert proxy_targets(built) == {"project:us-east1:clientbridge"}


def test_the_powersync_key_id_and_previous_keys_come_from_secrets(stacks: dict[str, Built]) -> None:
    for built in stacks.values():
        for name in ("api", "worker"):
            (container,) = containers(named(built, "kubernetes:apps/v1:Deployment", name))
            assert "POWERSYNC_KID" not in env_vars(container)
            assert {"POWERSYNC_KID", "POWERSYNC_PREVIOUS_PUBLIC_KEYS"} <= exported(container)


def test_ledger_drift_raises_an_alert(cloud: Built) -> None:
    (metric,) = [
        each for each in of_type(cloud, "gcp:logging/metric:Metric") if each.name == "ledger-drift"
    ]
    query = str(dig(metric.inputs, "filter"))
    assert 'jsonPayload.logger="clientbridge.services.ledger"' in query
    assert 'jsonPayload.message=~"^ledger drift"' in query
    assert [
        each
        for each in of_type(cloud, "gcp:monitoring/alertPolicy:AlertPolicy")
        if each.name == "ledger-drift"
    ]


def test_the_registry_never_deletes_a_deployed_image(cloud: Built) -> None:
    (repository,) = of_type(cloud, "gcp:artifactregistry/repository:Repository")
    policies = {dig(each, "id"): each for each in listed(dig(repository.inputs, "cleanupPolicies"))}
    assert dig(policies["keep-deployed"], "action") == "KEEP"
    assert dig(policies["keep-deployed"], "condition", "tagPrefixes") == [
        "prod-",
        "staging-current",
    ]
    staging = dig(policies["keep-recent-staging"], "condition")
    assert dig(policies["keep-recent-staging"], "action") == "KEEP"
    assert (dig(staging, "tagPrefixes"), dig(staging, "newerThan")) == (["staging-"], "2592000s")
    assert dig(policies["keep-recent"], "mostRecentVersions", "keepCount") == 20
    assert dig(policies["delete-rest"], "action") == "DELETE"
    assert dig(policies["delete-rest"], "condition", "tagState") == "ANY"


def test_only_a_staging_migration_is_retried(stacks: dict[str, Built]) -> None:
    retries = {
        env: dig(migrate_job(built).inputs, "spec", "backoffLimit") for env, built in stacks.items()
    }
    assert retries == {"prod": 0, "staging": 2}


def test_served_pods_drain_before_they_stop(stacks: dict[str, Built]) -> None:
    for built in stacks.values():
        for name in ("api", "auth", "web"):
            each = named(built, "kubernetes:apps/v1:Deployment", name)
            (container,) = containers(each)
            delay = dig(container, "lifecycle", "preStop", "sleep", "seconds")
            assert delay == settings.DRAIN_DELAY_SECONDS
            grace = dig(each.inputs, "spec", "template", "spec", "terminationGracePeriodSeconds")
            assert grace == settings.GRACE_SECONDS
            assert settings.DRAIN_DELAY_SECONDS + settings.DRAIN_SECONDS < settings.GRACE_SECONDS
        (api,) = containers(named(built, "kubernetes:apps/v1:Deployment", "api"))
        command = [str(part) for part in listed(dig(api, "command"))]
        assert command[command.index("--timeout-graceful-shutdown") + 1] == str(
            settings.DRAIN_SECONDS
        )


def test_the_worker_is_restarted_when_arq_stops_reporting(stacks: dict[str, Built]) -> None:
    for built in stacks.values():
        (worker,) = containers(named(built, "kubernetes:apps/v1:Deployment", "worker"))
        command = listed(dig(worker, "livenessProbe", "exec", "command"))
        assert command[-3:] == ["arq", "--check", "clientbridge.tasks.worker.WorkerSettings"]


def test_deployers_can_read_pod_logs(cloud: Built) -> None:
    for env in DOMAINS:
        (role,) = [
            each
            for each in of_type(cloud, "kubernetes:rbac.authorization.k8s.io/v1:Role")
            if dig(each.inputs, "metadata", "namespace") == env
        ]
        rules = listed(dig(role.inputs, "rules"))
        assert {"apiGroups": [""], "resources": ["pods/log"], "verbs": ["get"]} in rules


def test_deployers_can_watch_what_pulumi_awaits(cloud: Built) -> None:
    for env in DOMAINS:
        (role,) = [
            each
            for each in of_type(cloud, "kubernetes:rbac.authorization.k8s.io/v1:Role")
            if dig(each.inputs, "metadata", "namespace") == env
        ]
        rules = listed(dig(role.inputs, "rules"))
        readable: set[str] = set()
        for rule in rules:
            verbs = {str(verb) for verb in listed(dig(rule, "verbs"))}
            if {"get", "list", "watch"} <= verbs or verbs == {"*"}:
                readable |= {str(each) for each in listed(dig(rule, "resources"))}
        assert {"pods", "replicasets", "persistentvolumeclaims", "jobs", "deployments"} <= readable


def test_the_connection_pools_fit_the_instance(cloud: Built, stacks: dict[str, Built]) -> None:
    for built in stacks.values():
        (api,) = containers(named(built, "kubernetes:apps/v1:Deployment", "api"))
        assert env_vars(api)["DB_POOL_SIZE"] == "3"
        assert env_vars(api)["DB_MAX_OVERFLOW"] == "1"
    envs = environments.build("clientbridge.ca", "staging.clientbridge.ca")
    peak = sum(settings.peak_connections(env) for env in envs)
    assert peak + database.RESERVED_CONNECTIONS <= database.MAX_CONNECTIONS
    (instance,) = of_type(cloud, "gcp:sql/databaseInstance:DatabaseInstance")
    flags = listed(dig(instance.inputs, "settings", "databaseFlags"))
    assert {"name": "max_connections", "value": str(database.MAX_CONNECTIONS)} in flags


def test_the_cloud_stack_enables_its_apis_before_anything_else(cloud: Built) -> None:
    enabled = of_type(cloud, "gcp:projects/service:Service")
    assert {each.inputs["service"] for each in enabled} == set(services.APIS)
    assert all(each.inputs["disableOnDestroy"] is False for each in enabled)
    apis = {each.urn for each in enabled}
    for each in cloud.resources:
        if each.type.startswith("gcp:") and each.type != "gcp:projects/service:Service":
            assert apis <= set(each.dependencies), each.name


def test_buckets_take_uploads_only_from_the_app_and_connect(cloud: Built) -> None:
    buckets = of_type(cloud, "gcp:storage/bucket:Bucket")
    assert len(buckets) == len(DOMAINS)
    for env, domain in DOMAINS.items():
        (bucket,) = [each for each in buckets if each.name == f"{env}-files"]
        upload, read = listed(dig(bucket.inputs, "cors"))
        assert dig(upload, "origins") == [
            f"https://{host}.{domain}" for host in ("app", "book", "pay", "shop")
        ]
        assert dig(upload, "methods") == ["PUT"]
        assert dig(upload, "responseHeaders") == ["Content-Type"]
        assert dig(read, "origins") == ["*"]
        assert dig(read, "methods") == ["GET", "HEAD"]
        assert {dig(rule, "maxAgeSeconds") for rule in (upload, read)} == {3600}


@pytest.fixture(scope="module")
def staging_only() -> Built:
    return run("cloud", config_for("cloud"), Fakes())


def test_a_staging_only_project_leaves_the_registered_domain_alone(staging_only: Built) -> None:
    zones = [
        dig(each.inputs, "dnsName")
        for each in of_type(staging_only, "gcp:dns/managedZone:ManagedZone")
    ]
    assert zones == ["staging.clientbridge.ca."]
    records = [
        (dig(each.inputs, "name"), dig(each.inputs, "type"))
        for each in of_type(staging_only, "gcp:dns/recordSet:RecordSet")
    ]
    assert not [
        name
        for name, kind in records
        if kind == "MX" and not str(name).endswith(".staging.clientbridge.ca.")
    ]
    assert not [name for name, _ in records if name in ("clientbridge.ca.", "app.clientbridge.ca.")]
    assert ("app.staging.clientbridge.ca.", "A") in records
    assert set(keys(staging_only.outputs["nameServers"])) == {"staging.clientbridge.ca"}
    assert not [
        each
        for each in of_type(staging_only, "gcp:serviceaccount/account:Account")
        if dig(each.inputs, "accountId") == "cb-deploy-prod"
    ]


def test_production_delegates_staging_from_the_apex(cloud: Built) -> None:
    (ns,) = [
        each
        for each in of_type(cloud, "gcp:dns/recordSet:RecordSet")
        if dig(each.inputs, "type") == "NS"
    ]
    assert dig(ns.inputs, "name") == "staging.clientbridge.ca."
    assert set(keys(cloud.outputs["nameServers"])) == {"clientbridge.ca"}
    mx = [
        dig(each.inputs, "name")
        for each in of_type(cloud, "gcp:dns/recordSet:RecordSet")
        if dig(each.inputs, "type") == "MX"
    ]
    assert [name for name in mx if not str(name).endswith(".staging.clientbridge.ca.")] == [
        "clientbridge.ca."
    ]


def _variables(built: Built) -> dict[str, object]:
    return {
        str(dig(each.inputs, "variableName")): dig(each.inputs, "value")
        for each in of_type(built, "github:index/actionsVariable:ActionsVariable")
    }


def test_github_holds_the_deploy_settings(staging_only: Built, cloud: Built) -> None:
    assert _variables(staging_only)["DEPLOY_PRODUCTION"] == "false"
    assert _variables(cloud)["DEPLOY_PRODUCTION"] == "true"
    assert (
        _variables(staging_only)["PULUMI_BACKEND_URL"]
        == f"gs://{config_for('cloud')['clientbridge:stateBucket']}"
    )
    environments_by_name = {
        str(dig(each.inputs, "environment")): each
        for each in of_type(cloud, "github:index/repositoryEnvironment:RepositoryEnvironment")
    }
    assert set(environments_by_name) == {"production", "staging"}
    assert dig(environments_by_name["production"].inputs, "reviewers") == [{"users": [12300880]}]
    assert not dig(environments_by_name["staging"].inputs, "reviewers")
    branches = {
        str(dig(each.inputs, "branchPattern"))
        for each in of_type(
            cloud,
            "github:index/repositoryEnvironmentDeploymentPolicy:RepositoryEnvironmentDeploymentPolicy",
        )
    }
    assert branches == {"main"}


def test_each_deployer_writes_only_its_own_state(cloud: Built) -> None:
    writes = [
        each
        for each in of_type(cloud, "gcp:storage/bucketIAMMember:BucketIAMMember")
        if dig(each.inputs, "role") == "roles/storage.objectUser"
    ]
    assert len(writes) == 2
    for each in writes:
        expression = str(dig(each.inputs, "condition", "expression"))
        own = "staging" if "staging" in str(dig(each.inputs, "condition", "title")) else "prod"
        other = "prod" if own == "staging" else "staging"
        assert f"stacks/clientbridge/{own}.json" in expression
        assert f"/clientbridge/{other}" not in expression


def test_only_staging_seeds_the_demo_after_migrate_and_auth(stacks: dict[str, Built]) -> None:
    assert not jobs(stacks["prod"], "seed")
    built = stacks["staging"]
    (seed,) = jobs(built, "seed")
    (auth,) = [
        each
        for each in of_type(built, "kubernetes:apps/v1:Deployment")
        if dig(each.inputs, "metadata", "name") == "auth"
    ]
    assert {migrate_job(built).urn, auth.urn} <= set(seed.dependencies)
    spec = dig(seed.inputs, "spec", "template", "spec")
    assert dig(spec, "serviceAccountName") == "migrate"
    (container,) = listed(dig(spec, "containers"))
    assert "scripts.stripe_setup --link-only --apply" in str(dig(container, "command"))


def test_stagings_seed_has_room_for_every_demo_business(stacks: dict[str, Built]) -> None:
    (seed,) = jobs(stacks["staging"], "seed")
    spec = dig(seed.inputs, "spec", "template", "spec")
    (container,) = listed(dig(spec, "containers"))
    assert dig(container, "resources", "requests") == {"cpu": "1", "memory": "2Gi"}
    command = str(dig(container, "command"))
    scratch_url = "postgresql://postgres@127.0.0.1:5433/scratch"
    assert f"scripts.seed_demo --jobs 2 --scratch {scratch_url} --prune-logins " in command
    assert dig(seed.inputs, "spec", "activeDeadlineSeconds") == 1800
    proxy, scratch = listed(dig(spec, "initContainers"))
    assert dig(proxy, "name") == "cloud-sql-proxy"
    assert dig(scratch, "resources", "requests") == {"cpu": "1", "memory": "2Gi"}
    cores = sum(
        int(str(dig(each, "resources", "requests", "cpu"))) for each in (container, scratch)
    )
    assert cores == 2  # one writer per core of the pod


def test_stagings_seed_writes_into_a_loopback_postgres_of_cloud_sqls_version(
    stacks: dict[str, Built],
) -> None:
    (seed,) = jobs(stacks["staging"], "seed")
    spec = dig(seed.inputs, "spec", "template", "spec")
    (scratch,) = [
        each
        for each in listed(dig(spec, "initContainers"))
        if dig(each, "name") == "scratch-postgres"
    ]
    assert dig(scratch, "restartPolicy") == "Always"
    assert str(dig(scratch, "image")).startswith(f"postgres:{database.MAJOR_VERSION}@sha256:")
    args = [str(arg) for arg in listed(dig(scratch, "args"))]
    assert "listen_addresses=127.0.0.1" in args and "port=5433" in args
    assert env_vars(scratch)["POSTGRES_HOST_AUTH_METHOD"] == "trust"
    assert dig(scratch, "securityContext", "readOnlyRootFilesystem") is True
    volumes = {str(dig(each, "name")): each for each in listed(dig(spec, "volumes"))}
    for mount in listed(dig(scratch, "volumeMounts")):
        assert dig(volumes[str(dig(mount, "name"))], "emptyDir", "sizeLimit") == "1Gi"
    assert "5433" not in json.dumps(
        [each.inputs for each in of_type(stacks["staging"], "kubernetes:core/v1:Service")]
    )


def test_the_project_asks_for_room_beyond_two_autopilot_nodes(cloud: Built) -> None:
    preferences = {
        str(dig(each.inputs, "quotaId")): each.inputs
        for each in of_type(cloud, "gcp:cloudquota/sQuotaPreference:SQuotaPreference")
    }
    ssd = preferences["SSD-TOTAL-GB-per-project-region"]
    assert dig(ssd, "dimensions") == {"region": "us-east1"}
    assert int(str(dig(ssd, "quotaConfig", "preferredValue"))) >= 500
    assert "CPUS-ALL-REGIONS-per-project" in preferences


def test_quota_use_alerts_before_nodes_stall(cloud: Built) -> None:
    filters = {
        str(dig(each.inputs, "displayName")): str(
            dig(listed(dig(each.inputs, "conditions"))[0], "conditionThreshold", "filter")
        )
        for each in of_type(cloud, "gcp:monitoring/alertPolicy:AlertPolicy")
    }
    quota = {name: f for name, f in filters.items() if "consumer_quota" in f}
    assert any("ssd_total_storage" in f and '"us-east1"' in f for f in quota.values())
    assert any("cpus_all_regions" in f for f in quota.values())


def listeners(cloud: Built) -> dict[str, object]:
    (gateway,) = [
        each
        for each in of_type(cloud, "kubernetes:gateway.networking.k8s.io/v1:Gateway")
        if dig(each.inputs, "metadata", "name") == "clientbridge"
    ]
    return {
        str(dig(each, "name")): each for each in listed(dig(gateway.inputs, "spec", "listeners"))
    }


def admitted(listener: object) -> object:
    return dig(listener, "allowedRoutes", "namespaces", "selector", "matchLabels")


def test_each_host_takes_routes_only_from_its_own_environment(
    cloud: Built, stacks: dict[str, Built]
) -> None:
    every = listeners(cloud)
    for env in environments.build(*DOMAINS.values()):
        for host in HOSTS:
            listener = every[f"{env.name}-{host}"]
            # an exact hostname: a wildcard is a suffix match, so *.clientbridge.ca takes staging's
            assert dig(listener, "hostname") == env.host(host)
            assert admitted(listener) == {"kubernetes.io/metadata.name": env.namespace}
        assert admitted(every[f"{env.name}-www"]) == {"kubernetes.io/metadata.name": "gateway"}
        pages = every[f"{env.name}-pages"]
        assert dig(pages, "hostname") == f"*.{env.base_domain}"
        assert admitted(pages) == {"kubernetes.io/metadata.name": env.namespace}
        route = named(
            stacks[env.name], "kubernetes:gateway.networking.k8s.io/v1:HTTPRoute", "pages"
        )
        assert listed(dig(route.inputs, "spec", "parentRefs")) == [
            {"name": "clientbridge", "namespace": "gateway", "sectionName": f"{env.name}-pages"}
        ]
        for host in HOSTS:
            route = named(
                stacks[env.name], "kubernetes:gateway.networking.k8s.io/v1:HTTPRoute", host
            )
            assert dig(route.inputs, "spec", "hostnames") == [env.host(host)]
            assert listed(dig(route.inputs, "spec", "parentRefs")) == [
                {
                    "name": "clientbridge",
                    "namespace": "gateway",
                    "sectionName": f"{env.name}-{host}",
                }
            ]
    https = [name for name, each in every.items() if dig(each, "protocol") == "HTTPS"]
    assert all(dig(every[name], "hostname") for name in https)


def test_no_stack_config_holds_a_pulumi_secret() -> None:
    # every deployer decrypts with the one state key, so a secret here would reach every deployer
    for config in PROGRAM.glob("Pulumi.*.yaml"):
        assert "secure:" not in config.read_text(), config.name


def test_production_keeps_a_served_pod_through_a_node_upgrade(stacks: dict[str, Built]) -> None:
    budgets = {
        str(dig(each.inputs, "metadata", "name")): each
        for each in of_type(stacks["prod"], "kubernetes:policy/v1:PodDisruptionBudget")
    }
    assert set(budgets) == {"api", "auth", "web"}
    for name, budget in budgets.items():
        deployment_ = named(stacks["prod"], "kubernetes:apps/v1:Deployment", name)
        assert dig(deployment_.inputs, "spec", "replicas") == 2
        assert dig(budget.inputs, "spec", "minAvailable") == 1
        assert dig(budget.inputs, "spec", "selector", "matchLabels") == {"app": name}
    assert not of_type(stacks["staging"], "kubernetes:policy/v1:PodDisruptionBudget")


def test_a_missing_secret_file_stops_the_container() -> None:
    script = str(settings.with_secrets(["serve"], {"A_KEY": "a-key"})[2])
    # export would succeed with an empty value; the bare assignment fails under set -e
    assert 'A_KEY="$(cat /var/run/secrets/clientbridge/a-key)"; export A_KEY' in script.splitlines()


def test_only_the_mobile_jobs_receive_secrets() -> None:
    jobs = dig(workflow("deploy.yml"), "jobs")
    assert isinstance(jobs, dict)
    for name, job in jobs.items():
        assert ("secrets" in keys(job)) == name.endswith("-mobile"), name


@pytest.mark.parametrize(
    "path",
    [
        ".pulumi/stacks/clientbridge/staging.json",
        ".pulumi/stacks/clientbridge/staging.json.bak",
        ".pulumi/history/clientbridge/staging/staging-1792120874690481000.history.json",
        ".pulumi/backups/clientbridge/staging/staging.1792120874690481000.json",
        ".pulumi/locks/organization/clientbridge/staging/82eaa4a8-6455-4f02-8f23-33d812e1fbd7.json",
    ],
)
def test_a_deployer_writes_every_file_of_its_stack(path: str) -> None:
    prefixes = identity.state_prefixes("state", "staging")
    assert any(f"projects/_/buckets/state/objects/{path}".startswith(p) for p in prefixes)


@pytest.mark.parametrize(
    "path",
    [
        ".pulumi/stacks/clientbridge/cloud.json",
        ".pulumi/stacks/clientbridge/staging-old.json",
        ".pulumi/locks/organization/clientbridge/prod/82eaa4a8.json",
        ".pulumi/meta.yaml",
    ],
)
def test_a_deployer_writes_no_other_stack(path: str) -> None:
    prefixes = identity.state_prefixes("state", "staging")
    assert not any(f"projects/_/buckets/state/objects/{path}".startswith(p) for p in prefixes)


def test_each_environment_has_an_android_app_that_push_can_reach(cloud: Built) -> None:
    for env in environments.build(*DOMAINS.values()):
        (app,) = [
            each
            for each in of_type(cloud, "gcp:firebase/androidApp:AndroidApp")
            if each.name == f"{env.name}-android"
        ]
        assert app.inputs["packageName"] == env.mobile.bundle_id
        assert app.inputs["deletionPolicy"] == "ABANDON"
        sender = f"cb-{env.name}-push@project.iam.gserviceaccount.com"
        (grant,) = [
            each
            for each in of_type(cloud, "gcp:projects/iAMMember:IAMMember")
            if each.inputs.get("member") == f"serviceAccount:{sender}"
        ]
        assert grant.inputs["role"] == "roles/firebasecloudmessaging.admin"
        shared = dig(cloud.outputs, "environments", env.name)
        assert dig(shared, "pushSender") == sender
        assert (
            dig(shared, "googleServicesFile") == f"services-1:123456789:android:{env.name}-android"
        )
    assert cloud.outputs["playPublisher"] == "cb-play-publisher@project.iam.gserviceaccount.com"


def test_each_environments_app_matches_its_eas_profile() -> None:
    eas = json.loads(EAS.read_text())
    envs = environments.build(*DOMAINS.values())
    assert len({env.mobile.bundle_id for env in envs}) == len(envs)
    for env in envs:
        build = eas["build"][env.mobile.channel]
        assert build["channel"] == env.mobile.channel
        assert build["environment"] == env.mobile.eas_environment
        assert eas["submit"][env.mobile.channel]["ios"]["bundleIdentifier"] == env.mobile.bundle_id
        # an Android build for Play is a store bundle; one installed from an EAS link is an APK
        android = build.get("android", {}).get("distribution", build.get("distribution"))
        assert (android == "store") == env.mobile.play_store


def web_env(built: Built) -> dict[str, object]:
    (container,) = containers(named(built, "kubernetes:apps/v1:Deployment", "web"))
    return env_vars(container)


def test_the_web_image_vouches_for_its_environments_app(
    cloud: Built, stacks: dict[str, Built]
) -> None:
    for env in environments.build(*DOMAINS.values()):
        values = web_env(stacks[env.name])
        assert values["MOBILE_APP_ID"] == env.mobile.bundle_id
        config = yaml.safe_load((PROGRAM / f"Pulumi.{env.name}.yaml").read_text())["config"]
        assert values["APPLE_TEAM_ID"] == config.get("clientbridge:appleTeamId", "")
        assert values["ANDROID_CERT_FINGERPRINTS"] == ""
    fingerprint = ":".join(["ab"] * 32)
    linked = build_environment(
        "staging",
        cloud,
        extra={
            "clientbridge:appleTeamId": "ABCDE12345",
            "clientbridge:androidCertFingerprints": json.dumps([fingerprint]),
        },
    )
    values = web_env(linked)
    assert values["APPLE_TEAM_ID"] == "ABCDE12345"
    assert values["ANDROID_CERT_FINGERPRINTS"] == fingerprint.upper()


def test_app_links_take_only_a_team_id_and_sha256_fingerprints(cloud: Built) -> None:
    for key, value in (
        ("appleTeamId", "abc"),
        ("androidCertFingerprints", json.dumps(["AB:CD"])),
    ):
        with pytest.raises(Exception, match=key):
            build_environment("staging", cloud, extra={f"clientbridge:{key}": value})


def test_each_app_ships_after_its_environment_and_one_run_at_a_time() -> None:
    deploy = workflow("deploy.yml")
    for name, after in (("staging-mobile", "staging"), ("production-mobile", "production")):
        job = dig(deploy, "jobs", name)
        assert dig(job, "uses") == "./.github/workflows/deploy-mobile.yml"
        assert after in listed(dig(job, "needs"))
        condition = " ".join(str(dig(job, "if")).split())
        assert f"needs.{after}.outputs.deployed == 'true'" in condition
        # a manual run may roll the backend back; shipping main's bundle then would outrun it
        assert "github.event_name == 'workflow_run'" in condition
        assert dig(job, "with", "ref") == "${{ needs.images.outputs.sha }}"
    called = workflow("deploy-mobile.yml")
    assert called["permissions"] == {}
    job = dig(called, "jobs", "mobile")
    assert dig(job, "permissions") == {"contents": "read"}
    assert dig(job, "environment") == "${{ inputs.environment }}"
    assert dig(job, "concurrency") == {
        "group": "mobile-${{ inputs.environment }}",
        "cancel-in-progress": False,
    }
    # one pinned CLI, so a build and its updates compute fingerprints the same way
    pinned = {text for text in strings(called) if "eas-cli@" in text}
    assert pinned == {"eas-cli@25.0.0"}


def test_no_route_matches_by_method(stacks: dict[str, Built]) -> None:
    # GKE refuses a method match and then programs no Gateway change; Caddy proxies /contact
    for built in stacks.values():
        for route in of_type(built, "kubernetes:gateway.networking.k8s.io/v1:HTTPRoute"):
            for rule in listed(dig(route.inputs, "spec", "rules")):
                assert all(
                    dig(match, "method") is None for match in listed(dig(rule, "matches") or [])
                )


def test_google_business_resources_are_gated_and_use_a_separate_key() -> None:
    disabled = build_cloud()
    assert not any("google-business" in item.name for item in disabled.resources)
    enabled = build_cloud({"clientbridge:googleBusinessEnabled": "true"})
    keys = [
        item
        for item in enabled.resources
        if item.type == "gcp:kms/cryptoKey:CryptoKey" and "google-business" in item.name
    ]
    assert keys
    assert all(item.inputs["rotationPeriod"] == "7776000s" for item in keys)
    grants = [
        item
        for item in enabled.resources
        if item.type == "gcp:kms/cryptoKeyIAMBinding:CryptoKeyIAMBinding"
        and "google-business" in item.name
    ]
    assert len(grants) == len(keys)
    assert all(
        item.inputs["role"] == "roles/cloudkms.cryptoKeyEncrypterDecrypter" for item in grants
    )
    enabled_apis = {
        item.inputs["service"]
        for item in enabled.resources
        if item.type == "gcp:projects/service:Service"
    }
    assert "mybusiness.googleapis.com" in enabled_apis
    assert "mybusinessaccountmanagement.googleapis.com" in enabled_apis
    assert "mybusinessbusinessinformation.googleapis.com" in enabled_apis
