# End-to-end test suite execution

The suite exercises actual rendered interfaces, authenticated APIs, committed PostgreSQL transactions, PowerSync replicas, local mail/storage and genuine Stripe sandbox outcomes. Shared helpers handle sessions, owned prerequisites and observable waits; each scenario states its own exact expected and forbidden effects.

**Execution is ongoing.** The registry contains 60 required cases, including one Android development-build case. These do not complete the 302 broader audit families. [coverage.json](coverage.json) records precise behavior, parent families, limitations and runtime evidence. The [comprehensive product brief](../../reviews/product/comprehensive-e2e-brief.md) remains the product map; [history.md](history.md) preserves diagnostic failures, fixes and earlier results. [evidence.json](evidence.json) is a source-assertion inventory, not runtime proof.

## Latest verification

Every lane passed on one source, `71a3d1cdcb6683f671a4b5e934784f2a89ca736f03a5cf2706a64e65180a63ee`, at commit `22a83707`. Each run was strict: no source change during the run, no retries, and process, Docker and (for Stripe) provider cleanup all passed. Each run's worker was alive at the start and the end, and its scheduler fired a job on its own.

| Lane | Result | Run |
| --- | --- | --- |
| Full default web | 67 passed + one presentation skip | `e2e-d35310e3ffcc` |
| Full default Connect | 53 passed + one presentation skip | `e2e-312f41471fe6` |
| Cross-surface journeys | 10/10 | `e2e-9e2010e2e285` |
| Completed-quarter filings | 1/1 | `e2e-8e772ccfdd3d` |
| Pseudo locale | Web 1/1, Connect 6/6 | `e2e-d91927896142`, `e2e-73b1a71fa492` |
| Real Stripe browser | 7/7, including FIN-DEPOSIT-04 | `e2e-594077efb873` |
| Backend regression | 2818 passed, 50 deselected; 93.62% coverage | `make check` on a fresh database |
| Frontend regression | 622 app-core tests in each of Vancouver, Halifax and Tokyo, plus every other package | `make check` |
| Hosted CI | All 24 checks passed on PR #59 | Includes the web, Connect, journeys, filings and Android jobs; Stripe runs in its own manual workflow |
| Native transaction | Android 1/1 | Development build; iOS and release-build qualification remain open |

Reports live under `.scratchpad/<run>/`. Earlier runs and their sources remain in `coverage.json` and `history.md`.

The registry holds 60 required cases. `coverage.json` maps each to the audit families its assertions exercise. Judged strictly, 74 of the 302 families are partly covered, none is fully covered and 228 have no case yet; `coverage_summary` breaks this down by priority and category.

## Organization and reusable pieces

| Concern | Location and responsibility |
| --- | --- |
| Scenarios | Web `*.e2e.ts`, cross-surface `*.journey.ts`, Connect document cases and dedicated `stripe-provider.spec.ts` |
| Domain building blocks | `frontend/apps/web/e2e/support/`: sessions, clients/pets, bookings, billing, refunds, inventory, entitlements, messaging, files and payroll |
| Customer interfaces | Connect document/Stripe helpers; cross-surface cases use separate anonymous and provider contexts |
| Demo fixtures | `@clientbridge/config/e2e/demo` creates natural customer names. Pet-care/beauty labels match the actual demo business. IDs and unique recipients carry run identity |
| Independent evidence | Read-only `backend/scripts/e2e_*.py` observers inspect exact owned records, journals, inventory, delivery rows and provider IDs |
| Isolated runtime | `e2e_stack.py` owns dynamic ports, PostgreSQL, Redis, auth, PowerSync, object storage, Mailpit, API, worker and browser processes |
| Acceptance | `e2e_results.py` is the canonical required-case registry; missing cases, failed/skipped required cases, retries and empty reports fail |
| External provider | `e2e_stripe_stack.py`, setup/delivery/recovery helpers, merchant leases, exact ownership tags and restricted artifacts |

