# Product hardening plan and findings

Status: implemented in [draft PR #26](https://github.com/nbaghiro/clientbridge/pull/26), pending final CI and QA. This is the single record for the current eight findings and all 51 findings from the earlier codebase review. [QA and results](qa.md) contains verification, rollout checks and remaining manual acceptance.

The earlier review examined `7ec6612e`; this execution started from `964e5427` and rebased onto `0927f649`. Historical file/line references below identify the reviewed snapshot, not current line numbers. Original execution logs remain in git history and local scratchpad; this document replaces the separate codebase-review plan, task queue and progress files.

## Change groups

| Group | Implemented behavior |
| --- | --- |
| Payments and stock | Serialized command replay, stable retry keys, shared refund/credit-note/ledger handling, derived stock holds, abandoned-intent cancellation and late/unfulfillable payment refunds. |
| Delivery and SMS | Durable settlement/refund, merchant-booking, manual-form, trial and admin delivery intent; fenced worker claims and callbacks; test-send history; dedicated business numbers and retired ownership protection. Other scheduled notification paths retain their existing per-item status markers. |
| Documents | Version-bound contract signing and stale-consent reset; immutable form definitions, typed answers and signature evidence. |
| Clients and subscriptions | Normalized contact locks and ambiguity rejection; merge/money coordination; refreshed plan/seat locks, distinct checkout attempts and safe replacement subscriptions. |
| Security and integrations | Shared Redis limits, trusted proxy parsing, manager-only gift-card codes, bounded Stripe calls, lifecycle-managed HTTP pools, nonblocking storage operations. |
| UI and performance | Batched pickup/held-order queries, async race guards, inbox timestamps, long visits, move/undo, public-calendar retry, mobile inbox virtualization and Canadian zones. |
| Admin and deployment | Client-related activity, admin image/runtime/origin routing, and bounded marketing contact handling. |

## Execution sequence

The implementation ran in dependency batches: preserve existing work and reproduce defects; approve concrete schema changes; fix replay and document integrity; implement stock/delivery/SMS; consolidate refunds and plan races; address client, UI, security and measured performance gaps; validate deployment and reconcile every finding. All changes are on `hardening/product-invariants`; commit subjects are single-line, pushes are grouped, and the PR remains a draft until acceptance. No production deployment, provider provisioning or merge is included.

Preserved scope: ledger facts remain authoritative; no stored paid/balance counters; only hours are offline writable; bookings and notes remain online-only; full money sync is deliberate. Keep layer-first code and shared app-core view models, with files split by concept.

## Current findings R01–R08

### R01 Online shop can sell the last unit twice

High at review; implemented.

Observed: Two customers open checkout while stock is 1; both subsequently pay. The reproduced final stock is −1.

Root cause: The shop checks stock_on_hand but does not reserve quantity. Settlement later deducts stock without checking availability. A row lock at checkout alone would not fix the gap between checkout and settlement.

Fix: Derive holds from existing lines, active payments and stock movements under ordered locks. Cancel provider intents before releasing holds; refund late or unfulfillable online settlements. Preserve intentional in-person negative stock when no other checkout is holding it.

Acceptance: Two checkouts for one unit; duplicate webhook; expired checkout; payment after expiry; simultaneous checkout and stock correction.

Evidence: API reproduction: test_shop_oversells_last_unit. Sources: `backend/src/clientbridge/services/public.py:1846`, `backend/src/clientbridge/services/inventory.py:92`.

### R02 A signature can attest to contract text the client never saw

High at review; implemented.

Observed: Client loads version 1. The owner publishes version 2. Signing from the still-open page succeeds and stores version 2.

Root cause: The request carries name, strokes and consent, but no expected version/hash. The server snapshots the current contract body at submit time, rather than checking the version displayed.

Fix: Bind the signing request to the displayed immutable version or content hash. Lock/conditionally transition the pending signature, reject stale content, and require review and consent again after a version change.

Acceptance: Load v1 → publish v2 → sign must reject or sign an explicitly preserved v1; concurrent sign/decline; replay after success.

Evidence: API reproduction: test_contract_signs_text_not_seen. Sources: `backend/src/clientbridge/services/public.py:934`, `backend/src/clientbridge/schemas/contracts.py:55`, `frontend/packages/app-core/src/domain/publicContract.ts:23`.

### R03 Payment receipts can disappear permanently during a provider outage

Medium at review; implemented.

Observed: Email sending fails while processing a successful payment. The webhook still returns success; replaying that event after recovery never retries the receipt.

Root cause: Payment settlement marks the webhook processed before notification. Notification helpers swallow send exceptions, and no durable delivery work remains to retry. Keeping settlement committed is correct; losing delivery intent is the gap.

Fix: Persist notification intent in the settlement transaction, then dispatch and retry it independently with stable delivery keys. Track per-channel outcomes so retries do not repeat already-successful sends. The same mechanism now covers merchant-booking and manual-form notifications, trial reminders and admin tests; it is not a claim that every outbound path was migrated.

Acceptance: Provider unavailable then recovers; worker crash before/after provider acceptance; duplicate event; independent email/SMS outcomes.

Evidence: API reproduction: test_settlement_notification_is_lost_on_outage. Sources: `backend/src/clientbridge/services/payments.py:1439`, `backend/src/clientbridge/api/webhooks.py:42`, `backend/src/clientbridge/services/notifications.py:1564`.

### R04 Intake form requirements are not enforced end to end

Medium at review; implemented.

Observed: A form configured to require a signature accepts an unsigned submission. A required rating also accepts an arbitrary JSON object and unknown answer keys are persisted.

Root cause: require_signature is saved by the editor but absent from the public contract and submit checks. validate_answers only checks whether required values are absent or empty.

Fix: Implement signature capture and server validation together. Validate each field type, allowed options, lengths/ranges and recognized keys; keep upload ownership checks.

Acceptance: Unsigned required-signature form; wrong scalar/object types; unknown choices/keys; required checkbox semantics; malformed uploads; valid typed answers.

Evidence: API reproductions: test_required_form_signature_is_not_enforced; test_form_accepts_invalid_answer_types. Sources: `backend/src/clientbridge/services/public.py:1117`, `backend/src/clientbridge/services/public.py:1138`, `backend/src/clientbridge/schemas/forms.py:49`.

### R05 Editing a form changes the meaning of historical responses

Medium at review; implemented.

Observed: A client submits “Peanuts” for “Allergies”. The owner changes that question to “Emergency contact”. The completed response now resolves the new label while retaining the old answer.

Root cause: Responses store answer keys but no question/version snapshot. The editor mutates or deletes the shared field rows, and public context reads the current form fields.

Fix: Version the form definition or snapshot the exact questions, labels, options and requirements used by each response. Existing responses must continue to render their original schema; new requests use the new version.

Acceptance: Edit label/type/options; delete a field; remove and recreate the same name; historical response/export still shows the original question and answer.

Evidence: API reproduction: test_form_edit_changes_submitted_question. Sources: `backend/src/clientbridge/services/forms.py:113`, `backend/src/clientbridge/services/public.py:1037`, `backend/src/clientbridge/models/documents.py:73`.

### R06 A successful payment cannot reliably be replayed with its original key

Medium at review; implemented.

Observed: A full cash payment succeeds. The exact same body/key retried after a lost response returns 409 instead of the original success.

Root cause: record_invoice_payment calls assert_payable before run_command checks the saved response. The first attempt has already made the invoice paid, so the retry never reaches replay.

Fix: After authentication and resource authorization, perform same-key/request replay before mutable business-state validation. Put payable/balance checks in the transactional execution path. Audit other mutation entry points and retain frontend attempt keys across ambiguous failures.

Acceptance: Full and partial payments; network response loss; changed request with the same key; cross-tenant attempts; no duplicate ledger/payment rows.

Evidence: API reproduction: test_full_payment_retry_is_refused. Sources: `backend/src/clientbridge/services/payments.py:250`, `backend/src/clientbridge/core/command.py:155`, `frontend/packages/app-core/src/domain/payments.ts:288`.

### R07 The merged admin app is absent from the production deployment

Medium at review; implemented.

Observed: The frontend image builds/copies web, Connect and site only. There is no admin host route, and the main app’s admin login destination defaults to localhost:8711.

Root cause: Admin implementation and infrastructure were developed on separate branches; the combined main does not connect the new surface to the deployment contract. Admin API/web URLs also use only build-time env defaults rather than deployed runtime config.

Fix: Add admin build artifacts, a dedicated host with DNS/certificate/Gateway/Caddy routing, runtime API/web/admin URLs, the backend admin origin and server-side operator grants. Test the deployed login → authorization → admin flow.

Acceptance: Production-like image serves admin assets; signed-out redirects to real auth; non-admin denied; admin succeeds; cookie/CORS/origin checks; no localhost/base.invalid URLs.

Evidence: Static deployment-chain verification; no live environment probe. Sources: `frontend/Dockerfile:34`, `infra/pulumi/kubernetes/gateway.py:25`, `frontend/apps/web/src/config.ts:7`, `frontend/apps/admin/src/config.ts:1`.

### R08 The contact form has no handler in the deployed site

Medium at review; implemented.

Observed: The rendered contact form posts to /contact, but the production image serves static files with Caddy and does not run the Node contact server.

Root cause: The working POST handler exists under apps/site/server. The deployed image copies dist assets only and has no reverse-proxy route to that handler. Architecture documentation already notes this deployment gap.

Fix: Deploy the existing handler or move it behind a dedicated API endpoint; wire the form action, provider settings, abuse controls and confirmation/error pages. Add a container-level POST test, rather than testing only the local Node server.

Acceptance: Submit against the production-like hostname/image; valid message reaches a fake sender; invalid/spam/rate-limited submissions; delivery failure renders retry.

Evidence: Static deployment-chain verification; previously documented gap. Sources: `frontend/apps/site/src/pages/Contact.tsx:19`, `frontend/apps/site/server/site.ts:255`, `frontend/Caddyfile:81`, `frontend/Dockerfile:41`.

## All prior findings and their resolution

These are the original review claims followed immediately by the current resolution. Previously fixed behavior is retained as a regression, not counted as a new fix. Historical severity does not assert that the issue remains present.

### H1

Fixed in `6b3966e3`: a failed send is no longer marked sent and is retried on the next run. Was: `Notifier._safe` logs and swallows every send failure, with no outbox or retry. The reminder job then sets `reminded_at`, so a failed reminder is never retried. The new trial email goes through the same path.

Historical evidence: `services/notifications.py:1090-1094`, `:727`; `services/bookings.py:2256-2258`

**Current resolution (implemented / regression retained):** Existing scheduled-job failure markers retained; payment, refund, booking, form, trial and admin intent now persists in deliveries.

### H2

Fixed in `6b3966e3`: each job commits after every send and the worker has a 900 s job timeout. Was: No `job_timeout` is set, so arq's 300 s default applies. The reminder, overdue and intake-form jobs send every message and commit their sent markers once at the end, so a crash or a long run resends to everyone already reached. Broadcasts are not affected; they commit per recipient.

Historical evidence: `tasks/worker.py:120-140`; `services/bookings.py:2235-2260`; `services/billing.py:602-624`; `services/forms.py:267-283`

**Current resolution (implemented / regression retained):** Existing per-item commits and 900-second worker timeout retained; fenced delivery claims cover interrupted sends.

### H3

All businesses share one SMS number. An inbound text goes to whichever business last texted that phone, and STOP applies only to that business, so CLI-45's done-when ("no reply can reach the wrong business") is not met. This blocks launch.

Historical evidence: `services/messaging.py:283-303`, `:306-320`; `.docs/launch-readiness.md:888-890`

**Current resolution (implemented / regression retained):** Dedicated business SMS number; destination-based inbound routing and retired-number ownership protection.

### M1

Credit note numbers are a count plus one, and a refund that fails after succeeding clears its number. The next refund collides with a number still in use: `refund_payment` returns 409 after Stripe has refunded, `refund_online_order` raises an IntegrityError, and the refund webhook fails on every Stripe retry, so the refund never reaches the ledger.

Historical evidence: `services/payments.py:1411-1426`, `:1566-1568`, `:610-618`, `:1597`, `:2626-2633`; `models/payments.py:51-57`

**Current resolution (implemented / regression retained):** Credit-note suffix uses maximum plus one under a document lock; failed reversals retain issued numbers.

### M2

The unpaid-order reaper cancels only `pending` intents before voiding the order. A declined intent stays confirmable at Stripe, settlement accepts `failed`, and the order status reads void, so a late retry charges the client for a void order and nothing flags it. The booking reaper cancels both.

Historical evidence: `services/orders.py:765-779`; `services/payments.py:1807`; `services/ledger.py:442`

**Current resolution (implemented / regression retained):** Order reaper cancels failed and pending intents; late successful payment is recorded and refunded.

### M3

A staff discount over the limit can never be approved in production. No app calls `POST /v1/orders/approval-pin`, only the demo seed writes a PIN, and `staff_discount_limit_bps` cannot be edited, so every business stays at 15%. `set_pin` also writes no audit row.

Historical evidence: `api/orders.py:106-110`; `services/orders.py:345-356`, `:461`, `:476-487`; `models/business.py:74-75`

**Current resolution (addressed by removal):** We dropped the feature: staff apply any discount up to the sale amount, and the approval PIN route, the limit, the PIN check and the order approver are gone, with `users.pin_hash`, `orders.approved_by` and `businesses.staff_discount_limit_bps` dropped in migration cb0013.

### M4

Stripe calls run inside database transactions that hold row and advisory locks: the three refund paths, the reaper, the deposit intent under the per-staff lock and pickup checkout under the business lock. The Stripe client keeps the SDK's default timeout and retries, so a Stripe slowdown blocks that member's bookings and holds connections.

Historical evidence: `services/payments.py:547`, `:585`; `services/public.py:344`, `:392-409`, `:1833-1845`; `integrations/stripe.py:625-630`

**Current resolution (implemented / regression retained):** Stripe requests use a bounded 10-second transport with no hidden network retries. Required money locks remain transactional.

### M5

New plan, invite and onboarding code holds `FOR UPDATE` on the business row across Stripe calls, and across an email send for invites. That lock conflicts with the `FOR KEY SHARE` every foreign-key insert takes, so all of the business's bookings, payments, ledger entries and webhook settlements wait on Stripe. `FOR NO KEY UPDATE` avoids the conflict.

Historical evidence: `services/plans.py:304-358`, `:366-376`, `:419-464`; `services/staff.py:128-147`, `:301-311`, `:356-366`; `services/payments.py:137-142`, `:720-726`

**Current resolution (implemented / regression retained):** Plan/staff/setup business locks use FOR NO KEY UPDATE and refresh current values.

### M6

An event on a business's previous plan subscription refunds every paid invoice on it and cancels it. When a new subscription is adopted after the old one went `unpaid`, the old one is never cancelled, so its next period roll triggers the refund branch.

Historical evidence: `services/plans.py:432-451`, `:452-461`, `:72`; `integrations/stripe.py:778-824`

**Current resolution (implemented / regression retained):** Replacement cancels the previous subscription; an older subscription event cannot refund its payment history.

### M7

Message and broadcast sends mint a new idempotency key on every call. A retry after a lost response sends the SMS again, or a second broadcast to the whole audience.

Historical evidence: `domain/messaging.ts:436`; `domain/broadcasts.ts:370-381`; `services/messaging.py:402-498`

**Current resolution (implemented / regression retained):** Message and broadcast action keys survive lost responses and reset for a changed request.

### M8

The Inbox side panel compares the replica's `YYYY-MM-DD HH:MM:SS+00` text against an ISO string with `T`, so every visit later today counts as past and the panel shows a later one.

Historical evidence: `domain/messaging.ts:85`, `:89`, `:307`; `domain/clients.ts:129-133` (correct `utcSql`)

**Current resolution (implemented / regression retained):** Inbox compares timestamps using the replica SQL representation.

### M9

Public book, reschedule, cancel and the shop order hand-roll replay instead of using `run_command`, and write no audit row. Two concurrent shop orders with the same key end in a 500 and leave a stray PaymentIntent.

Historical evidence: `services/public.py:277`, `:354`, `:720`, `:744`, `:1829`, `:1920`; `services/payments.py:1298`

**Current resolution (implemented / regression retained):** Public booking, reschedule, cancel and shop use audited run_command; matching requests serialize before side effects.

### M10

Client create and update take no idempotency key, and email and phone are not unique, so a double submit or a retry creates a duplicate client.

Historical evidence: `api/clients.py:20-25`, `:50-55`; `hooks.ts:32-59`

**Current resolution (implemented / regression retained):** Client create/update replay; normalized contact locks and explicit ambiguity rejection; merge locks and pending-money guard.

### M11

The rate limiter counts per process and keys on the leftmost `X-Forwarded-For`, which the client controls. The same value is stored as a contract signer's IP. No trusted-proxy configuration exists.

Historical evidence: `core/ratelimit.py:48-54`; `api/public.py:218`; `services/public.py:976`

**Current resolution (implemented / regression retained):** Redis-backed limits outside development and trusted-hop request IP parsing; shared admin limits.

### M12

Gift cards can be redeemed only standalone, by code, by an owner or admin, with no link to a sale. They cannot pay at checkout, online or by staff.

Historical evidence: `services/entitlements.py:167-179`; `api/entitlements.py:33-41`

**Current resolution (deliberate scope retained):** Gift-card split tender is a separate product capability, explicitly excluded by the approved hardening plan. Standalone manager redemption remains supported.

### M13

Gift card codes sync to every member's device, including staff and contractors, and work as bearer codes.

Historical evidence: `infra/powersync/sync-rules.yaml:27`

**Current resolution (implemented / regression retained):** Gift-card bearer codes are restricted to manager sync streams, matching redeem authorization.

### M14

The held-orders list evaluates the ledger status expression over every POS order the business has had, because paid sales stay `open`. Cost grows linearly to about a second after a year at a busy desk.

Historical evidence: `services/orders.py:301-315`; `services/ledger.py:436-446`

**Current resolution (implemented / regression retained):** Held-order ledger filtering aggregates cash/refund/deposit entries once per business; parity test retains ledger semantics.

### M15

`pickup_windows` runs about 150 to 200 queries per call (days by staff by hours), then again at checkout while holding the business advisory lock through the Stripe call. Repowise found this one too.

Historical evidence: `services/orders.py:675-722`; `services/public.py:1833-1845`

**Current resolution (implemented / regression retained):** Pickup schedule/count reads are batched: seeded regression measured 104 queries before, at most six after.

### M16

A new boto3 client is built on every request, including each public media redirect, and S3 `head_object` and `delete_object` block the event loop.

Historical evidence: `core/deps.py:31`; `integrations/s3.py:60`, `:68`, `:71-80`; `services/files.py:114-137`

**Current resolution (implemented / regression retained):** Storage adapter cached; blocking S3 head/delete calls run off the event loop.

### M17

Entries, payments, lines, signatures (with strokes), notes and consents sync with no time window. Full money sync is a deliberate choice, so this is a growth cost on first sync, not a defect.

Historical evidence: `infra/powersync/sync-rules.yaml:20-21`, `:45`, `:57`, `:73`, `:75`, `:78`, `:82`

**Current resolution (deliberate scope retained):** Full money sync is deliberate. No unapproved history window or ledger truncation was introduced.

### M18

Only hours are written offline, as documented, but the CLI-52 and CLI-54 QA expect an offline note to reach web. Either the QA or the offline scope needs a decision.

Historical evidence: `frontend/packages/sync/src/connector.ts:1`, `:28-31`; `.docs/launch-readiness.md:1031`

**Current resolution (implemented / regression retained):** Offline QA now tests hours; booking and notes are explicitly online-only.

### M19

No e2e flow visits Connect `/payment-method`, web `/auth-error` or the mobile Sign-in & security screen, and mobile onboarding is never submitted.

Historical evidence: `frontend/apps/web/e2e`, `frontend/apps/connect/e2e`, `frontend/apps/mobile/e2e/README.md:76`

**Current resolution (addressed; follow-up retained):** Auth-error and missing-bank-link browser regressions added and passed. Real bank/terminal flows and native security/onboarding are explicit manual QA; native automation expansion remains a follow-up.

### M20

Fixed in the docs rework that added this plan. Was: `architecture.md` and `CLAUDE.md` still describe JWT access and refresh tokens, `sessions` and `tokens` tables, and a localStorage token store. Kratos owns identity, neither table exists and web uses an HttpOnly cookie.

Historical evidence: `.docs/architecture.md:652-654`, `:667`, `:857`; `CLAUDE.md:51`

**Current resolution (implemented / regression retained):** Verified cookie/Kratos documentation; no duplicate auth rewrite.

### M21

Fixed in the docs rework that added this plan. Was: Other documentation no longer matches the code: 43 tables in 12 domains (doc says 39 in 11), soft delete also on `subjects`, eight jobs missing from the jobs list (including the two plan jobs), navigation missing the Payments, Inbox and Setup additions and the owner-only Plan section, the "one refund per payment" claim, CLI-45 still listing the Twilio signature check, `launch-readiness` listing shipped plan work as to do, and the `platform-billing` execution folder kept after it was implemented.

Historical evidence: `.docs/architecture.md:77`, `:154-157`, `:163`, `:184`, `:193`, `:247`, `:566`, `:731-735`; `.docs/launch-readiness.md:179-180`, `:890`

**Current resolution (implemented / regression retained):** Updated schema, delivery/jobs/SMS documentation; prior documentation corrections retained.

### L1

The refund Stripe key is built from the refund row count, so a direct API caller with no key, a rollback after the Stripe call and an early webhook can refund twice. The app always sends a stable key.

Historical evidence: `services/payments.py:584-590`, `:2540-2546`, `:2605-2611`; `domain/refunds.ts:314-318`

**Current resolution (implemented / regression retained):** Refund HTTP commands require a retry key; provider-reference reconciliation prevents duplicate refund rows.

### L2

A deposit refund that Stripe settles at once gets no credit note and no email; an online-order refund gets a note but no email.

Historical evidence: `services/payments.py:2547-2563`, `:2613-2629`, `:1562-1568`

**Current resolution (implemented / regression retained):** Deposit/order/manual refunds share credit-note creation, ledger application and durable receipt intent.

### L3

`payments.booking_id` has no index and `_has_open_deposit` skips `scoped()`. It runs only on deposit charges and no-show forfeits.

Historical evidence: `models/payments.py:45-57`; `services/bookings.py:936-946`

**Current resolution (addressed; follow-up retained):** Deposit lookup now uses scoped(). A booking_id index requires a concrete measured schema proposal, not an automatic model change.

### L4

Each inbound SMS runs `regexp_replace` over every client phone on the platform, then one query per match. Phones are stored as E.164, so an index is possible.

Historical evidence: `services/messaging.py:283-303`; `core/phones.py:34-38`

**Current resolution (implemented / regression retained):** Inbound candidates are scoped by assigned destination business before matching phone numbers.

### L5

Nightly reconcile loops over businesses serially with one commit at the end, and an uncaught Stripe error aborts the run.

Historical evidence: `services/ledger.py:1240-1262`

**Current resolution (implemented / regression retained):** Reconcile commits and isolates each business; one provider failure does not abort remaining businesses.

### L6

The email, SMS and push adapters open a new `httpx.AsyncClient` per message.

Historical evidence: `integrations/resend.py:72`; `twilio.py:43`; `expo.py:42`

**Current resolution (implemented / regression retained):** Email/SMS/push share a lifecycle-managed HTTP pool in API and worker; isolated calls close their temporary client.

### L7

Argon2 PIN checks run on the event loop, about 50 ms per manager.

Historical evidence: `core/security.py:21-25`; `services/orders.py:486-488`

**Current resolution (addressed by removal):** No PIN is hashed or checked any more (see M3), and the argon2 dependency is gone.

### L8

The 15-minute booking jobs and the intake-form job scan whole tables, since the indexes lead with `business_id` and Postgres 16 has no skip scan. The intake job also hand-writes its tenant filter.

Historical evidence: `services/bookings.py:2103-2250`; `services/forms.py:230-262`

**Current resolution (addressed; follow-up retained):** Intake tenant queries now use scoped(). Cross-tenant job indexes require production-shaped EXPLAIN evidence and separate schema approval.

### L9

POS cash, Tap to Pay and refund mint a new key per attempt. The backend rejects a cash or refund retry with 409 after success, and a Tap retry leaves an orphaned, uncaptured intent. No double charge.

Historical evidence: `domain/pos.ts:1096-1111`, `:2307-2311`

**Current resolution (implemented / regression retained):** POS cash/terminal/refund keys survive retries; unchanged saved sales are reused after ambiguous payment responses.

### L10

`useRemote` does not discard out-of-order responses, so the refund preview's tax split and the reports can lag.

Historical evidence: `hooks.ts:155-176`; `domain/refunds.ts:279-298`; `domain/plans.ts:247`, `:315`

**Current resolution (implemented / regression retained):** Remote hook generations discard stale completions.

### L11

`useAsyncAction.run` has no in-flight guard; a double tap before the re-render runs twice.

Historical evidence: `hooks.ts:31-60`

**Current resolution (implemented / regression retained):** Async actions have a synchronous in-flight guard.

### L12

Visits longer than about eight days drop out of the Schedule, agenda and checkout queue; the backend sets no maximum length.

Historical evidence: `domain/bookings.ts:248-255`; `schemas/catalog.py:29`, `:82`

**Current resolution (implemented / regression retained):** Calendar/agenda queries retain arbitrary-duration overlapping visits.

### L13

The inbox query has no limit, and mobile renders it with `ScrollView` instead of `FlatList`.

Historical evidence: `domain/messaging.ts:60-71`; `frontend/apps/mobile/src/screens/Inbox.tsx:173-206`

**Current resolution (addressed; follow-up retained):** Mobile inbox uses FlatList. SQL pagination/search redesign remains a measured-growth follow-up; no silent row cap hides old conversations.

### L14

A dragged visit that lands elsewhere keeps its pending position until unmount, and undo can race the first move.

Historical evidence: `domain/bookings.ts:731-866`

**Current resolution (implemented / regression retained):** Pending moves clear when outside the displayed window; undo becomes available only after a successful move.

### L15

A failed days load on public booking and manage shows no error.

Historical evidence: `domain/publicBooking.ts:478`, `:993`

**Current resolution (implemented / regression retained):** Public day-load failure and retry are distinct from slot-load errors.

### L16

The owner/admin check is hand-written four times in app-core; the invoice status SQL exists in the backend and app-core with no parity test; invoice numbers are optimistic while orders lock.

Historical evidence: `domain/payments.ts:55`; `staff.ts:463`; `pos.ts:607`, `:2113`; `services/ledger.py:396`; `domain/ledger.ts:44`

**Current resolution (implemented / regression retained):** Shared manager predicate; invoice numbering serialized; existing frontend/backend ledger-state tests retained and held-order parity added.

### L17

No API creates resources; the zone list lacks the non-DST areas of BC and Quebec (Creston, Dawson_Creek, Fort_Nelson, Atikokan, Blanc-Sablon); `audits` has no reader and no append-only trigger.

Historical evidence: `models/scheduling.py:142`; `core/zones.py:11-20`; `scripts/db_access.py:71`, `:128`

**Current resolution (addressed; follow-up retained):** Missing Canadian zones added; admin has bounded audit/client-related activity reads. Resources were removed from the product, so no resources API is needed; append-only audit triggers need concrete approval as required by the plan.

### L18

`POST /v1/connect/onboard` and `POST /v1/payments/pad-setup-intent/{id}` are called only by tests, and `clients.user_id` is unused but synced.

Historical evidence: `api/payments.py:38-45`, `:81`; `models/clients.py:41`

**Current resolution (addressed):** Admin person detail now reads Client.user_id. The two test-only routes were removed together with `GET /v1/tax-rates`, which also had no client caller.

### L19

Missing unit tests for the `hooks.ts` helpers, the `public*` hook logic and `files`, and a 401 test for `/v1/tax-rates`. `gettingPaid` gained tests in the Stripe work.

Historical evidence: `hooks.ts`; `backend/tests/test_catalog.py:72`

**Current resolution (implemented / regression retained):** Added hook races, public contract/form/day failures, file storage checks; existing integration coverage retained.

### L20

Seat decreases run after commit without the lock and can race an invite, leaving a seat unbilled until the daily seat sync.

Historical evidence: `services/staff.py:343-356`, `:501-502`; `services/plans.py:205-219`

**Current resolution (implemented / regression retained):** Seat release and daily synchronization lock/refetch the business before calculating seats.

### L21

`PlanWritable` loads the business before `with_for_update()`, which has no `populate_existing()`, so an invite can read a plan that changed in the same moment.

Historical evidence: `api/plans.py:46-57`; `services/staff.py:128-129`

**Current resolution (implemented / regression retained):** Locked plan reads refresh already-loaded rows.

### L22

Plan checkout reuses the client's idempotency key on a Stripe create whose parameters can change, and `IdempotencyError` becomes a 500 until the page reloads.

Historical evidence: `services/plans.py:332-349`; `domain/plans.ts:257-275`; `main.py:36-37`

**Current resolution (implemented / regression retained):** Checkout provider keys include effective parameters so a changed plan/seat/trial request gets a distinct attempt.

### L23

`run_trial_reminders` keeps no sent marker, so a retried run in the same hour emails the owner again.

Historical evidence: `services/plans.py:488-506`

**Current resolution (implemented / regression retained):** Trial reminders persist a stable scope and per-channel delivery intent.

### L24

Unused UI surface: `template="statement"`, `retryLabel` and `onPickAlt`/`altLabel` are never passed.

Historical evidence: `ui.ts:105`, `:874-875`, `:1011-1012`

**Current resolution (implemented / regression retained):** Removed unused retry-label/image-picker alternate actions and the unused statement print template from both UI contracts/renderers.

### L25

Fixed in the docs rework that added this plan. Was: Minor doc errors: 33 services (doc says 28), seven public limiters (doc says five), the pytest marker omits `not kratos`, no `shards` row in the CI table, `WRITE_POLICY` mentioned but absent.

Historical evidence: `.docs/architecture.md:77`, `:135`; `.docs/engineering.md:114`, `:199`, `:235`

**Current resolution (implemented / regression retained):** Prior documentation corrections retained; current changed surfaces documented.

### L26

The `ui.ts` comment says mobile ignores `allowBank`, but mobile offers "add bank" by creating a link the client completes on Connect `/payment-method`; the docs call PAD web only.

Historical evidence: `ui.ts:431`; `frontend/apps/mobile/src/components/ClientScreens.tsx:465`

**Current resolution (implemented / regression retained):** Mobile bank setup is documented as a Connect link, not a web-only feature.

### L27

`payments.py` has three separate refund paths that build rows, keys and credit notes differently; M1, L1 and L2 come from that. Repowise's low score for the file otherwise overstates it, since `_dispatch` is a flat switch.

Historical evidence: `services/payments.py:523-622`, `:2506-2567`, `:2570-2632`

**Current resolution (implemented / regression retained):** One refund builder applies provider results, credit notes, ledger transitions and delivery intent.

## Refuted claims

These 11 claims remain refuted unless new evidence changes the verdict. They are not executable cleanup tasks.
| Source   | Claim                                                                                                                       | Why it is not an issue                                                                                                                           |
| -------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Repowise | Rotate the credential in `scripts/seed_demo.py:57`                                                                          | It is the documented demo password, and the seed refuses to run outside dev with a local database.                                               |
| Repowise | Rotate the secret in `scripts/demo_engagement.py:510`                                                                       | It is a seed form token.                                                                                                                         |
| Repowise | Five dead-code candidates                                                                                                   | `embedLoader.ts` builds Connect's `embed.js` and is a knip entry; `frozen-clock.ts` is the vitest setup file; `theme` and `loadEmbeds` are used. |
| Repowise | Untested hotspots in site content and `Field`                                                                               | The site test and Playwright pass cover every page; `Field` is exercised by every web and Connect form.                                          |
| Repowise | `useDocComposer` duplication                                                                                                | Its two callers are the web and mobile `DocEditor`, the shared view-model the conventions require.                                               |
| Repowise | `payCode.ts`, `itemPayload`, `config.py`, `auth.py`, `remittances.py` refactor targets and the brain and large method flags | Flat or single-concept code; the repo splits by concept, not size.                                                                               |
| Ours     | Inbox next visit counts deleted bookings                                                                                    | The sync streams already filter `deleted_at`.                                                                                                    |
| Ours     | POS cash checkout and POS refund can double-charge or double-refund                                                         | The backend rejects the retry with 409 (now L9).                                                                                                 |
| Ours     | The discount limit fallback disagrees between app-core and the backend                                                      | The column defaults to 1500; the backend fallback applies only when the row is missing.                                                          |
| Ours     | `_open_deposit` uses the old account fields instead of `merchant_account()`                                                 | `stripe_charges_enabled` is false until the account has the merchant configuration.                                                              |
| Ours     | Gift card redemption has no path at all                                                                                     | It exists, standalone by code (now M12).                                                                                                         |

## Approved schema and rollout decisions

These proposals supersede the earlier S1–S4 designs. The user approved proceeding after reviewing the revised designs; implementation is now authorized. Minimize stored facts, retain necessary historical evidence, and use one-word names for new tables. JSON is for structured documents/transport payloads, not a way to conceal duplicated state or an unbounded relational history.

### S1 — Stock: reuse existing tables

Withdraw the proposed `stock_reservations` table. Derive held quantities from checkout orders, their lines, payment lifecycle and recorded sale movements. Lock item rows in a consistent order when checking availability and creating holds; apply the same rule to every stock-consuming path. Settlement must remove the derived hold and record the sale atomically. A deadline makes a checkout eligible for cancellation; it does not itself release stock while a provider can still collect payment.

No schema change proposed. Prove concurrent checkout/POS, retries, cancellation failures, late settlement and no-double-counting with tests. Audit existing pending orders before enabling enforcement. Any measured index requirement is a separate concrete proposal.

### S2 — One durable deliveries table

Approved revised design after the schema discussion: one server-only `deliveries` table, no attempts table or JSON attempt history. Columns: prefixed `id` primary key; nullable `business_id` FK; required unique `key`; required immutable typed JSONB `payload` (recipient/channel/rendered content and necessary metadata); required checked `state` (queued/sending/accepted/delivered/failed/ambiguous); nullable timestamptz `next_at` (retry/lease deadline); nullable text `claim` (worker fencing token); nullable `provider_ref`; nullable safe `error` code; required `created_at` timestamp. Due-work index on next_at for eligible rows, provider-reference lookup index, and business/time index. No attempt count, payload hash, actor copy, updated_at, or separate attempts table. Admin initiation is attributable through the immutable payload’s trusted actor tag; platform test messages have no business to attach to the tenant-only audits table. Full network attempt history is deliberately out of scope.

Worker claims commit before external I/O; completion checks its fencing token. Expired sends are ambiguous and are not blindly retried. Acceptance is not delivery. Data impact: additive empty table, new events only, no historical resends; excluded from PowerSync. Rollback stops dispatch and retains pending/ambiguous records. No live external sends are authorized by schema approval.

### S3 — Forms: two columns on responses

- `definition`: required JSONB structured snapshot containing provenance (`issued` or `reconstructed`), form name, signature requirement and ordered field definitions/validation. Provenance belongs to the snapshot and is not a separate column.
- `signature`: nullable JSONB signature evidence: signer name, IP and optional normalized drawing strokes. Typed/drawn presentation is derived from validated evidence shape. Signing occurs atomically with submission, so the existing submitted_at is the signing timestamp.

Remove definition_hash (compute when needed) and definition_provenance columns. Do not duplicate submitted_at inside signature. Snapshot content cannot be derived from a form that is later edited, so it must remain stored. Existing signatures are contract-specific with a required contract FK; generalizing them would introduce optional relationships and touch unrelated contract behavior merely to avoid this one field.

Data impact: preserve answers unchanged. Backfill existing response definitions from current forms and mark all such snapshots reconstructed, including previously issued drafts whose original wording is unknown. Newly issued responses use issued provenance. Historical unsigned submissions remain unsigned; do not fabricate evidence. Enforce signatures on new submissions under the captured definition. Keep new evidence server-only unless an explicit safe read projection is approved.

Rollback: retain captured evidence; pause submissions if reverting would discard or bypass it. No destructive downgrade.

### S4 — SMS: one column on businesses

- `sms_number`: nullable normalized E.164 text with a unique constraint/index (multiple nulls allowed).

Withdraw sms_assignments. The current integration uses one configured Twilio account and one assigned sending number per business. Resolve inbound To against sms_number after validating provider credentials/signature, then find From only inside that business. Outbound routing reads the same assignment. The existing contact phone, where present elsewhere, is not the sending-number assignment.

No stored provider account/number ID (not needed for the current send/routing path), active flag (derive from null/non-null), activation timestamps or separate assignment history table. Record provisioning/removal in existing business audits with old/new numbers. Numbers cannot be transferred between businesses in this scope: retired ownership must be checked from audit history under a number-specific lock before assignment, preventing delayed/retried inbound events from being silently rerouted to a different tenant. If number reuse or multiple provider accounts becomes necessary, reconsider a dedicated ownership model then.

Data impact: existing businesses get null, no shared-number backfill. Unassigned SMS sending fails explicitly. Provider provisioning is separate; no purchases or releases are authorized here. Existing messages/consents remain intact. Exclude sms_number from device projections unless a specific UI needs it. Rollback disables affected SMS, retains assignments/audits and never restores cross-tenant last-sender routing.

### Approval scope

Approved revised proposal: one new table (`deliveries`), two columns on responses and one column on businesses. No stock table, no duplicate derived counters/hashes/status copies. The user’s subsequent instruction to proceed follows the concrete schema review and approval of the single-table delivery design. S1 requires no schema change. Additional schema outside S2/S3/S4 remains a separate decision.

## Remaining work and deliberate limits
These are not silently closed as fixed:

- **M19:** Auth-error and missing-bank-link browser regressions added and passed. Real bank/terminal flows and native security/onboarding are explicit manual QA; native automation expansion remains a follow-up.
- **L3:** Deposit lookup now uses scoped(). A booking_id index requires a concrete measured schema proposal, not an automatic model change.
- **L8:** Intake tenant queries now use scoped(). Cross-tenant job indexes require production-shaped EXPLAIN evidence and separate schema approval.
- **L13:** Mobile inbox uses FlatList. SQL pagination/search redesign remains a measured-growth follow-up; no silent row cap hides old conversations.
- **L17:** Missing Canadian zones added; admin has bounded audit/client-related activity reads. Resources were removed from the product, so no resources API is needed; append-only audit triggers need concrete approval as required by the plan.

Additional schema approval is required before adding indexes or append-only triggers. Gift-card tender needs a separate product design. Manual device/provider QA remains part of the handoff; passing browser tests does not claim native or live-provider validation.

The existing sync fixes (`ec3fd669`) and admin foundation (`6baf5ed7`) are retained and verified rather than reimplemented. Admin activity projects recorded audits and related entities; it does not fabricate missing history. Delivery acceptance differs from delivery confirmation, and uncertain provider acceptance is not retried blindly.

## Completion criteria

Every R01–R08 and H/M/L ID must have a resolution above. Required local and remote checks must pass on the published head; QA must cover relevant happy paths, rejection, tenancy/roles, retry and concurrency. New schema outside the approved changes requires a concrete decision. Native hardware, real provider settlement and production rollout cannot be certified by browser or fake-provider tests; record their limits in [QA](qa.md).
