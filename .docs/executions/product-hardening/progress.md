# Product hardening progress

Execution authorized directly on main, all pushes held until the end. Manual QA and final commit breakdown come after implementation and automated validation. No commits or pushes made.

Baseline: 964e5427. Preserved previous root work in `.scratchpad/hardening-backup-20261017-211914` and a named Git stash; restored the unique booking comment after fast-forward.

First batch in progress:
- R06: failing full-payment replay test now passes; mutable payable validation moved inside command execution under invoice lock.
- R02: failing unseen-contract-version test now passes; signing binds the displayed version, locks content/signature, and stale-client reload clears consent. Broader concurrency coverage remains.
- L10/L11: failing React tests now pass for stale remote response ordering and immediate duplicate-action prevention.
- Package consumption: failing transport test established the missing attempt key; shared detail hook now retains the key across ambiguous retries.
- Backend targeted integration suite: 92 passed. App-core full suite pending; final gates not yet run.

Red/green logs are in root `.scratchpad/hardening-*.log`. S3 form schema approval was requested asynchronously; no schema edits made. Remaining plan tasks are not complete.

Additional verified work:
- M1: credit-note maximum numbering and retention after failure; reproduced collision, 30 refund tests passed.
- M2/M10: cancel failed as well as pending payment intents before expiring unpaid orders; replay/audit client creation. 34 targeted tests passed.
- M7/M8: stable message and broadcast retry keys; corrected inbox UTC comparisons with a failing replica regression.
- M5/L21: non-key business locks and refreshed locked reads; original two-connection lock regression passed. Public API variant initially failed because its setup changed a unique account key; corrected setup rerun pending.
- M6: cancel a prior unpaid subscription when adopting its replacement; red/green regression and 59 plan tests passed. Older pre-fix provider subscription history still needs review.
- L12: removed unsupported one-week overlap assumption; preserved starts_at upper-bound index use. Checkout's start-day scope is separate and has not been changed.
- R04 validation: six invalid-answer regressions failed first, then 40 form tests passed. Signature enforcement/snapshots remain pending S3.
- R07/R08: admin build/runtime/host/origin wiring, configurable operator grant IDs, API-backed contact delivery and shared local adapter. 102 infrastructure and 24 site tests passed. Real Docker image admin/app/config routes returned 200; contact honeypot POST returned 303 without sending mail.
- M11: independent limiter instance regression failed first; deployed public limits now use atomic Redis counters. Nine rate-limit tests passed; final typing/routing checks are running.

Latest full backend run: 2015 passed, 3 failures (two admin-origin expectation updates and one lock-test setup issue); this is not a passing final gate. Fixes are in place and affected suites are rerunning. Latest app-core: 426 passed. No new schemas, migrations, commits, pushes, live deployments or external messages performed. Schema approval requests S1/S2/S3/S4 remain pending. Remaining historical items have not yet all been reconciled.


Latest continuation:
- L15: public booking availability failures now show an error and retry instead of an empty week. Red regression recorded; 13 tests pass. Added manage-page day/slot failure coverage; rerun pending.
- M16: cached S3 adapter and moved head/delete network calls to worker threads, including public form upload completion. Regression authored before change, but its red run could not reach tests because local Postgres disconnected during fixture migration. Verification pending.
- M3/L7 partial: approval PIN updates now write a secret-free audit; PIN hashing/verification is off the event loop. Audit regression authored first, but could not execute because Postgres remains in recovery. Configuration UI and distributed PIN limit remain outstanding.
- Local infrastructure blocker: Postgres repeatedly enters recovery (data-directory fsync stalls and server child reinitialization). Stopped only the temporary hardening web container; did not restart/delete databases or disturb other projects. Backend reruns were infrastructure failures, not passing/failing product regressions. Frontend runs are substantially slower too.
- No schema changes, commits or pushes. This is not QA-ready; all remaining registry items and S1–S4 approvals still apply.

Public booking/manage verification completed: 15 tests pass, including failed day and slot fetches and successful retry. Ruff passes for storage/PIN changes. Final static checks pending. Do not interpret the completed subset as completion of the full plan.

Schema proposals revised after user requested minimal tables/columns: S1 uses existing order/line/payment/movement facts; S2 uses deliveries + attempts with derived summaries; S3 adds definition + signature only; S4 adds businesses.sms_number only. Previous four-table proposal superseded. Revised schema approval remains pending; no model or migration edits. See schema-decisions.md for constraints, data impact and rollback.

## Current continuation (supersedes earlier pending-approval and infrastructure status)

S1–S4 revised schemas approved after the single-delivery-table discussion. Added only deliveries, response definition/signature, and business sms_number; migrations exercised on disposable Docker Postgres databases. Dev data has not been reset. Final workflow is a new branch, focused commits and one draft PR, with pushing only at the end.

Verified: forms 74 backend tests plus signature-consent UI test; admin/delivery/SMS 66 backend tests; admin UI 7 tests after two red regressions; trial reminders 61 plan tests after duplicate-job red regression. SMS assignment protection passed in the admin suite. Public booking/manage/shop now use audited commands; same-key commands serialize before side effects. Public/reconciliation batch passed 73 existing tests with only the newly added stock-hold red regression failing. Reconciliation now isolates provider failure and commits each business; its fixture needed explicit merchant setup.

