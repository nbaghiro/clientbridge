# E2E execution history

Historical snapshots and failed attempts are retained below. Use [current status](README.md) and [coverage.json](coverage.json) for the latest evidence and limits. Counts and outstanding items in earlier entries describe their original point in time.

# End to end test suite execution

## Latest verification snapshot

| Lane | Verified result | Evidence boundary |
| --- | --- | --- |
| Full default web | 58 passed, one presentation skip; 6.5 minutes | Strict unchanged source; owned cleanup passed |
| Full default Connect | 50 passed, one presentation skip | Local diagnostic; hosted CI pending |
| Pseudo locale | Web 1/1; Connect 6/6 | Local diagnostic, actual persisted message text excluded precisely |
| Real Stripe browser | 4/4: payment, decline/correction, 3DS completion/cancellation | Strict unchanged source; exact provider cleanup passed |
| Real Stripe backend | 13/13 | Genuine sandbox API/events; separate from browser coverage |
| Backend regression | 2493 passed; 93.33% coverage | Fresh disposable database; external tiers separate |
| Cross-surface journeys | 6/6; 35.5 seconds | Real provider/customer UIs; strict unchanged source and owned cleanup |
| Native transaction | Android 1/1 | Development build; iOS and release-build qualification pending |

These results certify named behaviors, not completion of the 302 broader audit families. The six returning-customer, identity-conflict, booking-race/retry and class journeys passed together. GitHub's provider environment/credentials remain unprovisioned.

The core confidence layer is completed user journeys against the real application: browser or native UI, real authentication, committed Postgres transactions, PowerSync replication and observable delivery. Integration and unit tests supplement these journeys for exhaustive invariants and arithmetic; they do not substitute for functional end to end coverage.

The [product brief](../../reviews/product/comprehensive-e2e-brief.md) is the research reference. [coverage.json](coverage.json) preserves all 302 proposed scenario families and contains the atomic pilot execution records. Imported cases began as `needs_triage`: an audit priority is not an implementation priority or a claim of passing coverage. Split multi-behavior families into atomic cases during refinement and retain the parent ID. [evidence.json](evidence.json) is a related source-assertion inventory, not runtime proof. A passing atomic case does not close its broader family.

## Reusable building blocks

- `frontend/apps/web/e2e/support/session.ts`: real UI sign-in and client navigation. No injected authentication state or fixed sync sleeps.
- `support/billing.ts`: uniquely owned prerequisites through authenticated production APIs, invoice navigation and cash-payment UI actions. Prerequisite creation is not credited as UI creation coverage.
- `@clientbridge/config/e2e/demo`: plausible customer names for web and Connect fixtures. Visible names and document content remain appropriate for a product demonstration; run uniqueness belongs in recipient addresses, internal IDs and scoped metadata, not UUID/E2E labels in customer names. Native fixtures follow the same rule. Earlier synthetic records are retained; this policy does not authorize renaming or deleting existing data.
- `support/evidence.ts`: independent committed database observation and recipient-scoped Mailpit search.
- `backend/scripts/e2e_evidence.py`: read-only SQL evidence; it does not call production accounting calculations to produce expected answers.
- `billing.e2e.ts`: named journeys with explicit expected cents, state transitions and forbidden duplicate effects. Expected values remain in the scenario, not hidden inside a universal workflow helper.
- `support/crm.ts`: client, pet and note UI actions, command observation and scoped record navigation; independent browser contexts observe actual replica changes.
- `support/bookings.ts`: unique booking prerequisites, real calendar selection, UI create/open actions and committed visit observation.
- `support/invoices.ts`: document composition, line/discount editing, exact totals, recipient-scoped mail and committed document evidence.
- `support/security.ts`: real authenticated prerequisites, refused production API calls and unchanged-owner-state assertions. An API denial is credited as an authorization boundary, not as a completed forbidden UI action.
- `frontend/apps/connect/e2e/documents.ts` and `backend/scripts/e2e_documents.py`: authenticated provider prerequisites plus independent read-only form/signature SQL. Customer submission/signing uses the real public UI; API prerequisite creation is not provider UI creation/send coverage.
- `backend/scripts/e2e_results.py`: validates required atomic case IDs and actual first-attempt report results.
- `backend/scripts/e2e_stack.py`: prepares a run-owned stack and frontend/service configuration. Runtime provisioning, the approved existing migrations through `cb0028`, core seed, API, real worker and owned cleanup have now executed successfully. A SIGTERM startup cancellation drill passed; hard-kill and browser-phase cancellation remain separate checks.

Keep helpers small and domain-specific. Share transport, session, fixtures and observable waits. Add abstractions only when journeys need them; avoid a configurable universal test runner. A UI workflow must not use API calls to perform the behavior it claims to test. Fault injection may forward a real request and drop its response after commit; it must not fabricate the application's successful response.

## Initial execution queue

| Order | Work                     | Exit criterion                                                                                                 |
| ----- | ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| 1     | Establish baseline       | Existing suite results, skips, environment, revision and known failures recorded                               |
| 2     | Billing pilot            | UI cash collection, independent replica, reload, exact committed ledger and receipt delivery                   |
| 3     | Recovery pilot           | Real commit followed by lost response and UI retry; same key, one collection, unchanged ledger                 |
| 4     | Isolated stack lifecycle | API, worker, auth, Redis, storage, sync and mail owned by run; cancellation cleanup exercised                  |
| 5     | External bridges         | Real Stripe.js payment plus signed callback and native transaction in intended execution environments          |
| 6     | Risk expansion           | Booking/deposit/refund, cross-tenant denial, roles, offline recovery; one canonical owner per shared invariant |

