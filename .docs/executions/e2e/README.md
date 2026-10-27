# End-to-end suite: remaining work

The suite, the shared test tier and the CI lanes are in place. [engineering.md](../../engineering.md#the-shared-test-tier) covers how they work, where a new case goes and what a case must prove. This folder tracks only what's left, and goes once that's done.

## Where coverage stands

`backend/e2e/results.py` registers every required case. [coverage.json](coverage.json) maps each case to the audit families from the [product brief](../../reviews/product/comprehensive-e2e-brief.md). Judged strictly:

- 74 of the 302 families are partly covered (44 of them P0).
- None is fully covered.
- 228 have no case yet (104 of them P0).

A family moves to `verified` only after a case written to its full audit assertions passes a strict run and an independent review.

[decisions.md](decisions.md) lists the behaviour that cases asserted where the intent wasn't settled. Each entry needs a review.

## What's left

1. Cover the open families one category at a time, P0 first: messages and consent, plans and seats, reviews and Google, admin and the marketing site, onboarding choices, and shop holds.
2. Build the remaining anchor journeys (FLOW02 to FLOW10 in the brief), and finish FLOW01.
3. Cover a program deposit through the Stripe lane, and mixed-tax or capped fixed estimate discounts.
4. Provision GitHub's protected `stripe-sandbox` environment, CI credentials and ready merchants, so the Stripe browser lane runs in hosted CI.
5. Close the known boundaries:
   - Connect shows paid before the payment event arrives (PAY-E01).
   - Hard-kill and browser-phase recovery.
   - iOS: the replica isn't ready after the first sync in 14 of 15 runs.
   - Release builds.
   - Hosted runs of the flake and mutation workflows.
6. Lift the WebKit offline exclusions (XB-E2E-05 and XB-E2E-06) once Playwright can load a service-worker page offline in WebKit.