API calls may create explicit prerequisites or perform exact-owned cleanup. They do not count as UI coverage. Cases claiming UI create/pay/refund/submit must perform that action through the real interface. Lost-response injection forwards the genuine request and drops only its response after commit. Expected financial amounts come from scenario arithmetic and independent observations, not the production calculation being tested.

Visible records use realistic names and service descriptions. Inventory codes are short business-style identifiers; email aliases and internal IDs retain uniqueness. Tests select exact IDs or unique recipients where names can collide. Historical synthetic demo records have not been renamed or deleted. The closure walkthrough now removes only its captured record ID, without clearing unrelated same-name closures.

## Running the lanes

```sh
make test-functional FUNCTIONAL_ARGS="--surface web"
make test-functional FUNCTIONAL_ARGS="--surface connect"
make test-functional FUNCTIONAL_ARGS="--surface journeys"
make test-functional FUNCTIONAL_ARGS="--surface filings"
make test-functional FUNCTIONAL_ARGS="--surface web --project pseudo"
make test-functional FUNCTIONAL_ARGS="--surface connect --project pseudo"
make test-stripe-browser
```

The Stripe lane requires dedicated ready sandbox merchants and local CLI credentials, or explicit environment credentials in CI. It uses actual Stripe.js pointer interaction, challenge controls and signed callbacks. Fee-readiness failures can invoke bounded official CLI redelivery of the exact owned event. This does not simulate a callback or establish production retry timing.

Each isolated run applies the approved existing migration chain through `cb0032` to its new database and seeds core demo data before starting services. No schema, model or new migration is part of this changeset. Browser time stays real; backend regression uses the repository's frozen clock and supported fresh-database wrapper.

## Background worker and scheduler

Every isolated stack starts the arq worker beside the API, and both runners (`e2e_stack.py` and `e2e_stripe_stack.py`) refuse to start browsers until it is alive. They wait for the heartbeat the production liveness probe reads (`arq --check`), then enqueue one cron entry, `cron:prune_receipts`, under its scheduled name and wait for the worker's log to report it finished. That proves the schedule's wiring without changing it. At the end of a run they wait for a job the scheduler fired by itself, then require the worker process and its heartbeat to still be alive. `run.json` records `worker_heartbeat`, `worker_probe`, `worker_schedule`, `worker_final` and the `scheduled_jobs` the log reports, and a failed check fails the run as `WorkerFailed`. A cron job that fails during the run also fails `worker_schedule`.

CLS-E2E-01 now proves the worker delivers. The customer cancellation on the manage page commits the promoted client's seat notice to the delivery queue, and nothing in that request sends it. The case waits for the delivery row to become `accepted`, finds exactly one matching message in Mailpit, and checks it arrived within ten seconds after second 15 of a minute, when `send_deliveries` runs. In the qualifying run (`e2e-175f57ee8f6e`) the notice was queued at 18:18:40 UTC and arrived at 18:19:15.

The Android CI job also starts the worker, waits on the same heartbeat before the walkthroughs and checks it is still alive afterwards. `backend/tests/test_jobs.py` checks that every cron entry is a worker coroutine that fires at least daily, and `backend/tests/test_harness.py` covers the heartbeat gate, the probe and the end-of-run record.

## Staging smoke lane

`make test-staging-smoke` runs `frontend/apps/connect/e2e/smoke/` against deployed staging, or another environment through the `SMOKE_*` variables. It turns the staging QA checks into a lane: `config.js` and frame policy on every host, the bare-host redirects, the marketing site's demo link, the business page to booking and the shop, not-found pages, both widgets embedded on another origin, a widget below the fold, the staff setup screens and every demo owner's sign-in. A route guard aborts and fails on any write to the environment except signing in and the payment setup's Stripe session. The deploy workflow runs it in its own `staging-smoke` job after each staging deploy.

The QA script's token-page check needs locally minted links, and its slug check saved a reserved slug to see the error, so neither is part of the read-only lane.

