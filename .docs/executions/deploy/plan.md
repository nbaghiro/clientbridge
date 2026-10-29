# Deploy plan

**Status: in progress; see [progress](progress.md).** This plan puts Clientbridge into production and staging on GKE Autopilot with a managed Cloud SQL database, sized for the lowest cost that keeps the design we would run at scale. It covers [CB-62](../../launch-readiness.md#run-production-safely-on-its-own-hosts-cb-62), [CB-64](../../launch-readiness.md#use-live-providers-safely-cb-64), [CB-63](../../launch-readiness.md#restore-from-backup-and-hear-about-errors-first-cb-63) and the backend half of [CB-61](../../launch-readiness.md#ship-store-builds-staff-can-install-cb-61). The [task queue](tasks.json) holds 16 dependency-ordered tasks; [progress](progress.md) records what has been done. Implementation starts only on the user's go; commits, pushes and schema changes stay separate approvals, consistent with `CLAUDE.md`.

## Shape

Every service runs as a workload on one GKE Autopilot cluster, and every piece of state lives on a managed service: Cloud SQL for the databases, Cloud Storage for files, Secret Manager for secrets and Artifact Registry for images. Production and staging are two namespaces in the same cluster, behind one Gateway. Pulumi, written in Python and checked by the same ruff and pyright gate as the backend, owns every cloud and Kubernetes resource. The only things made outside it are the generated secret values, each environment's database admin and the storage HMAC keys, which `infra/pulumi/secrets_init.py` creates so that no Pulumi state holds a secret.

The cost savings below are all sizing choices: replica counts, resource requests, Spot pods, a shared database instance and features left off. None of them changes the architecture, so each one is lifted by changing a value in the Pulumi program when its trigger is reached.

## Decisions

| Decision               | Choice                                                                                                                                                        | Why                                                                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cloud                  | Google Cloud with GKE Autopilot                                                                                                                               | The Kubernetes tier is about $145 a month cheaper than EKS: one Autopilot cluster's fee is covered by Google's monthly credit and Cloud NAT is cheaper than a NAT Gateway.                 |
| Region                 | `us-east1` (South Carolina) for every resource                                                                                                                | The cheapest price tier. Client data is stored in the United States: the privacy policy discloses it (PIPEDA), and selling in Quebec needs a privacy impact assessment under Law 25 first. |
| Infrastructure as code | Pulumi in Python under `infra/pulumi`, one program with three stacks (`cloud`, `staging`, `prod`), state in Pulumi Cloud                                      | One owner for every resource avoids the drift flowmaestro has between Pulumi, kustomize and hand-run commands, and a staging deploy cannot change production.                              |
| Environments           | Production and staging, each with one base domain: `clientbridge.ca` and `staging.clientbridge.ca`                                                            | Every hostname and URL is derived from the base domain, so staging works without per-service setup.                                                                                        |
| Session cookie         | The auth service served under the API host at `/auth`, so the session cookie is `__Host-` and bound to `api.<base>`                                           | A cookie on `.clientbridge.ca` would reach every staging host; a host-only `__Host-` cookie can neither be sent to staging nor overwritten by it.                                          |
| Deploys                | GitHub Actions with Workload Identity Federation, images by digest                                                                                            | No stored keys; the same digests are promoted from staging to production.                                                                                                                  |
| Auth service           | Named `auth` wherever it runs (workload, database, role, secrets, settings, URL path); Kratos is named only in its adapter and in files written in its format | Replacing Kratos then replaces one adapter, one config folder and one workload, while the URLs, cookies, secret names and database names the deploy creates stay as they are.              |

## Hostnames

Each environment uses its base domain `D`: `clientbridge.ca` in production and `staging.clientbridge.ca` in staging.

| Host     | Serves                                                  | Notes                                                                                                              |
| -------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `D`      | Marketing site                                          | `robots.txt` allows indexing only in production.                                                                   |
| `app.D`  | Staff web app                                           | WebAuthn RP ID is `app.D`, so a staging page can never use a production passkey.                                   |
| `book.D` | Connect: booking, client pages and `embed.js`           | One Connect build serves `book.`, `pay.` and `shop.`.                                                              |
| `pay.D`  | Pay links                                               |                                                                                                                    |
| `shop.D` | Online shop and pickup orders                           |                                                                                                                    |
| `api.D`  | API, `/webhooks/*` and the auth service under `/auth/*` | The Gateway strips `/auth` before the auth service; its admin API stays inside the cluster behind a NetworkPolicy. |
| `sync.D` | PowerSync                                               | The Gateway backend policy keeps streaming connections open for an hour.                                           |

## Layout

`infra/` holds only the configs of the third-party services we run and the cloud program. Each config exists once and is used locally, in CI and in the cluster; only environment variables differ.

```
infra/
├── auth/                    the auth service (Ory Kratos): kratos.yml, identity.schema.json,
│                            courier.jsonnet, oidc.google.jsonnet, standalone.sh (CI's backend jobs)
├── powersync/               powersync.yaml, sync-rules.yaml (also copied into the backend image),
│                            verification/ (the stack make test-sync runs against)
└── pulumi/
    ├── Pulumi.yaml · Pulumi.cloud.yaml · Pulumi.staging.yaml · Pulumi.prod.yaml · pyproject.toml
    ├── __main__.py          wires the stack's part: cloud/ for the cloud stack, kubernetes/ for an environment
    ├── environments.py      prod and staging: base domain, namespace, replicas, requests, Spot
    ├── cloud/               network, cluster, identity, registry, database, storage,
    │                        secrets, dns, certificates, observability
    ├── kubernetes/          namespace, settings (env vars for every backend container), sidecar
    │                        (Cloud SQL Auth Proxy), api, worker, migrate, auth, powersync,
    │                        web, redis, gateway
    └── tests/               the whole program built against Pulumi's mocks (cd infra/pulumi && uv run pytest)
```

Outside `infra/`: `backend/Dockerfile`, `frontend/Dockerfile` with `frontend/Caddyfile` (the web image's server config lives with the web image), `frontend/apps/mobile/eas.json`, `.github/workflows/deploy.yml` with `deploy-environment.yml` (the one environment's deploy that staging and production both call), and `docker-compose.yml`, whose digest pins for Kratos, PowerSync, Redis, the Auth Proxy and Postgres are also read by Pulumi, so local runs and the cluster run the same versions from one source.

The stack name selects the part of the program that runs. The `cloud` stack holds everything the environments share and is applied by an administrator: the network, cluster, identities, registry, database, buckets, secrets, DNS, certificates, observability, the three namespaces with each environment's deploy Role, and the Gateway. The `staging` and `prod` stacks each hold one namespace's workloads, routes and policies, read what they need from the cloud stack through a `StackReference` (service account emails, Secret Manager names, the bucket, the cluster endpoint, the database connection), and are applied by CI with two image digests. Neither creates a Google Cloud resource or anything outside its namespace.

Kubernetes objects are defined in Python under `kubernetes/` and applied by Pulumi, not kept as YAML applied by another tool. Cloud values (service account emails, the database connection name, image digests, the base domain) pass straight into each object, `pulumi preview` shows the diff of every object before a deploy, and pyright checks them. This avoids the two problems flowmaestro has from applying kustomize with `kubectl` outside Pulumi: values fixed by hand that each apply resets, and deploys that do not wait for migrations or rollouts.

### One Dockerfile for local runs and the cluster

Each Dockerfile has stages: `base` installs dependencies, `dev` runs from mounted source with reload, and `prod` bakes in the source and runs as a non-root user. The worker and the migrate Job run the backend `prod` image with a different command, so there are two images in total. The web Dockerfile builds the web, Connect and site bundles in one stage and copies them into Caddy with `frontend/Caddyfile`.

| Where                             | What runs                                                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Daily development                 | Native processes with hot reload, as today (`make dev-api`, `dev-web`)                                           |
| `docker compose --profile app up` | The `prod` images against the local Postgres, auth service, PowerSync and storage, the way the cluster runs them |
| CI e2e jobs                       | The images CI just built, so the tests exercise what gets deployed                                               |
| Staging and production            | The same images by digest, promoted from staging to production unchanged                                         |

## Architecture and cost choices

Each part lists what we run now and, after it, the scaled configuration and when we move to it.

### Cluster

One regional Autopilot cluster on the regular release channel, with Workload Identity, private nodes, Cloud NAT for outbound calls to Stripe, Twilio and Resend, and the control plane reached through its DNS endpoint with IAM. Namespaces `prod` and `staging`, each with its own Kubernetes service accounts mapped to its own Google service accounts.

- **Cost choice:** one cluster for both environments. The cluster fee ($73 a month) is covered by Google's free credit for one Autopilot cluster per billing account; a second cluster would pay it in full.
- **Scaled:** staging moves to its own project and cluster when a staging change must not be able to affect production, or when more than one person deploys.

### Workloads

Pods use Autopilot's small minimums and burst above their requests into spare capacity, so requests are set to steady use, not peaks. Production runs on regular pods; staging runs entirely on Spot pods.

| Workload             | Production now                                                                                                                            | Staging now                            | Scaled                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `api`                | 1 replica, 0.5 vCPU and 1 GiB requested; rolling updates surge one new pod before the old one stops, so deploys have no downtime          | 1 replica, Spot, 0.25 vCPU and 0.5 GiB | 2 or more replicas with an HPA on CPU and a PodDisruptionBudget, once one pod is busy or a node move must not drop requests. |
| `worker`             | 1 replica on Spot pods, 0.25 vCPU and 0.5 GiB; safe because each job commits after every send, so a preempted run resends nothing         | Same, Spot                             | Regular pods if Spot preemptions delay jobs noticeably. The cron schedule keeps one worker replica.                          |
| `migrate`            | A Job before each rollout: `db_access roles`, `alembic upgrade head`, `db_access grants`, the auth service's migrations                   | Same                                   | Unchanged.                                                                                                                   |
| `auth`               | 1 replica, 0.1 vCPU and 256 MiB                                                                                                           | 1 replica, Spot                        | 2 replicas with a PodDisruptionBudget.                                                                                       |
| `powersync`          | 1 pod running replication and the sync API, 0.25 vCPU and 768 MiB                                                                         | 1 pod, Spot                            | Replication as one pod and the sync API as its own Deployment with an HPA, when many devices stream at once.                 |
| `web`                | 1 Caddy pod (the web image) serving the web, Connect and site builds, 0.1 vCPU and 256 MiB; a runtime `config.js` carries the base domain | 1 pod, Spot                            | Static files in Cloud Storage behind Cloud CDN when site traffic grows.                                                      |
| `redis`              | 1 pod, queue only, no persistence, 0.05 vCPU and 128 MiB                                                                                  | 1 pod, Spot                            | Memorystore Basic when the queue must survive a pod restart, then Standard for failover.                                     |
| Cloud SQL Auth Proxy | Native sidecar in each pod that reaches the database, 0.05 vCPU and 128 MiB                                                               | Same                                   | Unchanged.                                                                                                                   |

### Database

One Cloud SQL for PostgreSQL 16 instance, `db-g1-small` (1.7 GB), zonal, with daily backups kept 7 days, point-in-time recovery, private IP only, TLS required and `cloudsql.logical_decoding=on`. It holds six databases: `clientbridge`, `auth` and `powersync_storage` for production, and the same three with a `staging_` prefix, each created by the environment's migrate step as its admin rather than by Pulumi. Each environment has its own roles from `scripts/db_access.py` and its own admin, `prod_admin` or `staging_admin`, which `secrets_init.py` creates and only that environment's migrate Job can read; on PostgreSQL 16 a CREATEROLE admin administers only the roles it created, so staging credentials cannot reach production data, and the built-in `postgres` user has no password. Connection pools are set small (`DB_POOL_SIZE=3`, `DB_MAX_OVERFLOW=1` per process) and `max_connections` is 120, from this count of what one environment opens at most (`kubernetes/settings.py` `peak_connections`, checked by a test):

| Client               | Production                                                                               | Staging                                    |
| -------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------ |
| API                  | 3 pods during a rollout × 2 uvicorn workers × (3 + 1) = 24                               | 2 pods during a rollout × 2 × (3 + 1) = 16 |
| Worker               | 1 process × (3 + 1) = 4                                                                  | 4                                          |
| Auth service         | 3 pods during a rollout × `max_conns=5` = 15                                             | 2 × 5 = 10                                 |
| PowerSync            | source and storage pools of 8 each (its default) plus replication streams, counted as 20 | 20                                         |
| Migrate Job          | 8, beside the old pods: 16 + 4 + 10 + 20 + 8 = 58                                        | 8 + 4 + 5 + 20 + 8 = 45                    |
| Peak per environment | 24 + 4 + 15 + 20 = 63                                                                    | 16 + 4 + 10 + 20 = 50                      |

Production runs two API, auth and web pods, each with a PodDisruptionBudget, so a node upgrade never stops the only one. Both environments can deploy at once, so the peak is 113, plus 5 kept for Cloud SQL's own connections, under 120. Idle connections cost a few MB each on the 1.7 GB tier; if memory runs short, lowering PowerSync's `max_pool_size` in `powersync.deployed.yaml` is the cheapest cut, and the larger tier is the next step.

- **Cost choice:** one small zonal instance for both environments, about $28 a month instead of about $125 for a dedicated production instance with HA plus a staging instance.
- **Scaled:** `db-custom-1-3840` when CPU or connections run high; staging on its own instance when it gets real load; regional HA once paying customers depend on uptime; a read replica for reports later. Each is a Pulumi setting, and the HA step needs the PowerSync slot's failover tested first.

### Edge

One Gateway (`gke-l7-global-external-managed`) on one static IP serves both environments, with an HTTPRoute per host. Certificate Manager issues two wildcard certificates through DNS authorization, one for `*.clientbridge.ca` and one for `*.staging.clientbridge.ca`, plus the two apex names. Port 80 redirects to HTTPS, and `www.D` redirects to `D`. `/webhooks/*` passes through with the raw body and path, since Stripe and Resend verify the body and Twilio signs the exact URL. Google's load balancer appends two hops to `X-Forwarded-For`, and the API trusts exactly two, so a client cannot choose its own rate-limit key or contract signer IP.

- **Cost choice:** one load balancer for both environments, and no Cloud Armor at first; the API's own limiter covers the public routes, and the auth service's own limits cover `/auth/*`.
- **Scaled:** a Cloud Armor policy with rate-limiting rules on `/auth/*` and the public routes (about $10 a month) when abuse appears or before a public launch push; a separate Gateway per environment when staging gets its own cluster.

### Storage, secrets and identity

- **Files:** one private Cloud Storage bucket per environment, with object versioning and a 30-day noncurrent-version lifecycle. The existing S3 adapter reaches it through the S3-compatible API with HMAC keys. Scaled: a native GCS adapter on Workload Identity, which removes the HMAC keys.
- **Secrets:** Secret Manager, mounted into pods as files by GKE's managed Secret Manager add-on; no External Secrets Operator to run and no Kubernetes Secrets. Each container's command is wrapped by a short `sh` script that exports each mounted file as the variable the process reads (`DATABASE_URL`, the auth service's `DSN`, PowerSync's `PS_DATA_SOURCE_URI`), so the images need no change. Pulumi creates only the empty secrets and who may read them, so no Pulumi state holds a secret value. `infra/pulumi/secrets_init.py`, run once per environment by an administrator after the cloud stack, generates the database URLs (and creates the environment's Cloud SQL admin with its password), `JWT_SECRET`, the PowerSync RS256 key with its key ID and an empty previous-keys map, the courier secret, the auth service's cookie and cipher secrets and the HMAC key; it adds a version only where none exists. The provider secrets (Stripe, Twilio, Resend, Expo, Google OAuth) are created empty and a person adds their values. The add-on fails a pod whose secret has no version, so every provider secret needs a value before an environment's first deploy. A pod reads its secrets when it starts, so a rotated value takes effect on the next rollout.
- **Identity:** each workload's service account reads only its own secrets and buckets. CI uses a GitHub OIDC pool restricted to `refs/heads/main` of this repository, with three service accounts: a builder that may only push and tag images, and one deployer per environment that only a job on `main` in that GitHub environment can use (`production` requires a reviewer). Both GitHub environments also allow deployments only from `main`. A deployer can reach the cluster (`container.clusterViewer`) and change only its own namespace, through a Kubernetes Role the cloud stack binds to it; it holds no Google Cloud role that changes a resource. The cluster's nodes run as their own service account with only the log writer, metric writer, resource metadata writer and repository reader roles, not the default compute account. The cloud stack is applied by an administrator.
- **Images:** Artifact Registry with a cleanup policy that never deletes an image tagged `staging-current` or `prod-…` (the deploy workflow tags every deployed digest), deletes `staging-<short sha>` images after 30 days, and keeps the 20 most recent versions of each image, so storage stays near the free 0.5 GB while production's history is kept.

### Deploys

1. On a push to `main` of this repository (never a pull request), after CI passes, the deploy workflow builds the backend image (API, worker and migrations) and the web image, and pushes both by digest.
2. It runs `pulumi up` on the `staging` stack with those digests: the migrate Job runs first and the deploy stops if it fails, then the rollout is waited on and a smoke test checks `api.` (`/health`, `/ready`), `sync.` (`/probes/liveness`) and `app.` (`/` and `config.js`).
3. Production runs the same step on the `prod` stack with the same digests behind the `production` GitHub environment's required reviewers. Each environment deploys one run at a time in its own concurrency group, a running deploy is never cancelled, and a push's deploy skips an environment that already runs a later commit of `main`. After the smoke test, the digests are tagged `<env>-current` and `<env>-<short sha>`.
4. Rollback is a manual run of the workflow with the environment, the previous digests and `rollback=true`. Migrations stay backward compatible for one release, and the registry keeps every digest production ran, so a rollback reaches back one migration. The rollback input sets `clientbridge:allowSchemaAhead=true`, which gives that run's migrate Job `MIGRATE_ALLOW_AHEAD=1`, so the older image skips the upgrade of a database at a revision it does not know; any other run fails on an unknown revision, which also catches a squashed baseline, a deleted revision or an image from another branch.

The migrate Job is named after the backend and auth service digests, so each new pair runs it once; it runs `migrate` and then the auth service's migrations (`kratos migrate sql up`) in one pod, and a failed Job is replaced on the next deploy. An environment stack refuses to run without both digests, so a run cannot change what an environment runs by leaving them out; `pulumi stack output images` shows the deployed ones.

### Observability

GKE sends container logs to Cloud Logging, which is free up to 50 GB a month, and Error Reporting groups the errors. Uptime checks on `api.` and `app.` alert by email. Alerts also cover database CPU and disk, replication slot lag (a stopped PowerSync fills the disk), a failed job run, failed webhooks and a monthly budget at $150.

- **Cost choice:** Managed Prometheus collection is turned off and workload metrics stay at GKE's free system metrics. It was flowmaestro's second-largest cost.
- **Scaled:** Managed Prometheus with a scrape on the API and PowerSync when we need request-level dashboards.

### Mobile

EAS build profiles `staging` and `production` carry the base domain, `expo-updates` is added for over-the-air updates, the EAS project id is set for push tokens, store builds set `STRIPE_TERMINAL_SIMULATED=false`, and the hard-coded production fallbacks are removed.

## Cost

Rough list prices for `us-east1`, in USD a month, before taxes.

| Item                                     | Now                           | Scaled (HA database, 2 API replicas, Memorystore, Cloud Armor, separate staging) |
| ---------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------- |
| Cluster fee                              | 0 (free credit)               | 73 for a second cluster                                                          |
| Production pods                          | 47                            | 110                                                                              |
| Worker on Spot                           | 4                             | 4                                                                                |
| Staging pods on Spot                     | 15                            | 35 on regular pods                                                               |
| Load balancer and IP                     | 19                            | 38 for two Gateways                                                              |
| Cloud Armor                              | 0                             | 10                                                                               |
| Cloud NAT                                | 3                             | 5                                                                                |
| Cloud SQL                                | 28 (one shared `db-g1-small`) | 125 (HA `db-custom-1-3840` plus a staging instance)                              |
| Memorystore                              | 0 (pod)                       | 36                                                                               |
| Secrets, registry, DNS, storage, logging | 3                             | 8                                                                                |
| **Total**                                | **about $119**                | **about $444**                                                                   |

One-year committed-use discounts on Autopilot and Cloud SQL, bought after a steady month, take about 20% off the first column, to about $100. The prices are list prices from memory and are checked against the bill in task D14.

## Code changes needed first

1. Staged Dockerfiles for the backend and web images (`base`, `dev`, `prod`), the production server command, `infra/powersync/sync-rules.yaml` copied into the backend image since the grants step reads it, and an `app` profile in `docker-compose.yml` that runs both images locally.
2. A readiness endpoint that checks the database and Redis (`/health` in `main.py` checks nothing today), a JSON logging config, and the worker pinned to UTC.
3. One `BASE_DOMAIN` setting that derives every URL (`WEB_BASE_URL`, `CORS_ALLOW_ORIGINS`, Connect, Pay, Shop, the auth service, PowerSync, the OAuth callback and the WebAuthn RP ID), a runtime `config.js` for the web image so the same image runs in both environments, and the catalog's `clientbridge.ca/` slug prefix passed in as an argument.
4. The production startup check in `core/config.py` also requires `STRIPE_SECRET_KEY`, `S3_*`, `REDIS_URL`, `DATABASE_URL` and the derived URLs, and checks that they agree with `BASE_DOMAIN`.
5. A trusted-hop setting for `X-Forwarded-For` in `core/ratelimit.py`, used by the rate limiter and the contract signer IP.
6. Auth service and PowerSync production values set through environment variables over the existing `infra/auth` and `infra/powersync` files, with no separate templates: Kratos without `--dev`, its public URL at `api.D/auth` with the Gateway stripping the prefix, a `__Host-` session cookie with path `/`, the RP ID and the courier hook over the cluster network; PowerSync with RS256 and `jwks_uri` pointing at `/sync/keys`.
7. `scripts/db_access.py` working on Cloud SQL, whose `postgres` user is not a superuser: grant the app roles to it before ownership changes, and create the publication as the migrator.
8. Stripe payment method domains registered for `book.`, `pay.` and `shop.`.
9. The auth service named for its role rather than its product: the `auth` workload, Service, NetworkPolicy, database and role, the `AUTH_*` secrets and settings (`AUTH_DATABASE_URL`, `AUTH_COOKIE_SECRET`, `AUTH_CIPHER_SECRET`, `AUTH_PUBLIC_PORT`, `auth_env`), `infra/auth/`, and the API contract's `second_factor` field and `second_factor_required` code. The local stack, CI and the backend already use these names; the Pulumi program, the gateway route and `core/deployment.py` take them on with the rest of this plan.

## Delivery stages

Dependencies in the [task queue](tasks.json) control the order; the stages below are the practical sequence.

| Stage                          | Tasks      | Checkpoint                                                                                                                                                      |
| ------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts and domain            | D00        | The GCP project, budget, Pulumi stacks and DNS delegation exist.                                                                                                |
| Make the code deployable       | D01 to D04 | The images build in CI, start from one base domain and pass the readiness check against a local stack with production-shaped configs.                           |
| Build the foundation           | D05 to D07 | `pulumi up` creates the network, cluster, database, buckets, secrets, Gateway and CI identity from nothing, and a second run changes nothing.                   |
| Run staging                    | D08 to D10 | Staging deploys from CI on every push to `main`, with every provider in test mode and logs and alerts working.                                                  |
| Prove recovery and the product | D11 to D12 | A point-in-time restore of staging completes from the runbook, and every stage's QA pass is clean on staging.                                                   |
| Go live                        | D13 to D15 | Production deploys behind approval, live providers are connected, the $1 live payment and refund in CB-64 pass, and `operations.md` describes how it all runs. |

## Risks to test on real infrastructure

- Each environment's admin (`<env>_admin`) is a CREATEROLE CREATEDB user that creates its own environment's roles and databases (Pulumi creates no database, so `cloudsqlsuperuser` owns none). That it cannot act for the other environment's roles or open its databases rests on PostgreSQL 16's CREATEROLE rules and on `db_access` handing each database to its migrator; `scripts/verify_db_access.py` proves this on stock PostgreSQL 16 with the admins outside `cloudsqlsuperuser`, but not on Cloud SQL. Cloud SQL may make API-created built-in users members of `cloudsqlsuperuser`, and that role carries Cloud SQL privileges stock PostgreSQL lacks, which could break the isolation. [First deploy](../../operations.md#first-deploy) steps 6 and 20 check it on the instance; the remedy is to revoke `cloudsqlsuperuser` from both admins once through the `postgres` user in `secrets_init.py`, or a dedicated instance per environment.
- The migrate Job reads the provider secrets because `db_access.py` and Alembic build `Settings`, whose startup check requires them.
- The replication slot alert uses `cloudsql.googleapis.com/database/disk/bytes_used_by_data_type` with `data_type="wal"`; confirm the metric and label on the instance during D10.

- `db_access.py` against Cloud SQL's limited `<env>_admin` users, before any deploy depends on it.
- The PowerSync replication slot after a point-in-time restore: the runbook must cover dropping the slot and letting PowerSync re-snapshot.
- Cloud Storage through the S3 API with the pinned boto3 version: uploads, presigned URLs and deletes.
- The auth service with a `__Host-` session cookie at `api.D/auth`, the prefix stripped by the Gateway: sign-in, recovery, Google sign-in and passkeys on web and mobile, and Kratos setting its session and CSRF cookies with path `/` behind the prefix.
- PowerSync streams through the Gateway with the long backend timeout, and the Spot staging pods restarting without losing sync state.
