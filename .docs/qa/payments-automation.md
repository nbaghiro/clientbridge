# Payments QA automation plan

Status: **proposed execution plan, not an installed workflow**, 2026-10-18.
Scope and stable scenario IDs: [payments checklist](payments.md).

Use the existing Clientbridge Stripe platform sandbox, with **two dedicated CI connected accounts**
and dedicated platform-billing fixtures. Keep the human demo accounts for manual QA. Local database
rollback cannot roll back Stripe; sharing a merchant with humans would make schedule, balance and
subscription assertions unreliable. No production schema changes are needed for this test harness.

## Existing infrastructure to extend

| Area                                                     | Current behavior                                                                                   | Required extension                                                                                                |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`                               | Backend/Postgres regressions, stripe-mock contract job, frontend checks and real app browser jobs. | Preserve these PR gates; add a separate opt-in sandbox workflow after local proof.                                |
| `backend/tests/e2e/test_stripe_e2e.py` and `conftest.py` | Real Stripe adapter tests; missing credentials/account can skip tests.                             | Audit fixture ownership/idempotency, fail-closed CI preflight, lifecycle cleanup and additional state assertions. |
| `frontend/apps/web/e2e/paymentAccount.e2e.ts`            | Aborts Connect JS loading to test application error/navigation behavior.                           | Keep it; add real provider scenarios that load Stripe through authenticated app pages.                            |
| Web and Connect `playwright.config.ts`                   | Existing production-preview CI servers, failure traces/screenshots; videos off.                    | Dedicated sandbox project with one worker, separate fixture accounts and passing-run videos.                      |
| Admin                                                    | No dedicated Playwright project identified in this checkout.                                       | Reuse existing browser fixtures with an admin server/project and actual admin login.                              |
| `frontend/apps/mobile/e2e/`                              | Existing Maestro flows and Android emulator CI.                                                    | Extend native flows; retain assisted iOS/physical reader coverage.                                                |

Do not invoke unqualified `make test-e2e` in the Stripe-only lane: it can also select email-provider
tests. Select the Stripe file explicitly initially, then add a focused target using the same local/CI
command. Existing `STRIPE_TEST_SECRET_KEY` and `STRIPE_TEST_CONNECTED_ACCOUNT` are the starting fixture
contract; name and validate the second account and expected platform explicitly in the harness.

## CI lanes

| Lane              | Trigger                                                | Coverage and result                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deterministic     | Every PR and main push                                 | R coverage for every checklist ID, existing stripe-mock contracts, web/Connect error/navigation tests and native smoke. Required merge checks; no sandbox secrets.                     |
| Sandbox smoke     | Initially `workflow_dispatch` on reviewed trusted code | SET-02/04/05, OUT-01/02/03, COL-01/02/03, REC-01/02/04/08 and OPS-03 through actual apps/API; recorded successful flows. Promote to scheduled main runs after stable repetition.       |
| Sandbox lifecycle | Manual and later scheduled main                        | Remaining S/B variants, Test Clocks, asynchronous debits, disputes, recovery and platform billing. Longer bounded polling; explicit unsupported-state results.                         |
| Assisted release  | Before sign-off                                        | Initial terms/verification, blocked third-party authentication, physical Terminal, wallets/iOS and any unsupported sandbox lifecycle variant. Record separately from automated passes. |

Do not run secrets against arbitrary fork code or use `pull_request_target` to check out untrusted PR
code. A protected GitHub environment controls the sandbox key. A trusted-branch check may be added
later, but the baseline PR gate must remain runnable without live provider credentials.

## Execution batches

### 1. Establish reproducible fixtures and readiness

- Inventory existing tests against every checklist ID/variant; retain useful regression tests and add
  missing happy, 4xx, isolation and idempotency cases. Record test paths in the result manifest.
- Provision CI merchants A/B with the application's existing Accounts v2 responsibilities and currency.
  Reuse `backend/scripts/stripe_setup.py` where appropriate; do not change account configuration merely
  to avoid provider verification. An operator completes required terms and verification once.
- Verify test mode via key type and provider `livemode`, expected platform/account IDs, ownership
  metadata, capabilities, bank destination, currency and API version. Require explicit readiness;
  missing credentials, disabled charges or skipped selected tests fail the sandbox lane.
- Start disposable Postgres, Redis, storage, auth, API and PowerSync using existing CI setup; seed
  isolated application businesses/users mapped only to CI accounts. Use fresh data for financial flows.
- Assign a run namespace (workflow run ID + attempt, or a local random ID) to provider metadata and
  scenario idempotency keys. Preserve the same key for retries of a logical operation, not unrelated runs.

Done when setup/re-run is repeatable, both merchants are ready, tenant gates pass and human demo state
is untouched. Initial onboarding is a dependency, not an automatically passing setup test.

### 2. Connect real, isolated webhook delivery

- Run authenticated Stripe CLI forwarding to the runner-local API for the snapshot and thin event
  paths required by the application. Supply the CI secret noninteractively; never copy a developer CLI
  profile. Mask generated signing secrets and wait for listener readiness before starting tests.
- Filter sandbox event routing to owned CI connected accounts and run-owned platform customer-account
  fixtures. Preserve raw bytes and genuine signature verification; resolve thin event ownership through
  Stripe where necessary. Test that unrelated human/demo events cannot mutate the test application.
- Account for the sandbox-wide event stream and recovery listings, not just browser requests. Keep
  workers limited to the CI businesses/fixtures; prove global replay cannot import unrelated activity.
- Use real application commands and genuine resulting provider events for end-to-end success. Artificial
  events belong to regression coverage; CLI-generated unrelated objects do not prove product fulfillment.
- Exercise missing delivery and retry with a controlled relay. Run actual recovery/reconciliation job
  bodies deterministically rather than sleeping for their 15-minute/nightly schedule.

Done when a fresh app payment settles through a signed event, duplicates are harmless, a withheld event
is repaired and an unrelated sandbox event is ignored without bypassing application authorization.

### 3. Automate core browser flows and recordings

- Extend existing web/Connect fixtures, using actual login, business selection and production-preview
  builds. Add one admin project using the same fixture conventions. Keep files grouped by concept.
- Implement SET, OUT and COL-01 through COL-06 first, then refunds/admin investigation. Select embedded
  Stripe controls through supported browser/frame locators; do not patch provider internals or disable
  Stripe authentication. Unsupported verification/CAPTCHA is an assisted blocker, not a bypass.
- For each mutation assert UI completion, retrieved Stripe object account/Customer/amount/status,
  application product state and expected ledger deltas. Wait for bounded observable state transitions,
  not fixed sleeps. Separate provider-processing timeout from an application assertion failure.
- Snapshot and restore schedule settings. Prepare payout funds using supported sandbox payment fixtures,
  poll available funds and prevent automatic scheduling from consuming the fixture balance mid-test.
  Compare balance deltas with a baseline; an enduring CI account will not start at zero each run.
- Explicitly configure passing-run video recording and close contexts so files finalize. Record real
  page interactions rather than the isolated development component harness.

Done when the smoke lane passes repeatedly with artifacts, no unexplained reconciliation differences,
no cross-account effect and verified cleanup. A successful CLI schedule change alone cannot pass OUT-01.

### 4. Cover asynchronous lifecycles and recovery

- Add COL-07 through COL-10, REC-03 through REC-08 and OPS-01/02/04. Use supported Stripe test payment
  methods, simulated readers and compatible Test Clocks; confirm support for the current Accounts v2
  billing model before choosing clock-based fixtures.
- Cover every payout/dispute/debit status deterministically at R; exercise at S only where Stripe can
  produce it reproducibly. Document the unsupported variants without reporting fabricated provider passes.
- Reconcile source transaction IDs, fees and currencies after each scenario and after replay. Compare
  current provider subscription state after stale delivery. Assert unsupported adjustments are reported,
  not hidden by balancing entries.
- Capture notifications with the existing fake/test transport. A separate explicitly enabled inbox test
  can verify actual delivery after the recipient is agreed; it must not message demo/customer addresses.

Done when every S variant is implemented or has a documented provider limitation and assisted procedure.

### 5. Native, resilience and release sign-off

- Extend existing Maestro Android flows for OPS-06 and supported collection paths. Add recordings using
  the native runner's recording support; Playwright only proves browser behavior.
- Complete OPS-05/07, accessibility/navigation checks and device-specific assisted cases. Review failed
  and flaky cases at their root cause; retries cannot silently convert money discrepancies into success.
- Run the complete matrix at one commit, publish an evidence index and carry remaining blockers to launch
  readiness. Only then promote the stable sandbox subset to a scheduled workflow.

## Shared sandbox controls and cleanup

Start with one sandbox job and one browser worker. Use a constant workflow concurrency group across
branches with `cancel-in-progress: false`; ordinary per-ref CI concurrency does not protect a shared
merchant. GitHub concurrency is repository-scoped and is not a durable FIFO queue. Reserve these
accounts exclusively for this repository's CI; local runs either use their own accounts or acquire the
same explicit lease before mutation. Do not assume GitHub concurrency locks out a developer's CLI.

Maintain a run manifest of created objects and original mutable settings. Cleanup runs in `finally` and
an `always()` workflow step: restore schedules, cancel owned test subscriptions, remove supported owned
temporary objects and verify the result. Stripe objects cannot all be deleted or rolled back; retain their
IDs and completed disposition. Never delete a shared merchant, its bank or an object without ownership
proof. On interrupted runs, the next preflight detects an unfinished manifest and restores or fails before
new mutations. A scheduled sweeper must use the same ownership checks and exclusive lock.

Apply bounded retries only to safe reads or idempotent logical operations. Rate-limit the harness and
retain initial failures. Read balances before and after the scenario, account for provider settlement and
automatic payouts, and do not assume payout finalization occurs immediately in sandbox.

## Secrets and evidence

Proposed protected configuration: Stripe sandbox secret key, test publishable key, expected platform ID,
CI connected account A/B IDs and ordinary local application test configuration. Account IDs can be
variables; secret/signing keys stay server-side. Use the account's supported pinned API version and
pinned existing tool versions. No real credentials, session secrets or Account Session client secrets in
committed fixtures or artifacts.

For each run produce a machine-readable manifest and HTML index mapping checklist variant → test →
result → video/screenshot → Stripe IDs and sanitized ledger/assertion summary. Include commit, run,
tool versions, timestamp, account aliases and cleanup result. Keep artifacts private with explicit
retention (initially seven days for routine runs, thirty for release recordings). Durable docs link the
run and note artifact expiry; renew reference recordings when behavior changes.

Videos are supporting evidence, not accounting assertions. Use only synthetic data. Do not inherit
raw trace uploads blindly: network traces can contain auth tokens and Stripe secrets even when logs are
masked. Keep raw traces restricted locally by default; upload only inspected/sanitized evidence. Record
successful flows with video enabled, failure screenshots and sanitized diagnostics; finalize contexts
before collecting artifacts. See [Playwright video behavior](https://playwright.dev/docs/videos).

## Remaining investigations before implementation

1. Complete the two CI merchants' initial onboarding and verify embedded authentication can operate on
   an ephemeral CI browser without an operator; otherwise separate the assisted flow explicitly.
2. Verify thin/snapshot CLI forwarding and ownership filtering with the actual endpoint configuration,
   including platform customer-account events and sandbox-wide recovery reads.
3. Confirm supported sandbox funding, payout-status triggers, PAD timing, dispute fixtures and Test Clock
   compatibility; retain deterministic regressions for provider states that cannot be forced.
4. Map exact existing scenario tests and identify current admin/native UI capabilities before promising
   coverage of controls the product does not yet expose.
5. Confirm CI artifact privacy, fixture cleanup after cancellation and the dedicated-account lease policy.

References: [Stripe Connect testing](https://docs.stripe.com/connect/testing),
[Accounts v2 configuration](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration),
[payout schedules](https://docs.stripe.com/connect/manage-payout-schedule),
[Playwright CI](https://playwright.dev/docs/ci-intro), and
[GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

## Review follow-up

Implementation status after the review-fix follow-ups (2026-10-18):

| Finding                                                 | Status                                         | Regression / next action                                                                                                                      |
| ------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Listed event version mismatch and stale outcome         | Fixed                                          | `test_payments_recovery.py`: old-version success/failure snapshots retrieve the current successful payment and its actual charge date.        |
| Transient recovery timing                               | Implemented across recovery and source reconciliation | Fees unavailable defer without failing the job; the next run retries. Durable deferred-source checkpoints remain outstanding. |
| Customer creation parameter drift                       | Fixed                                          | `test_payments_gateway.py`: rename retries use identical create parameters and update the same Customer separately.                           |
| Old recovery receipts                                   | Fixed for routine notifications                | Old charges settle without receipt delivery; recent recovery still queues delivery. Gift-card issuance is preserved.                          |
| Unbounded payout history read                           | Capped                                         | Adapter reads the latest 24 payouts. A full history/detail pagination feature remains separate.                                               |
| Circular ledger/payment dependency                      | Fixed                                          | Payments owns repair orchestration; ledger owns journal operations.                                                                           |
| Standalone Stripe fees                                  | Fixed for `stripe_fee` transactions            | Debit and credit transactions post once by provider transaction ID.                                                                           |
| Bounded reconciliation, event replay and pending sweeps | Pending schema approval / implementation       | Durable checkpoints, fair batches, unresolved-source retries and method-aware retry windows.                                                  |
| Drift acknowledgement and consolidated alerts | Implemented; regression gate passed | Existing append-only audits deduplicate unchanged findings, record platform-admin acknowledgement and reopen changed/resolved findings. Removed duplicate aggregate alert; no balancing journal or schema addition. |
| Orphan and PAD refund completeness | Regression implemented; sandbox evidence pending | Audited orphan charges/refunds/returned fees journal once without recognizing a sale. `pyr_` sources supported; actual PAD refund format still needs sandbox verification. |
| Payout transit accounting                               | Pending schema approval / implementation       | Add the transit category, then correct journals/reports and test ordering, failures and historical repair.                                    |
| Payout contents and adapter result validation | Implemented; regression gate passed | Typed automatic-payout transactions, 24-row cursor pages, tenant/role gates and explicit pending/manual states; web/mobile share the hook. Malformed payout responses return 502. |

Do not treat this branch as merge-ready until these remaining findings are resolved and the full gate
is rerun. The schema proposals are a server-only `checkpoints` table and the `transit` account-category
constraint addition; no models or migrations have been changed for them without approval.

Automation should start with regression coverage above, then dedicated sandbox fixture setup and
signed-event isolation (batches 1–2). First real-app recordings should cover invoice payment, delayed
webhook recovery, refund, payout scheduling and a funded payout with matching reports. Expand to
membership/PAD/dispute lifecycles only after the core fixtures clean up reliably. Keep manual onboarding,
provider-dependent states and physical devices explicitly separate from CI passes.

Validation for this batch: `make check` passed with 2,113 backend tests (93.41% coverage),
498 frontend tests plus app-core timezone reruns, and 102 infrastructure tests. The separate Stripe
contract suite passed 34 tests against stripe-mock. Old-version replay, stale receipt, Customer retry
and standalone fee regressions were observed failing before their fixes. These results do not represent
a live sandbox payout or completion of the remaining review items.


## Follow-up execution evidence — 2026-10-18

The follow-up adds `GET /v1/connect/payouts/{id}/transactions?after=...` and the platform-only
`POST /admin/v1/businesses/{business_id}/drift/{finding_id}/acknowledge` (body: `reason`).
Acknowledgements preserve money and the original finding; changing its amounts or transaction IDs
creates a new finding. Only identical, acknowledged findings stop alerting. Successful repair records
resolution. Event recovery filters failed/pending webhook deliveries; the fallback payment sweep is
limited to pending payments created in the past 30 days. Durable/fair batching remains outstanding.

Targeted backend regression: 101 tests passed across payment recovery, ledger jobs/drift and admin.
Stripe-mock contracts: 35 passed. The added browser test in `paymentAccount.e2e.ts` passed through
real app login and rendering, covering payout-detail pagination, previous-page navigation and clearing
stale contents on switching to manual payouts. It intercepts the payout HTTP responses, so this is
browser regression evidence, **not** a real Stripe/application E2E sign-off. Enable `E2E_RECORD=1`
when running web Playwright to save videos for passing tests as well as failures.

No checklist group is declared fully covered by this follow-up. All 35 IDs and every variant in
`payments.md` remain the release inventory. The dedicated sandbox accounts, signed webhook isolation,
full real-app recordings, provider lifecycle coverage and native/hardware checks are still required.
The pending schema decisions prevent final reconciliation/restart and payout-report assertions from
being implemented against the intended final model. Do not merge based on the partial evidence above.

The demo account readiness recheck still reports `charges_enabled=false` and `payouts_enabled=false`
for both merchants. A passing browser recording is saved locally at
`.scratchpad/stripe-review/payout-contents.webm`; its payout responses are controlled fixtures.
Remaining implementation work also includes generic retrieved-object typing/validation and complete
payout history/30-day totals, in addition to the checkpoint and transit schema-dependent work.

Follow-up full gate: `make check` passed (2,128 backend tests, 93.31% branch-aware coverage;
498 frontend tests plus timezone reruns; 102 infrastructure tests). The separate Stripe contract suite
passed 35 tests and the payout browser scenario passed with a video. These results do not clear the
remaining schema, sandbox or complete-checklist coverage blockers.
