# Sync reliability implementation plan

Status: executing after the user’s “go”; see the task queue and progress log for verified completion.

Keep PowerSync as the replication layer for web, iOS and Android. Harden the application contracts around it so queued edits survive authentication failures, retries cannot corrupt or block uploads, each screen has one explicit business context, and replica authorization is tested against the real service. Connect remains an HTTP client. Marketing and playground do not become sync clients.

Evidence: [sync assessment](../../reviews/sync/assessment.json). Execution source of truth: [task queue](tasks.json). Status and verification: [progress](progress.md). All 16 findings S01–S16 have tasks and acceptance criteria. The previous 34 passing sync endpoint tests are baseline evidence, not acceptance evidence for future changes.

## Execution boundaries

User correction: the app is in early development. No old-client compatibility layers or dual write paths are required. Every schema change needs explicit approval of its concrete design before schema/model or migration edits and before application, including disposable databases. The earlier “go” is not schema approval. Already-applied changes are listed in progress.md and must not be silently reverted.

- “Go” authorizes implementation and local verification of this plan. It does not authorize a production deployment, commit, push, shared demo reset or destructive database cleanup. Earlier completed push instructions are not a standing instruction to push new work.
- Preserve the active checkout and concurrent work. Capture the current HEAD, dirty-file hashes, tool versions and relevant test results at SH00. Reconcile source drift before modifying shared files. Do not use broad checkout, reset or stash commands.
- Reuse completed backend-hardening work where it meets these contracts. One writer owns shared auth, sync, models, migrations, schema generation and UI contracts at a time. Split large tasks into bounded domain slices before editing.
- Use disposable test infrastructure with deterministic fixtures. A temporary test database/container must have a unique name, explicit lifecycle and cleanup. Do not leave extra persistent databases or PowerSync instances; never reseed or clear the main Clientbridge database for a test. Keep one existing iOS simulator and the existing Android emulator.
- Follow CLAUDE.md: thin routes, service-owned transactions, scoped tenancy, role checks in services, shared domain logic, twin UI components and centralized copy. New offline support is limited to working hours and existing pending edits; money and bookings remain server-authoritative commands.
- Each task requires a failing reproduction or explicit behavior specification, implementation, focused verification and review. Record commands, exit status, source hash and remaining limitations. Infrastructure/credential blockers affect only their dependent tasks; ordinary engineering choices do not require repeated permission requests.
- Do not silently turn an unresolved experiment into a shipped assumption. SH01 proves SDK queue and lifecycle behavior before SH05/SH09 depend on it. Maintain a concrete fallback and keep unrelated tasks moving.

## Delivery sequence

| Gate | Tasks | Required outcome |
|---|---|---|
| Baseline and test capability | SH00–SH02 | Reproducible snapshot, supported SDK primitives and an actual PowerSync integration harness. |
| Preserve and validate writes | SH03–SH06 | Strict uploads, durable replay records, rejection recovery and safe hours conflicts. |
| Preserve identity and business context | SH07–SH12 | Reauthentication preserves work; refresh, browser tabs, device storage and business context agree. |
| Make progress and permissions observable | SH13–SH17 | Accurate health and catch-up behavior, explicit projections and role-revocation tests. |
| Harden deployment and configuration | SH18–SH20 | Pinned service, least privilege, stable signing keys, operational checks and tested Streams migration. |
| Bound data and finish release evidence | SH21–SH26 | Measured performance, bounded queries, defined offline files, native fault matrix and release/rollback evidence. |

The JSON queue defines actual dependencies. Numeric ranges describe delivery areas, not permission to bypass prerequisites. SH02 starts real-service testing early; security validation is not postponed until after a configuration migration.

## Durable upload contract

### Transport and identity

Use one current upload contract; remove superseded payload handling when its replacement is ready. A v2 request carries protocol version, random durable device installation identifier, random durable operation identifier, expected business and a bounded operation payload. Identity and tenancy are always derived and rechecked from authenticated membership; client identifiers are not authorization credentials.

Persist each hours command in a local-only outbox before attempting it. Use explicit UUIDs, never a payload-derived identity or PowerSync internal-table mutation. The SDK CRUD probes are verification history; there is no generic CRUD runtime path.