Stock enforcement derives holds from existing unpaid/partially paid document lines and active payment attempts, locks parent/items, and excludes recorded sale movements. Product/shop/POS/payment batch passed 102 tests; the preexisting intentional negative-stock test is being replaced to match the approved prevention requirement. Cross-connection, late-settlement and broader regression verification remain pending.

Admin email UI retains request IDs after ambiguous failure, guards synchronous double submit, reports queued states accurately, and lists persisted delivery history. Backend SMS assignment normalizes numbers and audits changes, preventing reassignment to another business using retired audit history. Shared command handling, POS retries, seat decrease locks and document numbering changes need final regression review.

Separate PR24 review (head 8a6c9a91): one confirmed P2 paid-order notification timestamp issue; 59 frontend tests, TypeScript, 2 backend receipt tests passed. Review isolated in .scratchpad/review-pr24-peer; no comments or changes posted to that PR.

Not QA-ready: outstanding registry items, complete delivery integration, refund consolidation/late-settlement handling, additional concurrency/migration tests, frontend gates and final full backend/CI remain. No hardening commits, push, branch switch or PR yet.

## Continuation: refund, stock, delivery, and growth regressions

- Consolidated manual, deposit and online-order refunds through `create_refund`; credit notes and durable refund receipts now follow the same settlement path. Refund API requires a retry key. 65 focused tests passed.
- Late settlement of a void online order is recorded and automatically refunded with a stable provider key and an audit event; pickup stays closed. 30 order/refund tests passed.
- Historical plan subscriptions are cancelled without refunding pre-replacement payment history. Subscription creation times come from Stripe, not a new column. Daily seat synchronization now locks, refreshes and commits each business independently. Unassigned SMS verification rejects before creating a challenge. 75 tests passed.
- Pickup availability measured 104 queries in the seeded scenario; batching schedules/exceptions/counts reduces this to at most six. Pickup and delivery race batch: 16 tests passed.
- Added real two-connection stock contention, worker contention, callback-fencing and transaction-rollback tests. Stock/contact batch: 66 passed. Contact lookup now serializes normalized contacts and rejects ambiguous matches.
- Booking creation and manual form sends now enqueue notifications in their command transaction and dispatch after commit. Booking/form/notification batch: 111 passed. Added provider-outage recovery test for form delivery.
- Existing-data form backfill is exercised through the real migration against temporary tables using the migration role; 51 follow-up tests passed, including the backfill, form/delivery tests and Stripe adapter tests.
- Mobile Inbox now uses FlatList. Client merge retains its retry key. Added client locks and pending-payment merge protection; focused verification is running.
- Auth-error and missing bank-setup-link browser regressions both pass. Updated offline QA to exercise supported hours edits rather than unsupported offline notes.
- App-core: 433 tests passed in the configured timezone runs. Infra: 102 passed. Site browser suite: 67 passed. All production builds passed.
- First complete backend gate: 2045 passed, two test-harness failures, 93.29% branch coverage. The failures were an unscoped delivery count and a migration-test function rename during the running suite; both corrected, follow-up tests pass. A final complete rerun remains required after the last edits.
- All changes remain local and uncommitted. No hardening branch or PR has been created, and this is not yet ready for QA. Per-finding final disposition, final gates and branch/commit/push remain outstanding.

## Draft PR handoff, 2026-10-18

This entry supersedes the earlier pending implementation, branch and validation status. All approved implementation is collected on `hardening/product-invariants`; manual QA and remote CI remain release gates. See disposition.md for intentional scope and remaining follow-ups.

- Final backend gate: 2,054 passed, 31 deselected, 94.11% branch coverage against a disposable Docker Postgres database. HTTP pool lifecycle and Twilio authentication regressions pass.
- Held-order reads now aggregate ledger facts per business; seeded parity tests pass. Stock correction before settlement refunds the unfulfillable order. Client money locking and related admin activity regressions pass.
- Local development migrations advanced cb0008 to cb0011 without a reset or reseed. SMS assignments remain explicit; existing data was preserved.
- Frontend UI cleanup removes unused alternate image actions, retry labels and statement print layout. Final frontend/static/generated/build validation is recorded below once complete.
- Prior focused acceptance: 102 infrastructure tests, 67 site browser tests, and the auth-error and missing-bank-link browser regressions passed. Native and live-provider checks remain manual.
- PR24 review is separate from this changeset. Its P2 notification timestamp finding was posted inline at https://github.com/nbaghiro/clientbridge/pull/24#discussion_r4305655981.

Commit groups: backend invariants and API/sync contracts; shared UI and admin workflows; admin/contact deployment; finding reconciliation and QA documentation. The final combined tree is validated before publication; the PR remains a draft for manual QA.

Final local checks passed: formatting, lint/strict type checks, generated-code drift, frontend tests (433 app-core tests in each of three additional time zones, 17 API-client, 5 mobile, 24 site), and all four production builds. The full backend and infrastructure suites cited above cover unchanged backend/infra code. Checks were run once against the complete tree before splitting commits; per-commit hook reruns are skipped to avoid repeating the same full suites for packaging-only commits. Remote CI will validate the published head.
