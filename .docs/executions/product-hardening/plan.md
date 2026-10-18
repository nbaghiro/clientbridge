# Product hardening execution plan

Status: implementation complete on `hardening/product-invariants`, with local gates passing and draft publication in progress. Remote CI and manual QA remain pending. See [finding disposition](disposition.md) for all 51 historical items and explicit follow-ups, and [QA checklist](qa.md) for manual acceptance. Revised S2/S3/S4 designs were approved after schema review.

## Scope and source of truth

Bring the confirmed product defects to a tested resolution, reconcile every older review finding, and preserve deliberate product scope. The current review covers main at `964e5427`; seven API reproductions demonstrate six application defects and two deployment gaps are established from configuration. The evidence runs passed 427 existing tests plus seven reproductions. These reproductions assert the defective behavior and must be inverted into regression tests during implementation.

This folder owns the execution plan and [task queue](tasks.json). [Historical findings](historical-findings.md) retains all 51 older review IDs with current dispositions. The older codebase-review queue is evidence, not a second queue to execute concurrently. At kickoff, reconcile its statuses and link it to this plan rather than silently deleting its history.

The root checkout is nine commits behind the reviewed remote snapshot and contains the older admin implementation already merged, the already-merged ActionTile alignment, and one unique explanatory booking comment. Keep a patch and untracked-file archive before any cleanup. Use an isolated checkout until every local difference is accounted for; do not reset the root as a shortcut.

## Delivery workflow

Latest user decision: complete all fixes locally, then move the full change set to a new branch, make focused single-line commits, push only at the end and open one draft PR. No main push or deployment. The draft PR must concisely explain every addressed finding, validation and remaining limits. Preserve the original local booking comment and archived pre-hardening work. Earlier multi-PR/direct-main-push recommendations are superseded.

## Feature ownership

| Group | Main code owners | Review focus |
| --- | --- | --- |
| Access and setup | auth, business, staff, plans, core/deps, Kratos | Identity, tenancy, role/plan transitions, invite and seat races |
| Clients and records | clients, subjects, notes, returning, consents | Contact ambiguity, merges, history, verified profile access |
| Catalog and stock | catalog, inventory, files, tax | Availability, reservation lifecycle, variants and attachments |
| Scheduling | bookings, hours, public; app-core bookings/classes/recurrences | Capacity, resources, overlapping writes, offline hours |
| Checkout and billing | orders, payments, billing, entitlements, lines | Payment attempts, idempotency, refunds, late events |
| Money and reporting | ledger, earnings, remittances, reports | Balanced journals, reversal, filing/payroll integrity |
| Communications and documents | notifications, messaging, forms, contracts, reviews | Durable delivery, consent, immutable submitted content |
| Sync and offline | packages/sync, sync rules, app-core auth/sync/hours | Account isolation, history coverage, recovery and growth |
| Admin and deployment | admin, site/server, Caddy, Docker, Pulumi | Actual image/routing/auth behavior, operational visibility |

Keep layer-first organization and shared app-core view models. Split by concept when needed, not by file length, and reuse existing web/mobile UI twins and admin navy tokens.

## Execution order

| Task | Deliverable | Dependencies | Suggested PR |
| --- | --- | --- | --- |
| P00 | Preserve local work, fetch current main, establish isolated checkout and evidence inventory | User go | Preparation |
| P01 | Concrete schema decisions and environment/provider decisions | P00 | Decision record |
| P02 | Revalidate older high-risk money findings and add repros before related design is finalized | P00 | Evidence accompanying fixes |
| P03 | Payment replay and stable frontend action keys, including package consumption | P00 | Retry guarantees |
| P04 | Inventory reservations and late-payment/reaper recovery | P01, P02, P03 | Stock and checkout |
| P05 | Durable notifications, trial reminders, admin test-send history and deduplication | P01, P03 | Delivery reliability |
| P06 | Confirmed refund, plan and seat fixes from historical review | P02, P03; P01 if schema needed | Separate refund and plan PRs |
| P07 | Contract version binding, serialized sign/decline and consent reset | P00 | Contract integrity |
| P08 | Per-business SMS routing, shared rate limits and verified sync visibility fixes | P01, P05; verification first for old claims | Separate SMS and security PRs |
| P09 | Immutable form definitions, validated answers and real required signatures | P01, P07 | Form integrity |
| P10 | Measured performance/reliability fixes and sync growth investigation | P00; P01 only for approved indexes | Per measured bottleneck |
| P11 | Verified UI/product gaps, client race fixes and admin activity grouping | P00, P03; P01 if schema needed | Per cohesive feature |
| P12 | Admin/contact deployment wiring, acceptance matrix, final reconciliation | P00; final gate follows completed fixes | Deployment integration then final tests |