Complete decisions only for dependent cases. Before declaring a case `ready`, specify setup, UI actions, exact expected and forbidden effects, observation completion, primary layer, CI lane, risk, dependencies and evidence. Missing functionality is `needs_feature`; it is not implicitly part of test implementation. Retain valid existing assertions and link them rather than recreating all integration tests through a browser.

## Environment and evidence boundaries

The initial pilot used the existing seeded local stack. Current functional runs use `make test-functional`, which owns fresh services, database and core seed per run. Each attempt creates its own client, recipient and invoice; it never mutates a seeded invoice. New fixtures use natural customer/document names with a unique email or internal identity for isolation. Local runs retain these synthetic financial records because ledger entries are append-only. CI starts a fresh stack. Earlier pilot evidence had record isolation only; new isolated-run evidence identifies its own Compose project. Do not run against production or a live merchant.

Cash collection does not exercise Stripe. Setup refuses non-development settings or a nonlocal SMTP sink. Manual invoice receipts are now queued atomically with payment and dispatched by the API through the existing durable delivery queue. This pilot checks the accepted delivery row and SMTP receipt; it does not establish scheduled worker recovery. Mailpit proves delivery to the SMTP sink, not real-world inbox delivery. Native and genuine provider bridges retain separate evidence and limitations.

Use real time for browser journeys, as required by repository conventions. Process-local clock overrides do not propagate to independent workers or external services. Future time-dependent suites need a deliberate shared clock contract or provider-supported simulation.

Local Stripe file locks and Actions concurrency groups do not coordinate with each other. Prefer dedicated local and CI sandbox resources. Tag provider objects by run; preserve diagnostics before scoped cleanup. Do not rely only on `finally` for runner cancellation.

## CI acceptance contract

Local existing make targets still discover the functional specs. CI now runs `scripts.e2e_stack` in separate default/pseudo project jobs for web and Connect, with fresh infrastructure, API and worker per job. The runner validates JSON reports with `scripts.e2e_results`: missing required IDs, global errors, zero cases, unexpected outcomes, skipped required cases and any retry fail acceptance. The checker retains one narrow exception for the existing `presentation demo:` walkthrough. Both surfaces provide isolated Mailpit/SMTP and retain browser reports plus service diagnostics, excluding generated secret-bearing Compose configuration; API document setup refuses nonlocal mail settings. These are implemented CI changes, not evidence that a new hosted CI run has passed.

Tests must fail when required infrastructure is absent; no environment-dependent skip is allowed for the core journeys. Preserve traces, screenshots, fixture IDs and committed evidence on failure. Retries must not erase first-attempt failures. Required-job aggregation, quarantine ownership and candidate-digest provenance still need explicit release acceptance review.

A passing pilot certifies only its named behaviors. It does not certify all 302 families. Required release evidence must identify the candidate revision and environment. Broader browser/device combinations should follow an explicit supported matrix rather than multiplying all fixtures by all platforms.

## Findings and validation

The lost-response pilot reproduced duplicate receipts on manual payment replay while payment and ledger deduplication remained correct. Manual receipts now enter the existing delivery queue inside the payment transaction; replay dispatches the original scope instead of composing another notification. Saved-card behavior is unchanged. No model or migration change is involved.

The initial two browser pilots passed against a freshly started API on port 8731. Testing against a long-running development server did not validate the new backend code, so execution provenance must include the API process as well as the frontend revision. The current checkout has concurrent UI changes; those are outside this execution.

`pnpm test` passed all six frontend package tasks, including 539 app-core tests. A direct backend invocation stopped at the seeded-date guard before running assertions. Its supported disposable database runner requires explicit migration approval under repository policy; that approval was requested. Full web baseline and final checks are tracked in the execution log below.

## Baseline follow ups

The broad local web run exposed these failures outside the new billing pilots:

- History and shell walkthroughs: Stripe Connect emits a session-closed console error when an embedded session is torn down. Preserve the failure until its lifecycle contract is reviewed; do not broadly suppress console errors.
- Pseudo-locale history: a seeded customer message is treated as untranslated interface copy. Separate customer content from catalog-owned copy in the oracle.
- Payment dialog walkthrough: opening the recorder now leaves the invoice drawer mounted, so an unqualified dialog locator matches twice. Scope the recorder assertion to its accessible name.
- Invoice accessibility: the document preview reports `scrollable-region-focusable`. This is a product accessibility finding, not a reason to relax the axe assertion.

At the initial baseline, the Stripe CLI read-only balance request confirmed `livemode=false`; no payment or callback was generated, and Maestro 2.11.0 had only been detected. Subsequent provider/native work is recorded below rather than retroactively credited to that baseline. Production-browser validation initially required installing the repository's matching Chromium build. Alternative web ports also require matching API and Kratos origin/return-URL configuration; port allocation alone is insufficient for a fully isolated stack.

## Reproducing the pilot

Start the existing seeded local services and a fresh API process from the checkout under test. For a private API process without replacing the developer's server:

```sh
cd backend
uv run uvicorn clientbridge.main:app --host 127.0.0.1 --port 8731
```

In a second terminal from the repository root:

```sh
cd frontend
VITE_API_URL=http://localhost:8731 pnpm --filter web exec playwright test billing.e2e.ts --project default
```

