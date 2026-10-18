# Historical review reconciliation

All 51 findings from the 13 October review are retained below. The implementation verdicts and retained follow-ups now live in [Finding disposition](disposition.md); the table below preserves the original planning snapshot. The old severity belongs to that snapshot, not a new severity verdict on current main. Preserve the historical queue as evidence; use this execution queue for work after its approval. Reproduce or inspect current code before promoting an old claim to an implementation task.

| Prior ID | Current planning disposition | Execution task | Prior task |
| --- | --- | --- | --- |
| H1 | Previously fixed for scheduled jobs; verify regression. Durable delivery remains P05. | P05 | T01 |
| H2 | Previously fixed for scheduled jobs; verify regression. Durable delivery remains P05. | P05 | T01 |
| H3 | Current shared-number routing confirmed; known launch gap. | P08 | T02 |
| M1 | Needs current-main verification | P02/P06 | T03 |
| M2 | Needs current-main verification | P02/P04 | T04 |
| M3 | Needs current-main verification | P11 | T07 |
| M4 | Needs current-main verification | P02/P06 | T05 |
| M5 | Needs current-main verification | P02/P06 | T05 |
| M6 | Needs current-main verification | P02/P06 | T06 |
| M7 | Needs current-main verification | P03 | T08 |
| M8 | Needs current-main verification | P11 | T15 |
| M9 | Needs current-main verification | P03/P04 | T09 |
| M10 | Needs current-main verification | P03 | T08 |
| M11 | Split: trusted-hop IP parsing now exists; distributed limiter still missing. Recheck deployment trust. | P08 | T10 |
| M12 | Needs current-main verification | P11 | T11 |
| M13 | Needs current-main verification | P08 | T11 |
| M14 | Needs current-main verification | P10 | T13 |
| M15 | Needs current-main verification | P10 | T13 |
| M16 | Needs current-main verification | P10 | T13 |
| M17 | Needs current-main verification | P10 | T14 |
| M18 | Needs current-main verification | P11 | T00 |
| M19 | Needs current-main verification | P12 | T16 |
| M20 | Previously documented fixed; check documentation drift only. | P12 | T17 |
| M21 | Previously documented fixed; check documentation drift only. | P12 | T17 |
| L1 | Needs current-main verification | P06 | T03 |
| L2 | Needs current-main verification | P05/P06 | T03 |
| L3 | Needs current-main verification | P10 | T13 |
| L4 | Needs current-main verification | P08/P10 | T02 |
| L5 | Needs current-main verification | P05/P10 | T13 |
| L6 | Needs current-main verification | P10 | T13 |
| L7 | Needs current-main verification | P10 | T13 |
| L8 | Needs current-main verification | P10 | T13 |
| L9 | Needs current-main verification | P03 | T08 |
| L10 | Needs current-main verification | P11 | T15 |
| L11 | Needs current-main verification | P03 | T08 |
| L12 | Needs current-main verification | P11 | T15 |
| L13 | Needs current-main verification | P10/P11 | T15 |
| L14 | Needs current-main verification | P11 | T15 |
| L15 | Needs current-main verification | P11 | T15 |
| L16 | Needs current-main verification | P06/P11 | T15 |
| L17 | Split: admin now reads audits. Recheck resource CRUD, zones, audit immutability separately. | P08/P11 | T12 |
| L18 | Needs current-main verification | P11 | T12 |
| L19 | Needs current-main verification | P12 | T16 |
| L20 | Needs current-main verification | P06 | T06 |
| L21 | Needs current-main verification | P06 | T05 |
| L22 | Needs current-main verification | P03/P06 | T06 |
| L23 | Needs current-main verification | P05 | T01 |
| L24 | Needs current-main verification | P11 | T12 |
| L25 | Previously documented fixed; check documentation drift only. | P12 | T17 |
| L26 | Needs current-main verification | P11 | T12 |
| L27 | Needs current-main verification | P06 | T03 |

