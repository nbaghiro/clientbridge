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
