# Finding disposition

All 51 historical IDs are accounted for below. Local automated gates pass; remote CI and manual QA remain pending. The approved plan separates correctness fixes from new product scope and additional schema proposals.

| ID | Disposition | Evidence / decision |
| --- | --- | --- |
| H1 | Implemented / regression retained | Existing scheduled-job failure markers retained; payment, refund, booking, form, trial and admin intent now persists in deliveries. |
| H2 | Implemented / regression retained | Existing per-item commits and 900-second worker timeout retained; fenced delivery claims cover interrupted sends. |
| H3 | Implemented / regression retained | Dedicated business SMS number; destination-based inbound routing and retired-number ownership protection. |
| M1 | Implemented / regression retained | Credit-note suffix uses maximum plus one under a document lock; failed reversals retain issued numbers. |
| M2 | Implemented / regression retained | Order reaper cancels failed and pending intents; late successful payment is recorded and refunded. |
| M3 | Implemented / regression retained | Web/mobile discount ceiling and PIN setup share a hook; PIN changes audited, hashing offloaded and guesses limited. |
| M4 | Implemented / regression retained | Stripe requests use a bounded 10-second transport with no hidden network retries. Required money locks remain transactional. |
| M5 | Implemented / regression retained | Plan/staff/setup business locks use FOR NO KEY UPDATE and refresh current values. |
| M6 | Implemented / regression retained | Replacement cancels the previous subscription; an older subscription event cannot refund its payment history. |
| M7 | Implemented / regression retained | Message and broadcast action keys survive lost responses and reset for a changed request. |
| M8 | Implemented / regression retained | Inbox compares timestamps using the replica SQL representation. |
| M9 | Implemented / regression retained | Public booking, reschedule, cancel and shop use audited run_command; matching requests serialize before side effects. |
| M10 | Implemented / regression retained | Client create/update replay; normalized contact locks and explicit ambiguity rejection; merge locks and pending-money guard. |
| M11 | Implemented / regression retained | Redis-backed limits outside development and trusted-hop request IP parsing; shared PIN/admin limits. |
| M12 | Deliberate scope retained | Gift-card split tender is a separate product capability, explicitly excluded by the approved hardening plan. Standalone manager redemption remains supported. |
| M13 | Implemented / regression retained | Gift-card bearer codes are restricted to manager sync streams, matching redeem authorization. |
| M14 | Implemented / regression retained | Held-order ledger filtering aggregates cash/refund/deposit entries once per business; parity test retains ledger semantics. |
| M15 | Implemented / regression retained | Pickup schedule/count reads are batched: seeded regression measured 104 queries before, at most six after. |
| M16 | Implemented / regression retained | Storage adapter cached; blocking S3 head/delete calls run off the event loop. |
| M17 | Deliberate scope retained | Full money sync is deliberate. No unapproved history window or ledger truncation was introduced. |
| M18 | Implemented / regression retained | Offline QA now tests hours; booking and notes are explicitly online-only. |
| M19 | Addressed; follow-up retained | Auth-error and missing-bank-link browser regressions added and passed. Real bank/terminal flows and native security/onboarding are explicit manual QA; native automation expansion remains a follow-up. |
| M20 | Implemented / regression retained | Verified cookie/Kratos documentation; no duplicate auth rewrite. |
| M21 | Implemented / regression retained | Updated schema, delivery/jobs/SMS documentation; prior documentation corrections retained. |
| L1 | Implemented / regression retained | Refund HTTP commands require a retry key; provider-reference reconciliation prevents duplicate refund rows. |
| L2 | Implemented / regression retained | Deposit/order/manual refunds share credit-note creation, ledger application and durable receipt intent. |
| L3 | Addressed; follow-up retained | Deposit lookup now uses scoped(). A booking_id index requires a concrete measured schema proposal, not an automatic model change. |
| L4 | Implemented / regression retained | Inbound candidates are scoped by assigned destination business before matching phone numbers. |
| L5 | Implemented / regression retained | Reconcile commits and isolates each business; one provider failure does not abort remaining businesses. |
| L6 | Implemented / regression retained | Email/SMS/push share a lifecycle-managed HTTP pool in API and worker; isolated calls close their temporary client. |
| L7 | Implemented / regression retained | PIN hashing and verification run in a worker thread. |
| L8 | Addressed; follow-up retained | Intake tenant queries now use scoped(). Cross-tenant job indexes require production-shaped EXPLAIN evidence and separate schema approval. |
| L9 | Implemented / regression retained | POS cash/terminal/refund keys survive retries; unchanged saved sales are reused after ambiguous payment responses. |
| L10 | Implemented / regression retained | Remote hook generations discard stale completions. |
| L11 | Implemented / regression retained | Async actions have a synchronous in-flight guard. |
| L12 | Implemented / regression retained | Calendar/agenda queries retain arbitrary-duration overlapping visits. |
| L13 | Addressed; follow-up retained | Mobile inbox uses FlatList. SQL pagination/search redesign remains a measured-growth follow-up; no silent row cap hides old conversations. |
| L14 | Implemented / regression retained | Pending moves clear when outside the displayed window; undo becomes available only after a successful move. |
| L15 | Implemented / regression retained | Public day-load failure and retry are distinct from slot-load errors. |
| L16 | Implemented / regression retained | Shared manager predicate; invoice numbering serialized; existing frontend/backend ledger-state tests retained and held-order parity added. |
| L17 | Addressed; follow-up retained | Missing Canadian zones added; admin has bounded audit/client-related activity reads. Resource management is separate product scope; append-only audit triggers need concrete approval as required by the plan. |
| L18 | Deliberate scope retained | Admin person detail now reads Client.user_id. Public API routes remain supported even where the app chooses a hosted setup flow; absence of one frontend caller is not proof of dead API. |
| L19 | Implemented / regression retained | Added hook races, public contract/form/day failures, file storage checks and anonymous tax-rate regression; existing integration coverage retained. |
| L20 | Implemented / regression retained | Seat release and daily synchronization lock/refetch the business before calculating seats. |
| L21 | Implemented / regression retained | Locked plan reads refresh already-loaded rows. |
| L22 | Implemented / regression retained | Checkout provider keys include effective parameters so a changed plan/seat/trial request gets a distinct attempt. |
| L23 | Implemented / regression retained | Trial reminders persist a stable scope and per-channel delivery intent. |
| L24 | Implemented / regression retained | Removed unused retry-label/image-picker alternate actions and the unused statement print template from both UI contracts/renderers. |
| L25 | Implemented / regression retained | Prior documentation corrections retained; current changed surfaces documented. |
| L26 | Implemented / regression retained | Mobile bank setup is documented as a Connect link, not a web-only feature. |
| L27 | Implemented / regression retained | One refund builder applies provider results, credit notes, ledger transitions and delivery intent. |

