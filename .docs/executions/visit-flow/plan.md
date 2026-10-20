# Visit flow: check-in and checkout

Status: planned. Branch `feat/visit-flow`, worktree `/Users/naib/Documents/code/clientbridge-visits`, based on `origin/main` at `5e0bad49`. Follow the [task queue](tasks.json), [schema notes](schema.md), [QA checklist](qa.md) and [progress](progress.md). The reasoning behind the scope is in the [check-in](../../explorations/check-in/README.md) and [checkout](../../explorations/checkout/README.md) explorations.

This execution builds both ends of a visit on one branch, so the whole flow can be checked in one QA pass. It lands on main as two commits: checkout first, then check-in.

## Starting point

Step 1 is already on main (`8fb18370`):

- the check-in confirm sheet on Today and in the booking panel (`useCheckIn` in app-core `today.ts`, `CheckInSheet.tsx` on web and mobile);
- checkout opening the register with the visit on the ticket (`useLinkedVisit` in `pos.ts`).

## Principles for this branch

These come from `CLAUDE.md` and the review of the first draft, and every task follows them.

- **No new tables, and no stored field for anything that can be worked out when it's read.** [schema.md](schema.md) maps each need to the data that already holds it.
- **One file per concept, and no new files unless a concept is new.** Work goes into the files that already own it (see the file map). The only new file is the cross-cutting flow test.
- **Comments are rare.** The default is none. Add one line only for a non-obvious reason or an invariant, and never narrate what the code does.
- **Backend layering:** a thin router in `api/` calls a service that owns its queries and transaction. Tenant queries go through `scoped()`. Money changes go through `run_command`, and the service method gates its own role with `assert_role` or `assert_can_act_as`.
- **Frontend:** each view-model is an app-core hook, and web and mobile only render it. Controls come from `@clientbridge/ui`, copy from the catalog, and displayed values from the formatters.
- **One current implementation.** No compatibility paths. When a behaviour changes (for example, check-in now audits skipped items), the old path is removed.
- **Generated files stay current:** `make gen-api` after any API change, and `make gen-strings` after any catalog edit.

## Decisions

- **What a visit needs comes from what the business already set up:**
  - forms sent on booking, including signed ones that act as waivers;
  - contracts at their current version;
  - the pet's alerts on the visit date;
  - a pending deposit.

  These apply business-wide.

- **Nothing blocks check-in.** Outstanding items are shown, staff decide, and the check-in audit entry lists anything skipped.
- **Status is worked out on the server**, because responses and signatures sync to managers only.
- **Paying completes a visit once it has started.** A visit paid ahead stays open, and a refund doesn't reopen one.
- **A package covers a visit by setting the existing `bookings.package_id`.** Covering completes the visit and posts the session's consumption through `ledger.post_consumption(booking_id=…)`, which already expects a completed booking that owns the package. Nothing sets `package_id` today, so this is the first writer.
- **A gift card pays part of a sale as a credit.** It works the way `visit_deposits` already reduces what an open sale owes: a redemption journal sourced to the sale lowers the amount due, and a refund reverses it.
- **Rebooking suggests the same staff member**, at the client's own interval for that service: the gap between their last two visits, or the series' interval.
- **A visit note goes out only when staff write one**, as a message in the client's thread.
- **Out of scope:** split card payments, self check-in, class rosters, per-service requirements, staff checklists, and the site sign-off. The sign-off would need a CHECK change, so it stays out unless approved separately.

## File map

Each change lands in the file that owns its concept.

