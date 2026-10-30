# Deploy progress

Planned on 13 October 2026; D01 to D10 are written in code, staging was applied on 16 October 2026 (see the last section), production is not applied, and `operations.md` holds the first-deploy checklist. The [task queue](tasks.json) is the status source and the [plan](plan.md) holds the design, costs and scaling steps.

## Inputs

| Input                                 | Where it came from                                                                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| What Clientbridge needs in production | A read-only review of `main` covering every process, self-hosted service, Postgres requirement, hostname and webhook.                                                                                  |
| What to copy and avoid                | A read-only review of the flowmaestro GKE and Pulumi setup: keep its private Cloud SQL, keyless CI and migration step; avoid its missing backups, split ownership between tools and unchecked deploys. |
| Cloud and cost comparison             | Google Cloud against AWS for a single VM and for Kubernetes; the VM tier costs the same, Kubernetes is about $145 a month cheaper on GKE.                                                              |
| Decisions                             | GKE Autopilot from the start, sized for cost, in `us-east1`, `staging.clientbridge.ca`, separate `book.`, `pay.` and `shop.` hosts, a zonal database with PITR, Pulumi in Python.                      |

## D05 to D10: the Pulumi program, deploy workflow and EAS profiles (code only)

Written on 13 October 2026 and checked locally without cloud access; nothing has been applied, so each task's acceptance still waits for a real `pulumi up`.

| Task | Done in code                                                                                                                                                                                                                                                                                                       | Still needs real infrastructure                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| D05  | `infra/pulumi` project with uv, the VPC, private service access, Cloud NAT and the health-check firewall, the Autopilot cluster, per-workload service accounts, Artifact Registry with a cleanup policy that keeps deployed tags, and the GitHub OIDC pool with a builder account and one deployer per environment | The first `pulumi up` of the cloud stack from an empty project and a second run with no changes |
| D06  | The Cloud SQL instance (protected, PITR, logical decoding), the six databases (created by `db_access roles`, not Pulumi), one bucket per environment with CORS, and an empty Secret Manager secret for everything the startup check needs, filled by `secrets_init.py`                                             | `db_access roles`, `alembic upgrade head` and `grants` against the instance                     |
| D07  | One module per workload in both namespaces, network policies, the Auth Proxy as a native sidecar, the migrate Job, Kratos and PowerSync ConfigMaps from the files on disk, the Gateway on a static IP, HTTPRoutes per host, the redirect, health check and sync timeout policies, DNS and certificates             | HTTPS on every host, a zero-failure rollout and a webhook verified through the Gateway          |
| D08  | `.github/workflows/deploy.yml` and `deploy-environment.yml`: build and push by digest, the `staging` stack, the `prod` stack behind approval, rollback by manual run; an `infra` job in `ci.yml`                                                                                                                   | Repository variables, the `production` environment and a first run                              |
| D09  | `frontend/apps/mobile/eas.json` with development, staging and production profiles that set only `BASE_DOMAIN` and `STRIPE_TERMINAL_SIMULATED`                                                                                                                                                                      | The EAS items below, provider setup and device builds                                           |
| D10  | Uptime checks, alerts on database CPU and disk, retained WAL, failed job runs and webhook failures, the email channel and the budget                                                                                                                                                                               | The alert drills in the acceptance                                                              |

The program has three stacks: `cloud` (applied by an administrator), and `staging` and `prod` (applied by CI), which read the cloud stack through a `StackReference`. Kratos and PowerSync take their environment from `clientbridge.core.deployment` (`kratos_env`, `powersync_env`, `KRATOS_COMMAND` and the secret variable names), which the program imports from `backend/src`. `docker-compose.yml` pins the Cloud SQL Auth Proxy (2.26.0) under a `deploy` profile, and `core/logs.py` writes the traceback to `stack_trace` as well as `exception`, so Error Reporting groups errors.

