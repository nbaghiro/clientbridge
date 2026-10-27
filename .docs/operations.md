# Clientbridge operations

How staging and production run: the environments and their hosts, the Pulumi stacks, every setting and secret, provider setup, the first deploy, deploys and rollback, jobs, health checks and alerts, and restore. The design and its cost reasoning are in the [deploy plan](executions/deploy/plan.md); local development is in [engineering](engineering.md).

**Status (13 October 2026):** the Pulumi program, the deploy workflows and the EAS profiles are written and checked against Pulumi's mocks, but nothing has been applied to a real project yet. Every command below is the intended procedure; the restore runbook in particular is untested until the D11 drill.

## Environments and hosts

There are two environments, each with one base domain `D` from which every hostname and URL is derived (`core/deployment.py` `public_urls`, `auth_env` and `powersync_env`). Both run in one GKE Autopilot cluster in `us-east1`, as the namespaces `prod` and `staging`, behind one Gateway on one static IP, and share one Cloud SQL instance.

| Environment | `ENV`     | Base domain               | Namespace | Database prefix | Pods                    |
| ----------- | --------- | ------------------------- | --------- | --------------- | ----------------------- |
| Production  | `prod`    | `clientbridge.ca`         | `prod`    | none            | regular, worker on Spot |
| Staging     | `staging` | `staging.clientbridge.ca` | `staging` | `staging_`      | all on Spot             |

| Host     | Serves                                                                                                   | Backend                     |
| -------- | -------------------------------------------------------------------------------------------------------- | --------------------------- |
| `D`      | Marketing site; `robots.txt` allows indexing only in production                                          | `web` (Caddy)               |
| `app.D`  | Staff web app; the WebAuthn RP ID                                                                        | `web`                       |
| `admin.D` | Platform admin app                                                                                      | `web`                       |
| `<slug>.D` | Connect: each business's public page, through a wildcard record, listener and route; the named hosts take precedence | `web`                       |
| `book.D` | Connect: booking at `/<slug>`, the client's visit page (`/m/`), forms, contracts, message preferences and `embed.js` | `web`                       |
| `shop.D` | Connect: the online shop at `/<slug>` and pickup orders (`/order/`)                                      | `web`                       |
| `pay.D`  | Connect: invoices (`/i/`), estimates (`/e/`), receipts (`/r/`) and bank account setup (`/setup`)         | `web`                       |
| `api.D`  | The API, `/webhooks/*`, and the auth service's public API under `/auth/` (the Gateway strips the prefix) | `api`, `auth` (public port) |
| `sync.D` | PowerSync, with a one-hour backend timeout for streams                                                   | `powersync`                 |

Each Connect host serves only its own pages and answers any other path with Connect's not-found page; the bare `book.D`, `shop.D` and `pay.D` redirect to the marketing site. Caddy lets a business's own site frame the booking page, forms and contracts on `book.D`, the shop on `shop.D`, invoices on `pay.D` and every business page, and sends `frame-ancestors 'none'` everywhere else. The business-page DNS record and the Gateway's `<env>-pages` listener live in the cloud stack, so an administrator applies it before an environment first deploys the matching `pages` route.

Inside each namespace the API reaches the auth service at `http://auth.<namespace>.svc.cluster.local:4433` (public) and `:4434` (admin, reachable only from the API and worker), Redis at `redis.<namespace>.svc.cluster.local:6379/0`, and PowerSync reads the signing keys from `http://api.<namespace>.svc.cluster.local:8701/sync/keys`. Every pod that reaches the database does so through a Cloud SQL Auth Proxy sidecar on `127.0.0.1:5432`.

### CORS

Each browser origin gets only the cross-origin access it uses. Mobile sends no `Origin` and authenticates with the `X-Session-Token` header, so CORS does not apply to it.

| Origin                                         | Target                                             | Allowed                                                                                                | Credentials                                                                       | Set by                                                        |
| ---------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `app.D`                                        | API on `api.D`                                     | Every method and request header; exposes `Retry-After`                                                 | Yes; cookie-authenticated writes must also carry this `Origin` (`origin_refused`) | `core/cors.py`, `Settings.app_origins()` (`WEB_BASE_URL`)     |
| `app.D`                                        | The auth service on `api.D/auth/`                  | The methods and headers in `kratos.yml`; preflights cached 600 seconds                                 | Yes, for `__Host-cb_session`                                                      | `auth_env` `SERVE_PUBLIC_CORS_ALLOWED_ORIGINS`                |
| `book.D`, `pay.D`, `shop.D`                    | API on `api.D` (the public routes)                 | Every method and request header; exposes `Retry-After`                                                 | No                                                                                | `core/cors.py`, `CORS_ALLOW_ORIGINS` derived by `public_urls` |
| `<slug>.D` (any one-label subdomain)           | API on `api.D` (the public routes)                 | Every method and request header; exposes `Retry-After`                                                 | No                                                                                | `core/cors.py`, `Settings.allowed_origin_regex()` from `BUSINESS_PAGE_URL` |
| `app.D`                                        | PowerSync on `sync.D`                              | Any origin (`*`), `GET`, `HEAD`, `POST`, `Authorization` and `Content-Type`; preflights cached an hour | No; the PowerSync token is a bearer header                                        | PowerSync itself; the open edition has no CORS setting        |
| `app.D`, `book.D`, `pay.D`, `shop.D`           | The environment's bucket (presigned `PUT`)         | `PUT` with `Content-Type`; preflights cached an hour                                                   | No                                                                                | `cloud/storage.py`                                            |
| Any origin                                     | The environment's bucket (presigned `GET`, `HEAD`) | `GET` and `HEAD`, exposing `Content-Type`, `Content-Length` and `ETag`                                 | No                                                                                | `cloud/storage.py`                                            |
| `D`, `www.D` (redirects to `D`), anything else | API, the auth service                              | Nothing                                                                                                | No                                                                                | ------------------------------------------------------------- |

