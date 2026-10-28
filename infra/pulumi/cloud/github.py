"""Actions settings: deploy variables, a GitHub environment per stack and Stripe test keys."""

from collections.abc import Mapping, Sequence

import pulumi
import pulumi_github as github

from cloud.identity import Ci
from environments import Environment, StripeSandbox

DEPLOY_BRANCH = "main"


def create(
    repository: str,
    reviewer: str,
    project: str,
    region: str,
    ci: Ci,
    envs: Sequence[Environment],
    state_url: str,
    google_services: Mapping[str, pulumi.Output[str]],
    stripe: StripeSandbox | None,
) -> None:
    """Everything deploy.yml reads, applied with the administrator's GITHUB_TOKEN."""
    owner, name = repository.split("/", 1)
    provider = github.Provider("github", owner=owner)
    opts = pulumi.ResourceOptions(provider=provider)
    deployed = {env.name for env in envs}
    variables: dict[str, pulumi.Input[str]] = {
        "GCP_PROJECT": project,
        "GCP_REGION": region,
        "GCP_WORKLOAD_IDENTITY_PROVIDER": ci.provider.name,
        "GCP_BUILDER": ci.builder.email,
        "PULUMI_BACKEND_URL": state_url,
        # deploy.yml stops after staging until production is one of this project's environments
        "DEPLOY_PRODUCTION": "true" if "prod" in deployed else "false",
    }
    for key, value in variables.items():
        github.ActionsVariable(
            f"variable-{key.lower()}",
            repository=name,
            variable_name=key,
            value=value,
            opts=opts,
        )
    approver = github.get_user_output(
        username=reviewer, opts=pulumi.InvokeOptions(provider=provider)
    )
    for env in envs:
        gated = env.name == "prod"
        environment = github.RepositoryEnvironment(
            f"environment-{env.name}",
            repository=name,
            environment=env.github_environment,
            # production waits for an approval; staging deploys as soon as CI passes on main
            reviewers=[{"users": [approver.id.apply(int)]}] if gated else None,
            deployment_branch_policy={"protected_branches": False, "custom_branch_policies": True},
            opts=opts,
        )
        github.RepositoryEnvironmentDeploymentPolicy(
            f"environment-{env.name}-branch",
            repository=name,
            environment=environment.environment,
            branch_pattern=DEPLOY_BRANCH,
            opts=opts,
        )
        github.ActionsEnvironmentVariable(
            f"environment-{env.name}-deployer",
            repository=name,
            environment=environment.environment,
            variable_name="GCP_DEPLOYER",
            value=ci.deployers[env.name].email,
            opts=opts,
        )
        # deploy-mobile.yml hands it to EAS; a secret, since Actions prints variables in public logs
        github.ActionsEnvironmentSecret(
            f"environment-{env.name}-google-services",
            repository=name,
            environment=environment.environment,
            secret_name="GOOGLE_SERVICES",
            value=google_services[env.name],
            opts=opts,
        )
    if stripe is not None:
        sandbox(name, stripe, opts)


def sandbox(repository: str, stripe: StripeSandbox, opts: pulumi.ResourceOptions) -> None:
    """The Stripe sandbox's test keys and CI merchants, for any workflow that runs against it."""
    secrets = {
        "STRIPE_TEST_SECRET_KEY": stripe.secret_key,
        # a secret only so Actions masks it, like the Firebase file
        "STRIPE_TEST_PUBLISHABLE_KEY": stripe.publishable_key,
    }
    for key, value in secrets.items():
        github.ActionsSecret(
            f"secret-{key.lower()}",
            repository=repository,
            secret_name=key,
            value=value,
            opts=opts,
        )
    variables = {
        "STRIPE_TEST_PLATFORM": stripe.platform,
        "STRIPE_TEST_CONNECTED_ACCOUNT": stripe.connected_account,
        "STRIPE_TEST_OTHER_ACCOUNT": stripe.other_account,
    }
    for key, value in variables.items():
        github.ActionsVariable(
            f"variable-{key.lower()}",
            repository=repository,
            variable_name=key,
            value=value,
            opts=opts,
        )
