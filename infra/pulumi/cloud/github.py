"""The repository's deploy settings: Actions variables, and a GitHub environment per stack."""

from collections.abc import Sequence

import pulumi
import pulumi_github as github

from cloud.identity import Ci
from environments import Environment

DEPLOY_BRANCH = "main"


def create(
    repository: str,
    reviewer: str,
    project: str,
    region: str,
    ci: Ci,
    envs: Sequence[Environment],
    state_url: str,
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
