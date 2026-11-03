# Stripe payments setup: full coverage and recorded runs

Status: in progress. A1 is done (see its result below). A2 runs in CI on the leased pair's slot b account. A3 passes on
iOS, and C is done apart from its first recorded CI run. B is next.

CB-5 has five QA steps. Today two are covered by tests that run in CI (STR-E09 and STR-E13), and STR-E09 writes
the paused state into our database instead of holding payouts in Stripe. This execution adds tests for the rest,
so every step runs in CI on each change to payments, and adds one setting that records any e2e run as watchable
video for review.

## End state

- Each CB-5 step has a test in the Stripe lane that runs on every pull request that touches payments.
- The mobile Getting paid screen is checked in its ready, paused and requirement-due states on the Android lane.
- `E2E_RECORD=1` on any Playwright or Maestro run saves a slowed-down video of each test, with a cursor, action
  labels and its step titles, in the run's `recordings/` folder. A manual CI run with `record` uploads them.
- CB-5 lists these tests under Automated by, and is marked Automated unless a step still needs a person.

## Where we start

- The Stripe lane (`e2e-stripe.yml`) leases one of six onboarded merchant pairs from `backend/e2e/stripe_pool.json`
  and runs the browser cases in two shards. It reports on pull requests and is not yet a required check.
- `test_fresh_v2_account_reports_kyc_requirements` creates a fresh Accounts v2 account and closes it afterwards.
  `scripts/stripe_qa_accounts.py` prefills Stripe's documented test identity and the Canadian test bank.
- The pool accounts were onboarded in a visible Chrome, because Stripe's hosted onboarding shows an hCaptcha to
  headless browsers (see `stripe-real-tests/progress.md`). Whether embedded onboarding does the same is open.
- The app creates accounts with `dashboard: "none"`, so our platform collects the requirements.
- `E2E_RECORD=1` turns on video in the web Playwright config only, and the videos stay in each run's
  `test-results`.
- Playwright 1.63 records with `showActions` (an animated cursor and a label per action) and can show chapter
  cards with `page.screencast.showChapter`.
- Maestro's `setup.yaml` checks that mobile Getting paid reads ready.

## Coverage today

| Step | Test | Gap |
| ---- | ---- | --- |
| 1. Complete onboarding with Stripe's test identity | None | No test goes through onboarding. |
| 2. An unfinished or rejected requirement | None (STR-E14 planned) | Wording for a real requirement and Stripe's reason for a rejected detail. |
| 3. Payouts on hold, cards still work | STR-E09 | The hold is written to our database, and no card is taken while it holds. |
| 4. Bank details behind Stripe's sign-in | STR-E13 | Covered up to Stripe's sign-in, which is the step's expectation. Entering the code stays by hand. |
| 5. A $10 test card payment | STR-E01 is the nearest | No first payment on a newly ready account. |

## Tasks

### A. Spikes

1. **Embedded onboarding in a headless browser.** Create a fresh account, open Getting paid on the local stack in
   headless Chromium and complete Stripe's embedded onboarding with its test values (test phone number, code
   `000000`, SIN `000000000`, the test bank, terms). Passes if it reaches ready without an hCaptcha or a Stripe
   sign-in. If it fails, step 1 stays by hand and B1 covers the app's side of it.

   **Result (2026-11-03): fails.** "Add information" opens Stripe's sign-in popup on `connect.stripe.com`,
   because the app's account sessions keep Stripe's user authentication on. In headless Chrome an hCaptcha
   challenge covers "Use test phone number", so the test values can't be entered. The API can't finish the
   account either: Stripe refuses a terms attestation with "You cannot accept the Terms of Service on behalf of
   accounts where requirement collection is owned by Stripe", and a fresh account still owes
   `identity.attestations.terms_of_service.account`. A fresh account therefore can't reach ready without a
   person, and every test that needs a ready account uses the pool, whose accounts were onboarded by hand.
