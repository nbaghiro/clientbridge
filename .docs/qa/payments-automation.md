# Payments QA automation plan

Status: **proposed execution plan, not an installed workflow**, 2026-10-18.
Scope and stable scenario IDs: [payments checklist](payments.md).

Use the existing Clientbridge Stripe platform sandbox, with **two dedicated CI connected accounts**
and dedicated platform-billing fixtures. Keep the human demo accounts for manual QA. Local database
rollback cannot roll back Stripe; sharing a merchant with humans would make schedule, balance and
subscription assertions unreliable. No production schema changes are needed for this test harness.

## Existing infrastructure to extend

| Area                                                             | Current behavior                                                                                   | Required extension                                                                                                |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`                                       | Backend/Postgres regressions, stripe-mock contract job, frontend checks and real app browser jobs. | Preserve these PR gates; add a separate opt-in sandbox workflow after local proof.                                |
| `backend/tests/sandbox/test_stripe_sandbox.py` and `conftest.py` | Real Stripe adapter tests; missing credentials/account can skip tests.                             | Audit fixture ownership/idempotency, fail-closed CI preflight, lifecycle cleanup and additional state assertions. |
| `frontend/apps/web/e2e/payouts.e2e.ts`                           | Aborts Connect JS loading to test application error/navigation behavior.                           | Keep it; add real provider scenarios that load Stripe through authenticated app pages.                            |
| Web and Connect `playwright.config.ts`                           | Existing production-preview CI servers, failure traces/screenshots; videos off.                    | Dedicated sandbox project with one worker, separate fixture accounts and passing-run videos.                      |
| Admin                                                            | No dedicated Playwright project identified in this checkout.                                       | Reuse existing browser fixtures with an admin server/project and actual admin login.                              |
| `frontend/apps/mobile/e2e/`                                      | Existing Maestro flows and Android emulator CI.                                                    | Extend native flows; retain assisted iOS/physical reader coverage.                                                |

Do not invoke unqualified `make test-sandbox` in the Stripe-only lane: it can also select email-provider
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
- Exercise missing delivery and retry with a controlled relay. Run the replay and reconciliation jobs deterministically rather than waiting for their hourly schedule.

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

## Status

The review findings this file used to track are fixed (PR #60): reconciliation
runs hourly from a per-business cursor kept as a `ledger.reconciled` audit (no checkpoint table), payouts
move through the `transit` account category and count as deposited only once paid, an hourly job replays
events Stripe couldn't deliver, and platform admins can list and acknowledge drift findings.
[Payments and Stripe](../payments.md) describes the current behavior.

The Stripe browser lane covers each money flow against the sandbox (STR-E01 to STR-E12, apart from the
missed-event replay, which backend tests cover), and the sandbox checks are recorded in
[Payments and Stripe](../payments.md#sandbox-verification-record-2026-10-27) with what is still open.

No checklist group is declared fully covered. All IDs and variants in [payments.md](payments.md) remain
the release inventory. The payout browser test in `frontend/apps/web/e2e/paymentAccount.e2e.ts` covers
payout-detail pagination and switching to manual payouts through real app login, with intercepted payout
responses, so it is browser regression evidence rather than a Stripe sign-off. Set `E2E_RECORD=1` when
running web Playwright to keep videos of passing tests as well as failures.

Automation should start with regression coverage, then dedicated sandbox fixture setup and signed-event
isolation (batches 1 and 2). First real-app recordings should cover invoice payment, a withheld webhook
applied by the replay job, refund, payout scheduling and a funded payout with matching reports. Expand to
membership, PAD and dispute lifecycles only after the core fixtures clean up reliably. Keep manual
onboarding, provider-dependent states and physical devices separate from CI passes.

## Sandbox automation implementation — 2026-10-18

`make test-stripe-qa` now selects 13 provider/API scenarios, creates a fresh application database,
and fails on missing prerequisites, an empty selection, skips, assertion failures or cleanup errors.
This is partial automation, not full checklist completion. The live scenarios have not yet passed
against ready, reserved merchants. Authentication and notification transports remain test boundaries;
these scenarios do not prove browser, native or email delivery behavior.

| Scenario file / test                                                     | Checklist coverage contributed                                                               |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `backend/tests/sandbox/test_stripe_sandbox.py`: fresh v2 account         | SET-03 onboarding requirements                                                               |
| Same: PAD capability and scoped setup                                    | COL-07 setup only; no debit settlement                                                       |
| Same: Terminal intent                                                    | Terminal intent contract only; no reader collection                                          |
| Same: declined card                                                      | COL-02 provider decline mapping                                                              |
| Same: subscription period                                                | COL-08 creation/period contract only; no renewal lifecycle                                   |
| Same: Customer rename retry and cross-account isolation                  | SET-02 customer identity and isolation                                                       |
| `backend/tests/sandbox/test_payments_sandbox.py`: invoice replay/refunds | COL-01, REC-01/04/08 payment, signed duplicate delivery, partial/full refunds and ledger net |
| Same: decline then retry                                                 | COL-02 failure/retry without false settlement                                                |
| Same: withheld webhook                                                   | REC-05/06 repair primitive for one owned charge; not the global job                          |
| Same: external refund                                                    | REC-02/04 external refund delivery and duplicate protection                                  |
| Same: cross-business refund                                              | SET-04 tenant isolation at the application API and provider                                  |

The executable test names in `results.json` are the precise evidence inventory; the checklist mapping
above describes contributions, not completion of an entire ID. Full checklist variants remain in
[payments.md](payments.md). There are no new browser recordings from these API scenarios.

Local setup requires `STRIPE_TEST_PLATFORM`, `STRIPE_TEST_CONNECTED_ACCOUNT`,
`STRIPE_TEST_OTHER_ACCOUNT` and `STRIPE_TEST_SECRET_KEY`. Both distinct merchants must settle in CAD,
have charges and payouts enabled, and carry `metadata.clientbridge_qa=payments`. Reserve dedicated
merchants before applying that metadata. A local developer can use the existing CLI key without printing
or copying it: `make test-stripe-qa STRIPE_QA_ARGS="--profile clientbridge --preflight"`, then omit
`--preflight` to execute. The account/platform variables are still required. CI forbids CLI profiles.

`.github/workflows/stripe-qa.yml` adds a main-only manual workflow with a `stripe-sandbox` environment,
a constant concurrency group, pinned CLI download checksum and disposable local services. Configure
the key as an environment secret and the three IDs as environment variables. Configure environment
protection in GitHub before enabling it; the workflow file alone does not create protection. It uploads
only sanitized test names/statuses/commit, retaining artifacts for seven days. Raw JUnit and Stripe
listener output are not uploaded. The workflow has not been executed remotely yet.

The relay verifies genuine CLI signatures, accepts only the run's account and owned payment objects,
and retains original bytes/signatures for the application webhook. It preserves events arriving out of
order. Tests clean up their owned Customers, intents, clocks and prices in teardown. This cleanup does
not yet recover from a killed process; a durable object manifest and interrupted-run recovery remain
required before unattended scheduling. Local file locking does not coordinate with GitHub: use separate
local merchants while CI owns its pair.

Still required: live execution and fixes from it; interrupted-run cleanup; actual browser/admin/native
flows and recordings; payout schedule editing and funded payout contents/report assertions; booking,
orders, entitlements, PAD, dispute, membership renewal and platform billing lifecycles; complete
per-variant mapping and replay job isolation. Do not interpret successful harness tests or ordinary `make check` as live E2E passes.

Validation for the sandbox harness increment: 17 harness regressions passed; the live suite collected
13 tests. `make check` passed with 2,145 backend tests (93.31% coverage), 498 frontend tests plus
timezone reruns, and 102 infrastructure tests. The read-only CLI-profile preflight rejected the
existing demo merchant as not reserved for QA. No live financial scenarios were executed. These
results validate the harness and baseline regression suite, not all 35 checklist groups.