Checks: `cd infra/pulumi && uv sync && uv run ruff check . && uv run pyright && uv run pytest`, which the `infra` job in `ci.yml` also runs. The tests build the cloud stack against Pulumi's mocks, then feed its outputs to the staging and prod stacks through the mocked `StackReference`, and assert that:

- the cloud stack runs no workloads, and an environment stack creates no Google Cloud resource and nothing outside its own namespace;
- each namespace's Role is bound only to its own deployer, the production deployer can be used only by a job in the `production` GitHub environment, and no deployer holds a Google Cloud role beyond `container.clusterViewer`;
- every host has a route and a DNS record, and the API host sends the Kratos paths to Kratos;
- the Kratos and PowerSync containers' environment equals `kratos_env` and `powersync_env` with the in-cluster URLs, their exported secrets equal `KRATOS_SECRETS` and `POWERSYNC_SECRETS`, and PowerSync mounts `powersync.deployed.yaml` and `sync-rules.yaml`;
- staging runs on Spot and production only its worker, with the plan's requests;
- the database keeps PITR, logical decoding, private IP and TLS;
- no resource input or stack output in any stack is a secret, the program has no `random` or `tls` resources, secret versions or HMAC keys, every catalog secret is an empty container, and pods mount the cloud stack's secret names;
- the migrate Job is a dependency of the API, worker, Kratos, PowerSync and web Deployments and changes name with the backend digest, and an environment stack without digests stops;
- only the API and worker reach Kratos's admin port.

## Operations doc and a second local image check (13 October 2026)

[`operations.md`](../../operations.md) is written as the new root doc with what exists now: environments and hosts, the three stacks and their config keys, every setting and secret per provider (generated or filled by a person, derived from `core/config.py`, `core/deployment.py` and `kubernetes/settings.py`), provider setup, a 21-step first-deploy checklist, deploys and rollback, the jobs table, health checks and alerts, the restore runbook (marked untested until D11) and a link to the plan's scaled configurations. The production paragraphs of `engineering.md` (Stripe webhook secrets, Resend production setup, PowerSync key rotation) moved there, with one-line pointers left behind. D15's remaining parts (updating CB-61 and CB-64, and deleting this folder) wait for go-live.

The images were rebuilt from this branch (`make images`) and run against a throwaway database on the shared local services, without starting, stopping or recreating any of them:

```
docker exec clientbridge-postgres-1 psql -U clientbridge -d postgres -c "CREATE DATABASE clientbridge_test_appcheck2"
APP_DATABASE=clientbridge_test_appcheck2 docker compose -p clientbridge --profile app run --rm --no-deps \
  -e POWERSYNC_STORAGE_DATABASE_URL=postgresql://powersync_storage_owner:…@postgres:5432/clientbridge_test_appcheck2_ps \
  -e AUTH_DATABASE_URL=postgres://kratos:…@postgres:5432/clientbridge_test_appcheck2_kratos migrate
APP_DATABASE=clientbridge_test_appcheck2 docker compose -p clientbridge --profile app up -d --no-deps --no-build api worker web
```

The storage and Kratos URLs point at throwaway databases too, so `db_access roles` changed no shared database. Migrate reached `cb0008` with the `powersync` publication owned by the migrator (35 tables); `/health` and `/ready` on :8750 answered 200 (`/ready` checks the database and Redis); `/` and `/config.js` answered 200 on `localhost`, `site.localhost`, `book.localhost`, `pay.localhost` and `shop.localhost` on :8751, with the site's own title on `site.` and `robots.txt` disallowing everything outside production; the worker started its 16 cron jobs and ran `send_due_broadcasts`. The shared auth on :8713 was healthy. The three containers were then removed, the three throwaway databases dropped and Redis database 1 flushed.

Open items found while writing `operations.md`:

- Done in the fix round below: the mail records are in `cloud/dns.py`, each environment has a `databaseInstance` setting for the restore, PowerSync's key ID and previous keys are secrets, the cloud stack's state holds no secret, and ledger drift raises an alert.
- Still unchecked: whether the GitHub plan allows required reviewers on this private repository.