Use a 256 KiB request-body ceiling and exactly seven unique weekdays in the typed hours command. Validate limits in API tests and the reverse-proxy/deployment contract; do not rely solely on an eventual proxy setting.

Create a server-only receipt table, either by safely extending the existing command idempotency mechanism or adding a dedicated sync receipt model after SH01 checks its semantics. Required fields: authenticated actor, device, operation ID, canonical payload hash, business, outcome and schema version. Enforce uniqueness on actor/device/operation. Successful mutation and receipt commit in one transaction. Repeating the same key and payload returns the original result without reapplying; different content under the same key returns a stable 409. Check actor/session validity and current membership before releasing receipt data.

Retain compact receipt/deduplication records for 90 days initially. Requests older than the supported retry horizon must fail closed into recoverable conflict, never be treated as fresh and silently reapplied. Include operation creation/protocol age checks with bounded clock-skew handling and publish the supported offline horizon. SH21 measures storage and may increase retention; decreasing it requires pending-operation retention review.

### Validation and outcomes

Hours mutations belong to the hours service. Validate strict booleans, weekday 0–6, paired and ordered local times, the active tenant-owned staff member and the expected revision. Time-off exceptions remain separate commands. Return structured validation/conflict responses, and commit the whole week with its receipt atomically.

Classify outcomes:

| Outcome | Client behavior |
|---|---|
| Network failure, timeout, 408, 429, transient 5xx | Retain request and retry with bounded backoff/jitter; respect Retry-After. |
| Expired access token | One single-flight session refresh, then retry using the same operation identity. |
| Invalid/revoked session | Pause uploads and lock data for reauthentication; preserve work. |
| Ownership/validation rejection or revision conflict | Persist a rejected-change record and show repair/discard actions; no endless blind retry. |
| Confirmed success or matching recorded replay | Acknowledge the exact queued operation. |

Keep rejected intent in the local-only outbox and hold dependent operations on that staff-week until repaired or discarded. Independent weeks continue. Canonical replica rows are never overwritten by the proposal. Treat rejected payloads as sensitive user data; do not include them in telemetry.

### Working hours as one aggregate

Replace delete-and-reinsert recurring hours with a versioned staff-week command. Seven weekday entries use stable identities; canonical server validation, an aggregate revision and an atomic compare-and-set prevent duplicate weeks and lost edits. Public availability and local calendar queries continue to consume server-authoritative hours rows.

Preserve offline editing with a narrowly scoped, local-only working-hours outbox: operation ID, actor/business/staff IDs, base revision, seven-day desired value, predecessor operation and state. Persist it and its optimistic UI overlay together. A shared uploader calls the versioned hours command; do not teach the generic CRUD endpoint to infer aggregate intent. Coalesce only unsent edits that have never been attempted; once an operation has been attempted its identity/payload is immutable. Later edits depend on the preceding result and revision.

Use the pending overlay only for the intended user's selected staff week; mark it as saved locally until acknowledged and observed in the replica. A revision mismatch presents current server values and the user's proposal. “Apply my changes” becomes a new command against the latest revision after an explicit user action; no silent last-writer-wins. Replace direct CRUD hours writes with the single verified command/outbox path and remove the superseded implementation and compatibility tests. Preserve current data; any explicit development-data reset needs separate authorization. A schedule revision counter is a concurrency proposal requiring schema approval, not an old-client compatibility mechanism.

## Session lifecycle contract

Use one shared state model: initializing, authenticated/connecting, usable cached data, reauthentication required, signing out, signed out and recoverable storage error. Network state and authentication state remain separate. Every async operation captures a session generation and actor; a response from an old generation cannot replace credentials or retry a command under a different user.

On automatic authentication failure, disconnect and unmount/protect business views before exposing a login form, retaining the replica and queued work under the original identity. Reauthentication as the same user resumes after authorization is revalidated. A different user gets a different bound replica; prior-user data must remain inaccessible and must never upload with new credentials. Explicit sign-out may discard after the existing pending-work confirmation; show discard errors rather than swallowing them. Manual login must wait for any prior teardown to finish.

Bind local storage to API environment and user identity. Use identity-scoped database names directly. Do not add automatic legacy-file discovery, migration or retained bindings. Do not read or delete abandoned development files as part of runtime initialization; any one-time cleanup must be explicit and authorized. Local-only preferences follow the same identity policy.

