# Deploy plan

**Status: planned, not started.** This plan puts Clientbridge into production and staging on GKE Autopilot with a managed Cloud SQL database, sized for the lowest cost that keeps the design we would run at scale. It covers [CLI-50](../../launch-readiness.md#production-hosting-deploys-and-security-cli-50), [CLI-51](../../launch-readiness.md#backups-monitoring-and-alerts-cli-51) and the backend half of [CLI-52](../../launch-readiness.md#iphone-and-android-store-release-cli-52). The [task queue](tasks.json) holds 16 dependency-ordered tasks; [progress](progress.md) records what has been done. Implementation starts only on the user's go; commits, pushes and schema changes stay separate approvals, consistent with `CLAUDE.md`.

## Shape

Every service runs as a workload on one GKE Autopilot cluster, and every piece of state lives on a managed service: Cloud SQL for the databases, Cloud Storage for files, Secret Manager for secrets and Artifact Registry for images. Production and staging are two namespaces in the same cluster, behind one Gateway. Pulumi, written in Python and checked by the same ruff and pyright gate as the backend, owns every cloud and Kubernetes resource, and nothing is created by hand.

The cost savings below are all sizing choices: replica counts, resource requests, Spot pods, a shared database instance and features left off. None of them changes the architecture, so each one is lifted by changing a value in the Pulumi program when its trigger is reached.

## Decisions

| Decision               | Choice                                                                                             | Why                                                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cloud                  | Google Cloud with GKE Autopilot                                                                    | The Kubernetes tier is about $145 a month cheaper than EKS: one Autopilot cluster's fee is covered by Google's monthly credit and Cloud NAT is cheaper than a NAT Gateway.                 |
| Region                 | `us-east1` (South Carolina) for every resource                                                     | The cheapest price tier. Client data is stored in the United States: the privacy policy discloses it (PIPEDA), and selling in Quebec needs a privacy impact assessment under Law 25 first. |
| Infrastructure as code | Pulumi in Python under `infra/pulumi`, one stack, state in Pulumi Cloud                            | One owner for every resource avoids the drift flowmaestro has between Pulumi, kustomize and hand-run commands.                                                                             |
| Environments           | Production and staging, each with one base domain: `clientbridge.ca` and `staging.clientbridge.ca` | Every hostname and URL is derived from the base domain, so staging works without per-service setup.                                                                                        |
| Session cookie         | Kratos served under the API host, so the session cookie is `__Host-` and bound to `api.<base>`     | A cookie on `.clientbridge.ca` would reach every staging host; a host-only `__Host-` cookie can neither be sent to staging nor overwritten by it.                                          |
| Deploys                | GitHub Actions with Workload Identity Federation, images by digest                                 | No stored keys; the same digests are promoted from staging to production.                                                                                                                  |

## Hostnames

Each environment uses its base domain `D`: `clientbridge.ca` in production and `staging.clientbridge.ca` in staging.

| Host     | Serves                                                           | Notes                                                                            |
| -------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `D`      | Marketing site                                                   | `robots.txt` allows indexing only in production.                                 |
| `app.D`  | Staff web app                                                    | WebAuthn RP ID is `app.D`, so a staging page can never use a production passkey. |
| `book.D` | Connect: booking, client pages and `embed.js`                    | One Connect build serves `book.`, `pay.` and `shop.`.                            |
| `pay.D`  | Pay links                                                        |                                                                                  |
| `shop.D` | Online shop and pickup orders                                    |                                                                                  |
| `api.D`  | API, `/webhooks/*` and Kratos (`/self-service/*`, `/sessions/*`) | Kratos's admin API stays inside the cluster behind a NetworkPolicy.              |
| `sync.D` | PowerSync                                                        | The Gateway backend policy keeps streaming connections open for an hour.         |

## Architecture and cost choices

Each part lists what we run now and, after it, the scaled configuration and when we move to it.

### Cluster

One regional Autopilot cluster on the regular release channel, with Workload Identity, private nodes, Cloud NAT for outbound calls to Stripe, Twilio and Resend, and the control plane reached through its DNS endpoint with IAM. Namespaces `prod` and `staging`, each with its own Kubernetes service accounts mapped to its own Google service accounts.

- **Cost choice:** one cluster for both environments. The cluster fee ($73 a month) is covered by Google's free credit for one Autopilot cluster per billing account; a second cluster would pay it in full.
- **Scaled:** staging moves to its own project and cluster when a staging change must not be able to affect production, or when more than one person deploys.

### Workloads

Pods use Autopilot's small minimums and burst above their requests into spare capacity, so requests are set to steady use, not peaks. Production runs on regular pods; staging runs entirely on Spot pods.

| Workload             | Production now                                                                                                                    | Staging now                            | Scaled                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `api`                | 1 replica, 0.5 vCPU and 1 GiB requested; rolling updates surge one new pod before the old one stops, so deploys have no downtime  | 1 replica, Spot, 0.25 vCPU and 0.5 GiB | 2 or more replicas with an HPA on CPU and a PodDisruptionBudget, once one pod is busy or a node move must not drop requests. |
| `worker`             | 1 replica on Spot pods, 0.25 vCPU and 0.5 GiB; safe because each job commits after every send, so a preempted run resends nothing | Same, Spot                             | Regular pods if Spot preemptions delay jobs noticeably. The cron schedule keeps one worker replica.                          |
| `migrate`            | A Job before each rollout: `db_access roles`, `alembic upgrade head`, `db_access grants`, `kratos migrate`                        | Same                                   | Unchanged.                                                                                                                   |
| `kratos`             | 1 replica, 0.1 vCPU and 256 MiB                                                                                                   | 1 replica, Spot                        | 2 replicas with a PodDisruptionBudget.                                                                                       |
| `powersync`          | 1 pod running replication and the sync API, 0.25 vCPU and 768 MiB                                                                 | 1 pod, Spot                            | Replication as one pod and the sync API as its own Deployment with an HPA, when many devices stream at once.                 |
| `web`                | 1 Caddy pod serving the web, Connect and site builds, 0.1 vCPU and 256 MiB; a runtime `config.js` carries the base domain         | 1 pod, Spot                            | Static files in Cloud Storage behind Cloud CDN when site traffic grows.                                                      |
| `redis`              | 1 pod, queue only, no persistence, 0.05 vCPU and 128 MiB                                                                          | 1 pod, Spot                            | Memorystore Basic when the queue must survive a pod restart, then Standard for failover.                                     |
| Cloud SQL Auth Proxy | Native sidecar in each pod that reaches the database, 0.05 vCPU and 128 MiB                                                       | Same                                   | Unchanged.                                                                                                                   |

### Database

One Cloud SQL for PostgreSQL 16 instance, `db-g1-small` (1.7 GB), zonal, with daily backups kept 7 days, point-in-time recovery, private IP only, TLS required and `cloudsql.logical_decoding=on`. It holds six databases: `clientbridge`, `kratos` and `powersync_storage` for production, and the same three with a `staging_` prefix. Each environment has its own roles from `scripts/db_access.py`, so staging credentials cannot reach production data. Connection pools are set small (API 5 plus 5 overflow) to stay under the instance's connection limit.

- **Cost choice:** one small zonal instance for both environments, about $28 a month instead of about $125 for a dedicated production instance with HA plus a staging instance.
- **Scaled:** `db-custom-1-3840` when CPU or connections run high; staging on its own instance when it gets real load; regional HA once paying customers depend on uptime; a read replica for reports later. Each is a Pulumi setting, and the HA step needs the PowerSync slot's failover tested first.

### Edge

One Gateway (`gke-l7-global-external-managed`) on one static IP serves both environments, with an HTTPRoute per host. Certificate Manager issues two wildcard certificates through DNS authorization, one for `*.clientbridge.ca` and one for `*.staging.clientbridge.ca`, plus the two apex names. Port 80 redirects to HTTPS. `/webhooks/*` passes through with the raw body and path, since Stripe and Resend verify the body and Twilio signs the exact URL. Google's load balancer appends two hops to `X-Forwarded-For`, and the API trusts exactly two, so a client cannot choose its own rate-limit key or contract signer IP.

- **Cost choice:** one load balancer for both environments, and no Cloud Armor at first; the API's own limiter covers `/self-service/*` and the public routes.
- **Scaled:** a Cloud Armor policy with rate-limiting rules on `/self-service/*` and the public routes (about $10 a month) when abuse appears or before a public launch push; a separate Gateway per environment when staging gets its own cluster.

### Storage, secrets and identity

- **Files:** one private Cloud Storage bucket per environment, with object versioning and a 30-day noncurrent-version lifecycle. The existing S3 adapter reaches it through the S3-compatible API with HMAC keys. Scaled: a native GCS adapter on Workload Identity, which removes the HMAC keys.
- **Secrets:** Secret Manager, mounted into pods by GKE's managed Secret Manager add-on; no External Secrets Operator to run.
- **Identity:** each workload's service account reads only its own secrets and buckets. CI uses a GitHub OIDC pool restricted to this repository.
- **Images:** Artifact Registry with a cleanup policy that keeps the last 10 digests per image, so storage stays inside the free 0.5 GB.

### Deploys

1. On `main`, CI builds the backend image (API, worker and migrations) and the web image, and pushes both by digest.
2. CI runs `pulumi up` for staging with those digests: the migrate Job runs first and the deploy stops if it fails, then the rollout is waited on and a smoke test checks `api.`, `sync.` and `app.`.
3. Production runs the same step with the same digests behind a manual approval on a GitHub environment.
4. Rollback redeploys the previous digests. Migrations stay backward compatible for one release.

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

1. Dockerfiles for the backend and web images, the production server command and `infra/powersync/sync-rules.yaml` copied into the backend image, since the grants step reads it.
2. A readiness endpoint that checks the database and Redis (`/health` in `main.py` checks nothing today), a JSON logging config, and the worker pinned to UTC.
3. One `BASE_DOMAIN` setting that derives every URL (`WEB_BASE_URL`, `CORS_ALLOW_ORIGINS`, Connect, Pay, Shop, Kratos, PowerSync, the OAuth callback and the WebAuthn RP ID), a runtime `config.js` for the web image so the same image runs in both environments, and the catalog's `clientbridge.ca/` slug prefix passed in as an argument.
4. The production startup check in `core/config.py` also requires `STRIPE_SECRET_KEY`, `S3_*`, `REDIS_URL`, `DATABASE_URL` and the derived URLs, and checks that they agree with `BASE_DOMAIN`.
5. A trusted-hop setting for `X-Forwarded-For` in `core/ratelimit.py`, used by the rate limiter and the contract signer IP.
6. Templated Kratos and PowerSync configs: Kratos without `--dev`, its public URL under `api.D`, a `__Host-` session cookie, the RP ID and the courier hook over the cluster network; PowerSync with RS256 and `jwks_uri` pointing at `/sync/keys`.
7. `scripts/db_access.py` working on Cloud SQL, whose `postgres` user is not a superuser: grant the app roles to it before ownership changes, and create the publication as the migrator.
8. Stripe payment method domains registered for `book.`, `pay.` and `shop.`.

## Delivery stages

Dependencies in the [task queue](tasks.json) control the order; the stages below are the practical sequence.

| Stage                          | Tasks      | Checkpoint                                                                                                                                                      |
| ------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts and domain            | D00        | The GCP project, budget, Pulumi stack and DNS delegation exist.                                                                                                 |
| Make the code deployable       | D01 to D04 | The images build in CI, start from one base domain and pass the readiness check against a local stack with production-shaped configs.                           |
| Build the foundation           | D05 to D07 | `pulumi up` creates the network, cluster, database, buckets, secrets, Gateway and CI identity from nothing, and a second run changes nothing.                   |
| Run staging                    | D08 to D10 | Staging deploys from CI on every push to `main`, with every provider in test mode and logs and alerts working.                                                  |
| Prove recovery and the product | D11 to D12 | A point-in-time restore of staging completes from the runbook, and every stage's QA pass is clean on staging.                                                   |
| Go live                        | D13 to D15 | Production deploys behind approval, live providers are connected, the $1 live payment and refund in CLI-50 pass, and `operations.md` describes how it all runs. |

## Risks to test on real infrastructure

- `db_access.py` against Cloud SQL's limited `postgres` user, before any deploy depends on it.
- The PowerSync replication slot after a point-in-time restore: the runbook must cover dropping the slot and letting PowerSync re-snapshot.
- Cloud Storage through the S3 API with the pinned boto3 version: uploads, presigned URLs and deletes.
- Kratos with a `__Host-` session cookie served under the API host: sign-in, recovery, Google sign-in and passkeys on web and mobile.
- PowerSync streams through the Gateway with the long backend timeout, and the Spot staging pods restarting without losing sync state.
