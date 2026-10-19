# Google Business Profile reviews implementation plan

Status: ready for implementation planning review. Research checked 2026-10-18 against official Google and Pulumi documentation. This branch contains the execution plan and internal collection removal, not a deployed Google API integration. Follow [tasks](tasks.json), [schema proposal](schema.md), and [progress](progress.md).

Build a Google connection that lets an owner choose their business location, read its Google reviews, publish and manage replies, and send neutral review invitations after appointments. Remove Clientbridge feedback collection entirely; retain invitation history separately from Google content. Provision supporting cloud resources with the existing Python Pulumi program; Google API access approval and OAuth configuration remain explicit operator tasks.

## Scope and product decisions

- First release: one Google location per Clientbridge business, with account/location selection, reconnect/disconnect, paginated review viewing, Google-provided rating/count, explicit reply create/edit/delete, refresh status, background invalidation and appointment invitations. Different businesses may select different locations from one Google account. Reject a location already actively bound to another business in the same environment.
- Keep Google review reads online-only and invitation history synced. Remove internal feedback collection, approval, publication, replies and public testimonials. Never fabricate client or booking matches from Google reviewer names.
- Send neutral invitations directly to Google. There is no internal rating or feedback form. No incentives, suggested positive ratings, automatic customer review creation, or automatic owner replies.
- Use Google-supplied review links where available, with the existing manually configured link as a clearly labelled fallback. A link click means a visit to Google, not a posted review or a conversion. Do not match an invitation to a public review without a reliable identifier; Google does not provide that attribution in these APIs.
- Exclude listing editing, profile creation/claiming/verification, agency APIs, AI replies, review deletion, public Google testimonial widgets, exports, sentiment analysis, historical rating analytics and multi-location rollups. These would need separate product and policy decisions.

