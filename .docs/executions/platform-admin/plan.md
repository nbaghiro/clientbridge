# Platform admin: support, email testing and operations

Status: shell implementation started, 15 October 2026. This is a delivery plan, not approval to add database tables or run production operations. The email/CID prerequisite is tracked separately in PR #15. The admin shell is implemented; operator authorization, live data and schema work remain pending.

## Outcome

Build a staff-only Clientbridge console at `admin.<base-domain>` for platform operators. An operator can find a person or business, understand its current state, follow a payment across Clientbridge and Stripe, inspect a grouped activity history, preview an email using synthetic data and send a marked test to a chosen recipient. Operational changes are named commands with authorization, reasons and durable results. The console uses the existing design language while always identifying itself as a platform tool.

The initial release is desktop-first and responsive. It is a separate web app, not an extra tenant navigation item and not an offline replica of all businesses. It uses online, paginated API reads. Tenant owners/admins never acquire platform permissions from their business role.

## Current foundations and gaps

- `frontend/packages/ui/src/web`, tokens, icons, catalog/formatting tools and API session handling can be reused. Keep common component contracts and native twins consistent with CLAUDE.md; admin-only page composition stays in the admin app.
- FastAPI currently resolves a tenant `Principal` through membership. Add a separate platform principal and service authorization path; do not weaken existing `scoped()` tenant boundaries or treat a request's business ID as authorization.
- Kratos supplies identity and session verification. It does not make a business owner a platform operator. Reuse identity verification, require a fresh second factor for privileged operations, and keep grants in a server-only authority.
- `users` are login identities. `staff` associates users and businesses. `clients` are business-local customer records and can exist without a login. The console must not merge unrelated clients by matching email/phone or invent a global client identity.
- `payments` links bookings/invoices/orders and refund parents. The ledger is authoritative for money. Stripe IDs, accounts, commands and webhook state provide useful investigation handles.
- `audits` is business-scoped and records domain mutations, not a complete platform access log. Processed Stripe webhook bodies are intentionally cleared. Neither source is a complete historical trace of every operation.
- Current jobs and logs are not a persisted operator-run history. Avoid presenting inferred job completion as verified evidence.
- PR #15 supplies production email builders, branded HTML/plain text and bundled CID artwork. Its CLI offers ten representative synthetic samples. It is not yet a complete template registry or an admin UI.
- The deploy branch supplies readiness, structured logs, environment configuration, secret management and a migration Job. Reuse those mechanisms; do not add a second browser-driven migration engine.

## Navigation and visual identity

Top-level navigation: Overview; Businesses; People; Payments; Email lab; Activity; Operations; Access.