Open items for the people setting this up (the full order is in [First deploy](../../operations.md#first-deploy)):

- D00 enables only Service Usage and Cloud Resource Manager by hand; the cloud stack enables every other API it uses (`cloud/services.py`) before any resource that needs one. Then an administrator creates the stacks `cloud`, `staging` and `prod` and applies `cloud` first.
- GitHub needs the repository variables `GCP_PROJECT`, `GCP_REGION`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_BUILDER` and `PULUMI_ORG` (from the cloud stack's `workloadIdentityProvider` and `builderServiceAccount` outputs), the environments `staging` and `production` (the second with required reviewers), each with a `GCP_DEPLOYER` variable (`environments.<env>.deployer` in the cloud stack's outputs) and a `PULUMI_ACCESS_TOKEN` secret. Pulumi Cloud permissions should let the staging token update only the `staging` stack.
- EAS: create the EAS project and set `extra.eas.projectId` in `app.config.ts`, add `expo-updates` with `updates.url` (the profiles' `channel` values take effect once it is installed), and set `STRIPE_PUBLISHABLE_KEY` per profile when the Stripe keys exist. `app.config.ts` still falls back to production URLs for `publicWebUrl`, `payUrl` and `bookUrl` when `BASE_DOMAIN` is unset, which the plan's Mobile section says to remove.

## Fix round: Pulumi findings (13 October 2026)

The review's Pulumi findings and the gaps above, fixed in `infra/pulumi` against the shared fix contract and checked with `ruff check`, `ruff format --check`, `pyright` and `pytest` (mocks only; nothing applied):

- No secret value is in any Pulumi state. The program creates only the Secret Manager containers and their IAM; `pulumi-random` and `pulumi-tls` are gone, and `infra/pulumi/secrets_init.py` writes the generated values once per environment (`uv run python secrets_init.py --env staging|prod --project <id> [--dry-run]`). It uses the standard library with a `gcloud` access token and `openssl`, because the contract's `google-cloud-secret-manager` could not be added to the lock without network access; it calls the same Secret Manager, Cloud SQL Admin and Storage REST APIs. The environment stacks read only non-secret outputs.
- Each environment has its own admin, `prod_admin` or `staging_admin`, in its own `ADMIN_DATABASE_URL`, read only by its own migrate Job. Cloud SQL requires a password for a built-in PostgreSQL user, so `secrets_init.py` creates the admin (or sets its password on a restored clone) instead of the cloud stack, and the instance has no root password, so `postgres` is used by nothing.
- Every container runs with the numeric user and group of its image, read with `docker image inspect` on the pinned digests: Kratos 10000:101, PowerSync 901:901, Redis 999:999 (its image runs as root and drops to `redis` itself; run as 999, the entrypoint skips that step), the Auth Proxy 65532:65532, and the backend and web images 10001:10001.
- The Autopilot nodes run as `cb-nodes` with the logging, monitoring, resource metadata and repository reader roles.
- `gcp:userProjectOverride` and `gcp:billingProject` are set in `Pulumi.cloud.yaml`, and the program refuses to run the cloud stack without them.
- The zone holds the Workspace MX, SPF and DMARC records, production's existing Resend and Workspace DKIM records (copied with `dig`), staging's Resend records as `clientbridge:mailRecords` entries to fill, and `www.` for both environments, redirected to the apex by routes in the Gateway's namespace.
- `clientbridge:databaseInstance` in an environment stack points its pods at a restored clone.
- `POWERSYNC_KID` and `POWERSYNC_PREVIOUS_PUBLIC_KEYS` are per-environment secrets. `secrets_init.py` writes `{}` to the second, so it is always mounted and a rotation is a new version and a restart.
- A log-based metric and alert match `ledger drift` errors from `clientbridge.services.ledger`.
- The registry keeps every image tagged `prod-…` or `staging-current`, keeps `staging-<short sha>` images for 30 days, and keeps the 20 most recent versions of each image.
- Staging's migrate Job retries twice (`backoff_limit` 2, since it runs on Spot and its steps are idempotent); production's stays at 0, so a failed production migration stops the deploy.
- The API, Kratos and web pods sleep 10 seconds in `preStop`, and uvicorn has 10 seconds to finish (`--timeout-graceful-shutdown`), within the 25-second grace period. The web Deployment waits on the migrate Job. The worker's liveness probe runs `arq --check`; it notices a hung worker only after arq's `health_check_interval` (3600 seconds by default, set in `tasks/worker.py`). The deployer Role can read `pods/log`.
- `DB_POOL_SIZE=3` and `DB_MAX_OVERFLOW=2` were set (now 1, see the review round below) for the backend, and `max_connections` is 120 from the count in the plan's Database section.

Left open: PowerSync's pool sizes are its defaults (8 per pool), which is most of the connection budget, and `infra/powersync` was outside this round.

## Auth naming after the rebase (14 October 2026)

The branch was rebased onto `main` after the auth naming change, and the deploy code now follows it. The sections above keep the names used when they were written. The workload, Service, NetworkPolicy, database and role are `auth` (with the `staging_` prefix in staging), the migrate Job's second container is `auth-migrate`, `core/deployment.py` exports `auth_env`, `AUTH_COMMAND` and `AUTH_SECRETS`, and the Pulumi module is `kubernetes/auth.py`. The auth service's public API moved from the four Kratos path prefixes on `api.D` to one `/auth` prefix that the Gateway strips with a `URLRewrite` filter, so Kratos's base URL is `https://api.D/auth/`, `AUTH_PUBLIC_URL` and the web and mobile `authUrl` are `https://api.D/auth`, and the Google callback is `https://api.D/auth/self-service/methods/oidc/callback/google`. The session cookie stays `__Host-cb_session` on path `/`.

## Staging applied (16 October 2026)

The cloud and staging stacks were applied by hand with `pulumi up`, since `deploy.yml` runs only from `main`, and the deployed digests are tagged `staging-current`. Every host on `staging.clientbridge.ca` returns 200 and `www.` redirects. The seed Job wrote the demo businesses, and `stripe_setup --link-only` linked them to their sandbox accounts and Terminal locations. Applying it found three problems, now fixed in the program: the new project's 250 GB SSD quota fit only two default nodes, so nodes boot from 30 GB `pd-balanced` disks through the `small-disk` and `small-disk-spot` compute classes (Google denied the quota increase requests, and alerts fire at 80% of the SSD and CPU quotas); GKE refuses a Spot selector beside a custom class, so pods select only the class; and the web pod drops every capability, so the image strips Caddy's file capability and CI starts each image that way.

Still open: the Twilio number waits on the account's Trust Hub approval (then rerun `make infra-providers ENV=staging`), the first `deploy.yml` run checks the deployer's RBAC, the admin isolation check needs production, the demo businesses need Stripe onboarding, and the EAS items in `operations.md` are not set.

## Review round (16 October 2026)

A review of the branch found these, fixed in code and not yet applied:

- Each environment and host has its own Gateway listener with its exact hostname, taking routes only from that environment's namespace (`kubernetes.io/metadata.name`), so a staging deployer can no longer route a production host. A wildcard listener would not do, since `*.clientbridge.ca` also matches the staging hosts. Applying the cloud stack replaces the shared `https` listener, so staging's routes detach until the staging stack is applied next.
- Production runs two API, auth and web pods with a PodDisruptionBudget each; `DB_MAX_OVERFLOW` drops from 2 to 1 so both environments still fit `max_connections=120` without restarting the instance.
- A missing secret file now stops the container instead of starting it with an empty value.
- A test refuses a `secure:` value in any stack config, since every deployer can decrypt with the shared state key.
- A failed Stripe setup prints its output with the secrets cut to their prefixes, and the environment deploy jobs no longer receive the repository's secrets.