For production frontend/Chromium validation, install Chromium with `pnpm --filter web exec playwright install chromium`, then run the same command with `CI=1`. Keep the configured web ports 8721 and 8724 free; authentication currently explicitly allows those origins. Shut down only the private API process started for the run. The pilot does not provision or reset the service stack.

## Execution results on October 23 2026

- Broad local web baseline: **28 passed, 6 failed, 2 skipped**, 7.7 minutes. The two billing pilots passed. The skipped cases were the presentation-demo mode and production-only offline shell. Six failures comprise the five cases described above (Connect affects two tests), plus the timezone/reschedule walkthrough waiting for a Reschedule button on a selected seeded booking. That last case needs a purpose-built future booking instead of choosing the first available seeded row.
- Frontend package tests: six successful package tasks; two used cache. App-core: 539 passing tests.
- Changed Python files: Ruff and Pyright passed. Changed TypeScript: typecheck, ESLint and Prettier passed. Backend and frontend structure checks passed.
- Backend regression execution: blocked at the seeded-date prerequisite before assertions. Disposable database migration approval remains pending; no test guard was bypassed and no migration was applied.
- Read-only Stripe preflight: authenticated test mode. Native tool preflight: Maestro installed. Neither is transaction coverage.

Raw baseline logs and traces are in `.scratchpad/e2e-web-baseline.log` and `.scratchpad/e2e-web-baseline-results/`. These are local diagnostics, not committed CI or release evidence.

The production build with Chromium passed both billing journeys and the existing offline-shell test. The payment walkthrough reached its next pre-existing fixture assumption: it picked the first open invoice, which may already have a partial payment and cannot be voided. It now uses the same unique invoice fixture as the pilot and opens that exact invoice. This removes a concrete order dependency introduced by running legitimate payment journeys alongside the old walkthrough.

The focused payment walkthrough subsequently passed its invoice section and failed later at the sales-history detail panel (`Details` opened without the expected Payments content). That separate finding remains open. The invoice-specific selector and fixture fixes are retained; the walkthrough is not reported as passing.

Final focused production frontend/Chromium run: **2 passed in 21.5 seconds**, including receipt amounts ($10.00 and $4.00), committed accepted delivery records, exact ledger changes, replay deduplication and UI persistence. Source base: `184272263e45f2d0958748b18d740b6b7196b92c` plus this execution's uncommitted changes. Concurrent unrelated edits mean this is local behavioral evidence, not certification of a fixed release candidate. Final logs: `.scratchpad/e2e-final-pilot.log`.

## Subsequent functional slices

These results extend the historical baseline above. They are scoped local results against the current checkout and a fresh API process on port 8731, with existing local auth, Postgres, PowerSync and mail services. None completes an execution phase or certifies all 302 scenario families.