Start P07 and P03 while schema-dependent designs are awaiting decisions. Revalidate historical money risks early rather than waiting until the eight current findings are finished. P12's admin/contact wiring can be implemented earlier in an independent PR; final release validation comes last. This is a dependency graph, not an instruction to run multiple agents or concurrent mutations.

## Confirmed findings and acceptance criteria

### R01 Online shop can sell the last unit twice

High; owned by P04.

Observed: Two customers open checkout while stock is 1; both subsequently pay. The reproduced final stock is −1.

Root cause: The shop checks stock_on_hand but does not reserve quantity. Settlement later deducts stock without checking availability. A row lock at checkout alone would not fix the gap between checkout and settlement.

Implementation: Reserve stock atomically when creating the payment attempt, calculate availability after reservations, release on expiry/cancellation, and make settlement/release idempotent. Define the late-payment recovery path. Keep intentional in-person negative-stock policy separate.

Acceptance: Two checkouts for one unit; duplicate webhook; expired checkout; payment after expiry; simultaneous checkout and stock correction.

Evidence: API reproduction: test_shop_oversells_last_unit. Sources: `backend/src/clientbridge/services/public.py:1846`, `backend/src/clientbridge/services/inventory.py:92`.

### R02 A signature can attest to contract text the client never saw

High; owned by P07.

Observed: Client loads version 1. The owner publishes version 2. Signing from the still-open page succeeds and stores version 2.

Root cause: The request carries name, strokes and consent, but no expected version/hash. The server snapshots the current contract body at submit time, rather than checking the version displayed.

Implementation: Bind the signing request to the displayed immutable version or content hash. Lock/conditionally transition the pending signature, reject stale content, and require review and consent again after a version change.

Acceptance: Load v1 → publish v2 → sign must reject or sign an explicitly preserved v1; concurrent sign/decline; replay after success.

Evidence: API reproduction: test_contract_signs_text_not_seen. Sources: `backend/src/clientbridge/services/public.py:934`, `backend/src/clientbridge/schemas/contracts.py:55`, `frontend/packages/app-core/src/domain/publicContract.ts:23`.

### R03 Payment receipts can disappear permanently during a provider outage

Medium; owned by P05.

Observed: Email sending fails while processing a successful payment. The webhook still returns success; replaying that event after recovery never retries the receipt.

Root cause: Payment settlement marks the webhook processed before notification. Notification helpers swallow send exceptions, and no durable delivery work remains to retry. Keeping settlement committed is correct; losing delivery intent is the gap.

Implementation: Persist notification intent in the settlement transaction, then dispatch and retry it independently with stable delivery keys. Track per-channel outcomes so retries do not repeat already-successful sends. Reuse the mechanism for booking/document notifications.

Acceptance: Provider unavailable then recovers; worker crash before/after provider acceptance; duplicate event; independent email/SMS outcomes.

Evidence: API reproduction: test_settlement_notification_is_lost_on_outage. Sources: `backend/src/clientbridge/services/payments.py:1439`, `backend/src/clientbridge/api/webhooks.py:42`, `backend/src/clientbridge/services/notifications.py:1564`.

### R04 Intake form requirements are not enforced end to end

Medium; owned by P09.

Observed: A form configured to require a signature accepts an unsigned submission. A required rating also accepts an arbitrary JSON object and unknown answer keys are persisted.

Root cause: require_signature is saved by the editor but absent from the public contract and submit checks. validate_answers only checks whether required values are absent or empty.

Implementation: Implement signature capture and server validation together. Validate each field type, allowed options, lengths/ranges and recognized keys; keep upload ownership checks. If signature support is deferred, remove the misleading toggle until it works.