### Refresh and retry

Persist a random refresh-attempt ID before sending a rotating refresh request. Send it on all retries of that same attempt. The server locks the refresh family/record and records the rotation outcome. A retry with the same old credential and attempt ID may return the same replacement pair for five minutes, provided the family is still valid; any different-attempt reuse retains the existing replay protection. Encrypt the temporarily stored replacement credentials with a separately configured server key and purge the encrypted response after the window. Never store a raw bearer token in logs or ordinary audit payloads. If safe replay cannot be supported after the window, require reauthentication while preserving queued work.

Persist successful credentials atomically and clear the pending refresh attempt only after durable storage. Bound a refresh request to 15 seconds and token acquisition to a 30-second foreground UX budget; report offline/retry state rather than hanging. Timers and abort handling must work with the installed browser and React Native transports. Reauthentication replaces the session generation. A simple changed-token comparison is insufficient if the user changed.

Web coordinates login, refresh, logout and account switching under a shared auth lock with storage/BroadcastChannel notifications. Include fallbacks and explicit support behavior for browsers without required primitives. Native uses a serialized lifecycle controller and tests app foreground/resume against the SDK's existing reconnect behavior; avoid duplicate custom reconnect loops.

### Token and signing policy

Validate token type, issuer, audience where applicable and live user/session state when minting sync credentials. Require the current session-family token contract and consistent revocation checks; remove the sidless-token compatibility path. Reauthentication preserves current account-bound pending work. Keep PowerSync TTL behavior explicit: the configured default is five minutes; already-issued tokens remain usable until their original expiry. Membership rule updates independently remove online access once replicated. Do not claim instant device revocation or offline erasure.

Require a persistent production signing key, expected algorithm and JWKS configuration at startup. Missing production keys must fail closed rather than fall back to ephemeral per-process keys. Support overlapping key IDs for rotation. Shortening PowerSync TTL or adding session-bound Streams revocation is a separately measured deployment decision; do not silently increase credential-refresh traffic.

## Selected business and projection contract

Support multiple memberships rather than hiding them with `LIMIT 1`. Store an explicit active business per identity, choose deterministically only when exactly one exists, and require selection otherwise. All local business-scoped list/detail/aggregate queries, role lookups, branding, navigation and command headers use that context. URL/deep-link targets must be checked against it. Pending operations keep their original business; switching contexts never rewrites their tenancy.

Initially continue syncing all authorized memberships to preserve current offline semantics. A selected business is a client view filter, not a grant of access. Add on-demand subscriptions only after parity tests. SQL assertions must include a user who is owner in A and staff in B so a role from one business cannot drive another's UI.

Replace broad `SELECT *` with explicit reviewed projections. Maintain a matrix of table, role, columns, capability fields, retention and workflow justification. Server-only sessions, credentials, receipt records and recovery payloads never enter sync. A local schema column with no projected value is not itself a leak; tests assert actual replicated values. Review capability URLs and provider references individually instead of deleting fields required by legitimate share/receipt workflows.

## Health and consistency contract

Expose a shared health object: session state, transport connection, initial sync, downloading, uploading, upload/download errors, queue total, rejected count, oldest pending age, last completed checkpoint/time and cached-data age. A 50-item preview is not the total. Include all pending work in the current write path; remove obsolete CRUD support when the hours outbox replaces it. Use supported SDK queue APIs verified in SH01; where an API yields only a bound, say “50+” rather than a false exact number until a proper total is available.

Render status in the web and native application shells, not only Today. Distinguish “saved on this device”, “waiting to upload”, “needs attention”, “server unavailable” and “up to date”. Use shared strings and UI twins. First-sync, SecureStore/SQLite and bootstrap failures need bounded, visible recovery. Log stable error codes, request IDs, timestamps and queue age without JWTs, capability URLs or personal payloads.

After an HTTP command, show the command response immediately when safe, then wait for an expected row/version in SQLite with timeout/cancellation before treating the replica as updated. A successful command whose replica wait times out remains successful; do not encourage duplicate payment or booking submission. `hasSynced` only proves a completed initial sync. Default to stable row-observation primitives. Checkpoint Requests may be adopted only after a compatibility spike and cancellation tests because the upstream feature is alpha; otherwise retain the stable fallback.