| Concept                              | Backend                                                                                      | App-core                                                         | Web and mobile                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Check-in, undo, what a visit needs   | `api`, `schemas` and `services/bookings.py`                                                  | `domain/today.ts` (`useCheckIn`)                                 | `CheckInSheet.tsx`, `TodayParts.tsx`, `BookingPanel.tsx` / `BookingSheet.tsx` |
| Readiness on the agenda and schedule | same day read                                                                                | `domain/today.ts`, `domain/bookings.ts`                          | `TodayParts.tsx`, schedule grid on web, schedule list on mobile               |
| Hand-over                            | none (existing public form and contract pages)                                               | `domain/today.ts`                                                | `CheckInSheet.tsx`                                                            |
| Before the visit                     | `services/notifications.py` (reminder), `services/public.py` (manage)                        | `domain/publicBooking.ts`                                        | Connect `PublicManage.tsx`                                                    |
| Paying completes the visit           | `services/payments.py` (`_sync_visits`)                                                      | none                                                             | none                                                                          |
| Service commission at the register   | `services/earnings.py`                                                                       | none                                                             | none                                                                          |
| Package covers a visit               | `api`, `schemas` and `services/entitlements.py`, `services/ledger.py` (existing consumption) | `domain/pos.ts`                                                  | `POS.tsx`                                                                     |
| Gift card credit on a sale           | `api`, `schemas` and `services/orders.py`, `services/ledger.py`                              | `domain/pos.ts`                                                  | `POS.tsx`                                                                     |
| Ticket to invoice                    | `services/orders.py`, `services/billing.py`                                                  | `domain/pos.ts`                                                  | `POS.tsx`                                                                     |
| Book next visit, visit note          | none (existing booking composer and send-message command)                                    | `domain/pos.ts`, `domain/bookings.ts`                            | `POS.tsx`                                                                     |
| Strings                              | `locales/en_CA.po` (reminder text)                                                           | `locales/en-CA.json` under `today.`, `pos.desk.` and `bookings.` | none                                                                          |

Tests extend the existing concept files:

- `test_bookings_check_in.py`: undo, needs and audit;
- `test_bookings_completion.py`: paid completes;
- `test_earnings.py`: commission;
- `test_entitlements_packages.py`: covering a visit;
- `test_entitlements_gift_cards.py`: credit on a sale;
- `test_orders.py`: ticket to invoice;
- `test_bookings_reminders.py`: the reminder list.

The new `test_flows_visits.py` is a cross-cutting flow suite, which the naming rule exempts. Web e2e extends `web.e2e.ts`. Mobile e2e extends `01-workday.yaml`, so `shards.json` doesn't change.

## Work, in order

Checkout comes first so it can be its own commit. Each task follows the same loop:

1. Write the backend tests first, where there's backend work.
2. Implement.
3. Run the task's targeted tests and lint.
4. Update `tasks.json` and the progress log.
5. Make a WIP commit on the branch.

### Part 1: checkout

- **A1. Service commission at the register.** Write the test first. If a payee's service rate earns nothing on a paid sale carrying a visit, accrue per visit line in `ensure_order_earning` through the `_split` rules that `ensure_earnings` uses. Accrue once per booking, and reverse a pending one on refund.
- **A2. Paying completes a started visit.** In `_sync_visits`, a paid sale completes its visits whose slot has started. Test that:
  - a visit paid ahead stays open;
  - a refund keeps the visit completed;
  - a webhook replay changes nothing.
- **C1. Package covers a visit.**
  - The register shows the client's active package for the visit's service with sessions left.
  - "Use package" calls `POST /v1/bookings/{id}/package`. It sets `package_id`, completes the visit and posts one consumption, using `run_command` with an idempotency key. It's for an owner, an admin or the visit's own staff member.
  - The visit leaves the ticket, and other lines are paid as usual.
  - Refused for a package that's used up, expired or for another client, and for a visit already charged.
- **C2. Gift card credit on a sale.**
  - Staff enter a code on the ticket, and `POST /v1/orders/{id}/gift-card` redeems up to what's owed, with the sale as the journal's source.
  - The amount due counts it the way it counts held deposits, and a refund of the sale reverses the redemption.
  - Refused for an inactive card, a card from another business, or a paid sale.
- **C3. Send the ticket as an invoice.** `POST /v1/orders/{id}/invoice` turns an open ticket into an invoice with the same lines and `booking_id`s, sends it, and voids the ticket. Invoice earnings and completion then follow as for any paid invoice. It's for an owner or admin.
- **C4. Book next visit.** On the paid screen:
  - `useNextVisit` in `bookings.ts` works out the interval from the replica, and the paid screen shows "Book again for Nov 30 with Hannah".
  - Pressing it opens the booking composer prefilled.
  - With no history, it shows a plain Book again.