Acceptance: Unsigned required-signature form; wrong scalar/object types; unknown choices/keys; required checkbox semantics; malformed uploads; valid typed answers.

Evidence: API reproductions: test_required_form_signature_is_not_enforced; test_form_accepts_invalid_answer_types. Sources: `backend/src/clientbridge/services/public.py:1117`, `backend/src/clientbridge/services/public.py:1138`, `backend/src/clientbridge/schemas/forms.py:49`.

### R05 Editing a form changes the meaning of historical responses

Medium; owned by P09.

Observed: A client submits “Peanuts” for “Allergies”. The owner changes that question to “Emergency contact”. The completed response now resolves the new label while retaining the old answer.

Root cause: Responses store answer keys but no question/version snapshot. The editor mutates or deletes the shared field rows, and public context reads the current form fields.

Implementation: Version the form definition or snapshot the exact questions, labels, options and requirements used by each response. Existing responses must continue to render their original schema; new requests use the new version.

Acceptance: Edit label/type/options; delete a field; remove and recreate the same name; historical response/export still shows the original question and answer.

Evidence: API reproduction: test_form_edit_changes_submitted_question. Sources: `backend/src/clientbridge/services/forms.py:113`, `backend/src/clientbridge/services/public.py:1037`, `backend/src/clientbridge/models/documents.py:73`.

### R06 A successful payment cannot reliably be replayed with its original key

Medium; owned by P03.

Observed: A full cash payment succeeds. The exact same body/key retried after a lost response returns 409 instead of the original success.

Root cause: record_invoice_payment calls assert_payable before run_command checks the saved response. The first attempt has already made the invoice paid, so the retry never reaches replay.

Implementation: After authentication and resource authorization, perform same-key/request replay before mutable business-state validation. Put payable/balance checks in the transactional execution path. Audit other mutation entry points and retain frontend attempt keys across ambiguous failures.

Acceptance: Full and partial payments; network response loss; changed request with the same key; cross-tenant attempts; no duplicate ledger/payment rows.

Evidence: API reproduction: test_full_payment_retry_is_refused. Sources: `backend/src/clientbridge/services/payments.py:250`, `backend/src/clientbridge/core/command.py:155`, `frontend/packages/app-core/src/domain/payments.ts:288`.

### R07 The merged admin app is absent from the production deployment

Medium; owned by P12.

Observed: The frontend image builds/copies web, Connect and site only. There is no admin host route, and the main app’s admin login destination defaults to localhost:8711.

Root cause: Admin implementation and infrastructure were developed on separate branches; the combined main does not connect the new surface to the deployment contract. Admin API/web URLs also use only build-time env defaults rather than deployed runtime config.

Implementation: Add admin build artifacts, a dedicated host with DNS/certificate/Gateway/Caddy routing, runtime API/web/admin URLs, the backend admin origin and server-side operator grants. Test the deployed login → authorization → admin flow.

Acceptance: Production-like image serves admin assets; signed-out redirects to real auth; non-admin denied; admin succeeds; cookie/CORS/origin checks; no localhost/base.invalid URLs.

Evidence: Static deployment-chain verification; no live environment probe. Sources: `frontend/Dockerfile:34`, `infra/pulumi/kubernetes/gateway.py:25`, `frontend/apps/web/src/config.ts:7`, `frontend/apps/admin/src/config.ts:1`.

### R08 The contact form has no handler in the deployed site

Medium; owned by P12.

Observed: The rendered contact form posts to /contact, but the production image serves static files with Caddy and does not run the Node contact server.

Root cause: The working POST handler exists under apps/site/server. The deployed image copies dist assets only and has no reverse-proxy route to that handler. Architecture documentation already notes this deployment gap.

Implementation: Deploy the existing handler or move it behind a dedicated API endpoint; wire the form action, provider settings, abuse controls and confirmation/error pages. Add a container-level POST test, rather than testing only the local Node server.

Acceptance: Submit against the production-like hostname/image; valid message reaches a fake sender; invalid/spam/rate-limited submissions; delivery failure renders retry.

Evidence: Static deployment-chain verification; previously documented gap. Sources: `frontend/apps/site/src/pages/Contact.tsx:19`, `frontend/apps/site/server/site.ts:255`, `frontend/Caddyfile:81`, `frontend/Dockerfile:41`.