## Original claims and evidence

### H1

Fixed in `6b3966e3`: a failed send is no longer marked sent and is retried on the next run. Was: `Notifier._safe` logs and swallows every send failure, with no outbox or retry. The reminder job then sets `reminded_at`, so a failed reminder is never retried. The new trial email goes through the same path.

Historical evidence: `services/notifications.py:1090-1094`, `:727`; `services/bookings.py:2256-2258`

### H2

Fixed in `6b3966e3`: each job commits after every send and the worker has a 900 s job timeout. Was: No `job_timeout` is set, so arq's 300 s default applies. The reminder, overdue and intake-form jobs send every message and commit their sent markers once at the end, so a crash or a long run resends to everyone already reached. Broadcasts are not affected; they commit per recipient.

Historical evidence: `tasks/worker.py:120-140`; `services/bookings.py:2235-2260`; `services/billing.py:602-624`; `services/forms.py:267-283`

### H3

All businesses share one SMS number. An inbound text goes to whichever business last texted that phone, and STOP applies only to that business, so CLI-45's done-when ("no reply can reach the wrong business") is not met. This blocks launch.

Historical evidence: `services/messaging.py:283-303`, `:306-320`; `.docs/launch-readiness.md:888-890`

### M1

Credit note numbers are a count plus one, and a refund that fails after succeeding clears its number. The next refund collides with a number still in use: `refund_payment` returns 409 after Stripe has refunded, `refund_online_order` raises an IntegrityError, and the refund webhook fails on every Stripe retry, so the refund never reaches the ledger.

Historical evidence: `services/payments.py:1411-1426`, `:1566-1568`, `:610-618`, `:1597`, `:2626-2633`; `models/payments.py:51-57`

### M2

The unpaid-order reaper cancels only `pending` intents before voiding the order. A declined intent stays confirmable at Stripe, settlement accepts `failed`, and the order status reads void, so a late retry charges the client for a void order and nothing flags it. The booking reaper cancels both.

Historical evidence: `services/orders.py:765-779`; `services/payments.py:1807`; `services/ledger.py:442`

### M3

A staff discount over the limit can never be approved in production. No app calls `POST /v1/orders/approval-pin`, only the demo seed writes a PIN, and `staff_discount_limit_bps` cannot be edited, so every business stays at 15%. `set_pin` also writes no audit row.

Historical evidence: `api/orders.py:106-110`; `services/orders.py:345-356`, `:461`, `:476-487`; `models/business.py:74-75`

### M4

Stripe calls run inside database transactions that hold row and advisory locks: the three refund paths, the reaper, the deposit intent under the per-staff lock and pickup checkout under the business lock. The Stripe client keeps the SDK's default timeout and retries, so a Stripe slowdown blocks that member's bookings and holds connections.

Historical evidence: `services/payments.py:547`, `:585`; `services/public.py:344`, `:392-409`, `:1833-1845`; `integrations/stripe.py:625-630`

### M5

New plan, invite and onboarding code holds `FOR UPDATE` on the business row across Stripe calls, and across an email send for invites. That lock conflicts with the `FOR KEY SHARE` every foreign-key insert takes, so all of the business's bookings, payments, ledger entries and webhook settlements wait on Stripe. `FOR NO KEY UPDATE` avoids the conflict.

Historical evidence: `services/plans.py:304-358`, `:366-376`, `:419-464`; `services/staff.py:128-147`, `:301-311`, `:356-366`; `services/payments.py:137-142`, `:720-726`

### M6

An event on a business's previous plan subscription refunds every paid invoice on it and cancels it. When a new subscription is adopted after the old one went `unpaid`, the old one is never cancelled, so its next period roll triggers the refund branch.

Historical evidence: `services/plans.py:432-451`, `:452-461`, `:72`; `integrations/stripe.py:778-824`

### M7

