# Hardening QA

QA record for [draft PR #26](https://github.com/nbaghiro/clientbridge/pull/26). The checks below distinguish automated and browser verification from remaining real-provider/device acceptance. The PR check list is the source for CI on the exact published head. See [plan and findings](plan.md) for the complete scope, resolutions and schemas.

Use disposable demo data and provider test mode. Real email tests require an explicitly chosen recipient.

1. **Checkout and stock:** two sessions buy the last tracked unit; only one can proceed. Cancel or expire the first checkout and retry. Correct stock downward before payment and confirm a refund, no pickup ticket and no negative stock movement. Check an ordinary in-person negative-stock sale still works when no online stock is held.
2. **Payments:** record cash and retry after a lost response. Retry a card checkout and refund with the same action. Confirm one payment/refund, ledger totals and credit-note numbering. Exercise deposit and online-order cancellation receipts. Check Stripe links from Admin Payments.
3. **Contracts and forms:** open a contract, edit it elsewhere, then sign the stale page; it must require review again. Send a required-signature form, reject unsigned/invalid answers, submit valid answers, then edit its questions and confirm the response retains its issued definition.
4. **Email lab:** sign in as the demo platform admin, select a sample and recipient, preview, send, and inspect the history. Distinguish queued/accepted/delivered/failed/ambiguous. A retry must not create another send. Confirm ordinary merchant accounts have no admin access.
5. **SMS:** assign a dedicated number to each test business. Same-client phone numbers across businesses must route by destination number. STOP affects the addressed business. Unassigned businesses cannot request SMS verification; a retired number cannot transfer to another business.
6. **Staff and plans:** as staff, apply a large discount on a sale on web/mobile and confirm no approval is asked. Test membership changes and seats. A replacement subscription must not refund old subscription history.
7. **Clients and admin:** try ambiguous email/phone matches and a merge involving pending money. Open a client's activity from Admin People; related bookings, invoices, orders, payments, signatures and form-response events must stay within the selected business.
8. **Scheduling and inbox:** load a long visit, drag/undo and navigate date ranges; pending positions must clear correctly. Confirm today's next visit in Inbox and scroll a large native inbox. Simulate public calendar failure and retry.
9. **Native/auth:** submit fresh-business onboarding and exercise Sign-in & security on actual iOS/Android. Verify `/auth-error` returns to sign-in and bank setup works in Connect in provider test mode. Native SDK, real bank verification and terminal hardware remain manual QA.
10. **Deployment/site:** inspect the built admin origin, auth redirect, cookie/CORS boundaries, and marketing contact form success/failure. No production deployment is part of this PR. Test offline working-hours edits and reconnect; booking and notes remain online-only.

## Operational limits to verify before production

- New business SMS assignments are intentionally empty after migration; provision and assign dedicated numbers explicitly. Never backfill a shared number.
- Existing form definitions are marked reconstructed; no historical signature is invented.
- Inspect existing pending checkouts before enabling stock enforcement against production data.
- Unknown delivery acceptance is never blindly retried. Resolve ambiguous sends against provider records.
- Append-only audit triggers and additional growth indexes are separate concrete schema decisions. Gift-card split tender is a separate product capability.

## Verification results, 18 October 2026

| Surface | Evidence |
| --- | --- |
| Backend invariants | Full suite: 2,055 passed, 31 external-service tests deselected, 94.11% coverage. Fresh migrated/seeded disposable database on the existing Docker Postgres; development database was not reset. Covers stock races, replay, refunds, signatures/forms, SMS tenancy, delivery claims/callbacks and admin authorization. |
| Provider contracts | Reproduced 11 Stripe contract failures caused by a cached pool crossing closed test loops. API/worker shutdown now closes and clears the Stripe transport; fixtures do the same. All 23 real-adapter contract tests pass against stripe-mock; 29 gateway/rate-limit tests pass. |
| CI dependencies | The backend CI job lacked Redis for the cross-process rate-limit regression. Added the locally pinned Redis service and health check; production limiting still fails closed on Redis failure. |
| Frontend/build | Strict formatting/lint/type checks, generated contracts and all four production builds passed. App-core tests passed across three time zones; API-client, mobile and site tests passed. Infrastructure: 102 tests. |
| Provider web | Original PR CI: 30 browser tests passed, one opt-in presentation demo skipped. Local sweep: 28 passed, two environment-gated tests skipped; one history assertion captured a Stripe cancellation console message during navigation. The dedicated history rerun passed with the optional live Stripe UI disabled, matching CI; the original CI history test also passed. |
| Public Connect | Local: 50 passed, one opt-in media check skipped. Booking/manage, shop, invoices, estimates, receipts, forms, contracts, preferences, error paths, phone layouts, accessibility and pseudo-locale coverage. Original PR CI also passed. |
| Marketing | 67 site browser tests passed; contact API/provider-failure and production-image routing checks passed during implementation. |
| Admin | Browser verified all eight pages, sign-in redirect and ordinary-staff denial. All ten email template previews, SMTP test send to local Mailpit and history passed; exactly one matching test message was received. People, Payments and Email lab fit 390px without document overflow. Scoped client activity link and payment detail opened; mobile email body rendered. No uncaught page errors in the completed admin sweep. |
| Sync/native | Original CI passed real PowerSync verification, native build, inbox/client and setup/payment/recovery shards. Final exact-head matrix is linked from the PR; simulator results do not certify physical terminal or banking behavior. |
| Migration/rollout | Approved cb0009–cb0011 migrations and real existing-form backfill tested. Local development upgraded from cb0008 without reset/reseed. No production deployment, phone-number purchase or external test email. |

Earlier red/green regressions include full-payment replay, held stock and last-unit contention, correction-before-settlement refund, immutable form evidence, required signatures, stale contract consent, durable admin deduplication/history, worker fencing, client contact ambiguity, related activity scoping and pickup query counts (104 before, at most six afterward in the seeded scenario). Prior harness failures were corrected and superseded by the passing full backend run.

Raw logs, traces, screenshots and pre-consolidation documentation backups remain under the gitignored `.scratchpad/` folder. They are supporting artifacts, not extra maintained execution documents.