## Implementation decisions by slice

### Retry and concurrency guarantees

Authenticate and authorize the resource before serving a replay; hash the logical request and reject same-key/different-body reuse. Replay before checking mutable state such as an invoice's remaining balance. Recheck balances and terminal states under the correct narrow lock for new executions. Keep gateway request keys stable independently of database rollback.

Audit every app-core mutation with money or external side effects. Specifically cover invoice payment, message/broadcast send, POS cash/terminal/refund, client creation, plan checkout and `consumeSession`, which currently supplies no key despite backend support. An attempt key survives network ambiguity and changes only for a genuinely changed action. Add an immediate in-flight guard to the shared action helper only after verifying existing behavior; do not serialize unrelated actions globally.

Public booking/shop/manage mutations need both concurrent-key behavior and audit coverage verified. Move them through the existing command mechanism where doing so preserves authorization and locking; do not create a second command abstraction. Inject response loss and race requests over separate database connections.

### Inventory reservations

Reserve tracked quantities atomically under deterministically ordered item locks. Model reservation separately from on-hand movements so merely opening checkout does not appear as a sale. Check availability against active reservations for every path competing for those units, including POS; choose the explicit policy for manual overselling separately. An order/payment attempt references the reservation, and a repeated command reuses it.

The expiry worker must inspect or cancel provider attempts before releasing stock. Failed-but-retryable intents matter as well as pending intents. Provider timeout is an unresolved state, not permission to free stock. On late settlement, consume a still-held reservation; otherwise acquire availability atomically or initiate a tracked compensating refund and flag fulfillment as blocked. Do not silently accept payment for unavailable inventory. No automatic live refund is executed during development tests.

Reconcile existing unpaid orders at rollout: inventory their reservations/attempts, build only feasible reservations, and flag conflicts rather than over-reserving. Require a clean report before enabling the new path. Compare catalog, checkout availability, stock movements and completed orders in tests.

### Durable delivery and admin email testing

Write notification intent in the same transaction as the business event. A separate worker claims a lease, renders the versioned template, dispatches, records the outcome and retries eligible failures with backoff. Persist per-channel state so SMS success does not hide a failed email or cause a repeated SMS. Use stable provider keys where supported.

Do not promise exactly-once delivery when a provider can accept a message and lose the response without a deduplication/query facility. Record that case as ambiguous and apply an explicit provider-specific recovery policy. Test process death before send, after acceptance and before outcome commit; test expired leases and two workers.

Cover payment/refund receipts, booking notices/reminders, overdue notices, intake/review/contract sends, trial reminders and broadcasts through an inventory of callers. Preserve the already-fixed scheduled-job markers and per-recipient commits while replacing paths deliberately. Reconciliation jobs must isolate one tenant/provider failure so subsequent businesses still run.

Admin Email Lab uses the same durable mechanism for synthetic test sends. Persist actor identity, request key/hash, template revision, destination, selected transport, attempts and provider reference. Enforce deduplication across workers and provide a compact recent-history/detail view. Provider acceptance and actual delivery are different statuses. Avoid exposing stored bodies, live customer tokens or secrets in admin summaries. Do not send an external email until an actual recipient/test is explicitly requested; use local/fake delivery for automated verification.

### Contract and form integrity

The minimal contract fix needs no schema change: require the displayed contract version or content hash, lock the contract/signature in a consistent order, validate the expected content and pending state, then snapshot it using existing signed fields. A stale page reloads the new document and clears consent. Concurrent sign and decline have one winner. Signed evidence remains unchanged when the template is edited later.

Forms need an immutable response definition. Freeze field IDs/names, labels, input types, options, validation and require-signature policy when a response is issued. The client submits the definition hash/version it viewed. The server validates only against that definition, including allowed keys, scalar/list types, options, ranges, whitespace, date/time formats, file ownership and required consent semantics. A plain optional checkbox may legitimately be false; an explicit required agreement must be true.