Message and broadcast sends mint a new idempotency key on every call. A retry after a lost response sends the SMS again, or a second broadcast to the whole audience.

Historical evidence: `domain/messaging.ts:436`; `domain/broadcasts.ts:370-381`; `services/messaging.py:402-498`

### M8

The Inbox side panel compares the replica's `YYYY-MM-DD HH:MM:SS+00` text against an ISO string with `T`, so every visit later today counts as past and the panel shows a later one.

Historical evidence: `domain/messaging.ts:85`, `:89`, `:307`; `domain/clients.ts:129-133` (correct `utcSql`)

### M9

Public book, reschedule, cancel and the shop order hand-roll replay instead of using `run_command`, and write no audit row. Two concurrent shop orders with the same key end in a 500 and leave a stray PaymentIntent.

Historical evidence: `services/public.py:277`, `:354`, `:720`, `:744`, `:1829`, `:1920`; `services/payments.py:1298`

### M10

Client create and update take no idempotency key, and email and phone are not unique, so a double submit or a retry creates a duplicate client.

Historical evidence: `api/clients.py:20-25`, `:50-55`; `hooks.ts:32-59`

### M11

The rate limiter counts per process and keys on the leftmost `X-Forwarded-For`, which the client controls. The same value is stored as a contract signer's IP. No trusted-proxy configuration exists.

Historical evidence: `core/ratelimit.py:48-54`; `api/public.py:218`; `services/public.py:976`

### M12

Gift cards can be redeemed only standalone, by code, by an owner or admin, with no link to a sale. They cannot pay at checkout, online or by staff.

Historical evidence: `services/entitlements.py:167-179`; `api/entitlements.py:33-41`

### M13

Gift card codes sync to every member's device, including staff and contractors, and work as bearer codes.

Historical evidence: `infra/powersync/sync-rules.yaml:27`

### M14

The held-orders list evaluates the ledger status expression over every POS order the business has had, because paid sales stay `open`. Cost grows linearly to about a second after a year at a busy desk.

Historical evidence: `services/orders.py:301-315`; `services/ledger.py:436-446`

### M15

`pickup_windows` runs about 150 to 200 queries per call (days by staff by hours), then again at checkout while holding the business advisory lock through the Stripe call. Repowise found this one too.

Historical evidence: `services/orders.py:675-722`; `services/public.py:1833-1845`

### M16

A new boto3 client is built on every request, including each public media redirect, and S3 `head_object` and `delete_object` block the event loop.

Historical evidence: `core/deps.py:31`; `integrations/s3.py:60`, `:68`, `:71-80`; `services/files.py:114-137`

### M17

Entries, payments, lines, signatures (with strokes), notes and consents sync with no time window. Full money sync is a deliberate choice, so this is a growth cost on first sync, not a defect.

Historical evidence: `infra/powersync/sync-rules.yaml:20-21`, `:45`, `:57`, `:73`, `:75`, `:78`, `:82`

### M18

Only hours are written offline, as documented, but the CLI-52 and CLI-54 QA expect an offline note to reach web. Either the QA or the offline scope needs a decision.

Historical evidence: `frontend/packages/sync/src/connector.ts:1`, `:28-31`; `.docs/launch-readiness.md:1031`

### M19

No e2e flow visits Connect `/payment-method`, web `/auth-error` or the mobile Sign-in & security screen, and mobile onboarding is never submitted.

Historical evidence: `frontend/apps/web/e2e`, `frontend/apps/connect/e2e`, `frontend/apps/mobile/e2e/README.md:76`

### M20

Fixed in the docs rework that added this plan. Was: `architecture.md` and `CLAUDE.md` still describe JWT access and refresh tokens, `sessions` and `tokens` tables, and a localStorage token store. Kratos owns identity, neither table exists and web uses an HttpOnly cookie.

Historical evidence: `.docs/architecture.md:652-654`, `:667`, `:857`; `CLAUDE.md:51`