## Real service test matrix

SH02 builds a deterministic harness with pinned PostgreSQL, PowerSync service and an actual client SDK. Use test-controlled proxy faults to drop responses after commits, delay replication, interrupt authentication and inject transient failures. Backend ASGI tests and fake connector tests remain useful but cannot replace this harness.

Required scenarios:

- Owner/admin/staff/contractor, no membership, removed membership, two businesses with different roles and unrelated tenant C.
- Row and column visibility, active role downgrade, removed membership reconnect, soft deletion and capability-field audiences.
- Upload acknowledgement loss, server restart, repeated DELETE, invalid operation in a batch, permission rejection, duplicate key/different payload, queue predecessors/successors and receipt expiration.
- Concurrent offline hours edits, multiple unsent edits, cancellation, app crash before/after local persistence, before/after server commit and before/after acknowledgement.
- Access expiry, refresh response loss, expired/revoked refresh, concurrent requests, logout during refresh, storage failure and key rotation.
- Browser tabs and identity changes; iOS/Android background, force-close, airplane mode, reconnect and low-storage behavior.
- First sync, stale cached data, API down with sync up, sync down with API up, delayed command visibility and notification before row arrival.
- Approved schema/projection/service changes with current-client pending work preserved; no previous-client support matrix.

CI must run the small real-service matrix on each relevant change; full multi-device/native and scale drills gate release milestones. Keep tests that intentionally assert a failure separate from success evidence. Timeouts make failures visible; broad sleeps do not establish consistency.

## Operations and migration

Pin the current service image/digest and record installed SDK/SQLite versions before any upgrade. Use separate backend runtime, source replication, storage and migration identities. Validate grants needed for initial snapshots and ongoing replication against the pinned service; source access must not be a superuser. Coordinate backend RLS with the existing hardening plan, using non-bypass application roles; RLS does not replace the sync projection/membership contract.

Replace bootstrap error suppression with explicit idempotent existence checks and meaningful failures. Monitor readiness, active replication, source LSN/lag, retained WAL bytes, storage growth, upload rejection rate and authentication failures. Provisional operational alerts: lag over 60 seconds for five minutes, stalled oldest upload over five minutes while reachable, and retained WAL above 1 GiB or 10% of its disk budget. SH18 calibrates thresholds to hosting capacity and records chosen values. Establish who handles alerts and where logs live before production readiness is claimed.

Migrate Sync Rules to edition 3 Sync Streams only after projection parity tests. First migration keeps equivalent auto-subscriptions; selective history is later. Review timestamp/type correctness and current-client resync cost. Rehearse reverting to the pinned prior service/config pair without clearing user queues. Never “repair” a migration by deleting local data. Checkpoint requests and Streams migration are independent decisions.

Present schema proposals for explicit approval before implementation or application. Coordinate the current server, clients and sync configuration as one development change. Remove superseded upload/token handling instead of maintaining an old-client compatibility window. Do not run resets or downgrades implicitly.

## Scale and offline policy

SH21 measures 1,000/10,000/50,000 clients and 100,000/1,000,000 history/message/ledger rows on representative fixtures, with constrained network and representative existing devices. Initial targets to validate, not claimed current performance: usable hot offline data within 10 seconds on a warm launch/reconnect; primary local list queries p95 under 100 ms; first rendered page under 300 ms after data is available; no unbounded all-history load into React. Record cold-sync byte/storage budgets from measurements before adopting selective replication.

Paginate local lists with stable keysets and tie-breakers, and virtualize web/native renderers. Retain complete aggregates through server reports or explicit summary tables; do not silently compute totals from a retained subset. Design hot/calendar/history datasets and on-demand Streams from measured access patterns. Independently bound remote API lists where those surfaces use HTTP; coordinate the existing pagination work rather than duplicating contracts.

Guarantees for the first release: synced text/structured data can be read offline; hours edits can be durably saved offline; money/bookings and provider actions need online confirmation. File metadata does not guarantee cached file bytes. Show offline-unavailable files clearly. SH23 evaluates and implements device storage protection and retention appropriate to supported platforms. SH24 supplies bounded same-user caching for explicitly downloaded documents/images and recoverable foreground upload retry; it does not promise background uploads or offline card payments. Keep encryption keys outside the database, handle key loss with safe user recovery, and do not promise browser application encryption protects against an active same-origin script compromise.

