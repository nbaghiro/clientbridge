# Hardening QA

Local automated gates pass. This checklist is the manual QA handoff for the draft PR; remote CI and manual acceptance remain pending.

Use disposable demo data and provider test mode. Real email tests require an explicitly chosen recipient.

1. **Checkout and stock:** two sessions buy the last tracked unit; only one can proceed. Cancel or expire the first checkout and retry. Correct stock downward before payment and confirm a refund, no pickup ticket and no negative stock movement. Check an ordinary in-person negative-stock sale still works when no online stock is held.
2. **Payments:** record cash and retry after a lost response. Retry a card checkout and refund with the same action. Confirm one payment/refund, ledger totals and credit-note numbering. Exercise deposit and online-order cancellation receipts. Check Stripe links from Admin Payments.
3. **Contracts and forms:** open a contract, edit it elsewhere, then sign the stale page; it must require review again. Send a required-signature form, reject unsigned/invalid answers, submit valid answers, then edit its questions and confirm the response retains its issued definition.
4. **Email lab:** sign in as the demo platform admin, select a sample and recipient, preview, send, and inspect the history. Distinguish queued/accepted/delivered/failed/ambiguous. A retry must not create another send. Confirm ordinary merchant accounts have no admin access.
5. **SMS:** assign a dedicated number to each test business. Same-client phone numbers across businesses must route by destination number. STOP affects the addressed business. Unassigned businesses cannot request SMS verification; a retired number cannot transfer to another business.
6. **Staff and plans:** set the discount ceiling and approval PIN in Business settings on web/mobile. Test above-limit approval, wrong PIN throttling, membership changes and seats. A replacement subscription must not refund old subscription history.
7. **Clients and admin:** try ambiguous email/phone matches and a merge involving pending money. Open a client's activity from Admin People; related bookings, invoices, orders, payments, signatures and form-response events must stay within the selected business.
8. **Scheduling and inbox:** load a long visit, drag/undo and navigate date ranges; pending positions must clear correctly. Confirm today's next visit in Inbox and scroll a large native inbox. Simulate public calendar failure and retry.
9. **Native/auth:** submit fresh-business onboarding and exercise Sign-in & security on actual iOS/Android. Verify `/auth-error` returns to sign-in and bank setup works in Connect in provider test mode. Native SDK, real bank verification and terminal hardware remain manual QA.
10. **Deployment/site:** inspect the built admin origin, auth redirect, cookie/CORS boundaries, and marketing contact form success/failure. No production deployment is part of this PR. Test offline working-hours edits and reconnect; booking and notes remain online-only.

## Operational limits to verify before production

- New business SMS assignments are intentionally empty after migration; provision and assign dedicated numbers explicitly. Never backfill a shared number.
- Existing form definitions are marked reconstructed; no historical signature is invented.
- Inspect existing pending checkouts before enabling stock enforcement against production data.
- Unknown delivery acceptance is never blindly retried. Resolve ambiguous sends against provider records.
- Append-only audit triggers and additional growth indexes are separate concrete schema decisions. Gift-card split tender and resource management are separate product capabilities.
