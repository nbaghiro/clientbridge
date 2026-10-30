# Real Stripe in CI: progress

## Task 1: merchant pool (done 2026-10-29)

Six pairs in the Clientbridge sandbox (platform `acct_1UPkgSFGqw7iO9oD`), each tagged `clientbridge_qa=payments`, `clientbridge_qa_environment=ci-<n>` and `clientbridge_qa_slot`, with Stripe's test identity, the Canadian test bank account (transit 11000, account ending 6789) and terms accepted. All twelve show charges and payouts enabled with nothing due.

| Pair | Slot a                  | Slot b                  |
| ---- | ----------------------- | ----------------------- |
| ci-1 | `acct_1UW1EAFGqwpchJj8` | `acct_1UW1EKFGqw5WPraS` |
| ci-2 | `acct_1UW1EcFGqwCjmvBg` | `acct_1UW1EmFGqwyiuFg7` |
| ci-3 | `acct_1UW1F2FGqwYug5E4` | `acct_1UW1FDFGqwSDkSq6` |
| ci-4 | `acct_1UW1FUFGqwETL0Wd` | `acct_1UW1FfFGqwnv2Ulo` |
| ci-5 | `acct_1UW1FvFGqwMR1MhI` | `acct_1UW1G6FGqwvqJNFk` |
| ci-6 | `acct_1UW1GNFGqwQLONGh` | `acct_1UW1GWFGqw1tQVIQ` |

How they were made, for adding pairs later:

1. `uv run python -m scripts.stripe_qa_accounts --environment ci-<n> --apply --prepare --bank` creates and prefills a pair (rerunning it is safe).
2. For each account, open a fresh Stripe-hosted onboarding link in a visible Chrome started with `--remote-debugging-port` and a new profile, then click Use test phone number, Use test code and Agree and submit once each. A headless browser gets Stripe's hCaptcha challenge; a visible one passed all twelve without one. One page load timed out and passed on a retry.
3. `uv run python -m scripts.stripe_qa_accounts --environment ci-<n>` confirms both show charges and payouts enabled.

Accounts in this sandbox are shared with staging and local development, but no business there is linked to a pool account, so their events reach staging's webhook and are ignored.

## Task 2: leasing a pair (done 2026-10-29)

`backend/e2e/stripe_pool.json` holds the platform and the six pairs, and `e2e/stripe_pool.py` reads it. The browser lane, its recovery and `scripts/stripe_qa.py` take `--pair ci-N`, merge that pair's ids over the environment and lock `.scratchpad/stripe-qa-ci-N.lock`. Environment credentials now require a pair, so the single hosted `ci` pair and the three Actions variables that named it are retired; the cloud stack sets only the two keys. The two old `ci` accounts still exist in the sandbox, tagged `ci`, and nothing reads them.

Verified: STR-E01 passed on `ci-1` with provider cleanup clean, while the sandbox suite ran on `ci-2` at the same time.

## Task 3: real-Stripe API suite (done 2026-10-29)

The existing sandbox suite (`tests/sandbox/`, `make test-stripe-qa`) is the API suite, with three new files of scenarios: 3D Secure required then canceled, a lost and a won dispute with Stripe's dispute test card and evidence values, and a manual payout from created (transit) to paid (bank). Each dispute test checks our Stripe ledger account against the charge's and the dispute's balance transactions. The payout is marked `slow` and runs with `--full` and tops its pair up with a `pm_card_bypassPending` charge first, because earlier refunds and lost disputes drain the available balance.

In test mode Stripe can report a manual payout as paid already in its `payout.created` event, and our handler then books the transit and bank journals together, so the test checks both journals and the final balances rather than a moment in transit. Two real-Stripe problems found and fixed on the way: Stripe returns `lock_timeout` while it is still updating a new dispute (the tests now retry those reads), and a top-up charge reaches the available balance a few seconds after it succeeds (the payout test waits for it).

Measured on `ci-2` from a laptop: 17 scenarios in 2m22s with the payout, 2m51s on the first run. A membership on a test clock was already covered by `test_stripe_sandbox.py`. A PAD debit to succeeded is not built yet; it needs the mandate flow and Stripe's simulated debit timing, and is the next scenario to add.

## Task 4: CI wiring (done 2026-10-29)

- `.github/workflows/e2e-stripe.yml`, the `stripe` lane of `e2e.yml`: a lease job picks `ci-((run number mod pool size) + 1)` and applies the path filter; `api` runs the suite; `browser` runs the lane when payments code changes or on a run started by hand. Both hold the concurrency group `stripe-pool-ci-N`. With no sandbox key (a fork, or before `pulumi up`), the jobs skip with a notice.
- `ci.yml` passes only the two Stripe secrets to `e2e.yml`, which passes them to the lane. The lane's jobs set `continue-on-error`, so they report without failing `e2e` or `ci-result`.
- There is no nightly run. Its cases run on every pull request and `main` commit instead: the drift check always, the slow payout scenario and the browser lane when payments code changes. `stripe-qa.yml` is removed, and `stripe-real.yml` can be started by hand for a full run.
- `scripts/stripe_qa.py` labels each failure `Stripe rate limit`, `Stripe outage` or `Test failure` in the run's annotations and `results.json`.
- `.github/actions/stripe-cli` installs the pinned, checksummed Stripe CLI for both jobs.

Not yet run on GitHub: the repository has no sandbox key until the cloud stack is applied with `stripeTestSecretKey` and `stripeTestPublishableKey`.

A known limit of GitHub concurrency groups: a group keeps one waiting run, so a third run on the same pair cancels the one already waiting. With six pairs in rotation that needs six runs to start within one run's length.

## Task 5: keeping the fake honest (done 2026-10-29)

`e2e/stripe_shapes.py` records the shape of real event objects (field names and types, metadata left open) and compares fakes with it. The sandbox run records with `--record`; `tests/fixtures/stripe_events/` holds the first recording, from `ci-2`, for nine event types. `stripe_event` in `tests/helpers.py` checks every fake webhook against it, and every CI run fails when an event it received no longer has a recorded field. The payout events were recorded from a full run on `ci-3`. Invoice and failed-refund events aren't recorded, because no sandbox scenario produces them.

## First CI runs (2026-10-30)

The API suite passed every scenario in CI in about 2.5 minutes. The browser lane had fallen behind the UI while it ran only by hand: Take payment and record-payment had moved from dialogs into the ticket and the invoice drawer (`687eac98`), and the lane kept its own copies of those locators. It now uses the web suite's `paymentPanel`, `saleTicket`, `skipTip`, `choosePaymentMethod` and `paymentDrawer`, and its trigger covers the screens it drives. Two flakes were fixed at the cause: the card form lookup skips an iframe Stripe replaces while it polls, and the submit check listens on the document, so a re-rendered pay button is still observed. Failed cases now keep a screenshot and a trace in the CI artifact. STR-E13 and the WebKit card cases still failed in CI only; their screenshots from the next run decide the fix.

## Left

- Task 6: after two weeks of runs without a Stripe-caused failure, remove `continue-on-error` from the lane's two jobs.
- Apply the cloud stack with the two keys, so the jobs run.
- A PAD debit scenario.