## Overlap with backend hardening

| Existing tasks | Sync-plan responsibility |
|---|---|
| T11 sync field and role policy | SH16–SH17 own replica projection and real-service evidence; reuse policy metadata. |
| T12 selected business | SH12 owns the shared end-to-end contract; integrate existing changes rather than implement twice. |
| T19 permanent sync failures | SH03–SH06 implement typed errors, receipts and recovery; update both trackers. |
| T04 identity | SH07–SH10 handle refresh/lifecycle; coordinate identity normalization and abuse limits. |
| T05–T10 tenant context and RLS | SH18 consumes/co-develops role/grant changes; do not independently rename roles or fork RLS policy. |
| T13–T18 bounded reads | SH21–SH22 own measured local replica/query behavior and reuse API continuation contracts. |
| T44 retention | SH04/SH14/SH23 coordinate receipt, rejected-change and local-data retention. |

T00 baseline evidence from the earlier execution is historical. Reuse implementation only after checking the current tree, migrations and acceptance tests. Neither plan may mark an overlapping task complete solely because the other contains a proposal.

## Completion and release criteria

Every task in tasks.json is complete with evidence or explicitly deferred with its unmet release guarantee. All P1 findings must be resolved before declaring sync reliable for release. P2 scope is not silently waived to finish faster. Run focused checks after each slice; at milestones run formatting, lint, types, code generation, backend/frontend tests, builds and the actual-service suite. Run browser and native matrices on the final snapshot.

No source, test, migration or generated artifact should depend on an uncommitted future slice. Regenerate contracts with their API/model change. Update maintained architecture/engineering docs only to describe implemented behavior. Archive raw logs under `.scratchpad/sync-hardening/`; use progress.md for durable outcomes. Finish with the changed files, tested behavior, supported compatibility range, rollback instructions and any limitations. Await a separate instruction before committing, pushing or deploying.

## Implemented projection inventory

Snapshot after explicit-column hardening. Bucket membership remains enforced by PowerSync; selected-business SQL is a UI context boundary, not authorization. Shared buckets cover active members; self buckets cover only the member’s staff row; full buckets require owner/admin. Limited projections redact pay and business tax/billing fields. Explicitly retained invoice/estimate/signature capabilities support current copy-link flows; gift-card codes support authorized redemption. New model fields are excluded until reviewed in the rules.

| Table | Authorized buckets | Model columns excluded from every projection |
|---|---|---|
| clients | business_shared | stripe_customer_id |
| subjects | business_shared | — |
| notes | business_shared | — |
| consents | business_shared | — |
| resources | business_shared | — |
| hours | business_shared, staff_self, business_full | — |
| items | business_shared | stripe_price_id |
| packages | business_shared | — |
| subscriptions | business_shared | provider_ref |
| gift_cards | business_shared | — |
| forms | business_shared | — |
| fields | business_shared | — |
| contracts | business_shared | — |
| files | business_shared | s3_key |
| threads | business_shared | — |
| messages | business_shared | provider_ref |
| businesses | staff_limited, business_full | booking_policy, created_at, status, stripe_details_submitted, stripe_payouts_enabled, stripe_requirements, updated_at |
| staff | staff_limited, staff_limited, staff_limited, business_full, business_full, business_full | bookable_online, invite_token, invited_by |
| orders | staff_limited, business_full | receipt_token, status_token |
| lines | staff_limited, business_full | — |
| slots | staff_self, business_full | — |
| bookings | staff_self, business_full | manage_token |
| addons | staff_self, business_full | — |
| recurrences | staff_self, business_full | — |
| accounts | staff_self, business_full | — |
| entries | staff_self, business_full | — |
| invoices | business_full | — |
| estimates | business_full | — |
| inventory | business_full | — |
| payments | business_full | provider_ref |
| payment_methods | business_full | provider_ref |
| reviews | business_full | token |
| broadcasts | business_full | — |
| responses | business_full | token |
| signatures | business_full | — |

The live test matrix currently covers six role/tenant identities, forbidden invite/provider fields, pay/tax redaction, downgrade, soft deletion and membership removal. Full per-table fixture coverage and offline native retention validation are still outstanding; this snapshot does not mark SH16/SH17 complete.