Use the existing Pewter typography, spacing, fields, tables, panels, badges and formatting. Distinguish the console with a persistent high-contrast shell, a shield/tool glyph, the literal label “Platform admin”, and an environment badge and banner on every screen. Use the approved deeper blue accent (#243f65, compared with the app’s #3f5e80) through admin-scoped tokens. Environment is communicated by text and icon as well as color. A production action repeats the environment in its confirmation.

The header includes search by business/user/client/payment/provider ID, current environment, operator identity and selected business context. Read-only detail screens show a clear context breadcrumb. Use dense but legible tables, sticky identity summaries and expandable evidence panels. No tenant impersonation in the first release.

Suggested business workspace: Overview | Team | Clients | Payments | Messages | Activity. Suggested payment workspace: Summary | Related records | Ledger | Provider events | Delivery. These are linked views of source records, not copies that drift.

Keyboard navigation, readable focus, small-screen operation, screen-reader labels and contrast are acceptance requirements. Admin labels belong in the existing catalog tooling under an `admin` concept; dates and money use the existing formatters with explicit zone/currency. Show UTC alongside business-local times where incident investigation needs both.

## Capabilities

### Overview and search

Show environment/build, API/worker/sync status, recent failed jobs/webhooks, notification failures and reconciliation alerts. Every indicator shows source, last observation and freshness. Search is bounded and paginated; IDs are exact-match first, personal-data search requires the relevant capability. Empty, partial and unavailable provider states are distinct.

### Businesses and people

List businesses by ID/name/status/plan, with connected Stripe account and setup state. Inspect memberships, owner, locales, zones and linked resources. People lists distinguish platform user, tenant staff membership and customer record.

Start with read-only access. Later actions include explicitly scoped profile corrections and membership/support operations that call existing services where applicable. Each write displays the target, permitted fields, before/after summary and a reason. Revalidate current state on submit and record an audit event. Money, credentials, secrets and ledger rows never become editable grid cells. Revoking identities/sessions is a separate command with clearly stated impact.

### Email lab

Registry rows have a stable template key, audience (platform/provider/client), supported locale, fixture scenario, relevant builder and template/build revision. First cover the existing ten CLI samples; inventory all builders and auth email variants before claiming complete coverage.

Workflow: select template -> select synthetic scenario and locale -> inspect HTML/plain text/subject/from/reply-to -> choose recipient -> send one test -> show delivery result and provider event history.

Use the same production builders and sender adapters. Preview references the exact assembled email; it does not independently rebuild the HTML. Browser previews resolve CID bytes to data URLs inside a sandboxed frame with scripts/forms/navigation disabled. Download a MIME `.eml` for inspection. Expose desktop/phone widths and an image-hidden view. Record that browser previews cannot prove Gmail/Outlook/Apple Mail rendering.

Test sends use synthetic fixtures, nonfunctional `.test` action links, a `[TEST]` subject prefix and an explicit single recipient. They must not create authentication sessions, redeemable tokens, payment intents or business records. Require `email.test_send`, server-side per-operator/environment throttling and idempotency for the send action. On production, use a configured verified tester allowlist initially; adding a recipient is a distinct audited permission. Do not silently reuse a client address from the inspected business.

Record request/result, template revision, scenario, actor, environment, destination (restricted access), provider message ID and delivery status. Accepted, delivered, bounced and complained are separate states. Feed status from existing Resend callbacks where correlation is available. Keep production templates in code/catalogs with PR review initially; arbitrary HTML editing and campaign sending are later scope.

Uploaded business logos currently use the existing media URL; fixed header/contour art is bundled. Decide separately whether logo snapshots should also be embedded, with size/content validation and no arbitrary URL fetches.

### Payment investigations

Search by local payment, invoice, order, booking, Stripe intent/charge/refund/event, business or customer. A single page shows amount/currency, current local state, provider state with retrieval time, payment method summary (brand/last four only), connected account and test/live mode.

Trace invoice/order/booking -> payment/deposit -> refund children/dispute -> related ledger journals -> webhook/command/audit evidence. Show reconciliation differences explicitly; don't replace local financial records with a live Stripe response. Fetch live provider detail only on demand through the server, with bounded timeouts and clear unavailable/stale states.

Provide validated Stripe Dashboard links scoped to the correct connected account and sandbox/live mode. Verify the actual Dashboard URL formats during implementation against current Stripe documentation and the configured sandbox; do not guess URLs from user input. Include copyable provider IDs as a fallback. Never expose API keys, client secrets, full card data or raw bank details.

First release is read-only. Refunds, webhook retries and payment repair are separately permissioned commands with idempotency and finance review. Do not offer arbitrary event replay or status edits.

### Grouped activity

Provide platform, business and business-local client timelines. Group by day and by operation: one booking/payment/message operation expands to its command, related records, ledger movements, provider events and delivery outcome. Filters: actor, business/client, concept, outcome, time interval, local/provider ID and source.

Normalize each item as source/id, occurred_at, observed_at, actor type/id, business_id, client_id when known, operation/correlation ID when known, action, status, related references and redacted summary. Preserve original source timestamps. Use a stable `(occurred_at, source, id)` cursor and keyset pagination.

Do not treat matching timestamps as proof that records belong to one operation. Label inferred associations; leave missing correlations visible. Initial views derive from existing audits/payments/messages/commands/webhook metadata. Instrument durable correlation only where necessary after approving schema changes. Because processed webhook bodies are cleared, old event detail may require provider retrieval and may no longer be available. The UI must say so.

### Operations and migrations

Show current app revision, database revision, known migration graph, last deployment/migration runs, backup/restore evidence and job status. Viewing the graph and pending migration names is the first milestone.

A later “Request migration” action submits a fixed, reviewed workflow/run request for an immutable commit and named environment. It requires operations permission, recent MFA, an audit reason, a recorded backup/restore prerequisite and environment-specific approval. The executor is the existing CI/migration Job with its scoped identity, not the API process. Record the exact target revision, workflow/run ID, operator and outcome; serialize per environment and stop on failure.

Never accept SQL, shell commands, arbitrary repository refs or database connection strings from the page. Production migrations should normally run as part of deployment; the manual action is for an explicit supported recovery procedure. No automatic downgrades or “undo migration” button. Destructive changes retain CLAUDE.md's concrete schema approval requirement even when an operator has console access.

### Access and audit

Suggested capabilities: `support.read`, `support.write`, `finance.read`, `finance.act`, `email.preview`, `email.test_send`, `operations.read`, `operations.execute`, `access.manage`. Bundle them into viewer, support, finance, operator and administrator presets, enforced on the server. Grant/revoke operations require a separate trusted administrator; prohibit self-grant.

Cross-tenant lists use explicit platform-only query entry points with allowlisted DTOs, field redaction, pagination and access logging. Tenant detail queries continue through `scoped()` once a business is selected. Platform data never enters PowerSync streams or shared browser caches. Log sensitive reads as well as writes without copying complete records or secrets into logs.

No account gets platform access because of an email domain or a tenant role. Bootstrap the first operator through a documented trusted deployment procedure, then manage grants explicitly. Test session expiry, revoked grants, insufficient MFA, CSRF/origin checks and direct API access independent of hidden buttons.

## Proposed technical shape

- `frontend/apps/admin`: Vite/React app with shared UI/tokens/config, its own shell and routes.
- Shared UI-agnostic admin hooks/DTO consumption in an `admin` domain in app-core where it is useful; browser-specific navigation and evidence panels remain in the app.
- FastAPI `/admin/v1` routes, concept files such as `admin_users.py`, `admin_payments.py`, `admin_emails.py`, `admin_activity.py` and `admin_operations.py` across api/services/schemas. Add a separate platform authorization dependency. Preserve the layer-first rule and keep queries out of routers.
- Extend existing OpenAPI generation for the admin endpoints; never publish secrets through mirrored models. Read APIs are online and return paginated, minimal DTOs.
- Add `admin.<base-domain>` to deployment URL derivation, DNS/certificates, the web image/runtime routing and explicitly permitted auth/CORS origins. Confirm cookie/auth behavior with a browser test on separate app/admin origins. Do not widen CORS to all subdomains.
- Backend API roles keep current least-privilege grants. Operations execution is out-of-process through CI; it does not get database-owner privileges inside the web API.

## Schema proposals requiring individual approval

These are candidate changes, not migrations to create now. Final exact DDL, indexes, constraints, retention and rollback must be presented before implementation.

| Candidate                  | Purpose and proposed fields                                                                                                                                                    | Existing-data impact                                                                                    | Rollback consideration                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `platform_grants`          | ID, user FK, capability, granted_by, created_at, revoked_at; uniqueness for an active user/capability grant                                                                    | Additive; no automatic grants to existing users                                                         | Disable console access first; preserve grant history before dropping anything |
| `platform_events`          | ID, actor user FK, action, target type/ID, business/client references when applicable, outcome, reason, correlation ID, redacted metadata, created_at; append-only enforcement | Additive; no historical completeness claim or raw-PII backfill                                          | Retain/export audit history; never silently discard it on rollback            |
| `admin_runs`               | ID, requester, environment, kind, immutable target revision/template key, idempotency key, provider/workflow run ID, status and timestamps, redacted result                    | Additive; supports email and operations outcomes; decide whether separate tables are clearer before DDL | Stop new requests and reconcile in-flight sends/runs before rollback          |
| Correlation fields/indexes | Only specific missing associations shown necessary by activity/payment investigation                                                                                           | Optional incremental changes; existing rows remain unknown                                              | UI tolerates missing historical correlation; preserve old data                |

Prefer deriving read models from existing tables first. Avoid a generic editable database browser, duplicated balances, a second notification system or a universal event-store rewrite.

## Delivery sequence and acceptance

| Phase | Deliverable                                                                     | Acceptance evidence                                                                                                                                                      |
| ----- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A0    | Finish email CID PR and CLI demo selection/test send                            | MIME/Resend-payload tests, packaged assets, browser render, actual recipient delivery and CI; distinguish provider acceptance from inbox rendering                       |
| A1    | Approve scope, operator identity, permissions, hosting and exact initial schema | Written decisions, reviewed DDL/data-impact/rollback; no schema work before approval                                                                                     |
| A2    | Admin shell, login/MFA gate, grant checks and read-only business/people views   | Non-operators denied through API and UI; revoked grants take effect; pagination and PII redaction tested; distinct environment shell verified                            |
| A3    | Email registry, sandboxed previews, test send and delivery history              | Same builder bytes as production; no real customer records/tokens touched; recipient/rate/idempotency checks; Gmail/Outlook/Apple Mail manual evidence                   |
| A4    | Payment detail graph and provider links                                         | Fixtures cover success, failed deposit, partial refund and dispute; exact ledger totals; correct sandbox/account link; provider failures leave local evidence visible    |
| A5    | Business/client activity timelines                                              | Correct scoped results, stable cursors, grouping/correlation evidence, unknown-history states and bounded query counts                                                   |
| A6    | Named support mutations                                                         | Each action clears happy/4xx/security/idempotency tests, logs reason and before/after fields, forbids arbitrary data edits                                               |
| A7    | Operations visibility and controlled execution                                  | Read-only revision/status first; then a staging-only workflow request with concurrency, approval, failure/retry and audit tests; production added after a reviewed drill |
| A8    | Final access, privacy, performance and usability review                         | Full repo gate, admin browser suite, revoked-role/session tests, representative incident walkthroughs and operator runbook                                               |

The first useful release is A2 + A3: find a business/person and test the emails. A4/A5 follow before enabling support writes. Migration execution is the final operational slice, after its read-only page and a staging drill.

## Open decisions

1. Which named users are initial platform operators, and which second factor is mandatory?
2. Which verified addresses may receive production test emails, and which inbox clients will be checked?
3. Which first three support edits are actually needed? Recommend profile correction, membership investigation and session revocation; confirm exact write semantics before implementing.
4. Should uploaded logos also be embedded, or is their current media URL acceptable?
5. What retention/access policy applies to destination addresses, platform audit metadata and incident evidence?
6. Is manual migration execution needed in the first operational release, or is viewing/launching the existing deployment workflow sufficient?

## Merge and coordination

Keep this plan out of the email implementation PR. Email is PR #15. Marketing-site changes are a separate delivery decision. Once those prerequisites land, merge updated main into deploy and verify the deployment PR's diff, resolving its old email asset generator/site URL assumptions against the final CID implementation. The live site currently has its own waitlist-email build path; verify its generator/renderer integration before updating it. Do not overwrite an active deployment worktree or silently assume its old email merge is still compatible.