2. **A real payout hold.** On an onboarded account (a fresh one can't take payouts, see A1), switch the bank to Stripe's failing test account (`000111111116`)
   and make a manual payout. Passes if Stripe reports payouts disabled with an external account requirement while
   charges stay enabled, and records how long that takes. If not, STR-E09 keeps the mirrored state and the ticket
   says so.
3. **Maestro recording.** Run `setup.yaml` wrapped in `startRecording` and `stopRecording` on the iOS simulator and
   the Android emulator. Passes if both produce a playable mp4 of the whole flow.

   **Result (2026-11-03): passes on iOS.** On the Clientbridge iPhone 17 Pro simulator a wrapper flow with
   `startRecording` and `stopRecording` in `onFlowComplete` wrote an h264 mp4 at the device's resolution, for a
   passing flow and for a failing one, and the junit report kept the inner flow's name. With the runner's
   `--debug-output` and `--flatten-debug-output` the video lands in `native-debug/<flow name>/startRecording/`.
   Android is unchecked locally, because the shared emulator was down; the first recorded CI run checks it.

### B. Tests

1. **STR-E15, starting onboarding** (step 1, up to Stripe's sign-in), in `account.stripe.ts`. A new business
   with no Stripe account starts onboarding from Getting paid. The app creates the account, lists what Stripe
   needs in plain words, and shows Stripe's component with Add information. The test stops where Stripe's
   sign-in opens, and the account is closed in `finally`. The reconciliation check (STR-E12) also sweeps accounts
   a failed run left open.
2. **STR-E16, a first payment** (step 5). On the leased pool account, which reads ready, take a $10 payment
   with 4242 and find it in Payments with Stripe's charge behind it.
3. **STR-E14, requirements in plain words** (step 2). Through the API, a fresh account is filled in apart from
   its bank, and Getting paid names the bank and Stripe's terms. A detail submitted with a value Stripe's sandbox
   rejects should show Stripe's reason; that part is checked while building the test, since Stripe may only judge
   details once the terms are accepted. After the bank is added, Check again names only what is still due. A fresh
   account can't reach ready (see A1), so ready is covered by STR-E09 on the pool account.
4. **STR-E09 on a real hold** (step 3), if A2 passes. An onboarded account is put on hold in Stripe, Check again
   shows payouts paused, a card payment still goes through, and the bank is restored in `finally`.
5. **Mobile states**, in Maestro on the Android lane. A run mutation writes the paused and the requirement-due
   account state, as STR-E09 does today, and the flow checks the wording on Getting paid. The mobile lane has no
   Stripe keys, so Stripe's side stays covered by B1 to B3; both apps take the wording from the same app-core
   view-model.

### C. Recording

1. **Playwright.** Done. `recorded()` in `packages/config/e2e/recording.ts` wraps every config. With
   `E2E_RECORD=1` it records every context, including ones a test opens itself, with Playwright's cursor, action
   labels and test and step overlay, waits 500ms between actions and runs one test at a time with four times the
   timeout. Tried on XB-E2E-09 through the runner.
2. **Collection.** Done. `backend/e2e/recordings.py` writes the run's `recordings/` folder: one mp4 per context
   and an `index.html` with each test's result.
3. **CI.** Done, not yet run on GitHub. `gh workflow run ci.yml --ref <branch> -f record=true` sets
   `E2E_RECORD=1` on the web, Connect and Stripe browser lanes, lengthens their timeouts and uploads
   `recordings/` with each lane's run records. This replaces the planned pull request label, since adding a
   label doesn't start a run.
4. **Maestro.** Done. With `E2E_RECORD=1`, `e2e/native.py` runs each flow through a wrapper that records it, and
   the videos join the same index. The mobile lane uploads them on a recorded run.
5. **Docs.** Done: "Recording a run" in `.docs/engineering.md`.

### D. Ticket

1. Update CB-5's Automated by and To automate lines in `.docs/launch-readiness.md`, then copy them to Linear word
   for word.
2. Record one run of the CB-5 tests and attach the video to the ticket.

## Risks

- **Step 1 stays partly by hand.** Finishing Stripe's sign-in and identity needs a person (A1), so CB-5 keeps
  that line under By hand only.
- **Account build-up.** Each run creates a few sandbox accounts. They are closed in `finally`, and the
  reconciliation sweep closes any a failed run left behind.
- **Lane length.** The new cases add about 3 to 4 minutes to the Stripe lane, which shards by measured seconds.
- **Recording overhead.** Slowed runs take several times longer, which is why recording is opt-in.