- **C5. Visit note.**
  - The paid screen has a note field.
  - Sending it uses the existing send-message command, with the manage link appended through a catalog message.
  - The manage page gains the booking's photos, through `services/public.py` and `PublicManage.tsx`.

### Part 2: check-in

- **A3. Undo check-in.** `DELETE /v1/bookings/{id}/check-in` clears `checked_in_at` while the visit is open and uncharged. It's for the visit's own staff member or a manager. The confirmation line on Today and in the panel gets Undo.
- **B1. What a visit still needs.** `GET /v1/bookings/{id}/needs` and `GET /v1/bookings/needs?date=` return, per visit, a list of items with a kind, a label and the actions open to the viewer:
  - "on booking" forms the client hasn't submitted;
  - contracts the client hasn't signed at the current version;
  - pet alerts on the visit date;
  - a pending deposit.

  Staff only get their own bookings.

- **B2. Audit skipped items.** The check-in command adds the outstanding items to its audit entry.
- **B3. Checklist in the sheet.** `useCheckIn` reads B1 and lists the items with Resend link, Open here and Collect deposit. The collect action uses the existing `useCollectDeposit`.
- **B4. Readiness.** The day read feeds "Ready" or "2 to do" on Today's agenda rows and on schedule events.
- **B5. Hand-over.** Open here shows the public form or signing page full screen: in an iframe inside the shared `Modal` on web (Connect already allows framing on `/form/` and `/contract/`), and in an in-app browser on mobile. Closing it refetches the needs.
- **B6. Before the visit.** The reminder message lists the outstanding client items with their links (`en_CA.po` and `make gen-messages`). The manage page shows the same list, or "You're all set".

### Part 3: together

- **D1. Flow test** (`test_flows_visits.py`). The visit goes through these stages:
  - booked, with a signed intake form owed;
  - checked in, with the skipped form audited;
  - a second visit covered by a package;
  - a sale paid with a gift card credit and a card;
  - then confirm the visits completed, the session used, the commission accrued and the review request eligible.
- **D2. Web e2e** in `web.e2e.ts`: check in with the checklist, check out, then rebook and send a note from the paid screen.
- **D3. Mobile e2e** in `01-workday.yaml`: the same path on the iOS simulator.
- **D4. Milestone audit** per `CLAUDE.md`:
  - layering, surfaces and role gates;
  - the four-part matrix;
  - web and mobile duplication;
  - comments;
  - file placement against the file map.
- **D5. QA.** Run the branch locally and go through [qa.md](qa.md) together.
- **D6. Landing:**
  - Rebase onto `origin/main`.
  - Squash the Part 1 WIP commits into one checkout commit, and Part 2 and Part 3 into one check-in commit. The `checkout-done` tag marks the boundary.
  - Move durable notes into `architecture.md`, and delete this folder and the explorations, all in the second commit.

## Running it

**Setup, once, in the worktree:**

```sh
cd /Users/naib/Documents/code/clientbridge-visits
cd frontend && pnpm install --frozen-lockfile --offline && cd ..
cd backend && uv sync && cd ..
```

**During the work:**

- Use the backend tests and checks: `cd backend && uv run pytest tests/<file> -q`, `make lint-backend`.
- Use the frontend checks per package: `tsc`, `eslint`, `check-structure.mjs`, `knip`, and app-core `vitest`.
- These all run without the dev servers.
- The docker services are shared with the main checkout and need no changes, since there's no migration.

**For QA (D5):**

- The web app (8700), API (8701) and Metro (8707) have fixed ports, and they're currently served from other checkouts.
- Stop those three, then run them from this worktree: `make dev-api`, `make dev-web`, `make dev-mobile`, and `make worker` for the reminder.
- Rebuild the iOS app only if a native dependency changed, which this plan doesn't expect.
- Afterwards, restart them from the main checkout.
- Coordinate with any other session using those ports first.

**Before landing:** `make check` in the worktree, then `make test-web` and `make test-mobile`.

## Testing

Every backend task clears the four-part matrix: happy path, each 4xx, tenant isolation and role gates, and idempotency or replay. App-core hooks and pure functions get vitest coverage. The flow test, the e2e paths and the QA checklist check the two parts together.