The intermittent 256px shop widget was the frame's own resize report. The loading view is 256px tall, and Chrome delivers no ResizeObserver callbacks to an offscreen cross-origin frame, so a widget pushed below the fold before its content loaded kept its loading height until it was scrolled into view. `src/embed.ts` now also reports the height on DOM mutations, resource loads and font loads, which Chrome still delivers there, and skips unchanged heights. EMBED-E2E-01 reproduced 256px on the old code (`e2e-43f3e7b14dce`) and passes on the fix (`e2e-c12811f16ab5`). Against current staging, 23 of 24 smoke checks passed and the below-the-fold check failed at 256px, which is expected until the fix deploys.

Strict targeted runs on source `4f2bd18679f0a0cfbf5e214ca3ccdccb9e434a94e331f4d8d01c93b4a902e21a`: CLS-E2E-01 in `e2e-175f57ee8f6e` and EMBED-E2E-01 in `e2e-c12811f16ab5`, each 1/1 on the first attempt with every worker check and cleanup passed. Two earlier attempts on the same source failed in setup or cleanup because the run's Kratos stopped answering while the 3.8 GiB Docker VM was shared with other stacks; neither is credited.

## CI and cleanup contract

- Web and Connect default/pseudo jobs each own a fresh stack. The required `web` aggregate also requires the combined journey and dedicated filings lanes.
- Stripe browser CI follows the real backend sandbox job and uses dedicated CI merchant metadata. Local CLI credentials are not loaded in CI.
- Source changes fail qualification. Explicit local diagnostic overrides are forbidden in CI.
- Reports retain first-attempt results and source hashes. One existing presentation-only walkthrough is the explicit skip exception.
- Process, provider and Docker cleanup have separate outcomes. A cleanup failure cannot overwrite itself as a successful run.
- Provider recovery uses one exact manifest, a merchant lease, test-mode/account/customer lineage checks and settled refund/cancellation evidence. Incomplete lineage and ambiguous outcomes fail closed. Recovery writes a separate history and preserves the original failure.
- Uploads list reports and safe diagnostics explicitly. Secret-bearing Compose configuration, raw Stripe listener logs and Stripe browser traces are excluded.

Read-only recovery verified already-refunded/canceled objects after their application databases were gone. Normal provider cleanup exercises the shared refund/cancel operation against real Stripe. Recovery mutation after an orphaned payment remains a distinct qualification case. SIGTERM during startup was exercised; hard-kill host-process recovery and browser-phase cancellation remain open.

## Product defects found and fixed

- An invoice paid down by a visit deposit stayed "Sent"; an applied deposit now counts as part payment, and a part-paid invoice can still show overdue.
- Deposit previews could exceed the price; a deposit is now capped at the price, and every preview uses the backend's half-to-even rounding.
- An estimate preview ignored the document discount on a ticked add-on; Connect now shows the server's quote and acceptance refuses a total that changed.
- A repeating booking with a count of zero or less was accepted; it is now refused and nothing is saved.
- Editing a visit's invoice dropped its visit and staff links, so its deposit was never applied; the links now survive the edit.
- A sale paid fully by gift card ignored another order's stock hold, and two open tickets could both take one visit; both are now refused.
- Replaying a cash receipt, an invoice send or a series confirmation mailed twice, and a send lost to a provider outage was never retried; these now queue their delivery inside the command.
- Staff could change a client's status without archiving; status now changes only through archive and restore.
- Reports disagreed on the last instant of a period, a one-day tax return marked its whole period filed, and staff-pay year to date counted in UTC; all three are fixed.
- A STOP received after a broadcast or text was queued was ignored; consent is now checked when the message goes out.
- A refused manual message cleared its draft; the composer keeps it and says it wasn't delivered.
- A reload during shop checkout lost the order; Connect keeps it for the session and resumes it.
- A lapsed plan blocked cancelling client subscriptions, disconnecting Google and cancelling a scheduled broadcast; these stay available.
- A missed plan webhook left access wrong; opening Plans and the daily `sync_plans` job now follow Stripe's status.
- A widget embedded below the fold could stay at its 256px loading height; the frame now reports its height on changes Chrome still delivers offscreen.
- Manual payment replay sent duplicate receipts: receipt intent now commits inside the original payment command.
- Public booking replay sent duplicate acknowledgments: a distinct creation delivery scope preserves later approval/cancellation messages.
- Contact ambiguity displayed “slot taken” and cleared the chosen time: localized contact guidance now keeps details and time available for correction.
- Catalog creation/opening-stock response loss could duplicate products or stock: API idempotency and the shared form retain/replay original commands before applying edited values.
- Selected staff-pay confirmation included other payees: amount and paid IDs now refer to the same selected scope.
- POS history crashed on serialized JSON null tip splits: the shared model accepts the nullable representation.
- Invoice editors could read incomplete initial line state or lose restored discounts: shared loading/draft handling now preserves them.
- PAD mandate creation sent mutually exclusive Stripe parameters: the real provider regression verified the corrected request.