### M21

Fixed in the docs rework that added this plan. Was: Other documentation no longer matches the code: 43 tables in 12 domains (doc says 39 in 11), soft delete also on `subjects`, eight jobs missing from the jobs list (including the two plan jobs), navigation missing the Payments, Inbox and Setup additions and the owner-only Plan section, the "one refund per payment" claim, CLI-45 still listing the Twilio signature check, `launch-readiness` listing shipped plan work as to do, and the `platform-billing` execution folder kept after it was implemented.

Historical evidence: `.docs/architecture.md:77`, `:154-157`, `:163`, `:184`, `:193`, `:247`, `:566`, `:731-735`; `.docs/launch-readiness.md:179-180`, `:890`

### L1

The refund Stripe key is built from the refund row count, so a direct API caller with no key, a rollback after the Stripe call and an early webhook can refund twice. The app always sends a stable key.

Historical evidence: `services/payments.py:584-590`, `:2540-2546`, `:2605-2611`; `domain/refunds.ts:314-318`

### L2

A deposit refund that Stripe settles at once gets no credit note and no email; an online-order refund gets a note but no email.

Historical evidence: `services/payments.py:2547-2563`, `:2613-2629`, `:1562-1568`

### L3

`payments.booking_id` has no index and `_has_open_deposit` skips `scoped()`. It runs only on deposit charges and no-show forfeits.

Historical evidence: `models/payments.py:45-57`; `services/bookings.py:936-946`

### L4

Each inbound SMS runs `regexp_replace` over every client phone on the platform, then one query per match. Phones are stored as E.164, so an index is possible.

Historical evidence: `services/messaging.py:283-303`; `core/phones.py:34-38`

### L5

Nightly reconcile loops over businesses serially with one commit at the end, and an uncaught Stripe error aborts the run.

Historical evidence: `services/ledger.py:1240-1262`

### L6

The email, SMS and push adapters open a new `httpx.AsyncClient` per message.

Historical evidence: `integrations/resend.py:72`; `twilio.py:43`; `expo.py:42`

### L7

Argon2 PIN checks run on the event loop, about 50 ms per manager.

Historical evidence: `core/security.py:21-25`; `services/orders.py:486-488`

### L8

The 15-minute booking jobs and the intake-form job scan whole tables, since the indexes lead with `business_id` and Postgres 16 has no skip scan. The intake job also hand-writes its tenant filter.

Historical evidence: `services/bookings.py:2103-2250`; `services/forms.py:230-262`

### L9

POS cash, Tap to Pay and refund mint a new key per attempt. The backend rejects a cash or refund retry with 409 after success, and a Tap retry leaves an orphaned, uncaptured intent. No double charge.

Historical evidence: `domain/pos.ts:1096-1111`, `:2307-2311`

### L10

`useRemote` does not discard out-of-order responses, so the refund preview's tax split and the reports can lag.

Historical evidence: `hooks.ts:155-176`; `domain/refunds.ts:279-298`; `domain/plans.ts:247`, `:315`

### L11

`useAsyncAction.run` has no in-flight guard; a double tap before the re-render runs twice.

Historical evidence: `hooks.ts:31-60`

### L12

Visits longer than about eight days drop out of the Schedule, agenda and checkout queue; the backend sets no maximum length.

Historical evidence: `domain/bookings.ts:248-255`; `schemas/catalog.py:29`, `:82`

### L13

The inbox query has no limit, and mobile renders it with `ScrollView` instead of `FlatList`.

Historical evidence: `domain/messaging.ts:60-71`; `frontend/apps/mobile/src/screens/Inbox.tsx:173-206`

### L14

A dragged visit that lands elsewhere keeps its pending position until unmount, and undo can race the first move.

Historical evidence: `domain/bookings.ts:731-866`

### L15

A failed days load on public booking and manage shows no error.

Historical evidence: `domain/publicBooking.ts:478`, `:993`