Capture the form signature explicitly and persist its name/method/time/IP and optional strokes with the submission. Render completed responses and exports using the frozen definition. For old submitted responses the exact earlier wording may be unrecoverable: preserve the answers, identify the definition as reconstructed from current fields, and never claim reconstructed text is what the person actually saw. Existing draft links adopt a frozen definition once during migration; no indefinite legacy code path is planned.

### SMS tenancy and distributed abuse controls

Use a unique provider-number assignment to resolve the destination business from the signed inbound payload before finding the sender within that business. Route STOP/START to that assignment and account for the provider's sender-level suppression behavior. An unknown/ambiguous destination must not fall back to the business that last texted the sender. Record an operational event and expose a controlled recovery path.

Do not assign the shared historical number to every business under a uniqueness constraint. Provision distinct numbers or mark businesses unprovisioned and prevent new outbound traffic until configured. Define number reassignment/quarantine and historical-thread behavior before rollout. Number purchases and provider-account changes are a separate concrete provisioning action, not implied by a coding go.

The latest code already parses trusted proxy hops; do not reintroduce the old leftmost-forwarded-IP fix. Verify the deployment trust boundary, then move limiter state to an atomic shared store and test two API workers. Recheck bearer gift-card code visibility before changing streams. Any visibility change includes replica eviction assertions and sync projection tests.

### Deployed admin and contact flows

Build and copy admin assets, add its hostname to environment definitions/DNS/certificate/Gateway/Caddy, and supply deployed API, regular web and admin URLs consistently. Configure the backend allowed origin and platform identity grants; never enable a demo grant outside dev. Smoke-test redirects, cookie credentials, denied users, permitted operators and absence of localhost/placeholder URLs from the built image. Preserve the dark-blue admin style.

For the marketing contact form, reuse the working handler behind a deployed route or move its core logic into the API with an explicit form action. Select one production path and keep local tests on that same behavior. Test the actual container route, method handling, abuse controls, provider failure and thanks/retry pages. Waitlist handling must be checked separately if that build mode is being deployed; do not infer the static full site needs every waitlist feature.

### Admin activity view

The current admin activity section reads existing audit records; it is not a complete cross-feature provider/client timeline. Add grouped, paginated projections linking business, actor, client, booking, document, payment and delivery IDs where evidence exists. Keep missing history visibly missing and distinguish native events from derived context. Add missing audits to relevant mutations through command execution; do not fabricate old audit events or expose raw provider payloads. Add append-only protection only if the schema/trigger proposal is approved.

## Approved revised schema decisions

The concrete revised source of truth is [schema-decisions.md](schema-decisions.md). S1 derives reservations from existing records. S2 adds one deliveries table, no attempts table. S3 adds response definition/signature evidence. S4 adds businesses.sms_number. These supersede earlier broad designs and were reviewed with the user before authorization to proceed. Additional indexes/triggers/columns outside those proposals still require a concrete decision.

## Known gaps retained in scope

| Item | Disposition |
| --- | --- |
| Frontend package consumption has no idempotency key | Include in P03 with lost-response and double-click tests; do not rely only on the backend's key support. |
| Shared-number SMS routing and consent ambiguity | Confirmed existing launch gap; P08, linked to historical H3/CLI-45. |
| Durable admin test-email history | P05; reuse delivery history rather than build a second log. |
| Admin test-send deduplication across workers | P05; replace process-local-only guard with durable keyed requests and shared limiting. |
| Full provider/client activity grouping | P11; design a bounded cross-feature projection, not a promise of nonexistent past events. |
| Offline booking creation | Deliberately online-only today. Keep out of defect fixes; any future proposal must distinguish an offline request from a confirmed reservation and handle conflicts on reconnect. |
| Offline notes versus launch QA | Verify historical M18 and update the QA contract or separately scope a durable note command. Do not imply all writes work offline. |
| Root checkout leftovers | P00; archive, reconcile and preserve the unique comment before updating. No substantive unmerged admin feature remains. |

## Already resolved work retained for regression

The sync work merged in `ec3fd669` addressed out-of-window calendar coverage, history-window rollover, late restore activation after timeout, accepted/rejected hours recovery after access loss, production web offline startup/persistence, seven-day offline access verification and sync-health/queue-age/replication-delay visibility. Keep their meaningful existing tests; do not create duplicate fixes.