The independent application review found no further concrete High/Medium regression in these changes. Tests preserve known boundaries: catalog recovery is within the mounted editor, staff-pay lost-response replay is explicitly API replay, and queued notification acceptance is not arbitrary external-provider-crash exactly-once delivery.

## Remaining execution

1. Add cases for the audit areas that have none yet: messages and consent, plans and seats, reviews and Google, admin and the marketing site, onboarding choices, and shop holds.
2. Build the remaining anchor journeys (FLOW02 to FLOW10 in the brief); FLOW01 is covered in part.
3. Close the residuals the fixes left: booking-change and estimate-send notices still send after commit without a queued delivery, a queued review invitation doesn't recheck email opt-out, a nil tax return can't be filed, and an SMTP connection refusal marks a delivery ambiguous instead of retrying it.
4. Cover a program deposit, which needs the Stripe lane, and mixed-tax or capped fixed estimate discounts.
5. Provision GitHub's protected `stripe-sandbox` environment, dedicated CI credentials and ready CI merchants, so the Stripe lane runs in hosted CI.
6. Qualify iOS and native release builds, Firefox and WebKit for auth and payment, and measure flakes with shuffled and repeated runs.
7. Strip a leading `--` from the runner's test arguments: today it reaches Playwright and turns a `--grep` into a file filter, so the whole lane runs.

The pre-existing user edits to Connect's `PublicManage.tsx` and `PublicPay.tsx` stay in the main checkout and are not part of this branch. A long-label narrow-screen manage-page layout concern remains unverified. The branch is on PR #59 and nothing has been deployed.

The filings lane seeds once at noon on the first day of the current Vancouver quarter using the supported seed clock. API and browser clocks stay real. It records completed-quarter filings in the app; it does not submit to tax authorities or transfer money. Cleanup reaping preserves prior provider/process failures and treats unknown outcomes as incomplete.

The genuine event-delay case proves zero local settlement/receipt effects before release and exactly one afterward. Customer checkout currently shows optimistic paid immediately after Stripe confirms; reloading while the event is held shows unpaid. This existing UI boundary remains explicit, so PAY-E01 is not marked fully complete. The relay preserves original signed bytes, checks exact owned intent/customer/account, and releases within signature validity. Latest provider cleanup refunded five successful charges and canceled one intent; no owned containers or volumes remained.

Strict access-revocation/catalog qualification: `.scratchpad/e2e-7b0b1698509f/`, source `91ed7d755852b79af9dd8418e13b0494052ea4d04ce5f6dea7d1573894737f7d`; all five passed on first attempt with cleanup successful. SYN02 covers rendered/API access loss after downgrade/removal, including an offline reconnect. It does not directly inspect production-web SQLite storage or claim UI role-management coverage.

Provider cleanup now rejects incomplete or duplicate customer lineage before mutations. Relay shutdown interrupts tracked sockets and bounds worker draining; an uncooperative worker produces explicit failure evidence. Focused failure checks and the six genuine Stripe cases passed after these changes.
