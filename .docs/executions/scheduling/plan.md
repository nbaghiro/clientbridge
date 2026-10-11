# Scheduling correctness plan

Status: in progress. This plan fixes the High and Medium findings of the scheduling and availability audit of 2026-10-11 across the backend, web, mobile and Connect. It makes no schema change; a task that turns out to need one stops and is presented for approval. The design gaps from the same audit (class schedules, service-to-staff mapping, auto-completion, late-cancel policy, overnight hours and others) are planned separately in [design.md](design.md) and wait for product decisions. The [task queue](tasks.json) lists each task's scope and acceptance criteria.

The audit probes that reproduce the backend findings are in `.scratchpad/scheduling-audit/` and the frontend notes, probes and screenshots in `.scratchpad/scheduling-audit-fe/`. Each task turns its probe into a real test in the concept's test file before the fix, so the test fails first and passes after.

## Principles

The server's computed availability is the single source of truth. A public or manage booking is accepted only when its start is one of the open slots the server would list for that member, which removes several separate checks that drifted apart. Client-side checks mirror the server rules (buffers, resources, class joins, the day boundary) so that what the apps offer is what the server accepts; the server stays authoritative and the clients only avoid offering times that will be refused.

Money follows the order reaper's existing pattern: any path that gives up on a booking cancels its open payment intent under a row lock, and a payment that settles after its booking was canceled is refunded rather than kept.

Notifications fire on real state transitions only: a pending booking is told it was received, a confirmation goes out on approval, a move clears the reminder mark, a repeated status write is a no-op, and a reaped booking tells the client.

## Backend tasks

- B1. Public and manage bookings are validated against `open_slots` for the chosen member. "No hours set" counts as closed for online bookings, `_staff_for("any")` picks only among members whose open slots contain the start, and off-grid starts are refused. Covers H1 and M1.
- B2. The booking reaper cancels open payment intents with `FOR UPDATE SKIP LOCKED`, reaps online bookings with no succeeded payment whatever the payment state, and notifies the client. Client and staff cancels cancel a pending deposit intent. `settle_deposit` refunds a deposit that settles on a canceled booking. Covers H2, H3 and M6.
- B3. Class integrity: `PATCH` refuses waitlisted to confirmed (the seat action is the one path, with its locked capacity check), refuses time or end changes on a slot with capacity above one, and completing one attendee no longer completes the session. Covers M2 and M3.
- B4. Notification transitions: `move_slot` clears `reminded_at` when the start changes; pending online bookings get a "request received" message and no reminders; approval sends a confirmation and sets `confirmed_at`; a repeated terminal status is a no-op with no second notice. Covers M4, M5 and M9.
- B5. Recurrence limits: a count or end date beyond the occurrence cap is refused with 422 and a stable error code instead of being truncated. Covers M7.
- B6. Day boundaries: closure detection and exception windows use the next local midnight instead of 24 hours, so 23- and 25-hour days are handled; the manage slot list passes the current visit as `exclude` and applies the horizon; a resource conflict maps to its own error by constraint name. Covers the Low backend items L1, L3 and L4.
- B7. `late_cancel_deposit` is stored but never read. Until the late-cancel policy is decided (design.md), the setting is hidden from the API and settings screens rather than left misleading. Covers M8.

## Frontend tasks

- C1. Closed days keep their bookings reachable: on web the closure is a non-blocking banner and tint under which lanes and cards stay interactive, on mobile the grid renders with a banner, and visits on a closed day are marked as needing a move. Covers the first client High.
- C2. Calendar placement uses wall-clock minutes for cards, as the hour lines, now line, blocks and click-to-create already do, so cards line up on 23- and 25-hour days; the web hover label is computed in the business zone. Covers the second client High and the hover label.
- C3. The series weekday change preview uses the server's same-week rule. Covers the third client High.
- C4. `slotProblem` mirrors the server: buffers, resources, joining an existing class session with free seats, and the same-local-date end rule. The composer and reschedule load conflicts and away rows for the week of the chosen date, the reschedule dialog moves its selected day with the week and shows a loading state, and the composer's fallback start times follow the visible window. Staff viewers are only offered members they can act for.
- C5. The hours outbox keeps the server's error code; a split-week refusal shows its own message and the editor explains that split days are edited elsewhere instead of flattening them; the web save button uses the shared label.
- C6. Connect: "Anyone" sends `any`; a refused booking or reschedule clears the slot, refetches times and returns to the time step; connection failures read as connection failures; restored drafts use the business-zone date; the week navigation stops at the booking horizon; manage reschedule opens on the visit's week.
- C7. Moves: a connection failure says so instead of "may have just been taken", and the optimistic overlay clears when the replica reflects the move rather than after a fixed delay. Mobile time-off blocks clamp their height, and the visible window extends for events that end at midnight.

## Tests

Each task adds the failing test first: backend tests in the concept's file (`test_bookings*.py`, `test_public_booking*.py`, `test_public_manage.py`, `test_jobs.py`), app-core tests next to the domain file, and Connect or web e2e where the behaviour is visible only in the UI. Two cross-cutting suites are added: a property test that every accepted public start is in `open_slots` and every open slot passes `slot_problem` across daylight-saving weeks in Toronto, Vancouver and Halifax, and a calendar layout test on 23- and 25-hour days. Concurrency tests use two real connections for the same slot.

## Execution rules

Backend and frontend tasks run in parallel with one worker each, in task order within each side. Each task runs focused tests, then the full gate for its side; `make check` runs at the end. Other sessions' uncommitted work is preserved. No schema change, no data change, no commit or push without being asked. Progress and evidence go in `progress.md`.
