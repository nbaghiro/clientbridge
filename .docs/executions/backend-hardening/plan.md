# Backend implementation plan

**Status: execution started after the user's “go.”** This plan covers all **31 findings from the original backend review** and **12 additional principles findings**. It preserves the reproduced fixes already made. It contains 46 dependency-ordered tasks, concrete implementation contracts, acceptance criteria and a low-effort subagent handoff protocol. Implementation and isolated local verification are now authorized; progress is recorded in the task queue.

The first objective is to make isolation and recovery enforceable, then make every growing list complete and bounded across web, iOS, Android and Connect. The backend remains FastAPI/PostgreSQL with service-owned commands and PowerSync local reads. There is no proposed platform rewrite.

Evidence: [original review](../../reviews/backend/overview.md), [principles review](../../reviews/backend/principles.md), [original file inventory](../../reviews/backend/files.csv). The [task queue](tasks.json) is machine-readable and records each task's dependencies, source scope, covered findings and acceptance criteria.

## Execution rules

1. On “go,” start T00 with **one subagent at low reasoning effort**, inheriting the model. Use a fresh bounded context (`fork_turns="none"`) containing the task, relevant decisions, repository instructions, allowed files and verification commands. This is an execution preference, not an instruction to reduce validation.
2. The primary agent owns architectural contracts, migration ordering, review and integration. A low-effort worker implements one settled slice; it must return an unresolved invariant or contradictory evidence instead of inventing an accounting/security rule.
3. Default to one active worker. Directory-wide task scopes below must be split into one domain or one protocol step before dispatch. Split when a task requires more than roughly five production files, a new unsettled contract, or more than one independent migration. Shared model, migration, command, payment, sync and UI-contract files have one writer at a time.
4. Each task follows reproduce/specify → implement → focused verification → primary review → relevant gate. No task is done merely because code exists. Record evidence and remaining risk in the queue; follow dependency order. Existing passing audit regressions remain in the gate.
5. Preserve concurrent work. T00 snapshots the current dirty tree without committing it, uses a separate worktree/database, and records what is included. Do not overwrite the user's or another worker's edits, reseed the shared database, or reuse the original audit's passing result for newer code.
6. “Go” begins implementation and local verification. Commits, pushes and production deployment remain separate actions, consistent with `CLAUDE.md`. External credentials, provider selection or a domain-policy decision can hold the affected integration while unrelated tasks proceed.

## Delivery order and checkpoints

The JSON queue contains a validated topological execution order. The practical sequence is below; dependencies, not the numeric task IDs, control dispatch.

| Stage | Tasks | Required checkpoint |
|---|---|---|
| Establish evidence and contracts | T00–T04, T01 permission/invariant matrix | Identified combined baseline; existing failures separated; bounded inputs, auth semantics and deployment capabilities specified. |
| Enforce database isolation | T05–T10; then T12 and T11 | Restricted-role direct-SQL tests pass; all tenant tables classified/protected; public/onboarding/jobs/replication continue to work; selected business is explicit. |
| Make money recoverable | T20, T43, T21–T24, T32, T25–T27 | Stable attempts, durable event receipt and immutable sale facts; concurrency/crash tests prove no duplicate charge/refund or hidden settlement loss. |
| Make delivery recoverable | T28–T31 | Complete recipient traversal, per-delivery state, authenticated tenant routing and consistent suppression; outage/restart tests pass. |
| Make reads complete and bounded | T13–T19 | Every growing list has continuation; totals/detail reads remain complete; both SQLite drivers and web/native loading states are verified. |
| Close domain lifecycle gaps | T33–T38, T39–T42 | Stale edits, merges, documents/files, benefits, tax/currency and transfer matching follow the explicit policies below. |
| Prove operation and release | T44–T45 | Audit/retention, full client compatibility, migration/restore and failure drills have retained evidence; no untracked launch-critical finding. |

Security and money checkpoints are release gates. Pagination is not a substitute for tenant isolation; RLS is not a substitute for financial recovery. Work can be reordered within the dependency graph if the user prioritizes visible loading behavior, without weakening these gates.

## Database isolation contract

### Roles and ownership

Use distinct credentials and grants for these purposes. Role names are proposed names to encode in deployment/local bootstrap scripts, not new credentials to hard-code in source.

| Role | Privileges and responsibility |
|---|---|
| `cb_owner` and migrator | Non-login object owner plus a separately controlled migration identity. Own schema changes; unavailable to API/public worker request paths. |
| `cb_api` | Authenticated tenant queries/writes only; no ownership, superuser, BYPASSRLS, replication, DDL, TRUNCATE or ability to assume elevated roles. |
| `cb_identity` and narrow bootstrap functions | Authentication records and specifically allowed membership/onboarding resolution before a tenant is selected. No general tenant-table bypass exposed to services. |
| `cb_public` | Purpose-bound slug/capability resolution and explicitly allowed public reads/actions. Public capability context contains tenant, resource and purpose, not merely a business ID. |
| Dispatcher and `cb_worker` | Dispatcher can discover due work identifiers through narrow entry points. Each worker processes one validated tenant unit in its own session/transaction. A missing context never means all tenants. |
| `cb_sync` | Dedicated replication identity with only required source/publication access. Any replication-specific RLS bypass is isolated from runtime API credentials. |
| Sync storage and backup identities | Separate storage database grants; controlled backup/restore access that can read the complete required data without silently filtering it. |

RLS must include both row visibility and inserted/updated row checks, use `FORCE ROW LEVEL SECURITY` where appropriate, and reject missing context. Keep all existing `scoped()` helpers and service role checks. PostgreSQL explicitly exempts superusers/BYPASSRLS and normally owners; simply adding a policy under today's development superuser would not test the protection. [PostgreSQL row security](https://www.postgresql.org/docs/16/ddl-rowsecurity.html).

The tenant policy protects against forgotten scope in trusted code. The backend still controls the context, so it does not promise isolation from arbitrary SQL execution after compromise of its runtime credentials. Global identity/routing tables get their own limited grants or policies, not a fabricated business ID.

### Context and transaction lifecycle

Resolve authenticated identity and selected membership first, then construct an immutable tenant session context. Public resolution verifies an unguessable credential and purpose before returning a tenant/resource context; provider routing authenticates the event/account before selecting a tenant. A slug authorizes only published fields and specific public workflows.

