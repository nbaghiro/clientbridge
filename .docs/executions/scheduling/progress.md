# Scheduling correctness progress

Started on 2026-10-11. Record per-task evidence here.

## B1 to B7: backend (completed)

- B1: public and manage bookings are accepted only when the start is in `open_slots` for the member on its local day (`_offered()` in `services/public.py`); a day with no hours is closed online; "any" assigns the member the listing showed; refusals are 409 `slot_unavailable`. Tests that booked off the grid moved to on-grid starts.
- B2: `payments.cancel_open_deposits()` cancels pending or failed deposit intents under a lock on staff, client and series cancels; `settle_deposit` refunds a deposit that settles on a canceled booking; the reaper uses `FOR UPDATE SKIP LOCKED`, releases future online bookings with no succeeded deposit whatever the payment state, skips a booking whose intent cancel fails, and sends a `booking_released` notice.
- B3: PATCH only cancels a waitlisted booking (409 `class_seat`); time or end changes on a class slot are 409 `class_move`; completing one attendee completes the slot only when no live bookings remain.
- B4: `move_slot` clears `reminded_at`; reminders go to confirmed bookings only; pending online bookings get `booking_requested`; `patch` returns the notice to send so only real transitions notify, and approval sets `confirmed_at`; a repeated status is a no-op.
- B5: series over 60 visits are 422 `recurrence_too_long`.
- B6: `local_day()` gives midnight to next local midnight for exceptions and closures; manage slots exclude the visit and apply lead time and horizon; `clash()` maps the resource constraint to its own message.
- B7: `late_cancel_deposit` is gone from the policy schemas and public policy (stored JSON is kept by a merge on save); the web, mobile and Connect references were removed and `make gen-api` run.
- Cross-cutting: `tests/test_public_booking_slots.py` has the DST property test (Toronto, Vancouver, Halifax around 2026-11-01 and 2027-03-14) and a two-connection race for one public slot.
- Checks: full backend suite 1,426 passed, 95.42% coverage; ruff, mypy, structure and `gen_messages` clean.
- Open: Connect's optional `horizon_days` is not sent by the backend yet; the class sessions probe (P9) is a design gap (design.md).

## C1 to C7: clients (completed)

- C1: closed days show a banner and tint instead of a blocking overlay on web and a closed panel on mobile; bookings stay interactive, and future visits covered by a closure or time off carry a `needs_move` flag and "Needs a new time" label.
- C2: `layoutDay` places cards by wall-clock minutes, so cards line up on 23- and 25-hour days; the web hover label is computed in the business zone.
- C3: `movedStart` applies the server's same-week rule to the series weekday preview.
- C4: `slotProblem` applies buffers, room and station conflicts, class joins (with a "full" problem) and the same-local-date end rule; the composer and reschedule load the week of the chosen date, reschedule moves its day with the week and shows a loading state, and `actorsFor` limits staff viewers to themselves.
- C5: the hours outbox stores the server error code; split days are marked rather than flattened and explained by `splitNote`, and saving is disabled for a split week; the web save button uses `saveLabel`.
- C6: Connect sends `any` for Anyone, recovers from a 409 by clearing the slot, refetching and returning to the time step, reports connection failures separately, restores drafts by business-zone date, opens manage on the visit's week and stops the week strip at `horizon_days`, which the public policy now returns.
- C7: offline move failures say so; the optimistic overlay clears when the replica shows the move; mobile time-off blocks clamp to the visible window; the window extends for events ending at midnight.
- New error codes `slot_unavailable`, `class_seat`, `class_move` and `recurrence_too_long` map to catalog messages.
- Checks: frontend typecheck and lint, app-core (267 under three zones), playground (153), web (17) and Connect suites pass; one Connect navigation run failed on the local public rate limit and passed alone. Mobile changes are verified by types and shared helpers only.

## G1: concurrency (completed, uncommitted)

- Lock order is the hours lock, then member locks by id (`lock_staff`), then booking rows by id (`lock_bookings`, `SELECT ... FOR UPDATE` through `scoped()`), then slots. Manage reschedule and cancel take the member lock, then the booking row, then check replay and limits, so concurrent reschedules at the limit cannot both pass; a visit reassigned meanwhile is 409 `visit_changed`. Time off takes the member lock and a closure every active member's lock; staff moves lock both members; recurrence change and cancel lock the series' rows and skip visits that are no longer live.
- The hours week command takes the hours lock then the member lock and returns `stranded`, the future live bookings outside the new week; a receipt replay recomputes it. The device keeps the ids in `device_prefs` and the Hours screens on web and mobile show a notice for visits still outside the hours.
- Tests: two-connection races for reschedules at the limit, booking against time off and closures, and booking against an hours change; API tests for `stranded`; app-core tests for `withinHours`, `strandedNote` and `STRANDED_SQL`; the sync e2e checks the stored ids.
- Checks: backend 1,433 passed, 95.39% coverage; frontend typecheck, lint, app-core (271 under three zones) and the playground suite pass.

## G2: idempotency request hashes (completed)

- Approved schema change: `commands.request_hash text NULL` (`IdempotencyKey.request_hash`), migration `cb0002` (`20261011_000000_command_request_hash.py`) after `cb0001`, no backfill; applied locally and checked with downgrade and upgrade.
- `core/command.py` has `request_hash()` (SHA-256 of canonical JSON), `replay()` (through `scoped()`; a different stored hash is 422 `idempotency_key_reused`, a null hash replays) and `remember()`. `run_command` requires `request` whenever it gets a key; all 43 keyed callers pass the body and path ids. Public book, manage reschedule and cancel and the shop order use the same helpers; manage scopes are now `manage.move` and `manage.cancel`. The hours receipt path shares `request_hash`.
- Clients: `api.idempotencyKeyReused` is mapped by `failureMessage`; `attemptKey` keeps one key across retries of an identical request and issues a new one when the request changes, and `sendAttempt` retries once with a fresh key on `idempotency_key_reused` (Connect booking and reschedule).
- Checks: backend 1,441 passed, 95.40% coverage; frontend typecheck, lint, app-core (274), playground and Connect suites pass.
- Note: PR #1 also names its migration `cb0002`; it has to renumber to `cb0003` after `cb0002` when it rebases.

## G3: time guards and auto-completion (completed, uncommitted)

- No-show and complete before the start are 409 `visit_not_started` on booking PATCH and the roster no-show; status-only patches and roster actions lock the booking row and re-check for a closed status. `lifecycleOf` in app-core drives `useBookingActions`, which disables Complete and No-show before the start with a reason on web and mobile.
- `run_complete_past_bookings` runs at minutes 2, 17, 32 and 47. Per business with `booking_policy.auto_complete` (default true, toggle in online booking settings), it locks members and then booking rows with `SKIP LOCKED`, completes confirmed visits that ended before local midnight and cancels never-approved pending ones (canceling open deposit intents, no notice), with one audit each and slots released or completed through the B3 rules. A pending visit whose deposit was already collected is skipped for staff to handle.
- Tests: `tests/test_bookings_completion.py` (happy, 4xx, two businesses in different zones, idempotency, opt-out, collected deposit); tests that marked future visits now move the visit into the past with `tests/helpers.py: begin`.
- Checks: backend 1,451 passed, 95.34% coverage; frontend typecheck, lint, app-core and the playground suite pass.
