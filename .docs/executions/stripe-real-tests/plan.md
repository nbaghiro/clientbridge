# Real Stripe in CI

Status: tasks 1 to 5 and 7 done on `stripe-real-tests`; task 6 waits for two weeks of runs. The nightly run was folded into the per-change runs (see progress). Written 2026-10-29, based on `main` at `cb3f08c7`. See [progress](progress.md).

Today only the Stripe browser lane talks to real Stripe, and it runs by hand. Every other test, in CI and locally, uses the recording fake behind `PaymentGateway`. The fake is fast and deterministic, but it can't catch Stripe behaving differently from what we assumed: Stripe.js and 3D Secure in a real browser, the webhooks Stripe actually sends, the fees it really charges, and changes on its side. This plan runs real Stripe in CI at three levels, sized so a pull request doesn't wait on Stripe for long.

## End state

- **Every pull request** runs a real-Stripe API suite of about 3 to 5 minutes: charges, declines, 3D Secure, refunds, disputes, payouts, a membership on a test clock and fees, each checked against our ledger. It reports results first and becomes a required check once it has been stable for two weeks.
- **Pull requests that touch payments** (path filter) and **every night on `main`** run the full Stripe browser lane.
- **Every night** the run records real Stripe responses and compares them with what the fake returns, so drift in the fake is caught.
- Each run leases one pair from a pool of dedicated QA merchants, so runs never share a merchant and never touch demo or staging data.

## Decisions

| #   | Decision                            | Answer                                                                                                                                                                                                                     |
| --- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Which accounts the tests use        | A dedicated pool, not the demo businesses. Staging and local dev are linked to the demo accounts, so staging's webhook would book every test charge, refund and dispute into the demo, and runs would collide with people. |
| D2  | Pool size                           | Six pairs, `ci-1` to `ci-6`. A pair is slot a (the business under test) and slot b (another business, for tenancy checks).                                                                                                 |
| D3  | Whether the PR suite blocks merging | Not at first. It reports results, and becomes required after two weeks without a failure caused by Stripe.                                                                                                                 |
| D4  | Pull requests from forks            | They get no secrets and skip the real-Stripe jobs. The sandbox key lives in repository secrets (PR #84).                                                                                                                   |
| D5  | The existing local and hosted pairs | Unchanged. The `local` pair stays for a developer's lane; the `ci` pair stays for `stripe-qa.yml` until task 4 moves it onto the pool.                                                                                     |

## Where we start

- `backend/e2e/stripe.py` runs the browser lane on the shared test tier with a `local` or `ci` merchant pair, takes a file lock (`.scratchpad/stripe-qa.lock`), forwards webhooks with `stripe listen`, and refunds or recovers everything a run created.
- `backend/tests/e2e/test_stripe_e2e.py` holds a few real-Stripe backend tests that skip without `STRIPE_TEST_SECRET_KEY`.
- `.github/workflows/stripe-qa.yml` runs the sandbox suite and the browser lane from `main` by hand, reading the sandbox key and merchant ids from repository secrets and variables once the cloud stack sets them.
- `backend/scripts/stripe_qa_accounts.py` creates a tagged pair (`clientbridge_qa_environment`, `clientbridge_qa_slot`), prefills Stripe's test identity and attaches the Canadian test bank. Accepting Stripe's terms needs a browser once per account.

## Tasks

1. **Merchant pool.** Done 2026-10-29. `stripe_qa_accounts` accepts `ci-1` to `ci-99`; six pairs were created and onboarded in a visible Chrome (Stripe's hCaptcha challenges headless browsers, not a visible one). Account ids are in [progress](progress.md).
2. **Leasing a pair.** A hosted run takes pair `(run number mod 6) + 1` under a GitHub concurrency group for that pair (`stripe-pool-<n>`), so a busy pair queues its next run instead of sharing. A local run takes a file lock per pair. The lane's `validate_context`, `stack_credentials` and recovery accept a pool environment and read the pair's ids from a checked-in manifest (`backend/e2e/stripe_pool.json`, ids only, no secrets).
3. **Real-Stripe API suite.** Backend tests marked `stripe_real`, run by `make test-stripe-real` on the shared test tier with `stripe listen` forwarding the leased pair's events. Each test creates its own objects with the run's metadata, checks our ledger against Stripe's balance transactions, and is cleaned up by the lane's recovery. Scenarios: card charge and fees, decline then success, 3D Secure required, partial and full refund with fee return, dispute won and lost with Stripe's dispute test cards, manual payout to paid, membership renewal and failure on a test clock, a PAD debit to succeeded. Measure the run against Stripe's test-mode rate limit before adding more.
4. **CI wiring.**
   - PR job `stripe-real` in `ci.yml`, after lint, reporting only (not in `ci-result`).
   - PR job for the browser lane, gated by a path filter on Stripe, payments, ledger, Connect pay pages and the lane itself.
   - `stripe-qa.yml` gains a nightly schedule and moves from the `ci` pair to the pool.
   - Failure output names Stripe outages and rate limits apart from test failures, so a red run says whose problem it is.
5. **Keeping the fake honest.** The nightly run records the Stripe responses each scenario reads (intents, charges, balance transactions, refunds, disputes, payouts, events) with ids and timestamps normalized, and fails when the fake's answer for the same scenario differs in shape or meaning. Recordings are committed so a fake change is reviewed against them.
6. **Making the PR suite required.** After two weeks without a Stripe-caused failure, add `stripe-real` to `ci-result`.
7. **Docs and close-out.** Update the Stripe test tiers in `engineering.md`, the sandbox section of `operations.md` and the pool in `payments.md`; delete this folder.

## Risks

- **Rate limits.** Test mode has its own, lower limit. Task 3 measures one run and caps parallel runs at the pool size.
- **Stripe outages.** A real-Stripe job can fail for reasons outside our code, which is why it starts as reporting only and why failures are labelled.
- **Pool contamination.** A run that dies before cleanup leaves objects on its pair. The browser lane's recovery step cleans run-owned objects from its manifest. API suite leftovers are only extra test objects: every run creates its own, and the payout tops up its balance first.
- **Balance drain.** Refunds and lost disputes draw on a pair's available balance. Only the nightly run makes a manual payout, and it tops up its pair with a `pm_card_bypassPending` charge first.