## Remaining follow-ups

These are not silently closed as fixed:

- **M19:** Auth-error and missing-bank-link browser regressions added and passed. Real bank/terminal flows and native security/onboarding are explicit manual QA; native automation expansion remains a follow-up.
- **L3:** Deposit lookup now uses scoped(). A booking_id index requires a concrete measured schema proposal, not an automatic model change.
- **L8:** Intake tenant queries now use scoped(). Cross-tenant job indexes require production-shaped EXPLAIN evidence and separate schema approval.
- **L13:** Mobile inbox uses FlatList. SQL pagination/search redesign remains a measured-growth follow-up; no silent row cap hides old conversations.
- **L17:** Missing Canadian zones added; admin has bounded audit/client-related activity reads. Resource management is separate product scope; append-only audit triggers need concrete approval as required by the plan.

Additional schema approval is required before adding indexes or append-only triggers. Gift-card tender and resource CRUD need a separate product design. Manual device/provider QA remains part of the handoff; passing browser tests does not claim native or live-provider validation.

## Current review findings

R01–R08, stable package consumption, durable admin history/deduplication, SMS tenancy and bounded provider/client activity projections are implemented. See progress.md for tests and qa.md for the manual acceptance sequence. No production rollout, provider purchases, or unsolicited real email sends were performed.