The admin work merged in `6baf5ed7` includes regular-login authorization, demo-admin setup, stable auth rendering, the core admin pages, packaged migration discovery and independent Email Lab transport configuration. The newly found deployment omission is distinct from those completed source-level fixes. Historical H1/H2 scheduled-job fixes and M20/M21/L25 documentation fixes are recorded separately in the reconciliation appendix.

## Remaining investigations after the confirmed fixes

Every investigation ends as reproduced and scheduled, fixed already, deliberate scope, or refuted, with evidence. No “possibly risky” item becomes a mandatory refactor by default.

| Area | Questions and proof required | Task |
| --- | --- | --- |
| Refund and order recovery | Reproduce credit-note reuse after failed refunds, no-key rollback races, missing deposit/order refund notification, and retry of declined intents after order reaping. Verify all three refund paths before unifying them. | P02/P06/P04 |
| Plan and seat races | Reproduce replacement-subscription refund behavior, concurrent invite/removal seat drift, stale plan reads under lock and changed Stripe parameters with the same key. | P02/P06 |
| Database locks and external calls | Inject slow Stripe/email boundaries and measure whether unrelated tenant inserts block; narrow locks without allowing duplicate external actions. | P02/P06 |
| Client identity and merges | Same email with conflicting phone, two contacts matching different clients, simultaneous create/merge, consent history and new financial data arriving during merge. | P11/P03 |
| Gift-card access and tender | Verify current staff-device bearer-code exposure; distinguish a security correction from adding gift-card split tender to POS/public checkout. | P08/P11 |
| Scheduling/UI correctness | Same-day inbox time comparisons, long visits, drag/undo ordering, stale remote responses, calendar/load failures, resources and missing time zones. | P11 |
| Growth and blocking IO | Measure held-order query plans, pickup-window query count, global job scans, inbox size, initial sync volume, S3/head/delete blocking, sender client reuse, PIN hashing and reconciliation failure isolation. | P10 |
| Public auth and abuse | Verify proxy address trust with deployment settings, multi-worker limits, file size/content/ownership, cross-tenant public tokens and concurrent public command replay. | P08/P03 |
| E2E coverage | Verify actual gaps for PAD setup, auth-error, mobile security and onboarding; rerun relevant browser/mobile/offline scenarios after fixes. | P12 |
| Documentation and unused APIs | Reconcile old fixed docs, PAD comments, unused UI props/routes/columns and explicit offline scope. Delete only proven unused surfaces, not code merely absent from one app. | P11/P12 |

All individual historical claims, including lows, are listed in [historical-findings.md](historical-findings.md). The historical 11 refuted findings are retained as refuted and are not executable tasks. Newly discovered high/medium issues are documented with trigger, root cause and test before entering the queue; bounded fixes in the same approved scope proceed, while new product capabilities, schema changes, destructive data actions or live provider purchases get their concrete decision first.

## Validation and completion

For each slice, cover happy path, relevant 4xx paths, tenant/role invariants and retry/concurrency edges. Use real Postgres with disposable seeded data and boundary fakes. Race tests use separate connections; sequential calls alone do not prove locking. Convert the seven evidence reproductions into tests asserting corrected behavior.

Run relevant unit/integration tests during development, regenerate API/sync/catalog bridges as applicable, then the normal pre-commit gate including lint, strict types, formatting, generated drift and required test/coverage targets. Run frontend builds and browser/mobile scenarios for affected flows; run PowerSync projection/end-to-end tests only when sync behavior or visibility changes. Avoid duplicating broad checks once the tested SHA is unchanged.

For deployment changes, build the real image and exercise hostname routes, runtime configuration and form POSTs. CI success is checked on the exact PR head; main CI and staging smoke are checked on the merged SHA. Production uses its existing release approval and migration rollout plan. No ordinary go authorizes bypassing that environment gate.

Definition of done: each R01–R08 has a corrected regression, code review and passing relevant CI; all known-gap tasks are implemented or explicitly deferred; all 51 historical IDs have a current disposition; accepted high/medium findings have no unresolved release blocker; migrations have approved impact/rollback and upgrade verification; every remaining item is listed with its reason and next evidence needed. Report commits/PRs, tests, deployments actually performed and unresolved items without claiming every product path was exercised.