### L16

The owner/admin check is hand-written four times in app-core; the invoice status SQL exists in the backend and app-core with no parity test; invoice numbers are optimistic while orders lock.

Historical evidence: `domain/payments.ts:55`; `staff.ts:463`; `pos.ts:607`, `:2113`; `services/ledger.py:396`; `domain/ledger.ts:44`

### L17

No API creates resources; the zone list lacks the non-DST areas of BC and Quebec (Creston, Dawson_Creek, Fort_Nelson, Atikokan, Blanc-Sablon); `audits` has no reader and no append-only trigger.

Historical evidence: `models/scheduling.py:142`; `core/zones.py:11-20`; `scripts/db_access.py:71`, `:128`

### L18

`POST /v1/connect/onboard` and `POST /v1/payments/pad-setup-intent/{id}` are called only by tests, and `clients.user_id` is unused but synced.

Historical evidence: `api/payments.py:38-45`, `:81`; `models/clients.py:41`

### L19

Missing unit tests for the `hooks.ts` helpers, the `public*` hook logic and `files`, and a 401 test for `/v1/tax-rates`. `gettingPaid` gained tests in the Stripe work.

Historical evidence: `hooks.ts`; `backend/tests/test_catalog.py:72`

### L20

Seat decreases run after commit without the lock and can race an invite, leaving a seat unbilled until the daily seat sync.

Historical evidence: `services/staff.py:343-356`, `:501-502`; `services/plans.py:205-219`

### L21

`PlanWritable` loads the business before `with_for_update()`, which has no `populate_existing()`, so an invite can read a plan that changed in the same moment.

Historical evidence: `api/plans.py:46-57`; `services/staff.py:128-129`

### L22

Plan checkout reuses the client's idempotency key on a Stripe create whose parameters can change, and `IdempotencyError` becomes a 500 until the page reloads.

Historical evidence: `services/plans.py:332-349`; `domain/plans.ts:257-275`; `main.py:36-37`

### L23

`run_trial_reminders` keeps no sent marker, so a retried run in the same hour emails the owner again.

Historical evidence: `services/plans.py:488-506`

### L24

Unused UI surface: `template="statement"`, `retryLabel` and `onPickAlt`/`altLabel` are never passed.

Historical evidence: `ui.ts:105`, `:874-875`, `:1011-1012`

### L25

Fixed in the docs rework that added this plan. Was: Minor doc errors: 33 services (doc says 28), seven public limiters (doc says five), the pytest marker omits `not kratos`, no `shards` row in the CI table, `WRITE_POLICY` mentioned but absent.

Historical evidence: `.docs/architecture.md:77`, `:135`; `.docs/engineering.md:114`, `:199`, `:235`

### L26

The `ui.ts` comment says mobile ignores `allowBank`, but mobile offers "add bank" by creating a link the client completes on Connect `/payment-method`; the docs call PAD web only.

Historical evidence: `ui.ts:431`; `frontend/apps/mobile/src/components/ClientScreens.tsx:465`

### L27

`payments.py` has three separate refund paths that build rows, keys and credit notes differently; M1, L1 and L2 come from that. Repowise's low score for the file otherwise overstates it, since `_dispatch` is a flat switch.

Historical evidence: `services/payments.py:523-622`, `:2506-2567`, `:2570-2632`

## Refuted claims

The 11 refuted claims in [the historical review](../codebase-review/plan.md#refuted-findings) remain refuted unless new evidence changes the verdict. They are not cleanup or credential-rotation tasks. In particular, seeded demo passwords/tokens are not evidence of exposed production credentials, and existing refund retry errors must not be described as demonstrated duplicate charges.

Do not carry forward earlier proposals blindly: exactly-once external delivery is not generally achievable without provider support; do not backfill one shared SMS number into a unique per-business assignment; do not add stored money balances or a paid marker in conflict with ledger ownership; approve schema changes explicitly.
