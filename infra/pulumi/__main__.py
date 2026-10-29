"""Wires the stack's part: the shared cloud stack, or one environment's workloads."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend" / "src"))

import pulumi

import environments
from cloud import (
    certificates,
    cluster,
    database,
    dns,
    firebase,
    github,
    google_business,
    identity,
    network,
    observability,
    quotas,
    registry,
    secrets,
    services,
    storage,
)
from kubernetes import (
    api,
    auth,
    compute,
    gateway,
    migrate,
    namespace,
    powersync,
    redis,
    seed,
    settings,
    web,
    worker,
)


def cloud_stack() -> None:
    import pulumi_gcp as gcp

    stack = environments.load_cloud()
    services.require(services.create(stack.project))
    project_number = gcp.organizations.get_project_output(project_id=stack.project).number
    quotas.create(stack.project, stack.region, stack.alert_email)
    net = network.create(stack.region)
    repository = registry.create(stack.region)
    gke = cluster.create(stack.project, stack.region, net, repository)
    ci = identity.ci(stack.project, stack.github_repository, repository, stack.environments)
    identity.state_access(ci, stack.environments, stack.state_bucket, stack.state_key)
    instance = database.create(stack.region, stack.database_zone, net)
    ip = gateway.address()
    zones = {env.name: dns.zone(env) for env in stack.environments}
    for env in stack.environments:
        dns.hosts(zones[env.name], env, ip.address)
        # Google Workspace receives mail on the registered domain, which production serves
        dns.mail(zones[env.name], env, stack.mail_records, apex=env.name == "prod")
        above = dns.parent(env, stack.environments)
        if above is not None:
            dns.delegate(zones[above.name], zones[env.name], env.base_domain)
    certificate_map = certificates.create(zones, stack.environments)
    pushes = firebase.create(stack.project, stack.environments, stack.signing_certs)
    publisher = firebase.play_publisher()
    github.create(
        stack.github_repository,
        stack.github_reviewer,
        stack.project,
        stack.region,
        ci,
        stack.environments,
        f"gs://{stack.state_bucket}",
        {name: push.services_file for name, push in pushes.items()},
        stack.stripe_sandbox,
    )
    observability.create(
        stack.project,
        stack.region,
        project_number,
        stack.environments,
        instance.sql,
        stack.alert_email,
        stack.billing_account,
        stack.budget_amount,
        stack.budget_currency,
    )
    endpoint = cluster.dns_endpoint(gke)
    provider = namespace.provider("gke", endpoint)
    compute.create(provider)
    gateway.create(ip, certificate_map, provider, stack.environments)

    shared: dict[str, object] = {}
    for env in stack.environments:
        files = storage.create(stack.project, stack.region, env)
        accounts = identity.workload_accounts(
            stack.project, project_number, env, list(settings.ACCOUNTS), gke
        )
        if pulumi.Config().get_bool("googleBusinessEnabled"):
            google_key = google_business.create(
                stack.project,
                stack.region,
                env,
                [member for name in ("api", "worker") for member in accounts[name].members],
            )
            pulumi.export(f"{env.name}GoogleBusinessKmsKey", google_key.id)
        # empty containers: secrets_init.py writes the generated values, so no state holds one
        stored = secrets.create(
            stack.region,
            env,
            settings.CATALOG,
            {
                name: [
                    member
                    for workload, account in accounts.items()
                    if name in settings.readers(workload)
                    for member in account.members
                ]
                for name in settings.CATALOG
            },
        )
        namespace.create(env, ci.deployers[env.name].email, provider)
        shared[env.name] = {
            "bucket": files.bucket.name,
            "filesAccount": files.account.email,
            "adminUser": database.admin_user(env),
            "accounts": {name: account.google.email for name, account in accounts.items()},
            "secrets": {name: secret.id for name, secret in stored.items()},
            "deployer": ci.deployers[env.name].email,
            "pushSender": pushes[env.name].sender.email,
            "googleServicesFile": pushes[env.name].services_file,
        }

    pulumi.export("environments", shared)
    pulumi.export("cluster", {"name": gke.name, "endpoint": endpoint})
    pulumi.export("registry", registry.location(stack.project, stack.region))
    pulumi.export("databaseConnection", instance.sql.connection_name)
    pulumi.export("databaseInstance", instance.sql.name)
    pulumi.export("gatewayAddress", ip.address)
    # the records to add at the registrar: one NS set per zone no other zone here delegates
    pulumi.export(
        "nameServers",
        {
            env.base_domain: zones[env.name].name_servers
            for env in stack.environments
            if dns.parent(env, stack.environments) is None
        },
    )
    pulumi.export("workloadIdentityProvider", ci.provider.name)
    pulumi.export("builderServiceAccount", ci.builder.email)
    pulumi.export("playPublisher", publisher.email)
    pulumi.export("projectNumber", project_number)


def environment_stack(name: str) -> None:
    stack = environments.load_deployment(name)
    env = stack.env
    cloud = pulumi.StackReference(stack.cloud_stack)
    # project:region:instance, with a restored clone's name when databaseInstance is set
    connection = cloud.require_output("databaseConnection").apply(
        lambda shared: (
            f"{shared.rsplit(':', 1)[0]}:{stack.database_instance}"
            if stack.database_instance
            else str(shared)
        )
    )
    shared = cloud.require_output("environments").apply(lambda each: each[env.name])
    provider = namespace.provider(
        "gke", cloud.require_output("cluster").apply(lambda each: each["endpoint"])
    )
    scaffolding = namespace.scaffolding(
        env,
        {
            workload: shared.apply(lambda each, w=workload: each["accounts"][w])
            for workload in settings.ACCOUNTS
        },
        provider,
    )
    ctx = settings.Context(
        env=env,
        provider=provider,
        scaffolding=scaffolding,
        images=stack.images,
        registry=cloud.require_output("registry"),
        upstream=settings.upstream_images(settings.COMPOSE),
        connection_name=connection,
        bucket=shared.apply(lambda each: each["bucket"]),
        secrets={
            secret: shared.apply(lambda each, s=secret: each["secrets"][s])
            for secret in settings.CATALOG
        },
        stripe_publishable_key=stack.stripe_publishable_key,
        app_links=stack.app_links,
        allow_schema_ahead=stack.allow_schema_ahead,
    )
    cache = redis.create(ctx)
    job = migrate.create(ctx)
    identities = auth.create(ctx, [job])
    served = [
        api.create(ctx, [job]),
        identities,
        powersync.create(ctx, [job]),
        web.create(ctx, [job]),
    ]
    worker.create(ctx, [job, cache])
    if env.demo:
        seed.create(ctx, [job, identities])
    gateway.routes(env, provider, [*scaffolding, *served])
    pulumi.export("images", {"backend": stack.images.backend, "web": stack.images.web})
    pulumi.export("baseDomain", env.base_domain)
    pulumi.export("databaseConnection", connection)


if pulumi.get_stack() == environments.CLOUD_STACK:
    cloud_stack()
else:
    environment_stack(pulumi.get_stack())