Google prohibits selectively soliciting positive reviews. The cleanup in this branch removes the former published-only Google prompt. [Google Maps contribution policy](https://support.google.com/contributionpolicy/answer/7400114?hl=en)

## Original repository audit (before removal)

| Area                   | Existing code and consequence                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Internal reviews       | `backend/src/clientbridge/{models,schemas,api,services}/reviews.py`: client-linked requests and submissions, local replies, hide/publish and a misleading `sent_to_google` flag. Do not import Google reviews into these rows. |
| Appointment automation | `services/reviews.py::run_review_requests`: 8 a.m. business time, completed bookings from seven days, booking deduplication. UI manual requests currently omit booking IDs.                                                    |
| Customer flow          | `services/public.py::PublicReviewService`, Connect `PublicReview.tsx`, shared `publicReview.ts`: 1–3 stars held by default, Google link supplied only after publication.                                                       |
| Shared UI              | `app-core/src/domain/reviews.ts` plus web/mobile Reviews: a common view-model already exists; settings disappear in the empty state and saving an untouched stored URL clears it.                                              |
| Delivery               | `services/notifications.py` sends review requests directly. Reuse the queue/transport boundaries in `services/deliveries.py`; do not pretend a requested row proves delivery.                                                  |
| Infrastructure         | `infra/pulumi/Pulumi.cloud.yaml` targets `clientbridge-platform`, `us-east1`, currently staging only. Cloud stack owns APIs, workload identities, secrets and shared resources; environment stacks own deployments.            |
| Google sign-in         | `kubernetes/settings.py` sends existing `GOOGLE_OAUTH_*` values to Kratos. GBP authorization is a separate integration and separate credentials; it must not alter sign-in.                                                    |
| Secrets                | `cloud/secrets.py` provisions containers and readers, never values; `secrets_init.py` provisions generated values. Preserve that boundary.                                                                                     |

## Google prerequisites and operator setup

### Access approval

An operator must confirm a verified Business Profile active for at least 60 days, its matching business website, and their owner/manager access. Obtain the numeric project number for `clientbridge-platform`, apply for Basic API Access using that project and an appropriate profile owner/manager email, and retain the approval evidence. Google documents zero quota as unapproved and 300 QPM as an approval indicator; record actual quotas per service rather than treating that number as a universal limit. [Prerequisites](https://developers.google.com/my-business/content/prereqs)

Existing Pulumi files do not prove live approval. A read-only inspection on 2026-10-18 failed because gcloud requires reauthentication. The operator's first steps are:

```sh
gcloud auth login
gcloud projects describe clientbridge-platform --format='value(projectNumber)'
gcloud services list --enabled --project=clientbridge-platform --format='value(config.name)'
```

Inspect GBP quotas in Cloud Console and record status in progress.md. Keep API enablement behind a Pulumi feature configuration until approval, so an unavailable restricted API cannot block unrelated cloud deployments. Do not submit access applications or claim their approval automatically.

### OAuth configuration

Create dedicated Web application OAuth clients for staging and production in the approved project. Use the Google Auth Platform console for branding, audience, data access, clients and verification. Configure authorized domains, public homepage, privacy policy, terms, support email and developer contacts. Request `https://www.googleapis.com/auth/business.manage`; check its actual classification in the project's Data Access screen and complete whatever brand/data-access verification Google requires. Do not assume it is a restricted scope or promise a particular approval timeline. Prepare a demonstration of connect, location selection, review viewing, deliberate reply publishing and disconnect. [Setup](https://developers.google.com/my-business/content/basic-setup), [verification preparation](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)

Register exact callbacks:

- Staging: `https://api.staging.clientbridge.ca/v1/google-business/callback`
- Production: `https://api.clientbridge.ca/v1/google-business/callback`
- Development: a separate developer client and explicitly registered localhost callback, never a wildcard or production callback override.

Use server-side authorization-code exchange and offline access. Google OAuth Testing grants with this scope have seven-day refresh-token expiry; staging must exercise reconnect, and production launch must verify the appropriate publishing state. OAuth consent/publishing is project-level: separate clients in this shared project do not create independent test/production consent configurations. If independent consent lifecycles become necessary, provision and request approval for a separate developer-owned project rather than silently splitting the existing infrastructure. [OAuth web server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [token lifetime](https://developers.google.com/identity/protocols/oauth2)

Use console-created credentials as an explicit bootstrap input. Pulumi's similarly named `gcp.iam.OauthClient` targets Workforce Identity Federation, not a consumer Google Auth Platform client. Do not substitute it or an IAP client. [Pulumi resource scope](https://www.pulumi.com/registry/packages/gcp/api-docs/iam/oauthclient/)

### APIs to enable through Pulumi

Google's setup body lists seven associated APIs, although its generated summary uses a different count. Follow the named list, not the summary count. [Basic setup](https://developers.google.com/my-business/content/basic-setup)

| Service ID                                     | Use                                                                              |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `mybusiness.googleapis.com`                    | v4 review reads and replies                                                      |
| `mybusinessaccountmanagement.googleapis.com`   | Account discovery                                                                |
| `mybusinessbusinessinformation.googleapis.com` | Location discovery and metadata                                                  |
| `mybusinessnotifications.googleapis.com`       | Review event notifications                                                       |
| `mybusinessverifications.googleapis.com`       | Required family setup; no verification mutations in scope                        |
| `mybusinessplaceactions.googleapis.com`        | Required family setup; no application calls planned                              |
| `mybusinesslodging.googleapis.com`             | Required family setup; no application calls planned                              |
| `pubsub.googleapis.com`                        | Notification delivery                                                            |
| `cloudkms.googleapis.com`                      | Dedicated OAuth token encryption key; inspect existing bootstrap ownership first |

Confirm service IDs against Service Usage during the approved-project preflight. Record unavailable APIs as external blockers; no untracked manual API enablement to bypass Pulumi.

## API contract research

| Capability         | Google contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts           | `GET https://mybusinessaccountmanagement.googleapis.com/v1/accounts`, all pages, maximum 20/page. Expand organization/user-group parents as needed and deduplicate reachable accounts. [Reference](https://developers.google.com/my-business/reference/accountmanagement/rest/v1/accounts/list)                                                                                                                                                                                                    |
| Locations          | `GET https://mybusinessbusinessinformation.googleapis.com/v1/accounts/{id}/locations`, required `readMask`, all pages. Request only name, title, storefrontAddress and metadata needed for selection. [Reference](https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations/list)                                                                                                                                                                         |
| Location metadata  | `GET https://mybusinessbusinessinformation.googleapis.com/v1/locations/{id}?readMask=...`. `metadata.newReviewUri` is the customer review URL; `mapsUri` opens the listing. Handle missing fields and service-area businesses without assuming a storefront address. [Get](https://developers.google.com/my-business/reference/businessinformation/rest/v1/locations/get), [metadata](https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations#Metadata) |
| Reviews            | `GET https://mybusiness.googleapis.com/v4/accounts/{account}/locations/{location}/reviews`. Verified locations only, maximum 50/page, `nextPageToken`, default `updateTime desc`; response supplies `averageRating` and `totalReviewCount`. [List](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/list)                                                                                                                                                    |
| Single review      | `GET https://mybusiness.googleapis.com/v4/accounts/{account}/locations/{location}/reviews/{review}`. Use for event refresh and ambiguous reply reconciliation. [Review guide](https://developers.google.com/my-business/content/review-data)                                                                                                                                                                                                                                                       |
| Publish/edit reply | `PUT https://mybusiness.googleapis.com/v4/accounts/{account}/locations/{location}/reviews/{review}/reply`, body `{"comment":"..."}`; verified locations only. [Update](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/updateReply)                                                                                                                                                                                                                         |
| Remove own reply   | `DELETE` the same `/reply` URL. It removes the business reply, not the customer's review. [Delete](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/deleteReply)                                                                                                                                                                                                                                                                                             |
| Reply limits       | Maximum 4096 UTF-8 bytes; account for multibyte characters in server validation and UI counters. [ReviewReply](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews#ReviewReply)                                                                                                                                                                                                                                                                                 |
| Notifications      | GET/PATCH `https://mybusinessnotifications.googleapis.com/v1/accounts/{id}/notificationSetting`, `updateMask`, topic and `NEW_REVIEW`, `UPDATED_REVIEW`. Events carry `review_name` and `location_name`. [Setup](https://developers.google.com/my-business/content/notification-setup), [setting](https://developers.google.com/my-business/reference/notifications/rest/v1/NotificationSetting)                                                                                                   |

Use an injectable `GoogleBusinessGateway` adapter in `integrations/google_business.py`, typed DTOs and recording boundary fakes. Reuse HTTPX; explicit connect/read timeouts, response size limits, redacted errors and a small mapping from Google's star enums to display values. Preserve returned text and attribution. Never let callers supply an arbitrary upstream URL or unscoped resource path.

## Storage and policy decisions

Google limits cached content to small performance-oriented amounts, securely stored for at most 30 calendar days, and prohibits manipulation/aggregation of that stored content. It also requires authorized replies, easy disassociation, attribution, and prohibits exposing the project as a third-party programmable proxy. These constraints shape the design below. [GBP API policies](https://developers.google.com/my-business/content/policies)

**Proposed implementation:** use bounded Redis entries with a 24-hour absolute TTL for recently requested pages, review details and location display metadata. No permanent Google review table, no PowerSync projection, no persisted mobile/browser query cache, no service-worker cache and no Google text in public profiles, exports, audit payloads, logs, command replay bodies or backups. Google tab responses use `Cache-Control: no-store`; the client keeps only foreground memory and clears it on logout, business switch and disconnect. Redis loss is a cache miss, not data loss. Store and display Google's supplied rating/count unchanged rather than calculate a distribution or combine ratings.

Cap cached pages per connection (initial target 10 pages) and global memory; fetch older pages on demand. Absolute age is based on upstream retrieval, never extended by a cache hit. Do not persist reviewer avatars; if used later, preserve attribution and address remote-image privacy first. Store only operational connection identifiers durably, with an explicit retention review for those identifiers. A full persistent review warehouse or public republication requires a different approved design.

## Pulumi implementation

| Repository surface                           | Planned change                                                                                                                                                                                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `environments.py`, stack YAML                | Add default-off GBP provisioning/runtime configuration, validate required callbacks and secret references only when enabled. Shared project quotas apply to both environments.                                                                                              |
| `cloud/services.py`                          | Add gated GBP API family, Pub/Sub and KMS enablement using existing service dependencies and `disable_on_destroy=False`. Avoid importing/bootstrap-owning the same API twice.                                                                                               |
| New `cloud/google_business.py`               | Per-environment topic, authenticated push subscription, dead-letter topic/subscription, dedicated push service account and dedicated KMS key. Preserve resources during ordinary application rollback.                                                                      |
| `__main__.py`                                | Wire resources after services and workload identities; export nonsecret topic names, expected push identity/audience and key resource. Environment stack consumes outputs.                                                                                                  |
| `cloud/secrets.py`, `kubernetes/settings.py` | Add `GOOGLE_BUSINESS_CLIENT_ID` and `GOOGLE_BUSINESS_CLIENT_SECRET` containers. Restrict readers to API/worker. Existing broad PROVIDED expansion must be split so auth/migration/PowerSync do not inherit these values. Feature-off pods must not mount empty new secrets. |
| `secrets_init.py` / provider setup           | Document secure insertion of console-generated OAuth credentials through stdin/file, no shell arguments, logs or Pulumi secret versions. No per-customer refresh tokens in Secret Manager or Pulumi state.                                                                  |
| Backend config and deployment                | Supply feature flag, callback URI, topic, push identity/audience and KMS key name; use workload identity for KMS, never service-account JSON keys.                                                                                                                          |
| `cloud/observability.py`, infra tests        | Cache/refresh failure, auth failure, queue age, Pub/Sub backlog/DLQ and reply reconciliation alerts; mocked resource assertions for IAM and environment isolation.                                                                                                          |

Grant topic publisher to `mybusiness-api-pubsub@system.gserviceaccount.com`. The Pub/Sub service agent needs token creation on the dedicated push service account; the provisioning principal needs `actAs` for that account. The API verifies JWT signature, issuer, expiry, exact audience, expected service-account email and `email_verified`; a request merely originating from Google is insufficient. Use the GKE HTTPS API endpoint, not Cloud Run invoker roles. [Notification setup](https://developers.google.com/my-business/content/notification-setup), [authenticated push](https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions)

Proposed push endpoint: `https://api.<base>/webhooks/google-business`. Configure retry backoff, 60-second ack deadline, 24-hour message retention and dead-letter forwarding after 10 attempts; verify provider-supported bounds and required DLQ publisher/subscriber grants. Alert on any DLQ message and oldest pending event over 15 minutes. Keep all identifiers environment-scoped.

Use a dedicated symmetric KMS key per environment for refresh-token envelope encryption, with API/worker encrypter/decrypter access only. Bind tenant and connection ID as authenticated encryption context. Include key version metadata, rotation and restore tests. Do not reuse the Pulumi state key. Runtime OAuth refresh tokens authorize GBP calls; GKE workload identities alone do not grant access to customers' profiles.

## Application workflows

### Connect and reconnect

1. An owner/admin starts `POST /v1/google-business/connect`. Require current membership and CSRF protection for browser sessions. Create short-lived, single-use OAuth state bound to actor, business, environment and an allowlisted return target. Use state entropy, a browser binding and PKCE where supported by the chosen Google client flow; test the exact exchange before launch.
2. Open Google's consent in the system browser. Callback exchanges the code server-side, validates state and granted scopes, then stores an encrypted pending connection. Recheck the initiator's current role before activation. Never carry Google tokens to web/mobile URLs or logs.
3. Return an opaque one-time completion handle; web and mobile finalize against their authenticated session. Mobile uses a dedicated verified app/universal link and backend-owned flow binding, not an arbitrary redirect or an embedded webview. Token possession alone cannot switch business ownership.
4. List accessible accounts/locations and require a deliberate selection. Validate account and location ownership using the credential again at save time. Preserve full v1 location and v4 parent identities; do not confuse a Place ID with a location ID.
5. `POST /v1/google-business/location` atomically binds the selected location with uniqueness checks. Show no profiles, unverified/inaccessible location, denied consent, wrong account, pending Google approval, quota failure and reconnect-required as distinct states.
6. Refresh access tokens under a per-connection lease. Preserve an existing refresh token if Google omits a new one. On `invalid_grant`, stop retries, mark reconnect-required and clear cached content. Do not treat every 403 as a revoked token; distinguish API disabled, insufficient permissions and profile restrictions.

Use `api/google_business.py` → `services/google_business.py` → models/adapter; service methods enforce owner/admin and `scoped()` tenancy. Proposed RPCs: status, connect, accounts, locations, select location, refresh and disconnect. Read-only discovery/list GETs are online integration reads; document this explicit exception to the usual PowerSync read path in architecture.md. Mutations are online commands, never offline-outbox actions.

### Reviews and replies

`GET /v1/google-business/reviews` accepts an opaque, connection-bound cursor and a supported Google ordering. Fetch the first page on connection/open; refresh expired entries. Display source, location, Google rating/count and last successful fetch. Offline mode clearly says Google reviews require a connection; never present an old persistent replica as current.

`POST /v1/google-business/replies` and `/replies/delete` take an opaque review identifier, an idempotency key and the last observed reply revision. Publish only after the owner/admin presses a button explicitly labelled for Google. Validate UTF-8 byte length and tenant/resource ownership. Preserve a failed draft in foreground memory and show pending, confirmed, failed or outcome-unknown states.

Store a durable operation intent before calling Google, serialize writes per review, and return only an operation ID/status through command replay. Never put upstream review content in generic `commands.response`. On timeout or worker death after sending, read back the current reply before retrying. If it matches the authorized text, finish the operation; if it differs, surface the conflict instead of overwriting an external edit. Recheck authority and connection generation at execution time. Google's documented reply methods provide no compare-and-swap precondition, so there remains a narrow race with external writers; disclose it in the engineering design and never claim exactly-once remote mutation.

Use a readback before edit/delete to detect stale revisions where possible. Disconnect blocks queued writes and invalidates cache immediately. Reply removal needs an explicit product confirmation; a server-side 404 must be classified between already-absent reply and lost review/location access.

### Notifications and reconciliation

Notification settings are account-scoped, not location-scoped. Read existing settings before changing them. If another topic exists, default to polling and show the conflict; do not silently take over another vendor's notifications. If an operator deliberately switches it, record prior configuration and the exact change authorized. Multiple linked locations on one account share one registration. Staging must not take over a production-connected account.

Push validates identity and payload, maps `location_name` to an active tenant connection, and inserts a deduplicated work item before returning 2xx. Never trust a payload-provided tenant ID. Unknown/unlinked locations can be acknowledged and ignored without persisting their content. Duplicate/out-of-order events invalidate the relevant cache and coalesce fetches; events are hints, not authoritative review bodies. Existing durable webhook storage needs payload minimization or a dedicated operational queue, not indefinite raw event retention.

Use periodic refresh for active connections and manual refresh with throttling. Initial target: refresh recently viewed first pages every 15 minutes with jitter; bounded cached-page refresh every 24 hours. No account-wide historical prefetch. A review absent from one page is not proof of deletion; discard stale page caches and re-fetch, and confirm individual removals with a detail request. The documented event types have no review-deletion event, so polling/cache expiry remains necessary.

On disconnect, remove only this location's association. Clear the account's notification setting only when no active local bindings remain and the remote setting still equals ours. Never restore a stale previous vendor setting over a newer change. Revoke credentials when safe for the OAuth grant, document that revocation can affect other connections sharing that Google authorization, and provide local unlink even when Google is unavailable. Cleanup/revocation failure becomes a visible retryable operation.

### Appointment invitations

- Preserve appointment identity for manual suggestions and automatic requests; validate that booking and client belong together and that the visit is eligible. Use one normal request per booking, with explicit resend handling rather than duplicate rows.
- Queue each channel atomically with the request using existing delivery infrastructure. Show queued/accepted/failed/ambiguous separately from link-open/submission states, respect existing SMS stop controls, and inspect email consent/suppression rules before enabling automated outreach. Provider acceptance is not recipient delivery.
- Add an automation enabled setting, local send hour (default current 8 a.m.) and minimum post-completion delay (default next eligible morning). Preserve the current seven-day catch-up bound; add a proposed 30-day client cooldown across bookings to avoid frequent-visitor spam. Freeze the final defaults in schema approval and test timezone/DST behavior.
- Render Google settings even with zero reviews. Correct the unchanged-link save behavior. Remove the owner-facing share-as-posted action and badge. Existing `sent_to_google` values cannot be backfilled as verified Google posts.
- Remove the internal form, tokens, moderation settings/actions, local replies, testimonials, ratings, alerts, embeds and all corresponding contracts and fixtures. Keep only request identity and timestamps; the cleanup migration requires explicit data-deletion approval.

## Quotas and operational behavior

Several v1 services document 300 QPM, but configure limits from each approved project's actual quotas, including the separate reviews service. Share distributed rate limits across API and workers, reserve capacity for interactive replies, honor Retry-After and use exponential backoff with jitter for 429/5xx. [Usage limits](https://developers.google.com/my-business/content/limits)

Budget example, not a Google guarantee: 1,000 active locations polled once per 15 minutes use about 67 first-page requests/minute before pagination, user reads and retries. Poll only active/viewed data and use notifications to invalidate rather than fetch all history. Expose sanitized error codes and last successful fetch, not provider response bodies. Track request counts, latency, 401/403/429, refresh failures, pending operations, cache age and notification conflicts without reviewer text or high-cardinality PII labels.

## Delivery phases and acceptance

| Phase | Work and exit condition                                                                                                                                                                                                      |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Confirm API access, consent configuration, live project status and the schema proposal; finalize defaults and cache handling. Recording fakes and contract types can start before external approval.                         |
| 1     | Pulumi resources, secret wiring and adapter. Mock resource tests prove least privilege, disabled mode and environment separation; approved staging preview shows only intended changes.                                      |
| 2     | OAuth, location selection, reconnect/disconnect and token encryption. Integration tests cover tenant attacks, replay, expired state, lost membership, pagination and token rotation.                                         |
| 3     | Online Google review tab in web/mobile with bounded cache. Tests cover missing text, anonymous reviewer, star enums, pagination, Unicode, deleted/edited reviews, no cached content after logout/expiry and accurate totals. |
| 4     | Authorized reply commands and durable reconciliation. Prove idempotency, concurrent writers, timeout-after-success, worker crash, external edit, revoked grant and UTF-8 boundary behavior.                                  |
| 5     | Pub/Sub notifications and polling fallback. Prove invalid JWT/audience/email rejection, duplicate delivery, account-topic conflict, tenant mapping, queue recovery and shared-account disconnect.                            |
| 6     | Neutral invitations, reliable request delivery and settings fixes. Prove all ratings see the Google action, manual/automatic deduplication, resend, suppression, cooldown and timezone handling.                             |
| 7     | Controlled live pilot, observability, policy/retention review, rollback drill and gradual production rollout. Complete all release gates below.                                                                              |

Run backend HTTPX/Postgres tests against a fresh isolated database with boundary fakes and the repository happy/4xx/security/idempotency matrix. Shared hooks get behavioral tests; web/Connect browser and real mobile tests exercise OAuth handoff, empty states and publication errors. Regenerate API/client/catalog artifacts when changed; keep Google content out of sync fixtures. Run `make check`, pre-commit and relevant browser/mobile/PowerSync regression gates per slice. Audit each phase for service tenancy, role gates, external side effects, shared UI logic and secret exposure.

Google has no GBP sandbox. Use consenting real pilot profiles for read operations and an explicitly authorized reply create/edit/delete on an existing genuine review; never create fake reviews for tests. Do not assume `validateOnly` exists on review reply endpoints. [Testing constraint](https://developers.google.com/my-business/content/basic-setup)

## Rollout and rollback

Feature flags independently control connect, read, write and notifications. Ship schema and disabled code first, populate secrets before enabling mounts, then apply cloud preview and staging. Enable a small business allowlist for read-only pilot before replies and invitations. Acceptance requires successful token refresh beyond the initial access-token lifetime, mobile return, revoked-access recovery, account conflict fallback, no sentiment gating, cache expiry, queued-write cancellation and no secrets/content in logs or persistent replicas.

Launch requires recorded API access and OAuth publication/verification status, passing live smoke tests, alerts owned, operational runbooks and explicit schema approval. No fixed delivery date depends on unapproved Google access.

Rollback disables new connections/writes/notifications, drains or cancels outstanding operations, purges Google cache and retains the direct Google-link invitation experience. Internal feedback collection must not be restored. Keep credentials encrypted only as required for authorized cleanup, then revoke/delete on disconnect. Do not drop schema or destroy topics/keys as an application rollback. Inspect current remote notification settings before changing them. Move durable operating guidance into operations.md and architecture.md when complete.