| Atomic cases        | Current evidence                                                | Scope and remaining boundary                                                                                                                                                                                                                                                                          |
| ------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BILL-PILOT-01..02` | Two production-browser pilots passed in the earlier focused run | Cash collection, exact ledger/receipt and lost-response replay. Not Stripe or scheduled-worker recovery.                                                                                                                                                                                              |
| `CRM-E2E-01..04`    | Four browser cases passed                                       | Client create/edit/archive/restore, note create/pin/delete, pet validation/edit/removal and directional merge, with independent replica observation. Partial `CRM-E01`, `CRM-E02`, `CRM-E04`, `CRM-E06`, `CRM-E10`, `CRM-E11`, `CRM-E12`; not all roles, merge relationships or concurrency branches. |
| `SCH-PILOT-01`      | One browser case passed                                         | Create, reject an overlap, reschedule and cancel across replicas. Partial scheduling lifecycle/availability/cancellation coverage; a sequential overlap denial is not a simultaneous last-slot race.                                                                                                  |
| `DOC-E2E-01..05`    | Five production Connect cases passed together in the final run  | Customer form/contract completion with real API/Postgres and read-only committed evidence. Detailed family mapping below. No provider creation/send UI, attachment matrix or native document coverage.                                                                                                |
| `SEC-E2E-01..02`    | Two cases passed                                                | Real authenticated staff and foreign-business boundaries, with forbidden production API calls and unchanged owner evidence. Partial `ID02`, `BILL13` and `PAY-E08`; not every endpoint/role or public token boundary.                                                                                 |
| `BILL-DOC-01..02`   | Two browser cases passed                                        | UI invoice mixed-tax/discount/edit/issue/void and estimate approval/conversion. Partial billing document lifecycle; not every tax jurisdiction, concurrency branch or customer payment path.                                                                                                          |

Final combined execution with the natural-name fixtures: **11 provider-web cases and 5 Connect cases passed**. The provider-web count comprises two cash pilots, four CRM, one scheduling, two authorization-boundary and two document-composition cases. Connect's five required IDs passed report acceptance. Logs are `.scratchpad/functional-final.log` and `.scratchpad/documents-final.log`; corresponding `*-results/results.json` files retain execution details. These are local production-frontend results, not a hosted CI run or fixed-release certification.

Two separate focused checks also passed: the legacy timezone/reschedule regression in **19.4 seconds**, now using an owned future booking instead of an arbitrary seeded booking, and `OFF-E2E-01`, whose final durable-report run passed in **21.5 seconds**. The latter edits weekly hours offline, reloads with the proposal still pending, reconnects and observes the accepted week in another owner's replica. Independent evidence asserts exactly seven rows, revision one, one receipt and one audit; replay leaves those effects unchanged. This is partial `SYN07` durable outbox/restart evidence, not the existing offline-auth shell test or native process-death coverage. Its report is `.scratchpad/offline-final-results/results.json` and passed required-ID acceptance. The current total is **17 new browser cases plus one repaired legacy timezone case**. These results do not erase the other historical broad-suite failures.

Public-document atomic IDs map to the larger audit families as follows:

- `DOC-E2E-01` → partial `DOC01`, `DOC02`, `DOC04`: required signature/answer validation, issued form definition after template change, exact committed answer/signature, reload and rejected replay without overwrite.
- `DOC-E2E-02` → partial `DOC11`, `DOC13`: typed-name/consent validation, signed body/version snapshot after later publication, reload and rejected sign/decline reversal.
- `DOC-E2E-03` → partial `DOC13`: customer decline, stale second-tab signing refusal, terminal-state reload and unchanged committed evidence.
- `DOC-E2E-04` → partial `DOC12`: real stale-version 409, revised terms displayed, consent cleared and renewed before version-two signing. This is controlled ordering, not a simultaneous publication/signing race.
- `DOC-E2E-05` → partial `DOC11`: real pointer drawing, missing-drawing validation, clear/replacement stroke, committed normalized points and reload persistence.

Provider Forms currently exposes response counts but no reviewed historical answer/signature reader. Provider signature cancellation is not exposed in the reviewed contract routes; customer decline is the implemented terminal action. Neither missing capability is invented by the tests. Form file uploads, all field types, provider delivery recovery, native document flows and process-loss/concurrent-submit cases remain open.

Two dedicated local Stripe v2 sandbox merchants were created for future provider isolation. Both completed Stripe-hosted sandbox onboarding and now pass readiness. The real signed-webhook backend provider suite passed 13 cases. Stripe.js browser validation remains in progress; no browser payment is credited from merchant readiness or backend tests alone. The CLI's authenticated sandbox session is not CI credential/resource provisioning.

Following explicit user approval, the runner applied the existing chain through `cb0028` only to newly created disposable databases. It seeds before starting the API and worker and removes its owned Compose resources afterward. The full Connect run passed 50 cases with one intentional presentation skip; focused web sales, entitlements and scheduling passed seven cases. Broad web revalidation is in progress.

## Native transaction pilot

`frontend/apps/mobile/e2e/functional-client.yaml` passed **1/1 on Android in 3 minutes 54 seconds** with Maestro 2.11.0 and the already-running Shared Pixel API 34 emulator (`emulator-5554`). It creates Sophie Bennett through the real client form, force-stops/relaunches the app, finds that record by its unique email, edits the name to Sophie Laurent, then force-stops/relaunches again and verifies the edited name and unchanged email in the reopened editor. It uses the existing owner authentication helper and the actual native SQLite/PowerSync stack. Only the recipient address carries a run identifier.

An independent read-only Postgres query after the passing flow found exactly one matching active Birchbark client with name Sophie Laurent, ID `cl_01M5NFZJ646ZV4MYARZBCDQMQ4`. The flow report is `frontend/apps/mobile/test-results/functional-client-android/index.html`; command/device logs and screenshots are in its dated run directories, with the successful debug log under `debug/.maestro/tests/2026-10-23_190014/`. This is partial native `CRM-E01`/`CRM-E02` persistence evidence. It does not cover subjects, all validation/role cases, lost-response recovery, queued offline commands, native payments, push or release-build compatibility; it does not close `SYN17`'s offline-hours/process-death family.

The passing run used the installed development APK with an owned Metro process on 8737, explicitly configured for the fresh API on 8731, local auth on 8713 and real sync on 8704. It is not a release-build or hosted CI result. Earlier attempts exposed test issues that were corrected: email belongs in the editor rather than the detail display, and editing must place the cursor at the end before erasing and assert the exact replacement before saving. One intervening Android development startup stayed black and timed out; a subsequent complete run passed. Preserve that startup failure as a development-environment reliability limitation rather than counting a retry as a clean original attempt.

iOS was attempted separately on the already-booted iPhone 17 Pro simulator, iOS 26.5. It reached the client editor, but XCUITest failed while checking the keyboard with `Unable to perform work on main run loop, process main thread busy for 30.0s`; no iOS transaction is credited. No simulator was created/reset and no app build was installed. The owned Metro 8737 and the test-launched app processes were stopped afterward. Android's temporary 8707→8737 reverse was restored to 8707→8707, its added 8731 reverse was removed, both pre-existing devices were left booted, and the user's Metro 8707 and the root-owned API 8731 were left untouched. No earlier fixture records were renamed or deleted.

## Changeset review and remaining execution gates

The independent review found a process-group cleanup bug: a runner could exit while its child ignored termination. The runner now checks the whole owned process group and escalates termination; a real subprocess/socket regression fails against the old implementation and passes against the fix. Compose subprocesses also belong to tracked process groups. Eight no-database harness checks pass. A real SIGTERM startup cancellation drill now verifies exit 143, no owned descendant processes and no owned containers; evidence is `.scratchpad/e2e-cancellation-proof.json`.

Required browser IDs now have one canonical registry in `backend/scripts/e2e_results.py`, shared by the isolated runner and CI. Full default runs require the provider-web and Connect atomic IDs in that registry; focused runs still reject empty, skipped, failed or retried evidence. Presentation-only demo cases are the explicit skip exception. Artifacts are retained on successful CI runs as well as failures.

The latest frontend package run passed all six tasks (four cached), including 554 app-core tests. This checkout includes concurrent user changes, so those counts describe the tested working tree rather than only this changeset. Formatting, changed-file static analysis and structure checks passed; backend database regression execution and the full `make check` gate remain outstanding.

The user explicitly approved applying the existing Alembic chain through `cb0028` to newly created disposable test databases, seeding core demo data and dropping only run-owned databases/volumes. That approval has been exercised and persists. No new migration or model change is included.

The audit still has 302 broader families requiring refinement and completion. Seventeen browser cases and one Android case certify their named behaviors only. Provider onboarding/payments, broader money and entitlement lifecycles, notification worker recovery, uploads, more role/tenant boundaries, races, native platform coverage and the unresolved historical broad-suite failures remain open. This execution is not a claim of complete product coverage or release certification.

A separate source-review concern in the pre-existing `PublicManage.tsx` edit remains unverified: nonshrinking document labels in the To Do row can exceed a narrow viewport when names are long. That user-owned edit was preserved. Add a long-label mobile layout case before treating that path as covered.

Final review corrections also make invoice and booking client choices searchable by email, with visible email details and a duplicate-name regression. Catalog options expose their stable value so tests select the owned service by ID while asserting its natural label. Owned booking fixtures are canceled in `finally` through the production API, preventing successful repeated timezone/scheduling runs from consuming the available slots.

The final client-picker/booking-cleanup verification passed all four targeted production-browser journeys without retries in 58.0 seconds, including the legacy timezone case. Evidence: `.scratchpad/email-picker-final-results/results.json`; required-ID acceptance passed. New mobile picker rendering was typechecked; the separately passing native client lifecycle does not certify those mobile picker changes. Owned API port 8731 and native Metro port 8737 were stopped; Android forwarding was restored and the developer’s services were preserved.

## Approved disposable-stack validation, October 23

The full default web run now passes **49 cases with one intentional presentation skip** in 5.9 minutes, and the full default Connect run passes **50 with one presentation skip**. Both accepted reports and removed their owned services. Artifacts: `.scratchpad/e2e-195a53d6f9aa/` and `.scratchpad/e2e-c5bcbf930836/`. Concurrent source edits make these diagnostic working-tree results, not immutable release certification.

Four new sales/entitlement atomic cases are recorded in coverage.json. They exercise actual cash checkout, exact inventory/accounting, a committed-response-loss retry, gift-card partial/exhausted redemption and package rounding/use exhaustion. The suite exposed a POS history crash on serialized JSON null tip splits; the shared hook now treats that valid representation as an empty split list. Both new sales journeys and the legacy payment walkthrough passed afterward.

The fresh default backend run passed **2483 tests, 50 deselected, 93.32% branch coverage**. The genuine Stripe sandbox API/webhook run passed **13 tests without skips or test retries** after correcting incompatible PAD mandate parameters. Evidence is under `.scratchpad/backend-fresh-validation/` and `.scratchpad/stripe-sandbox-final/`; all databases from these runs were dropped by exact owned name. Stripe.js browser checkout remains independently under validation.

CI now provisions a fresh isolated stack for each web/Connect default and pseudo project, runs the real worker, validates required first-attempt case IDs, retains diagnostics and invokes an additional owned-resource reaper. Hosted CI has not been run from this uncommitted checkout. Upload and two direct-message browser cases passed on their first attempt (3/3, 29.2 seconds), with owned cleanup verified. Evidence: `.scratchpad/e2e-ef33866892c5/`. Their exact behavior and limitations are recorded in coverage.json.

The independent runner review hardened two evidence boundaries. Source changes during a run now fail acceptance by default; local `--allow-source-changes` diagnostics are explicit and forbidden in CI. Process shutdown and Docker cleanup are recorded separately. A standalone Docker reaper after SIGKILL cannot prove host-process termination, so it reports incomplete aggregate cleanup unless process cleanup was previously proven; persistent verified process-ownership recovery remains lifecycle work.

Full backend lint, frontend typechecking across eleven packages, unused-code analysis and all six frontend test tasks passed (554 app-core tests). Code generation produced only the intentional PAD-message removals; repeat message generation was byte-stable. The repository `codegen-check` still exits nonzero because it compares generated files against the Git index and those intentional edits remain unstaged. No staging or commit was performed.

CI preserves the existing `web`/`connect` check names as aggregate jobs requiring both matrix projects. Artifact upload explicitly includes the hidden `.scratchpad` directory but lists only reports and diagnostic logs, never generated Compose configurations or provider manifests; this follows the [upload-artifact hidden-file contract](https://github.com/actions/upload-artifact#inputs). Missing artifact files fail the upload step.

The staff-pay journey reproduced a real selected-payee confirmation error: the selected CAD60 payment was described as CAD206.25 because other approved payees were included. The shared earnings hook now uses the selected payee amount. `PAY-E2E-01`, the strengthened storage-deletion check and both messaging journeys passed together (4/4, 1.1 minutes) in `.scratchpad/e2e-d2330cc48036/`; process and Docker cleanup both passed. API replay is explicitly distinguished from UI retry in this case.

Catalog UI creation passed, but retrying after an opening-stock failure reproduced two products: one at zero stock and a second at seven. A shared-hook recovery fix is undergoing browser validation. It retains the acknowledged item and immutable pending stock command, resolves uncertain results before applying edited fields, and issues only the remaining stock delta. Initial create-response loss and browser reload during this multi-request operation remain separate durability gaps.

Catalog recovery validation passed **3/3 in 31.4 seconds** on `.scratchpad/e2e-defdb8a2e8dc/`, with source stability and process/Docker cleanup verified. The original pre-send stock failure now retries on the same product. A real committed-response loss followed by editing seven to nine units replays the first command unchanged and adds only two units with a new command; description changes survive. Seventeen catalog hook tests supplement decreasing-quantity and tracking-toggle/uncertain-PATCH branches. This does not close the initial-create response-loss or cross-reload recovery gaps.

The isolated web pseudo-locale project passed (1/1, 18.8 seconds) in `.scratchpad/e2e-ed61dc82e961/`, including independently verified process/Docker cleanup. Only persisted client-message bodies on that client's history page are excluded from the English-copy detector; catalog labels remain checked. Source changed concurrently, so this is diagnostic evidence.

Read-only GitHub inspection found only the `staging` environment. The referenced `stripe-sandbox` environment and its CI secrets/merchant variables are not provisioned. The provider browser workflow now supports explicit environment credentials, requires dedicated CI merchant metadata and runs after the backend provider job; local CLI credentials are not read in CI. No hosted provider run is credited. A provider connection failure during cleanup was separately recovered by canceling the exact manifest-owned, unconfirmed intent; original failed evidence was retained.

`REF-E2E-01` passed in 27.3 seconds on `.scratchpad/e2e-978bdd0af0fb/`: an owned CAD112 taxable cash invoice is refunded in two CAD56 portions, each reversing CAD50 revenue, CAD2.50 GST and CAD3.50 PST, with exact credit notes, canceled-preview/no-change checks, over-refund UI/API rejection and independent reloads. No product change was required. An initial test-only GET to a nonexistent invoice endpoint was replaced with the actual sync-backed invoice UI.

The isolated Connect pseudo-locale project passed **6/6 in 12.3 seconds** on `.scratchpad/e2e-763eb772b2e0/`; process and Docker cleanup passed. These latest refund and Connect pseudo runs were explicit concurrent-source diagnostics.

Initial product-create response loss is now covered by `CFG-E2E-04`. The existing command table atomically stores item creation, audit and replay receipt; the API accepts an optional idempotency header. The shared form retains the original body/key until acknowledged, then applies current edits. The real browser drops a committed 201 response, edits cost/description/opening count, retries, and verifies one item, one audit/receipt and one nine-unit stock movement. All four catalog journeys passed together in 38.5 seconds on `.scratchpad/e2e-248e4fbfa9e8/`. Focused backend catalog tests passed 68/68; full backend regression is underway. No database model or migration changed. Closing/reloading a partially completed editor remains an explicit durability gap.

## Strict provider qualification

`STRIPE-BROWSER-01` passed in **22.7 seconds** on `.scratchpad/e2e-8cb10c4cbd21/` with `allow_source_changes=false` and `source_stable=true`. It exercises actual pointer payment of CAD20 with no tip through Stripe.js, genuine signed-event settlement, exact committed ledger/Stripe gross-fee-net agreement and paid-state reload. A first 503 for unavailable fees was followed by one [supported local Stripe CLI resend](https://docs.stripe.com/cli/events/resend) of the exact owned event, returning 200. This is controlled genuine redelivery, not invented payload/signature data or a claim about automatic production retry timing.

The exact successful charge was refunded, and provider, process and Docker cleanup passed with no owned process left. Earlier failures remain diagnostics: pointer activation was corrected with normal field blur and observable viewport readiness; one provider transport outage required separately recorded exact-owned cleanup. CI uses `make test-stripe-browser` with environment credentials and dedicated CI metadata, but its protected environment, credentials and merchants still need provisioning. Declines, 3DS, mobile, provider invoice creation and provider-backed refund UI remain distinct open journeys.

The post-catalog full backend regression passed **2487 tests, 50 deselected, 93.33% coverage** in 277.89 seconds. Evidence: `.scratchpad/catalog-backend-full.log`. The supported fresh-database wrapper completed owned cleanup; unrelated test databases were not touched.

## Cross-surface execution

`make test-functional FUNCTIONAL_ARGS="--surface journeys"` starts both production web and Connect against one run-owned backend stack. `*.journey.ts` specs use the shared session/domain/evidence helpers; the default web suite remains independently runnable. CI includes this lane in the existing required `web` aggregate. The new Playwright configuration is explicitly discovered by Knip and TypeScript, without ignored test files or weakened rules.

`CLS-E2E-01` passed in 16.2 seconds on `.scratchpad/e2e-94997afe550f/` with unchanged source and independently empty owned Docker inventories afterward. It covers genuine waitlisting rather than incorrectly assuming overflow rejection. Individual provider cancellation is not exposed in the reviewed UI, so the real anonymous customer manage page performs cancellation; exact automatic promotion and two provider replicas are checked afterward.

The strict full default web run passed 58 cases plus its one explicit presentation skip in 6.5 minutes on `.scratchpad/e2e-2aef3ba9bed8/`, with source hash matching the strict provider run and all cleanup states passed. Legacy account and beauty-studio fixture names have also been changed to natural demo names, preserving run uniqueness in email identifiers. Existing historical demo records were not renamed.

The latest frontend package run passed all six tasks, including **566 app-core tests** (`.scratchpad/e2e-frontend-final-tests.log`). The generated-artifact gate also passed using a temporary Git index containing the current intended generated files (`.scratchpad/e2e-codegen-qualified.log`); the real index was unchanged. This verifies reproducible generation without staging user changes. It does not imply that the full aggregate `make check` or hosted CI has run.

The expanded strict Stripe browser lane passed **4/4 in 1.4 minutes** on `.scratchpad/e2e-f55eea2a0aa5/`, source hash `e0d323bb498abb2d81771bb1f787b3d5910aca86e56b3e67cf20716a18514b23`. Decline/correction retains one local payment and remote intent; 3DS completion settles only after the real challenge; actual challenge cancellation leaves failed/unpaid state with zero settlement. Genuine events and independent accounting are checked. Provider, process and Docker cleanup passed: three successful charges refunded, the canceled-challenge intent canceled, no owned containers/volumes left. No browser retry or concurrent-source override was used.

A follow-up naming audit removed the remaining visible Robin Test / Navigation Test / Stepper Test labels. The timezone walkthrough now creates a natural “Staff training” closure and captures its actual API ID; cleanup deletes only that owned ID instead of pre-clearing every closure with a shared prefix. Cleanup is an API prerequisite/teardown, not UI deletion coverage. The natural customer names remain separate from unique email, object, and idempotency identifiers.

Full backend and frontend lint/typechecking, structure and unused-code checks passed after promoting the returning/scheduling specs into the discovered journey lane. `make test-frontend` passed all package tasks and 566 shared app-core tests in each configured timezone (`.scratchpad/e2e-frontend-timezones-final.log`). The first expanded journey run (`e2e-4319980983d7`) retained two passes and three failures: scheduling stopped at ambiguous inactive/active headings; returning success selected a date before availability loaded. These test defects are being corrected; no product booking behavior is credited from the failed cases. Source was unchanged and all owned cleanup passed.

The second expanded journey run (`e2e-0b0b2354c376`) reproduced duplicate public-booking acknowledgments: one command/booking survived a deliberately lost committed response, but UI retry produced two actual Mailpit messages. The initial notification is being moved into the existing transactional delivery queue under a distinct creation scope, preserving later lifecycle notifications. The last-slot race reached correct winner/loser state; its final comparison incorrectly included Mailpit’s mutable read flag. Returning identity edits intentionally clear the verified proof in the current product, so the verified-pet journey must keep those fields intact; the observed ambiguous-contact rejection is retained as separate evidence rather than treated as a product defect. All owned cleanup and unchanged-source checks passed for this failed diagnostic.

After the public booking acknowledgment fix, full backend regression passed **2493 tests, 50 deselected, 93.33% coverage** in 270.49 seconds (`.scratchpad/e2e-backend-booking-final.log`), with the approved disposable database wrapper exiting successfully. Infra lint/typechecking and 105 infrastructure tests also passed (`.scratchpad/e2e-infra-final.log`). New provider-recovery harness tests authored during this run are verified separately; this count does not imply they were discovered before their files existed.

The booking-fix browser diagnostic (`e2e-cbcf50f955fa`) passed class promotion, archived-proof rejection, simultaneous last-slot race and lost-response retry with one acknowledgment. Returning success reached correct committed identity/pet state but failed on a client-only observer heading; the actual pet-and-client heading is now asserted. Source changed during this explicitly diagnostic run; all owned cleanup passed.

Final static/type/structure/unused-code checks and frontend package tests passed after the contact-conflict fix, including **569 shared app-core tests in each of the three configured timezones** (`.scratchpad/e2e-final-gates.log`). Generated artifacts passed repeat generation through a temporary index (`.scratchpad/e2e-codegen-final.log`); the actual Git index was not changed.

The provider runner now retains process-cleanup failure flags and marks Docker failures as failed outcomes. Eighteen focused runner/recovery tests pass. The separate recovery CLI validates exact manifest/customer/account/test-mode ownership, refuses incomplete lineage or ambiguous states, and records its result separately from original run evidence. Read-only checks against a successful four-case run and a previously failed run verified already-refunded/canceled objects after their databases were gone, with original metadata unchanged. CI invokes recovery only for incomplete cleanup and available credentials; malformed status metadata fails explicitly. Real recovery mutation after an orphaned payment remains distinct from these read-only checks, though the shared refund/cancel operation is exercised by normal provider cleanup.

The strict expanded cross-surface lane passed **6/6 in 35.5 seconds** on `.scratchpad/e2e-282ac2170f9a/`, hash `2a0e043e2a39816ce5fc4df6efaa47a0de32f126a57930c8849dfc258c430370`, no source override, retries or skips. Required-ID acceptance and process/Docker cleanup passed; the owned container inventory was independently empty. Atomic cases and exact limits are recorded in coverage.json. This brings the explicit atomic inventory to 41 cases including the earlier Android case; it does not close the 302 broader audit families.

The first final web run (`e2e-d752d50268c3`) retained 57 passes, one presentation skip and one failure with unchanged source and successful cleanup. Natural-name fixture Robin Bennett collided with an existing financially active seeded client; the helper incorrectly treated a display-name match as fixture ownership. The product correctly refused the merge. Fixture lookup now uses its dedicated email, and the UI selects that exact recipient through search before clearing the filter; natural duplicate names remain supported. The whole web lane is being rerun.

With fixture ownership corrected, full web passed 58 tests plus one presentation skip in 6.3 minutes (`e2e-874c6c180d94`), source `0ac9ffe46d9364baa057074d9b5fcb3c7f96feac12c778c4fdec91b7c62784b6`, all cleanup passed. Connect recheck `e2e-520ddb5394ef` retained 49 passes/one skip and one mobile-navigation failure. Trace showed the test scrolled from the team section to the non-sticky header before leaving; native history then correctly restored that departed position. The test is being corrected to use the visible fixed mobile CTA while retaining its Back URL/viewport assertions. No product scroll behavior was changed.

Finance/report expansion passed on its first isolated diagnostic: FIN-REPORT-01 and FIN-EXPORT-02 plus all15 authentication cases passed together (17/17,35.9s; `e2e-ed7892713aa2`), with owned cleanup passed. Signup/onboarding was extracted into shared helpers; each finance case owns a new tenant. Source changed concurrently during provider5 authoring, so this is explicitly diagnostic. No product change was needed for either finance scenario.


## Qualification evidence before cleanup/revocation expansion

Strict journeys: `.scratchpad/e2e-282ac2170f9a/`. Earlier four-case Stripe: `.scratchpad/e2e-32bd658be56d/`. Both use source hash `2a0e043e2a39816ce5fc4df6efaa47a0de32f126a57930c8849dfc258c430370`, with concurrent-source overrides disabled. Latest six-case Stripe: `.scratchpad/e2e-eef51d0fec95/`, source `25be6d2c8e7360d063d316e91ce57f22eb91f861a14330e934395b26eae59ced`. No hosted CI run is credited.

The latest Connect/default (`e2e-6cd0362b7e59`) and web/pseudo (`e2e-a7a55aca17c4`) passed on source `31ae61edd11db72f63318b8bc19c94846133196995c4a15e29131d3fa96b8c67`. Earlier journey/Stripe qualification and the latest web/default run have distinct hashes because later changes corrected fixture ownership and a navigation-test assumption; application code was unchanged. All six qualified project container/volume inventories were independently empty (`.scratchpad/e2e-qualified-cleanup-inventory.json`).

Expanded full web qualification: `.scratchpad/e2e-d267570d4a7f/`, source `c5f82cd5e2957be72a97a0e3274febf648061b7dbef0620bfd7530afde14244e`, 61 passed plus one intentional presentation skip,6.3 minutes. Finance now verifies exact invoice/payment source and account ownership per journal leg. Two hours editors produce one accepted revision and one real conflict; explicit repair preserves both edits on both reloaded replicas. Full backend/frontend lint/type/structure and formatting checks also passed (`e2e-expanded-*.log`).

Strict filings qualification: `.scratchpad/e2e-c661bd897297/`, same source as expanded full web,1/1 first attempt in11.8 seconds; owned process/Docker cleanup passed.

Cross-surface selector/cleanup requalification: `.scratchpad/e2e-db6da6a98853/`, same source as expanded web and filings,6/6 first attempt in36.8 seconds; owned process/Docker cleanup passed.



## First deposit-accounting browser attempt

`e2e-f1432c277702` failed on unchanged source `787564d0ac27bfdcc589fd59efb33e603e98dfd29c9264b4dbbc05ead8b7b2ac`: five passed, two failed in7.7 minutes. FIN-DEPOSIT-04 collected a genuine CAD20 deposit, then timed out because web/mobile hid Invoice visit for bookings without add-ons. STRIPE-BROWSER-05 remained in the card form after an apparently correctly targeted pointer click; no charge was created and the cause remains unestablished. All cleanup passed: five refunds including the deposit, two canceled intents, no owned containers or volumes. Neither failure is credited as successful coverage.


## Optional Stripe postal-field regression

`e2e-7de2142a3a8f` failed all seven browser cases on unchanged source `5345063b5b9a0ef8e5d3c426c61da6d2e05a83b11a95a93fa87887df7327d512`. A new helper incorrectly required a postal textbox whenever Canada was selected; both genuine Stripe surfaces legitimately omitted that optional field. No payment was confirmed. Cleanup passed with seven cancellations, no refunds, and no remaining owned containers/volumes. This test regression does not validate the no-add-on invoicing fix and does not explain the prior case05 failure.

## Findings 8 to 16 of the brief

- Replays and sends: a same-key replay of a cash sale, a create-and-send invoice or a recurring booking sent its message twice, and a send or reminder lost to a provider outage was never retried. Cash receipts, invoice sends and reminders and series confirmations now queue their delivery inside the command; send and remind take an idempotency key, and each new send still mails again. Booking reminders already retried and never repeated.
- A client status PATCH let staff archive or restore without `archived_at`; status is now set only by archive and restore.
- Report periods now end at the next local midnight, so ledger and line reports agree on the last instant; staff-pay year to date counts in the business year.
- A one-day return marked its whole period filed; a period is now filed only when no taxed day is left unfiled.
- A STOP or withdrawal after a broadcast's audience was chosen, or after a text was queued, is now honoured at send time: the broadcast counts the recipient as excluded and the delivery fails with `consent_withdrawn`.
- A refused manual message cleared the draft; the composer now keeps it, shows that it wasn't delivered and retries as a new message (MSG-E2E-03, `e2e-3c87f92ea077`).
- A shop order's attempt key and order lived only in memory; Connect now keeps them in session storage for 25 minutes, so a reload resumes the same order (SALE-E2E-03, `e2e-79929fd68d1a`, order endpoint stubbed).
- After a lapse, cancelling a client subscription, disconnecting Google and cancelling a scheduled broadcast stay available.
- Opening Plans and the daily `sync_plans` job now mirror the plan status from Stripe, so a missed cancellation or recovery event no longer leaves access wrong.