The bucket allows reads from any origin for two reasons. A presigned URL is itself the credential, so restricting the origin adds no protection, and Connect fetches a business's logo for its favicon through the API's `GET /media/{id}`, whose redirect to the bucket makes the browser send `Origin: null`. Uploads stay limited to the hosts that offer them. The marketing site at `D` makes no API calls, so it is not in `CORS_ALLOW_ORIGINS`. Connect's widgets on a business's own website run in an iframe from `book.D`, `shop.D` or `pay.D` (the loader swaps the first label of its own `book.` origin), so their API calls carry that origin; `embed.js` itself only builds the iframes, exchanges `postMessage` with them (checking the sender's origin) and shows the logo through a plain `<img>`, so it makes no request that needs CORS from the host page. Stripe.js calls Stripe from each page, which is Stripe's own CORS. No page sets a `connect-src` policy; the web image's Content-Security-Policy only sets `frame-ancestors`.

## Pulumi stacks

The program in `infra/pulumi` has a `cloud` stack and one stack per environment in `clientbridge:environments` (`staging` now, `prod` later). Their state is in the project's bucket `gs://<project>-pulumi-state`, with the KMS key `pulumi/state` encrypting the state's secrets; the bootstrap creates both, and CI reaches them with the deployer's Google identity, so there is no Pulumi account or token. Each deployer can read every stack's state, which holds no secret value, and write only its own stack's files and locks (`cloud/identity.py`). The stack name selects the part that runs (`__main__.py`).

| Stack     | Holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Applied by                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `cloud`   | Network and Cloud NAT, the Autopilot cluster, service accounts and the GitHub OIDC pool, Artifact Registry, the Cloud SQL instance (each environment's migrate step creates its three databases as `<env>_admin`), buckets, empty Secret Manager secrets and who may read them, the DNS zone with its host and mail records, certificates, uptime checks, alerts and the budget, the namespaces with each deployer's Role, the Gateway, and the repository's Actions variables and GitHub environments | An administrator, through `make infra-bootstrap`           |
| `staging` | The `staging` namespace's workloads, Services, routes and policies, reading the cloud stack through a `StackReference`                                                                                                                                                                                                                                                                                                                                                                                 | CI, on every push to `main` after CI passes                |
| `prod`    | The same for `prod`, with the digests staging just ran                                                                                                                                                                                                                                                                                                                                                                                                                                                 | CI, after a reviewer approves the `production` environment |

Configuration keys, from `Pulumi.*.yaml` and `environments.py`:

| Stack             | Key                                                | Value                                                                                                                                                                                    |
| ----------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cloud`           | `gcp:project`                                      | The Google Cloud project id                                                                                                                                                              |
| `cloud`           | `gcp:region`                                       | `us-east1`                                                                                                                                                                               |
| `cloud`           | `gcp:userProjectOverride`, `gcp:billingProject`    | `true` and the project id: the Billing Budgets API refuses an administrator's own credentials without a quota project, and the program stops if either is missing                        |
| `cloud`           | `clientbridge:databaseZone`                        | `us-east1-b`                                                                                                                                                                             |
| `cloud`           | `clientbridge:githubRepository`                    | `nbaghiro/clientbridge`                                                                                                                                                                  |
| `cloud`           | `clientbridge:githubReviewer`                      | `nbaghiro`, who approves production deploys                                                                                                                                              |
| `cloud`           | `clientbridge:environments`                        | The environments the project runs: `[staging]` now, `[prod, staging]` once production goes live                                                                                          |
| `cloud`           | `clientbridge:stateBucket`, `stateKey`             | Written by the bootstrap: the state bucket and the KMS key's resource name                                                                                                               |
| `cloud`           | `clientbridge:alertEmail`                          | The address alerts and budget mails go to                                                                                                                                                |
| `cloud`           | `clientbridge:billingAccount`                      | The billing account id (`XXXXXX-XXXXXX-XXXXXX`)                                                                                                                                          |
| `cloud`           | `clientbridge:budgetAmount`, `budgetCurrency`      | `150`, `USD`                                                                                                                                                                             |
| `cloud`           | `clientbridge:mailRecords`                         | Per environment, the records Resend issues for its domain (and Workspace's DKIM), by name under the base domain; see [Resend](#resend)                                                   |
| all               | `clientbridge:prodBaseDomain`, `stagingBaseDomain` | Default `clientbridge.ca` and `staging.clientbridge.ca` (`Pulumi.yaml`)                                                                                                                  |
| `staging`, `prod` | `clientbridge:stripePublishableKey`                | The environment's `pk_test_` or `pk_live_` key, served in `config.js`                                                                                                                    |
| `staging`, `prod` | `clientbridge:cloudStack`                          | Optional; defaults to `organization/clientbridge/cloud`, the cloud stack in the state bucket                                                                                             |
| `staging`, `prod` | `clientbridge:backendDigest`, `webDigest`          | Set by CI on each run (`sha256:…`); a run without both stops                                                                                                                             |
| `staging`, `prod` | `clientbridge:allowSchemaAhead`                    | Set by CI on each run: `true` only for a rollback run, which sets `MIGRATE_ALLOW_AHEAD=1` on the migrate Job; `false` otherwise                                                          |
| `staging`, `prod` | `clientbridge:databaseInstance`                    | Optional; the Cloud SQL instance the pods reach, by default the shared `clientbridge`. Set only to move an environment to a restored clone ([Backups and restore](#backups-and-restore)) |

The cloud stack exports `environments` (per environment: the bucket, its files service account, the admin user's name, the workload service accounts, the Secret Manager names and the deployer), `cluster`, `registry`, `databaseConnection`, `databaseInstance`, `gatewayAddress`, `nameServers`, `workloadIdentityProvider` and `builderServiceAccount`. None of them is a secret, and neither stack's state holds a secret value: the program creates only the secret containers and their IAM, and `secrets_init.py` writes the generated values (see [Secrets](#secrets)). An environment stack exports `images`, `baseDomain` and the `databaseConnection` its pods use.

## Settings and secrets

### Plain settings

These are set by the program and are not secret. The backend containers (API, worker, migrate) get them from `kubernetes/settings.py` `backend_env`:

| Variable                                | Value                                                                                                                               |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `ENV`                                   | `prod` or `staging`                                                                                                                 |
| `BASE_DOMAIN`                           | The environment's base domain                                                                                                       |
| `TRUSTED_PROXY_HOPS`                    | `2` (Google's load balancer appends two addresses)                                                                                  |
| `REDIS_URL`                             | `redis://redis.<namespace>.svc.cluster.local:6379/0`                                                                                |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET` | `https://storage.googleapis.com`, `auto`, `<project>-<env>-files`                                                                   |
| `AUTH_ADMIN_URL`, `AUTH_INTERNAL_URL`   | The auth service's admin and public Services                                                                                        |
| `POWERSYNC_USE_RS256`                   | `true`                                                                                                                              |
| `DB_POOL_SIZE`, `DB_MAX_OVERFLOW`       | `3`, `1` per process, sized to the instance's `max_connections` (the plan's [Database](executions/deploy/plan.md#database) section) |
| `EMAIL_FROM`                            | `Clientbridge <no-reply@D>`                                                                                                         |

`API_BASE_URL`, `AUTH_PUBLIC_URL`, `WEB_BASE_URL`, `BUSINESS_PAGE_URL` (`https://{slug}.D`), `BOOK_BASE_URL`, `SHOP_BASE_URL`, `PAY_BASE_URL`, `CORS_ALLOW_ORIGINS` and the session cookie name `__Host-cb_session` are derived from `BASE_DOMAIN` and are not set. The auth service gets `auth_env(D, …)` and PowerSync `powersync_env(…)` from `core/deployment.py`. The web image gets `BASE_DOMAIN`, `ENVIRONMENT` (`production` or `staging`) and `STRIPE_PUBLISHABLE_KEY` from the stack's `stripePublishableKey`.

Outside `ENV=dev` the API, worker and migrate step refuse to start (`core/config.py` `_require_prod_secrets`) unless `BASE_DOMAIN`, `DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_THIN_WEBHOOK_SECRET`, `STRIPE_PLATFORM_WEBHOOK_SECRET`, `STRIPE_PORTAL_CONFIGURATION`, `TWILIO_AUTH_TOKEN`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `EMAIL_FROM` and `POWERSYNC_PRIVATE_KEY_PEM` are set to non-default values, `JWT_SECRET` and `AUTH_EMAIL_HOOK_SECRET` differ from their development values, `AUTH_ADMIN_URL` differs from the public URL, `TRUSTED_PROXY_HOPS` is nonzero, `POWERSYNC_USE_RS256` is true, `POWERSYNC_KID` is not `clientbridge-dev`, and `SMTP_URL` is unset. A URL set explicitly must agree with `BASE_DOMAIN`. `BASE_DOMAIN` must not end in a reserved name (`.invalid`, which the web image is built with, `.localhost`, `.test`, `.example`, `.local`, `.internal`), `REDIS_URL`, `S3_ENDPOINT`, `AUTH_ADMIN_URL` and `AUTH_INTERNAL_URL` must not name `localhost`, a loopback address or `host.docker.internal` (only the database is reached on `127.0.0.1`, through the Cloud SQL Auth Proxy), and `EMAIL_FROM` must be an address at `BASE_DOMAIN` itself.

### Secrets

Each environment has one Secret Manager secret per name below, with the id `<env>-<name in lowercase with dashes>` (for example `staging-stripe-secret-key`, `prod-resend-webhook-secret`), created by the cloud stack (`cloud/secrets.py`, catalog in `kubernetes/settings.py`). Pods mount them as files through GKE's Secret Manager add-on, and each container's command exports them as variables before it starts. The secrets marked `secrets_init` are generated by `infra/pulumi/secrets_init.py`, which an administrator runs once per environment after applying the cloud stack ([First deploy](#first-deploy) step 6). It adds a version only to a secret that has none, so running it again changes nothing, and it prints secret names, never values. It also creates the environment's Cloud SQL admin user `<env>_admin` with the password in `ADMIN_DATABASE_URL` (Cloud SQL requires a password for a built-in user, so Pulumi cannot create it without keeping the password in its state) and the HMAC key of the environment's files service account (`cb-<env>-files`). The built-in `postgres` user is never given a password, so no workload can use it. The provided secrets are created empty, and a person must add a version to each one before the environment's first deploy, because the add-on fails a pod whose secret has no version. A pod reads its secrets when it starts, so a new version takes effect on the next rollout (`kubectl -n <namespace> rollout restart deploy/<name>`).

| Secret                           | Provider      | Source       | Read by                                                                    |
| -------------------------------- | ------------- | ------------ | -------------------------------------------------------------------------- |
| `ADMIN_DATABASE_URL`             | Cloud SQL     | secrets_init | migrate, as `<env>_admin`; only its own environment's migrate Job reads it |
| `MIGRATION_DATABASE_URL`         | Cloud SQL     | secrets_init | migrate                                                                    |
| `DATABASE_URL`                   | Cloud SQL     | secrets_init | API, worker, migrate                                                       |
| `POWERSYNC_SOURCE_DATABASE_URL`  | Cloud SQL     | secrets_init | PowerSync (`PS_SOURCE_URI`), migrate                                       |
| `POWERSYNC_STORAGE_DATABASE_URL` | Cloud SQL     | secrets_init | PowerSync (`PS_STORAGE_URI`), migrate                                      |
| `AUTH_DATABASE_URL`              | Cloud SQL     | secrets_init | auth (`DSN`), auth migrate, migrate                                        |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Cloud Storage | secrets_init | API, worker, migrate                                                       |
| `JWT_SECRET`                     | Clientbridge  | secrets_init | API, worker, migrate                                                       |
| `POWERSYNC_PRIVATE_KEY_PEM`      | Clientbridge  | secrets_init | API, worker, migrate                                                       |
| `AUTH_EMAIL_HOOK_SECRET`         | Clientbridge  | secrets_init | API, worker, migrate; auth courier                                         |
| `AUTH_COOKIE_SECRET`             | Clientbridge  | secrets_init | auth (`SECRETS_COOKIE`)                                                    |
| `AUTH_CIPHER_SECRET`             | Clientbridge  | secrets_init | auth (`SECRETS_CIPHER`)                                                    |
| `POWERSYNC_KID`                  | Clientbridge  | secrets_init | API, worker, migrate; `clientbridge-<env>-1` at first                      |
| `POWERSYNC_PREVIOUS_PUBLIC_KEYS` | Clientbridge  | secrets_init | API, worker, migrate; `{}` until a key rotation                            |
| `STRIPE_SECRET_KEY`              | Stripe        | Person       | API, worker, migrate                                                       |
| `STRIPE_WEBHOOK_SECRET`          | Stripe        | Person       | API, worker, migrate                                                       |
| `STRIPE_THIN_WEBHOOK_SECRET`     | Stripe        | Person       | API, worker, migrate                                                       |
| `STRIPE_PLATFORM_WEBHOOK_SECRET` | Stripe        | Person       | API, worker, migrate                                                       |
| `STRIPE_PORTAL_CONFIGURATION`    | Stripe        | Person       | API, worker, migrate                                                       |
| `TWILIO_ACCOUNT_SID`             | Twilio        | Person       | API, worker, migrate                                                       |
| `TWILIO_AUTH_TOKEN`              | Twilio        | Person       | API, worker, migrate                                                       |
| `TWILIO_SMS_FROM`                | Twilio        | Person       | API, worker, migrate                                                       |
| `RESEND_API_KEY`                 | Resend        | Person       | API, worker, migrate                                                       |
| `RESEND_WEBHOOK_SECRET`          | Resend        | Person       | API, worker, migrate                                                       |
| `EXPO_ACCESS_TOKEN`              | Expo          | Person       | API, worker, migrate                                                       |
| `GOOGLE_OAUTH_CLIENT_ID`         | Google        | Person       | auth (OIDC provider 0 client id)                                           |
| `GOOGLE_OAUTH_CLIENT_SECRET`     | Google        | Person       | auth (OIDC provider 0 client secret)                                       |

The migrate step reads the provider secrets because `db_access.py` and Alembic build `Settings`, whose startup check requires them. `TWILIO_ACCOUNT_SID`, `TWILIO_SMS_FROM` and `EXPO_ACCESS_TOKEN` are not part of the startup check, but they still need a version for the pods to start. A placeholder is not the same as an empty value: the SMS and push senders switch from their no-op versions only when every credential is nonempty, so a placeholder makes sends fail instead of being skipped.

Generated values exist only in Secret Manager, so a token that can read the cloud stack's state learns no secret. To read one (for example the admin URL during a restore): `gcloud secrets versions access latest --secret staging-admin-database-url`. To replace a generated value, add a new version by hand (for a database URL, with the same user, host and database) and roll the pods; `secrets_init.py` never overwrites one.

## Provider setup

Each environment has its own provider accounts or modes: Stripe sandbox and Twilio, Resend and Google clients for staging, live equivalents for production. Every webhook points at `https://api.D/webhooks/…`, and the Gateway passes the raw body and path through so each signature verifies.

### Stripe

See [Payments and Stripe](payments.md#staging-and-production-setup) for connected/platform endpoints,
thin event destinations, API versions, payment domains, Dashboard setup and sandbox/live provisioning.
The [credentials table](payments.md#credentials-and-runtime-settings) maps Stripe settings to their roles;
this document remains the reference for Secret Manager, infrastructure and deployment procedures.

### Stripe sandbox for hosted CI

`stripe-qa.yml` runs the backend sandbox suite and the real Stripe browser lane by hand, from `main` only. Both jobs read the protected GitHub environment `stripe-sandbox`: the secrets `STRIPE_TEST_SECRET_KEY` and `STRIPE_TEST_PUBLISHABLE_KEY`, and the variables `STRIPE_TEST_PLATFORM`, `STRIPE_TEST_CONNECTED_ACCOUNT` and `STRIPE_TEST_OTHER_ACCOUNT`. The cloud stack creates that environment from its config once all five keys are set, with a deployment branch policy that admits only `main`, the same rule the workflow's `if` applies. Until then it creates nothing, and a partly set group stops the stack.

CI uses its own pair of merchants, tagged `clientbridge_qa_environment=ci`, so a hosted run never shares a merchant lease with a local one. To create them, with the local `clientbridge` Stripe CLI profile on the sandbox platform:

```sh
cd backend
uv run python -m scripts.stripe_qa_accounts --environment ci   # read-only: shows what exists
uv run python -m scripts.stripe_qa_accounts --environment ci --apply --prepare --bank \
  --onboarding-links --output ../.scratchpad/stripe-ci-merchants.json
```

The second command creates the two accounts if they're missing (its idempotency keys make a rerun safe), fills in Stripe's documented test identity, attaches the Canadian test bank account and prints a Stripe-hosted onboarding link for each merchant that can't take charges yet. Opening each link accepts the terms, which no API call does for these accounts. Rerun the read-only command until both merchants show `charges_enabled` and `payouts_enabled` with nothing currently due.

Then set the stack config from the manifest and apply the cloud stack:

```sh
cd infra/pulumi
pulumi stack select cloud
pulumi config set --secret stripeTestSecretKey      # the sandbox platform's sk_test_ or rk_test_ key
pulumi config set --secret stripeTestPublishableKey # its pk_test_ key
pulumi config set stripeTestPlatform acct_…
pulumi config set stripeTestConnectedAccount acct_… # slot a in the manifest
pulumi config set stripeTestOtherAccount acct_…     # slot b
pulumi up
```

The two keys are stored encrypted in `Pulumi.cloud.yaml`, and `tests/test_program.py` fails if either is committed in plain text. After `pulumi up`, run `stripe-qa` from `main` in the Actions tab; its preflight refuses merchants that aren't ready or aren't tagged for CI.

### Resend

Each environment sends from its own domain: `EMAIL_FROM` is `Clientbridge <no-reply@D>`, so staging needs `staging.clientbridge.ca` as a second Resend domain.

Setting up production: create the team, add `clientbridge.ca` as the sending domain with receiving left off (Google Workspace keeps the root MX), publish the records Resend issues (a DKIM TXT on `resend._domainkey` and the `send` and `rsend` return-path CNAMEs), and wait for the domain to verify, since an unverified domain delivers only to the account owner. Create a sending-only API key restricted to that domain and set `RESEND_API_KEY` and the webhook's `RESEND_WEBHOOK_SECRET` in Secret Manager. Resend's test inboxes (`delivered@`, `bounced@`, `complained@` and `suppressed@resend.dev`) exercise the webhook end to end, and `tests/e2e/test_resend_e2e.py` sends one real mail when `RESEND_TEST_API_KEY` and `RESEND_TEST_FROM` are exported. Confirm the plan's daily cap before broadcasts go live.

Resend's records are part of the cloud stack: `clientbridge:mailRecords` in `Pulumi.cloud.yaml` lists them per environment by name under its base domain (`resend._domainkey`, `send`, `rsend`, with type `TXT`, `CNAME` or `MX` and the values Resend shows), and `cloud/dns.py` publishes them with the Google Workspace MX, SPF (`v=spf1 include:_spf.google.com ~all`) and DMARC (`v=DMARC1; p=none;`) records on the apex. Production's entries are the records published at the registrar today, and also carry Workspace's DKIM key (`google._domainkey`). Staging's list is empty until `staging.clientbridge.ca` is added in Resend: copy each record it shows into `mailRecords.staging` (for example `name: resend._domainkey`, `type: TXT`, `data: ["p=…"]`, and `name: send` with the `MX` and `TXT` or `CNAME` values) and run `pulumi up --stack cloud`. A long TXT value is split into 255-character strings by the program. The webhook is `https://api.D/webhooks/email`, subscribed to `email.delivered`, `email.bounced`, `email.failed`, `email.suppressed` and `email.complained`; its signing secret (`whsec_…`) is `RESEND_WEBHOOK_SECRET`.

### Twilio

Assign a distinct SMS-capable number to each business through the platform-admin
`POST /admin/v1/businesses/{id}/sms` command (`{"number":"+1…"}`; `null` unassigns).
Provision numbers in Twilio separately; the command does not buy numbers. Configure each number's
inbound POST webhook as `https://api.D/webhooks/sms`. `TWILIO_ACCOUNT_SID` and
`TWILIO_AUTH_TOKEN` authenticate the transport; `businesses.sms_number` determines the sender and
inbound tenant. The bootstrap's `TWILIO_SMS_FROM` secret records its provisioned number, but does not
assign it or act as a shared fallback. Unassigned businesses cannot request SMS verification codes.
Retired-number audit history prevents reassignment to another business. Twilio verifies the exact
public webhook URL, and staging requires real credentials for inbound SMS.


### Google OAuth

One OAuth client per environment (Google Cloud console > APIs & Services > Credentials > OAuth client ID, type Web application), with the consent screen's authorized domain `clientbridge.ca`. The only redirect URI is the auth service's callback under the API host: `https://api.D/auth/self-service/methods/oidc/callback/google`. Store the client id and secret as `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`; Kratos reads them as its first OIDC provider.

### PowerSync signing keys

`secrets_init.py` generates each environment's RSA key (`POWERSYNC_PRIVATE_KEY_PEM`, 2048 bits, PKCS#8) and sets `POWERSYNC_KID` to `clientbridge-<env>-1` and `POWERSYNC_PREVIOUS_PUBLIC_KEYS` to `{}`. All three are secrets, read by the API, worker and migrate step, so a rotation needs no program change. The API serves the public key at `/sync/keys`, and PowerSync reads it over the cluster network (`PS_JWKS_URI`).

Production requires `POWERSYNC_USE_RS256=true`, a durable RSA private PEM of at least 2048 bits, and a unique `POWERSYNC_KID`. Every API worker must use the same active configuration. The application rejects missing production keys at startup.

To rotate, first publish the next public PEM under its new key ID in `POWERSYNC_PREVIOUS_PUBLIC_KEYS` (a JSON object); keep signing with the current key. Verify that PowerSync can obtain the expanded `/sync/keys` response before changing the signer. Then deploy the new private PEM/key ID, retaining the former public key in the overlap map. Keep both public keys available until all workers have switched and the last old token has expired, plus the measured verifier cache/clock-skew margin. Remove the former public key only after verification. Rollback uses the former signer while retaining both public verification keys; it never requires clearing client queues. `make test-sync` runs the rotation drill against the pinned service: a new key is accepted about half a second after rotation, and after the previous key leaves `/sync/keys` a token it signed, still within its lifetime, is accepted until PowerSync re-reads the keys and refused from then on. The drill triggers that re-read with a token under an unpublished key ID (which must itself be refused) and fails if the retired key is still accepted after 90 seconds. Without such a trigger the pinned service re-reads the JWKS only five minutes after its last fetch (a fixed interval in its key cache, not a setting), so in production a retired key, and any token it signs, keeps working for up to about five minutes after removal.

In the cluster each step is a new secret version followed by `kubectl -n <namespace> rollout restart deploy/api deploy/worker`: first a version of `<env>-powersync-previous-public-keys` holding `{"<next kid>": "<next public PEM>"}`; then, once PowerSync serves the expanded keys, new versions of `<env>-powersync-private-key-pem` and `<env>-powersync-kid` together with a version of the previous keys holding the former key ID and public PEM; finally, after the overlap, a version of the previous keys holding `{}`. Generate the next key with `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048` and its public PEM with `openssl pkey -pubout`.

### Mobile app

Each environment has its own app: production is `ca.clientbridge.app` ("Clientbridge"), staging is `ca.clientbridge.app.staging` ("Clientbridge Staging"), so a tester keeps both on one phone. Both live in one EAS project, `@clientbridge-ca/clientbridge`, whose id is fixed in `app.config.ts`. `environments.py` holds each app's bundle id, name, EAS build profile and update channel (one name, `staging` or `production`), its EAS environment (`preview` or `production`), whether its Android build goes to Google Play, and whether Apple has granted it Tap to Pay. The tests check those values against `eas.json`.

`app.config.ts` reads only EAS environment variables (`APP_ID`, `APP_NAME`, `BASE_DOMAIN`, `GOOGLE_SERVICES`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_TERMINAL_SIMULATED`, `TAP_TO_PAY`). `GOOGLE_SERVICES` is Firebase's `google-services.json` for the app, base64, and a text variable rather than a file one because EAS gives a file variable to builds but not to `eas update`, which would split the runtime versions. `eas.json` holds no build-only values, since `eas update` sees only the EAS environment: a value only the build saw would give the build and its updates different runtime versions. The runtime version follows the fingerprint policy, a hash of every native input including those values, so an update reaches only the builds that can run it. `frontend/apps/mobile/.fingerprintignore` leaves out `bplist-parser`, which the EAS build worker loads while reading the config and a local or CI run does not; without it no update would match a build. Staging's iOS build goes to TestFlight; its Android build is an APK installed from the EAS build page, so staging needs no Play app. Production goes to App Store Connect and to Play's internal track as a draft.

Push on Android goes through Firebase Cloud Messaging. Firebase's API refuses to add Firebase to the project (403, "The caller does not have permission", even for an owner) until someone accepts the Firebase terms, which happens only in the console's setup flow. So once per project, an administrator adds Firebase in the console (console.firebase.google.com, Get started, add Firebase to the existing Google Cloud project, Analytics off, no apps) and imports it: `pulumi import --stack cloud gcp:firebase/project:Project firebase projects/<project id>`. The cloud stack (`cloud/firebase.py`) adds Firebase to the project, one Android app per environment with its own API key, and a sender account per environment (`cb-<env>-push`, with `roles/firebasecloudmessaging.admin`), and exports the app's `google-services.json`. The file holds the key, which ships inside the app, so it stays out of git: the cloud stack keeps it, base64, as the `GOOGLE_SERVICES` secret of the environment's GitHub environment (a secret so that Actions masks it in the repository's public logs, which print every variable), `deploy-mobile.yml` copies it to the sensitive EAS variable of the same name before it fingerprints, builds or updates, and `app.config.ts` writes it to the ignored `frontend/apps/mobile/.firebase/` when a build or update reads the config. The key (`<env>-push-key`) reaches only the two APIs a device calls to register for push (`fcmregistrations` and `firebaseinstallations`), and only from the app's package signed with a certificate listed under the environment in `clientbridge:androidSigningCerts` in `Pulumi.cloud.yaml` (SHA-1, from the EAS project's Android credentials and, for a Play build, Play's app signing key). An environment with no certificate listed has a key that any caller can use for those two APIs. It also creates `cb-play-publisher`, the account EAS uploads to Play as, which a person invites in Play Console (Users and permissions, with release rights for the production app), since Play has no API for its users. `app.D/.well-known/apple-app-site-association` and `assetlinks.json` vouch for the environment's app for passwords and passkeys, from `clientbridge:appleTeamId` and `clientbridge:androidCertFingerprints` in the environment's stack (empty until the accounts exist). Apple's file lists no link paths yet, so no web link opens the app.

`make infra-mobile PROJECT=<project id> ENV=staging` (`infra/pulumi/mobile_init.py`) reads `EAS_ROBOT_TOKEN` and, once the Apple account exists, the `APPLE_` values in `.env.<env>` (see `.env.staging.example`). Two Expo robots keep the cluster from shipping app code: `EXPO_ACCESS_TOKEN`, which `providers_init.py` copies to Secret Manager for the API and worker, only sends push, while `EAS_ROBOT_TOKEN`, with the Developer role, builds, submits and publishes updates and lives only in the environment's GitHub environment; the script refuses to run when the two are the same. It:

1. Writes the EAS variables from the environment and the stack's Stripe publishable key, changing only those that differ.
2. Creates a key for the push sender (Expo and EAS take only service account JSON keys, so the organization's `iam.managed.disableServiceAccountKeyCreation` and legacy `iam.disableServiceAccountKeyCreation` policies are turned off; Google enforces both on a new organization) and uploads it to EAS as the app's FCM v1 key, and for an app on Play, a key for `cb-play-publisher` as its submission key. A key already on EAS for the same account is kept, so a rerun creates none; a new key replaces the account's older ones in Google Cloud, and a key EAS refuses is deleted.
3. With the Apple values: uploads the APNs key and the App Store Connect API key (used for submissions and to create provisioning profiles), then, while EAS holds no App Store distribution certificate, creates one and its App Store provisioning profile through the App Store Connect API with that key (an `openssl` key and signing request, exported to a `.p12`) and uploads both to EAS. Nothing prompts.
4. Sets `EXPO_TOKEN` and `EAS_PLATFORMS` (`android`, or `android ios` once Apple is set up) on the environment's GitHub environment.

The EAS calls go through the GraphQL API the EAS CLI uses, since the CLI uploads credentials only interactively. The Tap to Pay entitlement is requested by the Apple account holder; once granted, set `tap_to_pay=True` for the environment and rerun `make infra-mobile`, which needs a new build.

## First deploy

Staging comes first; production joins later with a config change and the same commands. Every step is safe to run again. Commands run from the repository root.

**What a person does:** have a Google Cloud billing account; sign in to `gcloud` and `gh`; add four NS records at the registrar; create one Google OAuth client and an Expo robot token; and copy the Stripe, Twilio and Resend keys into `.env.staging`. The mobile stores add the Apple and Google Play accounts, the App Store Connect and APNs keys, and inviting the Play upload account (see [Mobile app](#mobile-app)). Everything else is created by the bootstrap, the cloud stack and `providers_init.py`.

1. **Sign in.** `gcloud auth login`, `gcloud auth application-default login` and `gh auth login` (a user who can administer the repository). Install the GKE auth plugin (`gcloud components install gke-gcloud-auth-plugin`) and Pulumi 3.268.0, the version CI runs.
2. **Bootstrap.** `make infra-bootstrap PROJECT=<project id> BILLING=<billing account>` (`infra/pulumi/bootstrap.py`). It creates the project if needed and links billing; enables the APIs Pulumi needs; creates the state bucket `gs://<project>-pulumi-state` (versioned) and the KMS key that encrypts the state's secrets; creates the `cloud` stack and one stack per environment in `clientbridge:environments`; applies the cloud stack with the person's `gh` token, which also sets the repository's Actions variables, its GitHub environments, the main-only branch rule and production's reviewer (`cloud/github.py`); and runs `secrets_init.py` for each environment. The first run takes about 25 minutes, mostly the cluster and the database. It ends by printing the name servers to delegate to. Commit the `Pulumi.*.yaml` files it changed.
3. **Delegate DNS.** At the registrar (Squarespace), add four `NS` records on the host `staging` with the printed name servers. Squarespace asks to turn off DNSSEC for the domain before it accepts an NS record; production's move to Cloud DNS turns it back on there. Check with `dig +short NS staging.clientbridge.ca`. The certificates turn `ACTIVE` once the delegation resolves (`gcloud certificate-manager certificates list`), usually within an hour.
4. **Provider credentials.** Copy `.env.staging.example` to `.env.staging` and fill it: a full-access Resend key, the Stripe sandbox's secret and publishable keys with the Stripe CLI profile logged in to it, the Twilio account SID and auth token, the Google OAuth client (type Web application, redirect URI `https://api.staging.clientbridge.ca/auth/self-service/methods/oidc/callback/google`) and an Expo access token with push permission.
5. **Providers.** `make infra-providers PROJECT=<project id> ENV=staging` (`infra/pulumi/providers_init.py`). It copies the credentials into Secret Manager; creates the Resend domain `staging.clientbridge.ca`, a sending-only key for it and the `/webhooks/email` webhook; buys a Canadian Twilio number and points its SMS webhook at `/webhooks/sms`; runs `stripe_setup.py` against the sandbox for the endpoints, billing objects and portal; sets the stack's `stripePublishableKey`; writes Resend's records into `clientbridge:mailRecords` and applies the cloud stack to publish them. A secret is written only when it has no version or its value changed. Commit `Pulumi.cloud.yaml` and `Pulumi.staging.yaml`.
6. **First staging deploy.** Push to `main`. After CI passes, `deploy.yml` builds both images, applies the staging stack (the migrate Job first) and smoke-tests every host. To start it by hand: `gh workflow run deploy.yml --ref main -f environment=staging`. If a pod does not start: `gcloud container clusters get-credentials clientbridge --region us-east1 --dns-endpoint`, then `kubectl -n staging get pods` and `kubectl -n staging describe pod <pod>`.
7. **Mobile app.** `make infra-mobile PROJECT=<project id> ENV=staging` (see [Mobile app](#mobile-app)). The next deploy builds the staging app; to build it now, `gh workflow run deploy-mobile.yml --ref main -f environment=staging -f build=true`. Testers install the Android APK from the build's page on expo.dev (Builds, then Install), and the iOS app from TestFlight once the Apple account exists.
8. **Check end to end.** A Stripe test event (`stripe trigger payment_intent.succeeded` on the sandbox profile), a mail to `delivered@resend.dev` and a text to the Twilio number each reach the API with a 2xx (Logs Explorer, `resource.labels.container_name="api" jsonPayload.path=~"^/webhooks/"`). Then run the QA passes from [launch readiness](launch-readiness.md) on `app.staging.clientbridge.ca` and the staging app.

### Production, later

1. Add `prod` to `clientbridge:environments` in `Pulumi.cloud.yaml` and run `make infra-bootstrap` again: it creates the prod stack, its namespace, secrets and deployer, the `clientbridge.ca` zone with Workspace's mail records and an NS record delegating `staging.`, and sets `DEPLOY_PRODUCTION`, so `deploy.yml` promotes each staging deploy behind production's reviewer.
2. Compare the new zone with today's registrar records (`gcloud dns record-sets list --zone clientbridge-ca` against `dig` of the MX, TXT and `resend._domainkey` records), then replace the registrar's name servers with the printed ones. The staging NS records at the registrar are no longer needed after that.
3. `make infra-providers PROJECT=<project id> ENV=prod` with live keys in `.env.prod`. The script's Stripe step refuses live mode, so create production's endpoints, destination, products, prices and portal in the live Dashboard with the event lists and lookup keys in `stripe_setup.py`, and add their secrets as Secret Manager versions.
4. With both environments running, check that each environment's database admin cannot reach the other's data: in Cloud SQL Studio as `staging_admin` on the `postgres` database, `SET ROLE clientbridge_migrator;`, `SET ROLE clientbridge_api;`, `ALTER ROLE clientbridge_api PASSWORD 'x';` and `GRANT clientbridge_migrator TO staging_admin;` must each fail with `permission denied`, and opening the `clientbridge` database as `staging_admin` must fail; repeat as `prod_admin` against the `staging_` names. If any succeeds, revoke `cloudsqlsuperuser` from both admins or move staging to its own instance before production holds real data.
5. The $1 live payment: take $1 through a pay link on `pay.clientbridge.ca`, check it in the live Dashboard and the ledger, then refund it (CLI-50).

## Deploys and rollback

On every push to `main`, after the `ci` workflow passes, `.github/workflows/deploy.yml` builds the backend and web images, pushes them to Artifact Registry (`us-east1-docker.pkg.dev/<project>/clientbridge/{backend,web}`, tagged with the commit SHA) and deploys their digests. Only CI runs for pushes to `main` of this repository start a deploy (never a pull request, including one from a fork), and a manual run is accepted only from `main`. Each environment runs one deploy at a time in its own concurrency group, so a production run waiting for approval never holds up staging; a running deploy is never cancelled, and a newer pending one replaces an older pending one. A deploy started by a push skips an environment that already runs a later commit of `main`, which happens when CI for an earlier commit finishes after CI for a later one; production then does not run for that commit either. Each environment's deploy (`deploy-environment.yml`) runs `pulumi up` on its stack with the two digests:

1. The migrate Job runs first: `db_access roles`, `alembic upgrade head`, `db_access grants`, then `kratos migrate sql up`. When the database is at a revision the image does not know, the backend step fails with `migrate: the database is at <revision>, which this image does not know; stopping…`, since that also happens after a baseline squash, a deleted revision file or an image built from another branch, and skipping would leave new code on an old schema. Only a rollback run sets `MIGRATE_ALLOW_AHEAD=1` on the Job (see below); the step then logs the revision, skips the upgrade and the grants, and succeeds. It is named after the backend and auth image digests, so each new pair runs it once. If it fails, `pulumi up` fails and nothing else changes, since every Deployment, the web one included, depends on it; the failed Job is replaced by the next deploy. Staging's Job retries twice, since its pod runs on Spot and every step is idempotent; production's does not retry, so a failed production migration stops the deploy at once. A deploy doesn't reseed staging's demo businesses; it only moves the nightly seed to the new image ([Staging's demo seed](#stagings-demo-seed)).
2. The API, worker, auth, PowerSync and web Deployments roll out (one surge pod before the old one stops), and Pulumi waits for them. A stopping API, auth or web pod sleeps 10 seconds in `preStop` while the load balancer takes it out of rotation, then the API's uvicorn finishes in-flight requests for up to 10 more seconds, within the 25-second grace period, so a rollout drops no request.
3. A smoke test fetches `https://api.D/health`, `/ready`, `https://sync.D/probes/liveness`, `https://app.D/`, `https://admin.D/` and `https://D/`, then `/config.js` on `app.`, `book.`, `shop.`, `pay.` and `smoke-check.D` (a business page through the wildcard route), and checks each carries the environment's business page template, `https://{slug}.D`. It retries with backoff (5 seconds doubling to 60) for up to 5 minutes, since a first deploy waits for the Gateway to program its routes.
4. Both digests are tagged `<env>-current` and `<env>-<short sha>` (`prod-` or `staging-`) in Artifact Registry by the builder account. The `<env>-current` tag is how the next deploy finds the commit an environment runs.

Production runs the same job with the same digests after a reviewer approves the `production` environment. The deployer account each job uses can change only its own namespace.

After staging deploys, the `staging-smoke` job in `deploy.yml` runs `make test-staging-smoke`: Playwright checks of the deployed hosts from `frontend/apps/connect/e2e/smoke/`. They read `config.js` and the frame policy on every host, follow the business page to booking and the shop, embed both widgets on another origin (including one below the fold), and sign in as each demo owner. The lane is read-only. A route guard aborts and fails on any write to the environment except signing in and the short-lived Stripe session the payment setup screen opens, so it never books, pays or sends a message. It runs as its own job with only `contents: read`, so the packages it installs never run beside the deployer's credentials, and production does not wait for it.

To inspect a failed deploy: the run's log shows the Pulumi diff and error; `kubectl -n <namespace> get jobs` and `kubectl -n <namespace> logs job/<migrate job> --all-containers` show the migration's output (the deployer Role can read pod logs, so CI can print them too).

Rollback is a manual run with the previous digests and the `rollback` input: `gh workflow run deploy.yml -f environment=<staging|production> -f backend_digest=sha256:… -f web_digest=sha256:… -f rollback=true`. The input passes `clientbridge:allowSchemaAhead=true` to `pulumi up`, which sets `MIGRATE_ALLOW_AHEAD=1` on that run's migrate Job; every other run passes `false`, so the value never carries over, and a rollback without both digests stops. A manual redeploy without `rollback` fails at the migrate step if the database is ahead of the image. Before a production approval, note the running digests with `pulumi stack output images --stack prod`; older ones are in `gcloud artifacts docker images list us-east1-docker.pkg.dev/<project>/clientbridge/backend --include-tags`, where each image carries its commit SHA and, once deployed, `<env>-<short sha>` (the running one also has `<env>-current`). A manual run must start from `main` (`gh workflow run deploy.yml --ref main …`) and never skips an older commit, so it can roll back. The registry cleanup never deletes an image tagged `staging-current` or `prod-…`, keeps `staging-<short sha>` images for 30 days, and keeps the 20 most recent versions of each image whatever their tags; migrations stay backward compatible for one release, so a rollback reaches back at most one migration and never downgrades the schema: the older image's migrate step, allowed by the rollback input, finds the newer revision, leaves the schema, grants and publication as they are, and succeeds. After a baseline squash, the next deploy fails at the migrate step until the database is stamped at the new baseline (`alembic stamp`).

After each environment deploys, `deploy-mobile.yml` ships its app from the same commit, in the same GitHub environment (so production's app waits for its own approval). For each platform in `EAS_PLATFORMS` it computes the native fingerprint with the environment's EAS variables. If a build with that fingerprint exists on the channel (finished, queued or running), it publishes the commit's bundle with `eas update`, which the app downloads on its next start and runs on the one after. Otherwise it starts `eas build` without waiting, and a store build goes on to TestFlight or Play by itself. A manual run (`gh workflow run deploy-mobile.yml --ref main -f environment=<staging|production>`) can force builds with `-f build=true`, or roll back with `-f republish_group=<id>`, which republishes an earlier update group from `eas update:list --branch <channel>` to the channel. The app falls back to the update it ran before when a new one crashes on start. A production update reaches every installed app at once; to stage one, publish it by hand with `eas update --channel production --environment production --rollout-percentage 10` and widen it with `eas update:edit`. A store build still needs review and a release in App Store Connect and Play Console, and the first Android upload to a new Play app is made by hand: until the environment's GitHub variable `PLAY_APP_READY` is `true`, the workflow builds the Android app without submitting it and says so in the run's summary.

The cloud stack is never applied by CI. A change under `infra/pulumi/cloud` is applied by an administrator with `pulumi preview --stack cloud` and `pulumi up --stack cloud`.

### Delivery recovery

`deliveries` retains the immutable payload, current state, provider reference and safe error code.
`queued` retries after known connection failures or rate limits; `accepted` is not proof of delivery.
A signed provider callback can confirm delivery, including after a lost response. `ambiguous` means
acceptance is uncertain: inspect the provider by delivery ID before any manual resend. The worker
never blindly retries an expired send lease. Retry attempts stop after 23 hours to remain within the
provider's idempotency window. Admin Email lab shows test-send history and exact returned status.

Form migrations preserve existing answers and mark reconstructed definitions explicitly; they do not
invent historical signatures. Evidence and delivery migrations reject destructive downgrades. Roll
back application code only after checking schema compatibility, or apply a forward migration.

## Jobs

The worker runs one replica per environment on Spot pods, with the schedule in `tasks/worker.py` evaluated in UTC. Every job is idempotent through a status or timestamp marker and commits after each item, so a failed or preempted run resends nothing it already finished and the next run continues. A run that raises is logged by arq at `ERROR` and raises the "Job runs that raised in the worker" alert for that namespace. To see why: Logs Explorer with `resource.labels.namespace_name="<namespace>" resource.labels.container_name="worker" severity>=ERROR`, or Error Reporting.

| Job                      | Schedule (UTC)                         | If it fails                                                                                                                                                                                  |
| ------------------------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `send_booking_reminders` | :00, :15, :30, :45                     | Reminders are late; the next run sends those still due. Check the email and SMS providers.                                                                                                   |
| `reap_unpaid_bookings`   | :05, :20, :35, :50                     | Unpaid holds keep their slots longer; the next run releases them. A Stripe outage is the usual cause.                                                                                        |
| `complete_past_bookings` | :02, :17, :32, :47                     | Past visits stay open; the next run completes them.                                                                                                                                          |
| `send_due_broadcasts`    | every minute                           | A broadcast pauses; each recipient is sent at most once, so a send that failed is recorded as failed and not retried.                                                                        |
| `sweep_overdue_invoices` | hourly at :00, for businesses at 07:00 | Acts only for businesses whose local time is 07:00, so a missed run waits until 07:00 the next day for those businesses.                                                                     |
| `expire_entitlements`    | 03:30                                  | Expired passes and gift cards stay usable until the next day's run; run it by hand if that matters.                                                                                          |
| `prune_devices`          | 03:30                                  | Stale push tokens stay one more day; no user effect.                                                                                                                                         |
| `prune_receipts`         | :10, :40                               | Used sync receipts stay longer; no user effect.                                                                                                                                              |
| `prune_pending_files`    | hourly at :20                          | Unfinished uploads stay in the bucket longer; check the storage HMAC keys if it keeps failing.                                                                                               |
| `reconcile_ledger`       | 04:00                                  | No drift check that day. Drift it finds is not a failure: it logs `ledger drift` at `ERROR`, writes `ledger.drift`, `ledger.cache_drift`, or source-specific `ledger.transaction_*` / `ledger.reconciliation_failed` audits, and raises the "Ledger drift" alert. |
| `send_review_requests`   | hourly at :00, for businesses at 08:00 | Same as the overdue sweep: the next chance is 08:00 local the next day.                                                                                                                      |
| `send_pickup_reminders`  | hourly at :00, for businesses at 09:00 | Same: 09:00 local the next day.                                                                                                                                                              |
| `reap_unpaid_orders`     | :05, :20, :35, :50                     | Unpaid shop orders hold stock longer; the next run releases them.                                                                                                                            |
| `send_intake_forms`      | :10, :25, :40, :55                     | Forms go out late; the next run sends them.                                                                                                                                                  |
| `sync_plans`             | 05:00                                  | Plan status and Premium seat counts can be a day behind Stripe after a missed event; the next run mirrors them, and opening Plans repairs status at once. |
| `send_trial_reminders`   | hourly at :00, for businesses at 09:00 | Same as the overdue sweep: 09:00 local the next day.                                                                                                                                         |

The worker's liveness probe runs `arq --check`, which fails when the worker has not refreshed its health key in Redis within `health_check_interval` (60 seconds in `WorkerSettings`; arq's default is an hour), so a hung worker is restarted. After a Redis restart the key is gone until the worker's next refresh, so the probe may restart a healthy worker once. The cron schedule assumes one worker replica; do not scale it up. Redis has no persistence, so queued jobs are lost when its pod restarts, which is safe because every job here is a cron run that the next tick repeats.

### Staging's demo seed

Staging's demo businesses are reseeded by the `seed` CronJob in the `staging` namespace, every night at 11:00 UTC (04:00 in Vancouver in summer, 03:00 in winter). The time is after Vancouver's midnight all year, so the scenario is anchored to the new day, and after the Cloud SQL backup window (four hours from 07:00 UTC) and Sunday's 08:00 UTC maintenance. Production shares the instance's single shared core, and a seed keeps it busy for about 35 minutes, so a quiet hour matters. A run seeds a scratch Postgres in its own pod, copies every demo business over, prunes stale demo logins and links the businesses to the Stripe sandbox (`stripe_setup --link-only`). It has an hour, retries twice, and never overlaps another scheduled run; a run that can't start within an hour of its time waits for the next night. Until a run finishes, the demo businesses keep their previous data.

The seed isn't part of the deploy. Each staging deploy updates the CronJob's image in place, which doesn't start a run, so after a deploy that changes the demo or the schema, run it by hand if you need fresh data before the night. The `seed-staging` workflow does that from `main` as staging's deployer: `gh workflow run seed-staging.yml --ref main` starts a Job from the CronJob, waits for it and prints its summary lines in the run's summary (`-f wait=false` returns once it has started). It refuses to start while another seed is running, since a Job started by hand isn't held back by the CronJob's concurrency policy. With cluster access, the same is one command: `kubectl -n staging create job --from=cronjob/seed seed-manual-$(date +%s)`, then `kubectl -n staging logs -f job/<name> -c seed` for its output. `kubectl -n staging get jobs -l app=seed` lists the recent runs; the CronJob keeps the last successful one and the last two failed ones.

## Health checks and alerts

| Check                | What it does                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| API probes           | Startup and liveness on `/health` (touches nothing), readiness on `/ready` (`SELECT 1`, 503 naming what failed; Redis is left out so its outage affects only the rate-limited public routes and the worker) |
| Auth probes          | `/health/ready` and `/health/alive` on the public port                                                                             |
| PowerSync probes     | `/probes/startup`, `/probes/readiness`, `/probes/liveness`                                                                         |
| Web probes           | `/robots.txt`, which Caddy answers for any host                                                                                    |
| Load balancer health | Gateway health check policies per backend (`kubernetes/gateway.py`), separate from the pods' probes                                |
| Deploy smoke test    | `api.` `/health` and `/ready`, `sync.` `/probes/liveness`, `app.`, `admin.` and the apex `/`, and `/config.js` on `app.`, `book.`, `shop.`, `pay.` and a business page |
| Staging browser smoke | `make test-staging-smoke` after each staging deploy: Connect hosts, embeds, frame policy and every demo owner's sign-in, read-only |

Alerts (`cloud/observability.py`) go to the `alertEmail` channel:

| Alert                              | Condition                                                 | First response                                                                                                                                                                                      |
| ---------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<env> api.D` / `app.D` uptime     | `/health` or `/` failing from three regions for 2 minutes | `kubectl -n <namespace> get pods`; check the last deploy and roll back if it caused it.                                                                                                             |
| Database CPU                       | Above 80% for 15 minutes                                  | Query Insights in the Cloud SQL console; if it is steady load, this is the trigger for the larger tier.                                                                                             |
| Database disk                      | Above 80%                                                 | Disk autoresize is on; check retained WAL first (next row), since a stuck slot is the likely cause.                                                                                                 |
| Replication slot lag               | More than 2 GiB of WAL retained for 15 minutes            | A PowerSync is stopped or stuck. `kubectl -n <namespace> get pods -l app=powersync` and its logs; restart it. If it cannot recover, drop its slot (see the restore runbook) and let it re-snapshot. |
| Job runs that raised in the worker | Any arq `ERROR` in a namespace's worker                   | See [Jobs](#jobs).                                                                                                                                                                                  |
| Ledger drift                       | `reconcile_ledger` logged `ledger drift` in a namespace   | Inspect the ledger audit and business id. Transaction drift includes the Stripe source, transaction IDs, and both net amounts. Fix the cause and rerun reconciliation; investigate unsupported adjustments rather than entering an unexplained balance correction.                           |
| Webhook failures                   | Any `/webhooks/*` answered with a 5xx                     | Find the request in Logs Explorer; providers retry, so fix the cause and confirm the retry succeeds (Stripe's Dashboard can resend an event).                                                       |
| Monthly budget                     | 50%, 90% and 100% of $150 spent, and 100% forecast        | Compare the bill with the plan's cost table.                                                                                                                                                        |

Container logs go to Cloud Logging as one JSON object per line, and Error Reporting groups errors that carry a `stack_trace`. The replication slot alert's metric (`bytes_used_by_data_type` with `data_type="wal"`) is still to be confirmed on the real instance in D10. Locally, `make replication-health` runs the same slot and lag checks.

## Backups and restore

The Cloud SQL instance keeps daily backups for 7 days and point-in-time recovery over the same window, and it is protected in Pulumi and by deletion protection. Buckets keep noncurrent object versions for 30 days. The instance holds both environments' databases, so any restore of the instance restores both, and each environment then chooses whether to move to it.

**Untested: this runbook has not been run. Task D11 runs it on staging, and it must not be relied on for production until that drill passes.** An environment is moved to a clone with its stack's `clientbridge:databaseInstance` setting, which changes only the instance its pods' Auth Proxies reach; the other environment stays on the shared instance.

1. Pick the target time in UTC (RFC 3339). Data written after it is lost, including auth sessions and identities created since.
2. For production, stop writes: `kubectl -n prod scale deploy/api deploy/worker deploy/powersync --replicas=0`. The next `pulumi up` restores the replica counts.
3. Clone the instance at that time into a new one:
   ```
   gcloud sql instances clone clientbridge clientbridge-restore-<yyyymmdd> \
     --point-in-time 2026-10-13T14:05:00Z
   gcloud sql instances describe clientbridge-restore-<yyyymmdd> \
     --format 'value(settings.databaseFlags, settings.ipConfiguration.privateNetwork)'
   ```
   Confirm the clone has `cloudsql.logical_decoding=on` and the same private network. Users and passwords come with the clone, `<env>_admin` included, so the generated database URLs keep working.
4. Point the environment at the clone: from `infra/pulumi`, `pulumi config set --stack staging clientbridge:databaseInstance clientbridge-restore-<yyyymmdd>` and commit `Pulumi.staging.yaml`. The redeploy in step 6 applies it, and `pulumi stack output databaseConnection --stack staging` then names the clone.
5. On the clone, as `<env>_admin` (Cloud SQL Studio in the console; the password is in `<env>-admin-database-url`), remove the environment's PowerSync state, because its slot and bucket storage describe the old instance's WAL:
   ```
   SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots
    WHERE slot_name LIKE 'powersync%' AND database = 'staging_clientbridge';
   DROP DATABASE staging_powersync_storage WITH (FORCE);
   ```
   For production the names are `clientbridge` and `powersync_storage`.
6. Redeploy the environment so the pods reach the clone and the migrate Job recreates the storage database (`db_access roles` creates it, owned by the storage role). The migrate Job is named after the digests, so delete the completed one first and let Pulumi recreate it, from `infra/pulumi`:
   ```
   kubectl -n staging delete job -l app=migrate
   pulumi up --stack staging --refresh \
     --config clientbridge:backendDigest=$(pulumi stack output images --stack staging --json | jq -r .backend) \
     --config clientbridge:webDigest=$(pulumi stack output images --stack staging --json | jq -r .web)
   ```
7. Restart PowerSync so it creates a new slot and snapshots the database again: `kubectl -n staging rollout restart deploy/powersync`, then follow `kubectl -n staging logs deploy/powersync -f` until the initial replication completes.
8. Verify: `https://api.D/ready` and `https://sync.D/probes/readiness` answer 200; `SELECT slot_name, active FROM pg_replication_slots` on the clone shows one active `powersync` slot for the environment's database; a web and a mobile client sign in and show data as of the target time, and a device that had newer rows drops them after its checksums disagree with the new buckets.
9. Bring the providers back in line: find the Stripe events since the target time in the Dashboard (Workbench > Events, filtered by date), resend those the database is missing (`stripe events resend <id>`, with `--live` for production), and check the next `reconcile_ledger` run records no drift.
10. Keep the old instance until the environment has run on the clone for a day. The cloud stack's database alerts still describe the shared instance, so either move the environment back after copying what it needs, or, when both environments move, adopt the clone into the cloud stack (`pulumi import`) in place of the old instance, clear `databaseInstance`, and remove the old one through Pulumi (it is protected, so the protection is lifted in the program first).

## Scaled configurations

Every cost saving in the current setup is a sizing choice, lifted by changing a value in the Pulumi program when its trigger is reached. The current size, the scaled configuration and the trigger for each part (cluster, workloads, database, edge, storage, observability) are in the plan's [architecture and cost choices](executions/deploy/plan.md#architecture-and-cost-choices), and the cost of each column in its [cost table](executions/deploy/plan.md#cost).

## Internal review removal deployment

Migration cb0019 removes internal review feedback and moderation data, preserving only actual invitation history in `review_requests`. Take and verify a database backup before the deployment migration; the migration is deliberately irreversible. Old review command replay payloads are deleted too. Deploy the matching API, PowerSync rules and web/mobile clients together; old feedback forms and review embeds are retired, and public profiles no longer display internal ratings or testimonials. Existing invitation links to the retired form stop working. New invitations use the saved Google URL directly. No Google Business Profile API connection is introduced by this cleanup.