Apply validated actor/tenant context with transaction-local settings on **every** transaction begin. Services currently commit internally and may query again, so a single dependency-level setting is insufficient. Revalidate membership/capability at the defined transaction entry point; never copy an unverified header into the database context. Use a new session when switching tenants to avoid SQLAlchemy identity-map reuse. Explicitly roll back/close on cancellation. PostgreSQL distinguishes transaction-local and session-wide `set_config`; use the former and verify actual commit/rollback behavior. [Configuration functions](https://www.postgresql.org/docs/16/functions-admin.html#FUNCTIONS-ADMIN-SET).

Test missing context; tenant A then tenant B on the same pooled connection; exceptions and cancellation; reads after commit; savepoints; concurrent requests; role removal; public tokens; onboarding; sync uploads; and worker transitions. Test through the restricted login itself, not only `SET ROLE` beneath a broadly privileged application connection.

Any security-definer resolver must have a fixed trusted search path, a non-login controlled owner, revoked default PUBLIC execution, a narrow return shape, parameterized SQL and explicit grants. Avoid permissive `USING(true)` fallbacks or a request-supplied bypass flag. Resolve public child access through the capability/resource matrix, not an OR policy that accidentally grants tenant-wide visibility.

### Relationships and rollout

Add `(business_id, id)` candidate keys and composite FKs for concrete tenant relationships; use client/parent-inclusive keys or explicit validated invariants where same-tenant ownership is still insufficient. Keep global user references global. Nullable references need deliberate null semantics; polymorphic references require a complete parent registry and validation rather than pretending one FK can represent every type. Tenant IDs are immutable after creation.

Before each constraint: report invalid rows, repair only with defensible provenance, add/validate using a staged migration, and check query/index cost. Do not silently delete or move historical records to make validation pass. Serialize migration authorship and keep the existing linear revision chain.

Enable RLS in two waves, core domains then financial/engagement domains, after context/bootstrap compatibility exists. Test ledger triggers and balance validation under the new roles. Inventory checks must fail when a new tenant table lacks a policy, a FK lacks a deliberate scope decision, or a new role gains bypass accidentally.

Replication remains a separate trust boundary. PowerSync uses dedicated source replication plus its own membership/field rules; HTTP RLS does not automatically protect the local replica. Verify source replication setup and actual row removal after role changes. [PostgreSQL replication security](https://www.postgresql.org/docs/16/logical-replication-security.html), [PowerSync RLS and download filtering](https://docs.powersync.com/integrations/supabase/rls-and-sync-streams).

## Pagination and infinite loading contract

### Shared behavior

Use a page size of **50** by default, **200** maximum for HTTP pages, a versioned opaque cursor and a unique ID at the end of every ordering. Every query identity includes tenant, filter, normalized search, sort, direction and schema/version. Reset its pages when that identity changes; ignore stale responses and prevent duplicate simultaneous load-more calls.

The shared view-model exposes rows, initial/loading-more/error states, continuation, retry, and refresh. Web and native use the same query/state logic: web gets a sentinel plus accessible manual load-more and bounded rendering; native uses `FlatList.onEndReached` plus an accessible footer. Page-load failure preserves existing rows. Focus, selection, back navigation and conversation scroll anchors survive appends. Selection by ID must not depend on whether its list page is loaded.

Cursor traversal is guaranteed complete and duplicate-free for a stable dataset. Concurrent writes are not falsely advertised as a database snapshot: immutable histories use a high-water boundary; mutable sort/filter changes invalidate and rebase the loaded window while preserving an identifiable row anchor. Deduplicate by ID. Reverse traversal reloads evicted pages rather than permanently losing earlier results.

Use a bounded local page cache, initially **10 pages**, with bidirectional reload as the viewport moves. Do not implement pagination by loading all rows and slicing JavaScript arrays. Watch only the active local window; changes that affect its ordering trigger a window refresh. Verify renamed clients, inbox thread movement, deletions at a boundary and inserts with equal timestamps. Defer library replacement until the installed SDK capabilities are checked.

### Local reads and server reads

For PowerSync lists, put tenant/search/filter constraints and ordering in SQLite before limiting. Use local SQL keyset/window queries and indexes that match them. Immutable descending histories seek by `(created_at, id)` or the appropriate frozen event key; named lists use an explicitly normalized sort key plus ID. Define null ordering. Watch queries update from local/synced table changes; they are not network page requests. [PowerSync watch queries](https://docs.powersync.com/client-sdks/watch-queries).

For actual HTTP collection endpoints, return `items`, `next_cursor` and `has_more`; exact counts are optional separate aggregates. Validate bounded cursor input and bind it to resource, tenant and filters, with a signature when it carries protected query state. A valid cursor never authorizes a request: recheck current access on every page. Allowlisted sort expressions and parameterized seeks are required.

Use SQL aggregates for totals, counts, balances and unread state. Never sum only the loaded page. Refactor invoice/sale details to query by ID before removing their unbounded parent-list dependency. Keep calendar navigation as bounded date windows, not an endless generic feed. Preserve intentional previews such as six public reviews and eight review suggestions, clearly linked to complete history where applicable.

### Replication and large work

Local query pagination improves query/render work; it does not reduce initial replication or local disk usage. First preserve full authorized replication and measure it. A later optional archive path must keep parent/reference closure, complete ledger-derived balances and visible offline availability. Do not simply date-filter ledger entries: current client financial calculations depend on them.

Use current Sync Rules for the initial changes. A Sync Streams migration is a separate compatibility-tested task, only if pinned server/SDK versions support the chosen on-demand design. Subscription filters narrow authorized data and never provide authorization themselves. PowerSync documents local pagination, dynamic subscriptions and API history as distinct [infinite scrolling strategies](https://docs.powersync.com/client-sdks/infinite-scrolling).

Jobs use claimed work batches, not interactive cursors. Proposed defaults are **100 claimed jobs per batch**, bounded recipient fanout and a per-tenant concurrency cap. Freeze a broadcast audience/work list so updates during processing do not skip or repeat recipients; recheck transport suppression before dispatch. Exports use a consistent documented data boundary, bounded database reads and a background artifact when too large for a synchronous response.

## Money and delivery contracts

The primary agent settles each transition table before implementation. Each external operation has a durable identity and request fingerprint **before** a network call, followed by a recorded outcome and idempotent finalization. An unknown provider outcome is reconciled, never interpreted as permission to create a new payment. Do not keep a transaction/row lock open while waiting on a provider when a durable reservation/attempt can express the invariant.

Command claims bind business, operation, resource, actor/capability scope, idempotency key and normalized payload. Replay reauthorizes access before returning the stored result, but occurs before state checks that would reject an already successful retry. A mismatched payload returns conflict. Financial dedupe identities outlive disposable response caches.

Verified webhooks are committed to an inbox before acknowledgment and processed with leases/retries. Dedupe includes provider/account/event identity. Processing validates stored amount, currency and account, tolerates ordering, and exposes unreconciled outcomes. Notifications use a transactional outbox and per-recipient delivery rows; neither system promises exactly-once provider delivery when that provider supplies no such guarantee. Ambiguous acceptance requires provider reconciliation or a visible operational outcome.

Refunds separate requested/pending cash return from confirmed reversal. Pending refunds reserve refundable capacity, but do not automatically declare the order refunded or reverse settled cash, stock and entitlements. On confirmed success, apply each defined reversal once; on failure/cancellation release the reservation. Later contradictory provider facts require explicit compensating journals, never mutation of append-only history. Fulfillment cancellation, return of goods and cash return remain distinct states.

Persist currency, discounts, taxable basis, jurisdiction, effective tax components and product/plan terms at the commitment point. Settlement, receipts and reports consume those facts. Existing incomplete history gets a reconciliation classification; it is not rewritten using current rates or catalog values. Class moves, deposit expiry and stock holds must share these attempt/state contracts.

## Defaults and domain decisions

These are recommended implementation defaults. A general “go” permits starting the queue without another planning discussion. The primary agent should confirm a decision from existing behavior and tests before an affected irreversible migration; contradictory financial data or an unspecified provider holds only that task's irreversible portion.

| Area | Recommended default and boundary |
|---|---|
| Currency | CAD-only for newly enabled flows until all paths support currency dimensions. Preserve/read existing non-CAD records and report separately; never auto-convert money. T40 must inventory affected data before enforcement. |
| Refund accounting | Pending cash return is not settled cash reversal. Preserve immutable journals; reserve remaining refundable amount. Credit-note timing, returned-goods restocking and entitlement restoration need explicit transition fixtures before T24 finalizes them. |
| Tax and benefits | Snapshot facts at sale commitment. Validate nil/credit filings, gift tender tax timing, package usage, breakage and filing rules against the intended bookkeeping scope before changing historical treatment. Implement fixtures and forward schemas while policy review proceeds. |
| SMS ownership | One authenticated inbound destination mapping per business/account; never choose a tenant by the sender's phone alone. Provisioning actual numbers/credentials remains external configuration. No-op delivery cannot count as success when the feature is enabled. |
| Interac | Keep the unfinished provider capability disabled and visible as unavailable until an authenticated provider contract exists. Implement matching/recovery against recorded fixtures; no fabricated bank integration. |
| Business closure | Deny new bookings, purchases and ordinary mutations; retain authorized owner history/export and explicitly permitted existing-document reads. Specify debt collection/cancel/refund exceptions in the capability matrix rather than implicitly denying or allowing every public action. |
| Public links | New secrets are hashed and purpose-bound; rotate/revoke action capabilities. Receipt/legal-document retention differs from booking-action expiry. Preserve supported existing links during additive migration. |
| Data retention | No automatic purge of ledger or signed evidence. Expire short-lived authentication/challenge material; define raw payload/PII retention and financial idempotency tombstones separately. Retention jobs start in dry-run until the matrix is settled. |
| Input and deadline budgets | Start with 2 MiB JSON bodies, 200 sync operations per transaction, 366-day synchronous report windows, 5-second ordinary SQL statements and 2-second lock waits. Treat these as proposed tunable limits; verify existing fixtures and representative workloads before enforcing. Long exports/migrations get separate workers/roles and budgets. |
| Performance evidence | Benchmark 10,000 clients, 50,000 bookings, 100,000 messages and 100,000 financial rows per synthetic large tenant, plus a small control tenant. Proposed targets: warm local 50-row query p95 under 100 ms and non-provider HTTP reads p95 under 300 ms on a recorded reference environment. Report hardware, cold sync and failures; do not claim these targets are already measured or guaranteed production SLOs. |

## Migration and verification requirements

Every schema/API change follows **expand → compatible dual handling → evidence-based backfill → validate → switch → contract**. Add nullable fields or new tables first; keep old mobile payloads readable during the supported window; regenerate API/sync artifacts; feature-gate new behavior until both client and worker paths are ready. Required revision headers, mandatory new payloads and dropped sync columns cannot precede a compatible mobile release.

Rollback means disable a new feature or restore the compatible application while keeping additive data. It does not mean downgrade a financial schema after it holds new money states. Prefer a forward correction; restore only with a verified reconciliation plan. RLS rollback must never silently switch public traffic back to a superuser. Use maintenance/fail-closed behavior when isolation cannot be preserved.

Each worker runs focused tests for its behavioral change. The primary agent then runs the relevant repository targets, regenerating first when needed: `make lint-backend`, `make test-backend`, `make test-contract`, `make gen-api`, `make gen-sync-schema`, `make codegen-check`, `make lint-frontend`, `make test-frontend`, `make build`, `make test-web`, `make test-connect`, `make test-mobile`, and the final `make check`. Use the identified isolated database and frozen dependency install. Do not reuse another task's coverage result as evidence for new code.

Add dedicated gates for restricted database roles, real-commit concurrency, pool reuse, RLS/grant/trigger presence, genuine PowerSync role revocation, deep list traversal, old-client contracts, provider failure/reordering and restart recovery. Keep live provider test-mode checks separate from ordinary fakes; contract mocks alone do not prove settlement. Store migration, query-plan, load, restore and client evidence with the task result.

The final release rehearsal restores both database and objects, reconciles ledger totals and pending external attempts, resumes PowerSync from a valid checkpoint or rebuilds it safely after restore, and demonstrates queued jobs catching up. Preserve pending offline uploads before any client replica reset; reconcile provider outcomes before replaying restored work. Production RPO/RTO and alert ownership must be recorded against the chosen infrastructure; local Compose is not proof of a production deployment.

## Low effort worker handoff

Use this template only after “go,” with a concrete task slice filled in:

```text
Task: <Txx and bounded slice>
Workspace: <isolated verified working directory>
Read: CLAUDE.md, applicable local instructions, the named plan contract and referenced files.
Goal: <one observable outcome from the task>
Allowed edits: <explicit files; one domain/protocol step; migration slot if assigned>
Dependencies: <completed IDs and evidence>
Implement: <settled steps from the queue, including input/output/state contracts>
Required cases: <happy, each relevant 4xx, tenant/role invariants, concurrency/replay/edge>
Verify: <focused commands with isolated DB environment; no shared reseed or live customers>
Do not commit, push, deploy, weaken tests, change policy, or modify other workers' files.
If the contract is inconsistent or requires a missing domain decision, report the exact conflict.
Return: changed paths, behavior, test results, migration/client compatibility, remaining risks.
```

T00 is the first dispatch. Its deliverable is the current snapshot and baseline evidence, not a fresh implementation of every finding. The next worker receives only the approved dependent slice. The primary agent checks the diff and acceptance evidence before updating task status or dispatching the next slice.


## Implementation tasks

The task IDs below are the execution and evidence keys. Current statuses are recorded in `tasks.json`. Each scope is relative to the repository root; directory scopes are inventories to split by domain, not permission for a single broad rewrite. The [machine-readable queue](tasks.json) contains dependencies, exact source scopes, coverage and acceptance criteria. Its `proposed_new_paths` field identifies files to create; other scopes point to existing source or source directories.

### T00 Freeze the execution baseline

**Depends on:** user go. **Covers:** B30, N11, N12.

**Source scope:** `CLAUDE.md`; `.docs/reviews/backend/overview.md`; `Makefile`; `backend/tests/conftest.py`; `.github/workflows/ci.yml`.

Record current HEAD and dirty-file hashes; preserve concurrent changes; create an isolated snapshot with a dedicated database; refresh endpoint/table/query inventories and re-evaluate findings against current feature work.

**Acceptance:** Reproduce the baseline gate without touching the shared database; record failures separately from new changes; retain the original audit regressions. No implementation ticket starts on an unidentified snapshot.

### T01 Define permission and invariant matrices

**Depends on:** T00. **Covers:** B10, B17, N01, N02, N10.

**Source scope:** `backend/src/clientbridge/models`; `backend/src/clientbridge/core/deps.py`; `backend/src/clientbridge/api`; `infra/powersync/sync-rules.yaml`; `.docs/architecture.md`.

Classify every table as tenant, identity, routing or operational; map each route/job to actor, tenant source, role, parent ownership and state; list all concrete and polymorphic relationships and public capability purposes.

**Acceptance:** Every registered model/router/job is assigned a policy and owner; unknown additions fail the inventory check; closed-business and public-token exceptions are explicit.

### T02 Enforce runtime capabilities and work limits

**Depends on:** T00. **Covers:** B07, N06, N08.

**Source scope:** `backend/src/clientbridge/core/config.py`; `backend/src/clientbridge/core/db.py`; `backend/src/clientbridge/main.py`; `backend/src/clientbridge/schemas`; `backend/src/clientbridge/sync/upload.py`; `.env.example`.

Validate production secrets, persistent signing keys and enabled adapters; add explicit database/provider/request budgets; inventory and bound strings, collections, JSON, numeric ranges and sync operations using the plan defaults; preserve existing valid payloads.

**Acceptance:** Production cannot start with a bypassing database identity or enabled no-op channel; oversized inputs return structured 413/422; dependency timeout and connection exhaustion fail within budget without leaking transactions.

### T03 Consume authentication tokens atomically

**Depends on:** T00. **Covers:** B08.

**Source scope:** `backend/src/clientbridge/services/auth.py`; `backend/src/clientbridge/services/staff.py`; `backend/tests/test_auth*`; `backend/tests/test_staff*`.

Use locks or conditional consumption for refresh/reset/verify/invite acceptance; preserve committed reuse-family revocation; revoke sessions during shared client sign-out in a separate frontend slice.

**Acceptance:** Two independent connections cannot consume the same one-use token twice; parallel refresh has a defined result; reuse revocation persists after an error; logout revokes server session and clears local data.

### T04 Normalize identity and distribute abuse limits

**Depends on:** T03. **Covers:** B09, N06.

**Source scope:** `backend/src/clientbridge/services/auth.py`; `backend/src/clientbridge/core/ratelimit.py`; `backend/src/clientbridge/models/auth.py`; `backend/src/clientbridge/models/business.py`; `backend/src/clientbridge/schemas/auth.py`.

Add bounded canonical identity fields with a collision report before uniqueness; bind OAuth subject explicitly; use Redis limits with expiry and trusted-proxy parsing; preserve current outward anti-enumeration behavior.

**Acceptance:** Case variants cannot create ambiguous login identities; collisions are reported rather than merged automatically; two API instances share limits; forged forwarded headers cannot bypass limits; buckets expire.

### T05 Provision restricted database roles

**Depends on:** T01, T02. **Covers:** B07, N01, N09.

**Source scope:** `infra/postgres/roles.sql`; `docker-compose.yml`; `Makefile`; `backend/src/clientbridge/core/config.py`; `backend/tests/conftest.py`.

Add owner/migrator, API, identity/bootstrap, public, dispatcher/worker, replication and storage role setup; restrict schema creation, truncation and role inheritance; separate runtime and migration DSNs; run application tests with runtime grants.

**Acceptance:** Runtime is neither owner, superuser, BYPASSRLS nor replication; it cannot SET ROLE to an elevated identity, create schema objects or TRUNCATE; migration/replication continue with their own credentials.

### T06 Bind tenant context to every transaction

**Depends on:** T05. **Covers:** N01, N08.

**Source scope:** `backend/src/clientbridge/core/tenancy.py`; `backend/src/clientbridge/core/db.py`; `backend/src/clientbridge/core/deps.py`; `backend/tests/test_scoping.py`.

Introduce validated immutable session context; apply transaction-local tenant/actor settings on every transaction begin, including after internal commits; separate identity lookup and tenant sessions; prohibit tenant switching on a populated session.

**Acceptance:** Missing context denies tenant access; commit, rollback, cancellation and pooled A-to-B reuse do not leak settings or identity-map objects; forged business headers fail before context binding.

### T07 Constrain public and background tenant resolution

**Depends on:** T06, T01. **Covers:** B10, N01, N10.

**Source scope:** `backend/src/clientbridge/core/tenancy.py`; `backend/src/clientbridge/services/public.py`; `backend/src/clientbridge/services/public_orders.py`; `backend/src/clientbridge/services/returning.py`; `backend/src/clientbridge/api/webhooks.py`; `backend/src/clientbridge/tasks/worker.py`; `backend/migrations/versions`.

Add purpose-specific bootstrap functions/roles for membership, onboarding, public slugs/tokens and authenticated provider routes; create a fresh tenant context for each worker unit; hash new capability secrets and add revocation/lifecycle/cache policies via additive fields.

**Acceptance:** A public invoice token cannot resolve another resource or purpose; invalid/revoked tokens fail; no runtime endpoint obtains a bypass DSN; new business creation works; a worker failure cannot retain the previous tenant context; protected responses use private cache policy.

### T08 Enable RLS for core tenant domains

**Depends on:** T07, T10. **Covers:** B10, N01, N11.

**Source scope:** `backend/src/clientbridge/models/business.py`; `backend/src/clientbridge/models/clients.py`; `backend/src/clientbridge/models/catalog.py`; `backend/src/clientbridge/models/scheduling.py`; `backend/migrations/versions`; `backend/tests/test_scoping.py`.

Install explicit USING and WITH CHECK policies for business, staff, client, catalog and scheduling tables; use FORCE RLS and the role/context matrix; keep role checks in services; forbid business_id mutation.

**Acceptance:** Raw SELECT/INSERT/UPDATE/DELETE/UPSERT under runtime roles cannot cross tenants without scoped(); no-context access fails; owner/migration paths are tested separately; public and onboarding paths still pass.

### T09 Enable RLS for financial and engagement domains

**Depends on:** T08. **Covers:** B10, N01, N11.

**Source scope:** `backend/src/clientbridge/models/billing.py`; `backend/src/clientbridge/models/payments.py`; `backend/src/clientbridge/models/ledger.py`; `backend/src/clientbridge/models/messaging.py`; `backend/src/clientbridge/models/documents.py`; `backend/src/clientbridge/models/reviews.py`; `backend/src/clientbridge/models/platform.py`; `backend/migrations/versions`.

Extend tested policies in one domain per worker assignment; classify globally routed webhook and identity tables separately; validate ledger trigger behavior, audit insertion, jobs and public child traversal.

**Acceptance:** Every tenant table is protected; aggregate/join queries cannot leak other tenants; deferred ledger checks still reject unbalanced journals; role changes do not widen public access; migration checks inspect policies, grants and triggers as well as model metadata.

### T10 Enforce tenant and parent relationships

**Depends on:** T01, T05. **Covers:** B10, N02.

**Source scope:** `backend/src/clientbridge/models`; `backend/src/clientbridge/services/lines.py`; `backend/src/clientbridge/services/bookings.py`; `backend/src/clientbridge/services/files.py`; `backend/migrations/versions`; `backend/tests/test_integrity.py`.

Produce a violation report; add referenced tenant/ID unique keys and composite FKs in domain batches; add same-client booking/subject and billing checks; validate polymorphic references; make tenant IDs immutable.

**Acceptance:** Direct SQL with a valid foreign-tenant ID fails; same-tenant wrong-client links fail where required; nullable/global-user references remain valid; historical rows are audited before NOT VALID constraints are validated.

### T11 Align sync field and role policies

**Depends on:** T01, T12. **Covers:** B17, N04, N10, N11.

**Source scope:** `infra/powersync/sync-rules.yaml`; `backend/scripts/gen_sync_schema.py`; `frontend/packages/sync/src/schema.ts`; `backend/tests/test_sync*`; `frontend/apps/web/e2e`; `frontend/apps/mobile/e2e`.

Replace sensitive wildcard projections with reviewed columns; preserve read/write role parity; separate server-only secrets and bearer capabilities; test membership removal/downgrade with real PowerSync and local cleanup.

**Acceptance:** Each matrix role receives only allowed rows and fields; forged subscription/tenant parameters cannot authorize data; previously synced rows disappear after online revocation; new schema fields do not automatically become replicated secrets.

### T12 Make selected business explicit everywhere

**Depends on:** T01, T03. **Covers:** B15, N07.

**Source scope:** `frontend/packages/api-client/src/session.ts`; `frontend/packages/app-core/src/domain/business.ts`; `frontend/packages/app-core/src/domain/auth.ts`; `frontend/packages/app-core/src/domain`; `frontend/apps/web`; `frontend/apps/mobile`.

Persist validated selected business; send X-Business-Id on commands; scope every tenant-owned local query and cache key; replace business LIMIT 1 assumptions; add a shared chooser contract and web/native rendering.

**Acceptance:** A two-business user with different roles sees correct settings, lists, totals and actions after switching; queued edits retain their original tenant; removed membership cannot be selected; logout clears tenant-sensitive state.

### T13 Build shared bounded query and list contracts

**Depends on:** T12. **Covers:** N03, N04.

**Source scope:** `frontend/packages/app-core/src/hooks.ts`; `frontend/packages/app-core/src/pagination.ts`; `frontend/packages/app-core/src/ui.ts`; `frontend/packages/ui/src/web/ListPage.tsx`; `frontend/packages/ui/src/mobile/ListPage.tsx`; `frontend/packages/app-core/src/strings.ts`; `frontend/apps/playground/src/stories/ListPage.tsx`.

Implement query identity, keyset/window state, bounded page cache, cancellation/reset, hasMore/loadingMore/error and retry; add native end-reached and web sentinel/manual loading; keep row identity and focus/scroll anchors.

**Acceptance:** Stable data traverses 1001 rows with no duplicates or gaps; ties, deletion, changed sort keys, repeated load-more, filter/tenant reset and out-of-order results are covered; old rows survive next-page failure; keyboard/screen-reader/manual loading works.

### T14 Page directories catalog and global search

**Depends on:** T13. **Covers:** N03, N04.

**Source scope:** `frontend/packages/app-core/src/domain/clients.ts`; `frontend/packages/app-core/src/domain/catalog.ts`; `frontend/packages/app-core/src/domain/search.ts`; `frontend/packages/app-core/src/domain/pos.ts`; `backend/scripts/gen_sync_schema.py`.

Push filters/search into local SQL before limiting; normalized name plus ID ordering; scoped selectable-client/item lookup; per-kind global search continuation; independently computed counts; targeted SQLite indexes.

**Acceptance:** A matching row beyond the former first page and a booking beyond 300 are discoverable; exact selected IDs resolve outside loaded pages; accented names/ties and tenant switching behave correctly; web/native share query logic.

### T15 Page money and client histories

**Depends on:** T13. **Covers:** N03, N04.

**Source scope:** `frontend/packages/app-core/src/domain/billing.ts`; `frontend/packages/app-core/src/domain/pos.ts`; `frontend/packages/app-core/src/domain/earnings.ts`; `frontend/packages/app-core/src/domain/refunds.ts`; `frontend/packages/app-core/src/domain/payouts.ts`; `frontend/packages/app-core/src/domain/entitlements.ts`; `frontend/packages/app-core/src/domain/clients.ts`.

Migrate one domain per assignment; remove terminal refund/payout/charge/stock caps; stable date/ID ordering; detail-by-ID queries; aggregate balances and counts independently from pages.

**Acceptance:** All records beyond 24/50/60/200 remain reachable; financial totals are unchanged by page size; reopening a historical detail works before its list page loads; nullable date ordering and tied timestamps are deterministic.

### T16 Page messaging and engagement lists

**Depends on:** T13. **Covers:** N03, N04.

**Source scope:** `frontend/packages/app-core/src/domain/messaging.ts`; `frontend/packages/app-core/src/domain/reviews.ts`; `frontend/packages/app-core/src/domain/contracts.ts`; `frontend/packages/app-core/src/domain/forms.ts`; `frontend/packages/app-core/src/domain/broadcasts.ts`; `frontend/packages/app-core/src/domain/clients.ts`.

Page threads, older messages, reviews/requests, signatures, broadcasts, notes and libraries; retain explicitly labeled previews; keep unread/summary queries independent; add supporting local indexes.

**Acceptance:** Loading older messages preserves the visible anchor while new messages arrive; no duplicate messages; page eviction/reload works offline; unread totals and pinned-note ordering are correct across pages.

### T17 Bound HTTP collections and large exports

**Depends on:** T06, T02. **Covers:** N03, N06.

**Source scope:** `backend/src/clientbridge/core/pagination.py`; `backend/src/clientbridge/schemas/reports.py`; `backend/src/clientbridge/api/reports.py`; `backend/src/clientbridge/services/reports.py`; `backend/src/clientbridge/services/public.py`; `frontend/packages/app-core/src/domain/publicShop.ts`.

Add versioned scoped keyset cursors and Page DTOs for actual HTTP collections; split report aggregates from paged detail; stream small CSVs and persist large export jobs; extend public catalog reads without breaking existing clients.

**Acceptance:** Cursor tampering/filter mismatch cannot expand access; all rows traverse with stable ties; 1/200/201 limits validate; reports remain complete; exports are bounded in memory, cancelable and tenant-authorized at download.

### T18 Set replica and query budgets

**Depends on:** T11, T14, T15, T16, T17. **Covers:** N04, N08, N11.

**Source scope:** `infra/powersync/sync-rules.yaml`; `frontend/packages/sync`; `backend/scripts/gen_sync_schema.py`; `frontend/packages/app-core/src/domain`; `backend/scripts`.

Benchmark representative large tenants, inspect PostgreSQL and SQLite plans, separate local index declarations where needed, and record sync/query/render budgets; prototype optional archive subscriptions behind a disabled rollout flag.

**Acceptance:** Record cold/warm timings, replica bytes, initial sync and WAL lag; no existing detail/report/balance becomes incomplete; on-demand history retains parent rows and states its offline limits; pinned server/SDK versions support any new syntax.

### T19 Recover permanent sync failures and preserve errors

**Depends on:** T12, T20. **Covers:** B16, B31, N07.

**Source scope:** `backend/src/clientbridge/sync/upload.py`; `backend/src/clientbridge/core/errors.py`; `frontend/packages/sync`; `frontend/packages/api-client/src/index.ts`; `frontend/packages/api-client/src/session.ts`; `frontend/packages/app-core/src/domain/sync.ts`.

Version and validate hours payloads; normalize typed errors; separate retryable transport/5xx/429 from permanent rejection; persist rejected transaction details locally for repair/discard; keep batch atomicity and tenant identity.

**Acceptance:** A rejected old hours change no longer blocks a later valid transaction after explicit reconciliation; no silent dropped edit; malformed fields return 422 rather than 500; original idempotency key survives retries; web/native show useful error text.

### T20 Claim commands atomically and bind replays

**Depends on:** T06, T01. **Covers:** B02, N07, N08.

**Source scope:** `backend/src/clientbridge/core/command.py`; `backend/src/clientbridge/models/platform.py`; `backend/migrations/versions`; `backend/tests/test_command.py`.

Persist operation/resource/actor scope, normalized request fingerprint, status and response; serialize claim; replay before mutable-state preconditions while reauthorizing access; reject conflicting payload reuse; retain durable tombstones for financial identities.

**Acceptance:** Parallel identical commands execute one logical action; conflicting payload is 409; another actor/resource cannot steal a replay; crash rollback does not create a new external operation identity; business state and audit commit together.

### T21 Persist external operation attempts

**Depends on:** T20, T43. **Covers:** B02, N08.

**Source scope:** `backend/src/clientbridge/models/payments.py`; `backend/src/clientbridge/services/payments.py`; `backend/src/clientbridge/integrations/stripe.py`; `backend/migrations/versions`.

Create attempt rows and stable provider keys before sending; separate request, provider response and finalization transactions; record unknown outcomes; implement reconciliation with canonical provider lookup; avoid long database locks during network calls.

**Acceptance:** Provider success followed by timeout, process death or DB failure produces one charge after recovery; unknown status never becomes a new charge automatically; concurrent effects serialize at the resource; leases recover abandoned work.

### T22 Make verified webhooks a durable inbox

**Depends on:** T07, T21. **Covers:** B06.

**Source scope:** `backend/src/clientbridge/api/webhooks.py`; `backend/src/clientbridge/models/platform.py`; `backend/src/clientbridge/services/payments.py`; `backend/src/clientbridge/tasks/worker.py`; `backend/migrations/versions`.

Commit verified provider/account/event identity before processing; claim events with retry/dead-letter state; validate amount/currency/account; distinguish real duplicates from processing IntegrityError; reconcile fees and out-of-order subscription events.

**Acceptance:** Receipt survives processor crash; duplicate/out-of-order/unknown-object events converge; wrong monetary identity cannot settle; absent fee data remains reconcilable; a failing event cannot starve other tenants.

### T23 Snapshot sale and tax facts

**Depends on:** T10, T20. **Covers:** B05, B24, B25.

**Source scope:** `backend/src/clientbridge/models/billing.py`; `backend/src/clientbridge/models/catalog.py`; `backend/src/clientbridge/services/lines.py`; `backend/src/clientbridge/services/tax.py`; `backend/src/clientbridge/services/ledger.py`; `backend/src/clientbridge/services/public.py`; `backend/migrations/versions`.

Persist sale currency, taxable basis, component rates/amounts, jurisdiction and price/benefit version at commitment; render and settle from immutable snapshots; version provider prices; backfill only from reliable historical evidence.

**Acceptance:** Changing catalog/province/registration before webhook cannot change an issued total, receipt or journal; sum of components reconciles; unknown legacy snapshots are flagged rather than recalculated as if historically correct.

### T24 Implement the refund lifecycle

**Depends on:** T21, T22, T23. **Covers:** B01.

**Source scope:** `backend/src/clientbridge/services/payments.py`; `backend/src/clientbridge/services/ledger.py`; `backend/src/clientbridge/services/inventory.py`; `backend/src/clientbridge/services/public_orders.py`; `backend/src/clientbridge/schemas/payments.py`; `frontend/packages/app-core/src/domain/refunds.ts`.

Represent requested/pending/succeeded/failed/canceled and unknown outcomes; reserve refundable room; separate cancellation/credit decisions from cash settlement; finalize reversals only at the defined terminal transition; reconcile existing incorrect rows with corrective journals.

**Acceptance:** Pending-success, pending-failure, success-failure, partial/parallel refunds, duplicate events and public cancellation are tested; no over-refund or premature stock/entitlement reversal; clients display processing instead of refunded when appropriate.

### T25 Coordinate booking deposits and late settlement

**Depends on:** T24, T32. **Covers:** B12.

**Source scope:** `backend/src/clientbridge/services/bookings.py`; `backend/src/clientbridge/services/payments.py`; `backend/src/clientbridge/services/public.py`; `backend/src/clientbridge/tasks/worker.py`.

Persist a serialized deposit attempt; cancel/reconcile the provider on cancellation or expiry; distinguish booking cancellation from payment status; define late-success remediation and failed-attempt retry.

**Acceptance:** Collect-collect and cancel-settle races cannot double-charge or resurrect a canceled booking; failed attempts leave the reaper/repair path reachable; late success creates visible reconciliation/refund work.

### T26 Enforce saved-method and subscription lifecycles

**Depends on:** T21, T22, T23. **Covers:** B05, B18.

**Source scope:** `backend/src/clientbridge/services/payments.py`; `backend/src/clientbridge/services/entitlements.py`; `backend/src/clientbridge/models/payments.py`; `backend/src/clientbridge/models/catalog.py`; `backend/src/clientbridge/integrations/stripe.py`.

Centralize chargeability and mandate checks; consume method/setup/mandate events; retire historical methods instead of unsafe deletion; require replacement for subscriptions; bind recurring invoices to provider and immutable price versions.

**Acceptance:** Inactive/expired/revoked/pending mandate cannot be charged; detach-in-use leaves provider/local state consistent; out-of-order events converge; changed item price does not silently diverge from recurring billing.

### T27 Reserve online inventory

**Depends on:** T21, T22. **Covers:** B19.

**Source scope:** `backend/src/clientbridge/models/catalog.py`; `backend/src/clientbridge/services/inventory.py`; `backend/src/clientbridge/services/public.py`; `backend/src/clientbridge/services/payments.py`; `backend/migrations/versions`.

Add atomic stock reservations per attempt with expiry; consume on settlement and release on cancel/failure; reconcile late success; include variants/add-ons; preserve documented POS oversell policy.

**Acceptance:** Two online buyers cannot reserve the last unit; duplicate settlement consumes once; expiry/cancel/late webhook is resolved explicitly; partial and full refund stock rules remain distinct from cash refund status.

### T28 Record and process an outbox

**Depends on:** T06, T20. **Covers:** B03.

**Source scope:** `backend/src/clientbridge/models/platform.py`; `backend/src/clientbridge/services/notifications.py`; `backend/src/clientbridge/services/messaging.py`; `backend/src/clientbridge/tasks/worker.py`; `backend/migrations/versions`.

Write versioned notification events with the business transaction; claim per-recipient/channel deliveries with attempts, provider IDs, leases and retry/dead-letter state; migrate callers in bounded domain slices.

**Acceptance:** Business rollback emits nothing; crash after commit retains work; worker restart resumes; permanent failure is visible; retry does not create duplicate logical deliveries; ambiguous provider acceptance is reconciled rather than blindly resent.

### T29 Complete SMS routing and suppression

**Depends on:** T04, T07, T28. **Covers:** B04, B20.

**Source scope:** `backend/pyproject.toml`; `backend/uv.lock`; `backend/src/clientbridge/integrations/twilio.py`; `backend/src/clientbridge/api/webhooks.py`; `backend/src/clientbridge/services/messaging.py`; `backend/src/clientbridge/services/consents.py`; `backend/src/clientbridge/models/messaging.py`.

Model business-owned destination/account routing; use a real async-compatible provider adapter and signature validation of original URL/body; separate transport suppression from marketing consent; centralize all SMS eligibility checks.

**Acceptance:** Same phone in two tenants routes by authenticated destination; tampered signatures fail; STOP survives preference edits and class fanout; START follows policy; returning-client codes have a defined permitted/suppressed path; no event-loop blocking send.

### T30 Make scheduled work complete and fair

**Depends on:** T07, T28. **Covers:** B27, N06, N08.

**Source scope:** `backend/src/clientbridge/services/messaging.py`; `backend/src/clientbridge/services/bookings.py`; `backend/src/clientbridge/services/forms.py`; `backend/src/clientbridge/services/reviews.py`; `backend/src/clientbridge/services/orders.py`; `backend/src/clientbridge/tasks/worker.py`.

Replace broadcast truncation with frozen recipient work rows; add batch claims/checkpoints, per-tenant fairness and catch-up; isolate poison records; mark delivery progress from durable outbox state rather than swallowed errors.

**Acceptance:** At least 1201 recipients are processed exactly once logically across restarts; two workers do not double-claim; long outage catches up; one bad record does not fail the batch; cancellation stops unclaimed sends while preserving history.

### T31 Reconcile push tickets and receipts

**Depends on:** T28. **Covers:** B28.

**Source scope:** `backend/src/clientbridge/integrations/expo.py`; `backend/src/clientbridge/services/notifications.py`; `backend/src/clientbridge/models/platform.py`; `backend/src/clientbridge/tasks/worker.py`.

Chunk to provider limits, map each token to ticket/receipt, retry individual transient failures and retire invalid tokens; retain active membership checks before delivery.

**Acceptance:** An HTTP-200 mixed batch records partial errors correctly; accepted tokens are not resent merely because another token failed; receipt failure deactivates the right token; removed membership cannot receive a queued push.

### T32 Normalize dates and availability contracts

**Depends on:** T01. **Covers:** B11, B14, N06.

**Source scope:** `backend/src/clientbridge/schemas/business.py`; `backend/src/clientbridge/schemas/bookings.py`; `backend/src/clientbridge/services/bookings.py`; `backend/src/clientbridge/services/public.py`; `backend/src/clientbridge/services/reports.py`.

Validate IANA zones and aware instants; use half-open local-day bounds; enforce recurrence/range limits; share public eligibility predicates with booking creation while keeping explicit staff override.

**Acceptance:** Direct POST cannot book a time excluded by public hours; DST spring/fall, exact midnight/end, invalid zone/naive time, zero/negative/over-limit recurrence and resource constraints have deterministic results.

### T33 Separate class session changes from transfers

**Depends on:** T32, T20, T25. **Covers:** B13.

**Source scope:** `backend/src/clientbridge/services/bookings.py`; `backend/src/clientbridge/schemas/bookings.py`; `backend/src/clientbridge/services/public.py`; `frontend/packages/app-core/src/domain/classes.ts`; `frontend/packages/app-core/src/domain/recurrences.ts`.

Define session-level move versus attendee transfer; lock source/target capacity in deterministic order; update all denormalized staff links for session changes; fan out durable notices to affected attendees.

**Acceptance:** Moving one attendee never moves peers; concurrent transfer cannot overfill; series edits preserve mixed rosters; all derived staff/sync visibility changes together; deposit/entitlement effects follow the chosen transfer policy.

### T34 Detect stale editor submissions

**Depends on:** T01, T12. **Covers:** N05, N07.

**Source scope:** `backend/src/clientbridge/models/base.py`; `backend/src/clientbridge/schemas`; `backend/src/clientbridge/services/clients.py`; `backend/src/clientbridge/services/catalog.py`; `frontend/packages/app-core/src/hooks.ts`; `frontend/packages/app-core/src/domain`.

Add revision fields and conditional updates to mutable editor records by domain; require expected revision in new clients; return structured conflict with safe refresh/reapply behavior; make older-client transition additive and time-bounded.

**Acceptance:** Two devices editing the same revision cannot silently overwrite; compatible disjoint field behavior is deliberate; retrying an accepted command replays success rather than a stale conflict; old supported mobile contract remains valid during rollout.

### T35 Make client merges complete and recoverable

**Depends on:** T10, T20, T34. **Covers:** B21.

**Source scope:** `backend/src/clientbridge/services/clients.py`; `backend/src/clientbridge/models/clients.py`; `backend/src/clientbridge/services/files.py`; `backend/src/clientbridge/services/payments.py`; `backend/tests/test_clients_merge.py`.

Build a full dependency and provider-identity merge plan; lock source/target in ID order; move concrete/polymorphic references, preserve an old-ID redirect/audit and reject unsupported financial identity combinations.

**Acceptance:** Every dependent table is accounted for; concurrent booking/message is serialized or resolves to the survivor; links/files/history remain readable; conflicting provider customers/subscriptions are surfaced without destructive automatic consolidation.

### T36 Version and validate form submissions

**Depends on:** T34, T38. **Covers:** B22.

**Source scope:** `backend/src/clientbridge/models/documents.py`; `backend/src/clientbridge/schemas/forms.py`; `backend/src/clientbridge/services/forms.py`; `backend/src/clientbridge/services/public.py`; `frontend/packages/app-core/src/domain/forms.ts`.

Publish immutable form versions; bind response to version; validate declared types/options/ranges, required agreements and verified owned files; implement required signature semantics with explicit fields.

**Acceptance:** Editing the template cannot reinterpret old responses; stale/duplicate submission, missing required signature, invalid type/option and foreign/unverified attachment fail correctly; valid historical response renders unchanged.

### T37 Make signing an atomic versioned transition

**Depends on:** T34, T38, T28. **Covers:** B22, B23.

**Source scope:** `backend/src/clientbridge/models/documents.py`; `backend/src/clientbridge/services/contracts.py`; `backend/src/clientbridge/services/public.py`; `backend/src/clientbridge/schemas/contracts.py`; `frontend/apps/connect/src/pages/PublicContract.tsx`.

Bind view/sign to an immutable document version; atomically sign or decline once; preserve body hash/signer evidence; queue immutable artifact generation and delivery with a scoped download contract.

**Acceptance:** Sign-sign/sign-decline races have one terminal outcome; edited text requires renewed consent; stale view cannot sign unseen terms; retry returns the same artifact identity; private PDF access is authorized.

### T38 Verify upload and download lifecycles

**Depends on:** T10, T06. **Covers:** B23, N06, N10.

**Source scope:** `backend/src/clientbridge/models/platform.py`; `backend/src/clientbridge/services/files.py`; `backend/src/clientbridge/integrations/s3.py`; `backend/src/clientbridge/api/files.py`; `backend/src/clientbridge/services/public.py`.

Add pending/verified/rejected upload states, server HEAD/size/type verification, replacement protection, purpose policy, private downloads and orphan cleanup; separate public immutable image caching from private capabilities.

**Acceptance:** Missing/oversized/replaced/foreign uploads cannot be attached or served; finalized objects match expected ownership/purpose; expired URLs cannot be reused through an unauthorized resolver; cleanup respects document retention and references.

### T39 Tie entitlement usage to a sale or visit

**Depends on:** T23, T24, T26, T27. **Covers:** B24.

**Source scope:** `backend/src/clientbridge/services/entitlements.py`; `backend/src/clientbridge/services/bookings.py`; `backend/src/clientbridge/services/orders.py`; `backend/src/clientbridge/services/ledger.py`; `backend/src/clientbridge/models/catalog.py`.

Store immutable entitlement terms, enforce coverage and benefits, bind each use/redemption to an eligible sale/visit, prevent double application and record reversals/expiry using the chosen accounting rules.

**Acceptance:** Purchase-to-use-to-refund/expiry works across clients; ineligible services cannot consume a package; gift tender settles a taxed sale exactly once; changed catalog benefits do not rewrite prior purchases.

### T40 Make currency and tax filing scope explicit

**Depends on:** T23. **Covers:** B25.

**Source scope:** `backend/src/clientbridge/services/tax.py`; `backend/src/clientbridge/services/remittances.py`; `backend/src/clientbridge/services/reports.py`; `backend/src/clientbridge/schemas`; `frontend/packages/app-core/src/domain/remittances.ts`.

Apply the recommended CAD-only policy to new unsupported flows, preserve historical currency dimensions, support nil/refund return bookkeeping and validate filing/payee rules; distinguish recording a payment from initiating it.

**Acceptance:** Mixed currencies never sum as one amount; unsupported new currency fails clearly; nil and credit returns are representable; historical data is not converted; filing/payment UI accurately states the action performed.

### T41 Complete Interac event matching

**Depends on:** T21, T22, T23, T24. **Covers:** B26.

**Source scope:** `backend/src/clientbridge/api/webhooks.py`; `backend/src/clientbridge/integrations`; `backend/src/clientbridge/services/payments.py`; `backend/src/clientbridge/models/payments.py`; `backend/src/clientbridge/services/ledger.py`.

Keep the stub visibly disabled until a provider contract exists; persist immutable transfer IDs separately from matching; model unmatched/partial/excess funds and reprocessing; use suspense/credit or return policy for surplus.

**Acceptance:** Duplicate transfer versus repeated reference is distinguished; delayed match and underpayment retry; every received cent is represented; provider signature/amount/currency validation is tested before enabling the integration.

### T42 Protect exports and measure query cost

**Depends on:** T17, T23, T40. **Covers:** B31, N04, N06.

**Source scope:** `backend/src/clientbridge/services/reports.py`; `backend/src/clientbridge/services/consents.py`; `backend/src/clientbridge/services/bookings.py`; `backend/src/clientbridge/services/public.py`; `backend/src/clientbridge/models`.

Centralize spreadsheet-safe untrusted cells; replace proven N+1 queries with scoped batches/aggregates; add measured PostgreSQL and SQLite indexes with plan evidence; preserve financial snapshots and full exports.

**Acceptance:** Formula-like names stay text in every export; literal numeric money stays numeric; representative large-tenant query count/latency meets recorded budgets; totals match ledger and do not change with pagination.

### T43 Expose failures and enforce dependency budgets

**Depends on:** T02, T06. **Covers:** B29, N08, N11.

**Source scope:** `backend/src/clientbridge/main.py`; `backend/src/clientbridge/core`; `backend/src/clientbridge/integrations`; `backend/src/clientbridge/tasks/worker.py`; `infra`; `.docs/engineering.md`.

Add request/command/attempt correlation, redacted structured logs, low-cardinality metrics, separate readiness/liveness, queue/WAL/provider lag alerts, graceful shutdown and explicit connection limits.

**Acceptance:** A simulated provider/DB/Redis outage produces bounded failures and visible diagnostics; no customer secret or raw capability enters logs; stale queue and replication lag alert; in-flight claims recover after shutdown.

### T44 Protect audits and govern retention

**Depends on:** T09, T28. **Covers:** N09, N10, N12.

**Source scope:** `backend/src/clientbridge/models/platform.py`; `backend/src/clientbridge/core/command.py`; `backend/src/clientbridge/services/auth.py`; `backend/src/clientbridge/services/staff.py`; `backend/migrations/versions`; `backend/src/clientbridge/tasks/worker.py`.

Make runtime audit records append-only; cover auth/permission/public/financial events; document per-record retention and deletion exceptions; minimize raw webhook/outbox payload retention while keeping financial identities and legal evidence.

**Acceptance:** Runtime UPDATE/DELETE of audit fails; sensitive values are redacted; retention dry-run cannot erase ledger/document evidence or re-enable duplicate money operations; access/removal/role events retain actor and outcome.

### T45 Prove migration compatibility recovery and all clients

**Depends on:** T00, T01, T02, T03, T04, T05, T06, T07, T08, T09, T10, T11, T12, T13, T14, T15, T16, T17, T18, T19, T20, T21, T22, T23, T24, T25, T26, T27, T28, T29, T30, T31, T32, T33, T34, T35, T36, T37, T38, T39, T40, T41, T42, T43, T44. **Covers:** B29, B30, N07, N11, N12.

**Source scope:** `.github/workflows/ci.yml`; `Makefile`; `docker-compose.yml`; `backend/scripts`; `backend/tests`; `frontend/apps/web/e2e`; `frontend/apps/connect/e2e`; `frontend/apps/mobile/e2e`; `.docs/engineering.md`.

Freeze dependencies/images, guard destructive scripts, add role/concurrency/provider-failure/sync/client-version CI tiers; rehearse expand/backfill/validate/contract rollout and restore database plus objects; publish runbooks and retained evidence.

**Acceptance:** Full combined gate passes on an identified snapshot; prior supported native build works; database/object restore reconciles ledger and sync; all B/N findings have evidence or an explicit affected-feature-disabled decision; no live release is implied by test completion.


## Finding coverage

Every finding has assigned implementation work. An already fixed regression remains a T00 preservation check; the remaining finding IDs below are not marked resolved by this plan.

| Finding | Implementation tasks |
|---|---|
| B01 | T24 |
| B02 | T20, T21 |
| B03 | T28 |
| B04 | T29 |
| B05 | T23, T26 |
| B06 | T22 |
| B07 | T02, T05 |
| B08 | T03 |
| B09 | T04 |
| B10 | T01, T07, T08, T09, T10 |
| B11 | T32 |
| B12 | T25 |
| B13 | T33 |
| B14 | T32 |
| B15 | T12 |
| B16 | T19 |
| B17 | T01, T11 |
| B18 | T26 |
| B19 | T27 |
| B20 | T29 |
| B21 | T35 |
| B22 | T36, T37 |
| B23 | T37, T38 |
| B24 | T23, T39 |
| B25 | T23, T40 |
| B26 | T41 |
| B27 | T30 |
| B28 | T31 |
| B29 | T43, T45 |
| B30 | T00, T45 |
| B31 | T19, T42 |
| N01 | T01, T05, T06, T07, T08, T09 |
| N02 | T01, T10 |
| N03 | T13, T14, T15, T16, T17 |
| N04 | T11, T13, T14, T15, T16, T18, T42 |
| N05 | T34 |
| N06 | T02, T04, T17, T30, T32, T38, T42 |
| N07 | T12, T19, T20, T34, T45 |
| N08 | T02, T06, T18, T20, T21, T30, T43 |
| N09 | T05, T44 |
| N10 | T01, T07, T11, T38, T44 |
| N11 | T00, T08, T09, T11, T18, T43, T45 |
| N12 | T00, T44, T45 |

## Completion criteria

All tasks have reviewed evidence; all original fixes remain covered; every tenant table and growing read surface has a declared contract; the combined backend/web/Connect/native gate passes on one identified snapshot; financial and delivery crash scenarios converge; restore and rollout are demonstrated. A provider-dependent feature can remain disabled with an explicit recorded decision, but it must not be reported as fully implemented. Benchmarks, unresolved policy decisions and operational configuration are reported separately from code/test completion.
