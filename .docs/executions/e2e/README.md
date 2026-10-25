# End-to-end test suite execution

The suite exercises actual rendered interfaces, authenticated APIs, committed PostgreSQL transactions, PowerSync replicas, local mail/storage and genuine Stripe sandbox outcomes. Shared helpers handle sessions, owned prerequisites and observable waits; each scenario states its own exact expected and forbidden effects.

**Execution is ongoing.** The registry contains 48 verified atomic cases, including one Android development-build case. These do not complete the 302 broader audit families. [coverage.json](coverage.json) records precise behavior, parent families, limitations and runtime evidence. The [comprehensive product brief](../../reviews/product/comprehensive-e2e-brief.md) remains the product map; [history.md](history.md) preserves diagnostic failures, fixes and earlier results. [evidence.json](evidence.json) is a source-assertion inventory, not runtime proof.

## Latest verification

| Lane | Result | Evidence boundary |
| --- | --- | --- |
| Cross-surface journeys | 6/6; 36.8 seconds | Strict unchanged source; no skips/retries; owned cleanup passed |
| Real Stripe browser | 6/6; 2.4 minutes | Strict unchanged source; owner invoice/payment bridge plus genuine event hold/release; exact provider/process/Docker cleanup |
| Full default web | 61 passed + one presentation skip; 6.3 minutes | Strict unchanged source; owned cleanup passed |
| Full default Connect | 50 passed + one presentation skip; 42.2 seconds | Strict unchanged source; owned cleanup passed |
| Pseudo locale | Web 1/1; Connect 6/6 | Both strict unchanged-source runs; owned cleanup passed |
| Finance, auth and concurrent hours editors | Included in strict full web pass | Exact invoice/payment journal attribution, real CSV/ZIP, one stale revision conflict and explicit repair |
| Access revocation and catalog recovery | 5/5 strict; 46.2 seconds | Two real member browsers, API downgrade/removal, exact owner controls; all four catalog cases |
| Completed-quarter filings | 1/1 strict; 12.8 seconds | Raw-ledger totals, exact balanced journals and filing date, validation/replay/overlap; cleanup passed |
| Backend regression | 2493 passed, 50 deselected; 93.33% coverage | Fresh owned database; external tiers separate |
| Runner/recovery/relay harness | 74 selected checks passed | Ownership refusals, cleanup failure recording, quarter anchors and signed relay transport; other harness tests separately verified |
| Frontend regression | All six package tasks; 569 app-core tests in each configured timezone | Vancouver, Halifax and Tokyo |
| Infrastructure | Lint/typechecks and 105 tests passed | No deployment |
| Native transaction | Android 1/1 | Development build; iOS and release-build qualification remain open |

Full web61 passed on source `c5f82cd5e2957be72a97a0e3274febf648061b7dbef0620bfd7530afde14244e` (`e2e-d267570d4a7f`). Later targeted web5 (`e2e-7b0b1698509f`), Connect50 (`e2e-e83219560593`), filings1 (`e2e-3376d9cab069`) and journeys6 (`e2e-91256a3e3042`) all passed on source `91ed7d755852b79af9dd8418e13b0494052ea4d04ce5f6dea7d1573894737f7d`. Reports live under `.scratchpad/<run>/`. Stripe six-case qualification after cleanup hardening is `.scratchpad/e2e-bf4adfa3061f/`, on the same `91ed7d…` source. Exact hashes and all prior runs remain in `coverage.json`. No hosted CI run is credited.

Backend/frontend lint, strict typechecking, structure/unused-code checks and all formatting checks passed. Code generation passed against a temporary Git index containing the intended generated changes; the user's real index was untouched. This is component-gate evidence, not a claim that one aggregate `make check` invocation or hosted pipeline passed.

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

Each isolated run applies the approved existing migration chain through `cb0028` to its new database and seeds core demo data before starting services. No schema, model or new migration is part of this changeset. Browser time stays real; backend regression uses the repository's frozen clock and supported fresh-database wrapper.

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

1. Current web/Connect/pseudo and provider qualification passed; retain that evidence while expanding the next slice.
2. Preserve strict reports/exports, completed-quarter filings and genuine Stripe event delay qualification; continue remaining finance/payment edges. No full-family coverage is implied.
3. Continue the broader family matrix: more deposit/payment/refund and entitlement lifecycles, roles/tenant boundaries, worker/provider recovery, documents/configuration and native/device paths. Existing lower-level assertions supplement real user journeys.
4. Provision GitHub's protected `stripe-sandbox` environment, dedicated CI credentials and ready CI merchants; hosted CI has not run.
5. Qualify iOS and native release builds, and complete remaining lifecycle recovery checks.

The pre-existing user edits to Connect's `PublicManage.tsx` and `PublicPay.tsx` were preserved. A long-label narrow-screen manage-page layout concern remains unverified. No commit, push or deployment has been performed.

The filings lane seeds once at noon on the first day of the current Vancouver quarter using the supported seed clock. API and browser clocks stay real. It records completed-quarter filings in the app; it does not submit to tax authorities or transfer money. Cleanup reaping preserves prior provider/process failures and treats unknown outcomes as incomplete.

The genuine event-delay case proves zero local settlement/receipt effects before release and exactly one afterward. Customer checkout currently shows optimistic paid immediately after Stripe confirms; reloading while the event is held shows unpaid. This existing UI boundary remains explicit, so PAY-E01 is not marked fully complete. The relay preserves original signed bytes, checks exact owned intent/customer/account, and releases within signature validity. Latest provider cleanup refunded five successful charges and canceled one intent; no owned containers or volumes remained.

Strict access-revocation/catalog qualification: `.scratchpad/e2e-7b0b1698509f/`, source `91ed7d755852b79af9dd8418e13b0494052ea4d04ce5f6dea7d1573894737f7d`; all five passed on first attempt with cleanup successful. SYN02 covers rendered/API access loss after downgrade/removal, including an offline reconnect. It does not directly inspect production-web SQLite storage or claim UI role-management coverage.

Provider cleanup now rejects incomplete or duplicate customer lineage before mutations. Relay shutdown interrupts tracked sockets and bounds worker draining; an uncooperative worker produces explicit failure evidence. Focused failure checks and the six genuine Stripe cases passed after these changes.
