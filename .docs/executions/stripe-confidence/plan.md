# Stripe confidence pass

Goal: every surface that takes, holds, moves or shows money through Stripe is shown working against real Stripe, on every platform that exposes it, with the books agreeing with Stripe to the cent, and the result is repeatable rather than a single green run.

"Shown working" means one of three things per surface, in this order of preference:

1. **Automated against the sandbox** (Stripe browser lane, sandbox suite or native lane), green on five consecutive full runs.
2. **Walked by hand on staging** with the walk recorded, when automation can't reach it (real devices, Dashboard-only actions).
Anything that needs real money or a physical card stays with Naib and is listed at the end. The live account (`acct_1UPkgI2VMt3M8sRM`) is unused until production is deployed, so this pass works only in the sandbox that local, CI and staging share.

## Guardrails for the whole run

- Writes go only to the **Clientbridge sandbox** (`stripe -p clientbridge`, `acct_1UPkgSFGqw7iO9oD`) and only to leased QA merchant pairs. Never the demo account `acct_1UPnLpFGqw5ObEW5` or any demo business, since staging books their events.
- Live mode is not touched at all, and the CLI's selected account is not switched.
- The other CLI profiles (`default` is PS - Staging, `galleo`) are never used.
- Local `stripe_setup --apply` is not run (it flips staging's portal return URL). If setup objects need changing, it runs from current code with `WEB_BASE_URL` set to staging, dry run first.
- No retries to get green: a failure is diagnosed to its cause and fixed in code or test, per "no tests should ever fail".
- Android runs only in CI (the shared emulator is not started); iOS runs on the Clientbridge iPhone 17 Pro simulator.
- Schema changes, if a fix needs one, stop for approval.
- Work happens in a worktree on one branch, `stripe-confidence`, with commits per milestone; one PR at the end, merged only when Naib says so. Ticket text changes go to the launch doc first, then Linear word for word; ticket statuses are not moved without asking.

## Phase 0: baseline (no code changes)

1. Create the worktree from `origin/main`; `make up migrate seed-core`.
2. Run, and keep each log in `.scratchpad/stripe-confidence/`:
   - `make test-backend` with the payments test files, `make test-contract` (stripe-mock), `make test-stripe-qa` (sandbox suite on the local pair, with `--record check` for event drift).
   - `make test-stripe-browser` with both shards and `--payout-case`, in Chromium, Firefox and WebKit.
   - `make test-stripe-native PLATFORM=ios DEVICE=09A5CAAC-79B2-4DE6-88BE-F9B038BDEA9B` after `native-build ios` (NATIVE-PAY-02 and NATIVE-PAY-01).
3. Pull the last 20 `stripe / *` CI results on `main` and list every case that failed at least once, with its annotation (Stripe rate limit, outage, or test failure).
4. Output: a baseline table of case, lane, browsers, local result, CI failure count.

## Phase 1: the surface matrix

Build `.docs/executions/stripe-confidence/matrix.md`: one row per surface and platform, the cases that cover it, and the gap. The starting inventory, from the code and the launch tickets:

| Area | Surface | Platforms | Covered by today | Gap to close |
| --- | --- | --- | --- | --- |
| Onboarding (CB-5) | Start onboarding, requirements in plain words, paused payouts, failing bank, account management | web, mobile | STR-E15, STR-E09, STR-E13, `setup.payments.yaml` | Mobile onboarding against the sandbox; bank swap to the failing test account then Check again (step 3) |
| Plan billing (CB-6) | Checkout, trial, seats, portal, failed renewal, past due to lapsed, read-only | web, Connect (blocked writes) | fake and contract tiers only | PLN-E2E-04, PLN-E2E-05, PLN-E2E-06 |
| Saved methods (CB-12) | Save card, default, remove, setup link card and bank, PAD mandate, refused debit | web, mobile, Connect | STR-E26, STR-E27, STR-E30, NATIVE-PAY-01, NATIVE-PAY-02 | Register NATIVE-PAY-01 in `cases.json` (it is tagged but not listed); missing and expired setup link tokens |
| Online booking (CB-24) | Deposit, request hold then approve or decline, abandon and reaper, reload midway, manage link deposit | Connect, web, mobile | STR-E17, STR-E28, SCH-E2E-17, FIN-DEPOSIT-04 | FIN-DEPOSIT-14; decline of a paid request refunds once; manage link deposit with a real card |
| Desk (CB-30) | Card sale, decline, cancel then cash, saved card, gift card plus cash | web, mobile | STR-E05, STR-E06 | STR-E19, SALE-E2E-15 |
| Tap to Pay (CB-31) | Terminal checkout on a product and an invoice, cancel mid-tap | iOS, Android | none | NATIVE-PAY-03 on a simulated Tap to Pay reader (see Phase 2 note) |
| Tips and discounts (CB-32) | Percent tip at the desk, custom tip on the pay link, crew tip | web, Connect | none against Stripe | STR-E20, SALE-E2E-16, PAY-E2E-04 |
| Invoices and pay links (CB-34) | Card, 3DS pass and abandon, decline then correct, held event, saved card remainder | Connect, web | STRIPE-BROWSER-01 to 06, STR-E01 | STR-E21; the held-event case listed as `STR-E30` collides with the PAD case, so it becomes STR-E33 |
| Wallets | Apple Pay and Google Pay buttons on Connect | Connect | `wallet.stripe.ts` (button presence) | Domain registration check on staging and live (Phase 4) |
| Memberships (CB-40) | Start, renew on a test clock, failed renewal, covered visit, cancel and resell | web, mobile | STR-E07 | ENT-E2E-08 |
| Shop (CB-41) | Paid order, stock limit, ready, picked up | Connect | STRIPE-BROWSER-07, fake-backed shop cases | STR-E22 |
| Gift cards (CB-38) | Sell by card, decline retry, redeem against a sale | web, Connect | STR-E03 (dispute side) | ENT-E2E-05, ENT-E2E-06, ENT-E2E-09 |
| Packages (CB-39) | Sell by card, refund unused | web | fake-backed | Covered by STR-E23's package refund leg |
| Programs (CB-20) | Camp enrolment deposit, cancel enrolment | Connect, web | FIN-DEPOSIT-10, FIN-DEPOSIT-11 | CLS-E2E-03 |
| Refunds (CB-42) | Partial then rest, desk sale, package, gift card, after staff pay, Dashboard refund, refund that fails later | web, mobile | STR-E02 (part refund leg) | STR-E23, plus mobile refund composer in the native lane |
| Disputes (CB-43) | Inquiry, escalate and lose, part-used gift card, win, refund blocked | web | STR-E02, STR-E03, STR-E04 | STR-E24 (won), inquiry that closes without escalating |
| Payouts and fees (CB-47) | Fee per payment, schedule change, manual payout, history paging, contents, CSV | web, mobile | STR-E01, STR-E08 (opt-in), STR-E12 | Make STR-E08 run every time (fund the balance first); STR-E25; payout CSV totals against Stripe; mobile Payouts screen in the native lane |
| Recovery | Webhook dedupe, out-of-order delivery, replay, reconcile, drift page | backend, admin | sandbox suite, STR-E12 | STR-E25 (withheld then replayed once); duplicate and reordered delivery through the relay; admin drift page with a seeded finding |

The matrix is the contract for "done": every row ends with a passing case or a recorded staging walk.

## Phase 2: write the missing automated cases

Each case follows `.docs/engineering.md` ("Where an e2e test goes", the four-part matrix), uses the shared helpers in `e2e/stripe/support/`, cleans up what it creates, checks the ledger against Stripe's balance transactions, and is registered in `backend/e2e/cases.json` with seconds in `seconds.json`. Order, by risk to money first:

1. **Money in and back out:** STR-E19 (desk card, decline, saved card), STR-E20 (pay link tip), STR-E21 (saved card remainder), STR-E33 (held invoice event), STR-E23 (refund that fails later, Dashboard refund, package and gift card refunds), STR-E24 (won dispute and inquiry closed), ENT-E2E-05 (gift card by card).
2. **Recurring money:** PLN-E2E-04 and PLN-E2E-05 on test clocks (new `plans.stripe.ts`), ENT-E2E-08 (membership cancel and resell).
3. **Recovery:** STR-E25 using the relay to hold an event past the replay window and release it, plus a case that delivers one event twice and two events out of order.
4. **Payouts:** a lane step that funds the QA merchant's available balance (a `4000000000000077` charge, which settles to available at once) so STR-E08 runs on every lane run; payout CSV totals against Stripe's payout list.
5. **Fake-backed web cases that touch payments:** SALE-E2E-15, SALE-E2E-16, PAY-E2E-04, ENT-E2E-06, ENT-E2E-09, CLS-E2E-03, BILL-DOC-23, FIN-DEPOSIT-14, PLN-E2E-06.
6. **Phone:** NATIVE-PAY-03, Tap to Pay on the Terminal SDK's simulated reader on the iOS simulator (simulated card, cancel mid-tap, then a declined simulated card), a refund from the refund composer and the Payouts screen, all under `apps/mobile/e2e/stripe/`. If the simulated Tap to Pay reader can't run on the simulator, I stop that item and record it as a device step for Naib rather than faking it.

Any product bug a new case finds is fixed at its cause in the same branch, with a backend test beside it.

## Phase 3: prove it repeats

1. Five consecutive full local runs of the Stripe browser lane (both shards, all three browsers, payout case on), plus the sandbox suite with event drift check, plus the iOS native lane twice.
2. Push the branch; the PR's CI runs the Stripe lane on the CI pairs and Android native lanes. Two consecutive green CI runs.
3. Any failure, local or CI: trace, fix the cause, restart the count at zero.

## Phase 4: sandbox and staging configuration

Read-only, with every finding written into the matrix:

1. **Sandbox endpoints for staging** (`api.staging.clientbridge.ca`): the Connect and platform endpoints and the thin destination exist, point at staging, and subscribe to exactly `PAYMENT_EVENTS`, `PLAN_EVENTS` and the thin list at the pinned API version; recent deliveries to staging have no failures.
2. **Sandbox objects**: products and prices by lookup key, tax settings, Connect branding and onboarding settings, the Billing Portal configuration returning to staging, and payment method domains for staging's Connect host. Settings the API can't read (Smart Retries "cancel after the last retry", dispute and Radar settings) I check in the sandbox Dashboard through the browser, read-only. The same checklist is saved as a production go-live step in `.docs/payments.md` for the live account.
3. **Every flow in the matrix walked on staging** (approved 2026-11-09), on a QA business I sign up on `app.staging.clientbridge.ca` with its own sandbox connected account onboarded through Stripe's test identity, never a demo business. Staff web through the browser, Connect as a client, and the mobile app on the iOS simulator pointed at staging where the flow is phone-only. Each walk checks the screen, the business's books and the sandbox Dashboard, and is logged in `matrix.md` with the date and the commit staging was on. The QA login is kept in `.scratchpad/stripe-confidence/staging-qa.md`, never in chat or the repo. The staging pass starts in parallel with Phase 2, since staging already runs main, and is repeated on the final branch's flows once it merges.

## Phase 5: wrap up

1. Update `cases.json` statuses, each ticket's Automated by and To automate lines in `.docs/launch-readiness.md` and then in Linear word for word, and `.docs/payments.md` where behaviour or the harness changed.
2. Run `make check`, open the PR (CB-prefixed title per ticket, plain description), and report: the final matrix, every bug found and its fix, the run counts, and the sandbox config findings.
3. Delete this execution folder once merged, keeping anything durable in the main docs.

## Left for Naib (needs real money or hardware)

- The $1 live payment through a pay link on `pay.clientbridge.ca`, checked in the live Dashboard and the ledger, then refunded (operations.md, production step 5).
- Tap to Pay on a physical iPhone and Android phone, including an Interac-only debit card (CB-31 step 4).
- At production go-live: the live account's endpoints, products, portal, domains and Dashboard settings, from the checklist Phase 4 saves.

## Rough size

About 20 new cases, a funding step and a relay extension. The lane's recorded case times add up to about 21 minutes per browser today, so a three-browser run is about an hour and Phase 3 is roughly five to six hours of wall clock before the new cases add to it. Expect two to three working days end to end, most of it unattended runs.
