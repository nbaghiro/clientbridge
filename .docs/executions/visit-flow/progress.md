# Visit flow progress

## Baseline

- Date: 2026-10-20.
- Base: `origin/main` at `5e0bad49`, which includes step 1 (`8fb18370`).
- Branch `feat/visit-flow`, worktree `/Users/naib/Documents/code/clientbridge-visits`. The tag `checkout-done` marks the end of the checkout work.
- Schema: `files.shared_at`, approved on 2026-10-20 so booking photos stay inside the business until staff share them ([schema.md](schema.md)).

## Done

### Checkout

- **A1. Service commission at the register.** The test confirmed the gap: a visit paid at the register earned its staff member nothing. `ensure_earnings` and `reverse_earnings` now take a sale as well as an invoice, so commission accrues per visit through `_split`, and a refund of a paid sale reverses a pending earning.
- **A2. Paying completes a started visit.** `close_settled_visit` in `services/payments.py` completes a confirmed visit that has started, clears a deposit that was never collected, audits `booking.complete_on_payment` and closes the slot. A visit paid before its start stays open. `complete_when_done` moved from bookings to payments so payments can use it without an import cycle.
- **C1. Package covers a visit.** `POST /v1/packages/{id}/cover` sets `bookings.package_id`, completes the visit and posts one consumption. The package must match by `covers_item_id`. It's for an owner, an admin or the visit's own staff member. The register shows "Use package" on a started visit when the client has an active covering package. Sessions left aren't shown, because staff devices don't sync the ledger entries that count them.
- **C2. Gift card credit on a sale.** `POST /v1/orders/{id}/gift-card` redeems up to what's owed, with the sale as the journal's source. The ledger counts it like an applied deposit: status, paid time, amount due and held tickets, on the server and in the replica's `orderStatusSql`. Refunding or voiding the sale reverses the redemption. The pay sheet has a code field, a credit line and "paid by gift card" when it covers everything.
- **C3. Send as invoice.** Managers can bill a named client's ticket through the existing create-invoice command with `send: true`. Issuing any invoice now links its visits (`invoice_id`) and completes those that have started, through the same `close_settled_visit`.
- **C4. Book next visit.** `useNextVisit` and `nextVisitStart` work out the next date from the series' interval or the client's own gap between visits, keeping the time of day. The paid screen says "Book again for Nov 30", and the composer opens prefilled through a new `rebookId` on `ComposerSlot`. On web it's the `rebook` link parameter, and on mobile a Schedule route parameter.
- **C5. Visit note.** `MessageSend.booking_id` adds the visit's manage link through the catalog message `visit_note.body`. The paid screen has a note field. The manage page lists the visit's uploaded photos through `GET /manage/{token}/photos/{file_id}`, where the manage token is the credential.

### Check-in

- **A3. Undo check-in.** `DELETE /v1/bookings/{id}/check-in` works while the visit is open and unpaid. `useUndoCheckIn` drives Undo on Today's confirmation line and in the booking panel, on web and mobile.
- **B1. What a visit needs.** `GET /v1/bookings/{id}/needs` and `GET /v1/bookings/needs?day=` list, for each visit:
  - "on booking" forms the client hasn't submitted;
  - signature requests still pending, or signed at an older contract version;
  - a pending deposit.

  Staff see only their own visits.

- **B2.** The check-in audit entry lists outstanding items under `outstanding`.
- **B3 and B5.** The sheet lists the items. Managers can send or resend a link, and anyone can open a sent link on the device: an iframe on web, the in-app browser on mobile. Closing it refreshes the list.
- **B4.** Today shows "n to do" on agenda rows on web, and on the next-visit card on mobile.
- **B6.** The manage page lists open forms and signatures with Fill in or Sign, or says they'll be handled at the desk when no link was sent.

### Together

- **D1.** `test_flows_visits.py` walks a visit through the needs list, an audited check-in, a package cover, and a gift card plus card payment. It then checks completion, the gift card balance and the earning.
- **D4. Milestone audit:**
  - routers stay thin;
  - every new query uses `scoped()`;
  - every new command uses `run_command`;
  - role gates sit in the service methods;
  - view-models are app-core hooks (`useCheckIn`, `useUndoCheckIn`, `usePackageCover`, `useNextVisit`, `useVisitNote`, and `giftCard` and `sendAsInvoice` on `useSale`);
  - comments are single lines on interface fields;
  - no new files except the flow test and the explorations.

## Changed from the plan

- **The reminder text is unchanged.** It already links to the manage page, which now lists what's owed. Adding the list to the reminder itself would need the needs logic in `notifications.py`, which would create an import cycle with bookings.
- **No readiness marker on the schedule grid.** It would need a new `CalendarEventFlag` in both UI twins and a day read threaded through the grid. Today has the marker, and the booking panel opens the full list.
- **The sheet shows a pending deposit as a to-do with no action.** Collecting it stays in the booking panel's deposit card.
- **Pet alerts stay in the sheet only.** They're worked out on the device and aren't counted as to-dos.

## Still to do

- D2 and D3 (web and mobile e2e) and D5 (QA) run against this branch's API. The fixed ports 8700, 8701 and 8707 are currently served from other checkouts, so these wait for the server swap described in [plan.md](plan.md#running-it).
- D6: landing as two commits.
