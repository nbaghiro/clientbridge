# Scheduling design gaps

Status: proposed, waiting for decisions. This document plans the design gaps found by the scheduling and availability audit of 2026-10-11. The bug fixes from the same audit are in [plan.md](plan.md) and run separately; this plan assumes those fixes (B1 to B7, C1 to C7) have landed, in particular that public and manage bookings are validated against `open_slots` (B1) and that `late_cancel_deposit` is hidden (B7).

Every schema change below is a proposal. Each one needs explicit approval of the exact change before any model, migration or test database is touched, following the schema approval rule in `CLAUDE.md`. Changes to the JSON shape of `businesses.booking_policy` do not change a column, but they change the API contract and are listed so they can be approved with the rest.

File and line references are to the tree as of commit `4864b33`; the bug-fix workers are editing some of the same files, so line numbers may drift by a few lines.

## Summary of recommendations

| Gap                           | Recommendation                                                                                                                          | Schema change                        | Size |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---- |
| 1. Class schedules            | Classes run from a schedule of sessions; clients book into existing sessions only; a released seat promotes the first waitlisted client | Yes (recurrences, shared with gap 8) | L    |
| 2. Staff, fairness, resources | Per-service member list, least-booked choice for "any", a resource pool per service, remove `resources.capacity`                        | Yes (items, resources)               | L    |
| 3. Removing a member          | Removal refuses while the member has future visits unless it carries a reassign or cancel choice; manage links refuse removed members   | No                                   | M    |
| 4. Completion and no-show     | A job completes past visits after local midnight; no-show and complete refuse before the visit starts                                   | No (policy JSON key)                 | S    |
| 5. Late cancel                | A policy of block, keep deposit or refund deposit for cancels inside the cut-off                                                        | No (policy JSON key)                 | M    |
| 6. Hours model                | Split days in the editor, windows that end at midnight, date overrides as an API, buffers inside hours, a 30 minute default step        | Yes (hours CHECK)                    | L    |
| 7. Performance                | One in-memory availability pass per request on the server; sargable range filters and shorter ranges on devices                         | No                                   | M    |
| 8. Recurrence horizon         | Rolling generation by a job from a stored local time, with occurrence identity and stored skipped dates                                 | Yes (recurrences, slots)             | L    |
| 9. Time zone rules            | Store the local wall time of each slot, re-anchor future slots after a tzdata change, and send local times to Connect                   | Yes (slots)                          | M    |
| 10. Concurrency               | Row locks for manage changes, request hashes on idempotency keys, staff locks for time off and hours                                    | Yes (commands)                       | M    |

## Gap 1: classes have no schedule

### Problem

A class session exists only once someone books it. The public page lists class times from the instructor's working hours exactly as it does for one-to-one services (`services/public.py:334-352` calls `open_slots`, `services/bookings.py:928-960`), and `create_booking_core` creates a new slot with the class capacity when no session exists at that member and start (`services/bookings.py:300-334`). Because `open_class_slot` matches on member and start (`services/bookings.py:209-218`), two instructors can each open a session of the same class at overlapping times, and booking with "any" picks the first free member in `_staff_for` (`services/public.py:354-368`) instead of joining a session that already has seats, which spreads attendees across several half-empty sessions. When the last attendee cancels, `release_slot` cancels the session (`services/bookings.py:405-417`), so a scheduled class disappears from the calendar. The waitlist exists on the staff roster (`ClassService.add` at `services/bookings.py:1403-1441`), but a seat is only given by hand (`services/bookings.py:1470-1477`) and the public page refuses a full class instead of offering the waitlist. Waitlists with auto-promote are listed under "After launch" in `.docs/launch-readiness.md`, and the audit's item D11 asks for auto-promotion on cancellation.

### Options

Option A is a new `class_schedules` table (item, member, room, weekdays, local start time, date range) with a job that creates sessions ahead. It keeps the class concept separate from client series, but it duplicates almost every column and rule that `recurrences` already has, and the generation job of gap 8 would exist twice.

Option B reuses `recurrences` as the class schedule: a recurrence with `client_id` null and a class item is a timetable, and its occurrences are sessions (slots with capacity N and no bookings yet). The columns gap 8 adds (local start time, generation horizon, skipped dates, occurrence date) serve both. The cost is that a recurrence has two meanings, told apart by `client_id`, which every reader has to respect.

Option C keeps sessions created on demand, but makes "any" join an existing session first and refuses a second overlapping session of the same class. It is the smallest change, but the timetable still comes from working hours, a business still cannot publish "Yoga, Tuesdays at 6" without hours that happen to fit, and an empty class still vanishes.

### Recommendation

We recommend option B. Classes are booked only into sessions that staff created, either one at a time or from a recurring timetable. The public page lists a class's sessions with seats left instead of computed start times, and `book` for a class item takes the session id rather than a member and start. A session with capacity above one is never canceled by `release_slot`; only staff cancel a session, which cancels its bookings and refunds their deposits through the existing cancel path. Two overlapping sessions of the same class are allowed only when staff create them deliberately with different instructors, which the existing staff exclusion constraint already permits.

When a confirmed seat is released (staff cancel, manage-link cancel, reaper), the same transaction promotes the oldest waitlisted booking on that session and notifies the client. We recommend promoting automatically only when the waitlisted booking owes no deposit; when a deposit is due, the client is offered the seat with a payment link and the reaper's 30 minute window, and the seat passes to the next person if it is not paid. The public page offers "join the waitlist" on a full session when the business turns it on.

### Schema changes (need explicit approval)

The class schedule uses the recurrence columns from gap 8 (`local_time`, `generated_through`, `skipped`, and `slots.recurrence_date`) plus one more column:

- `recurrences.resource_id text NULL REFERENCES resources(id)`: the room a timetable's sessions hold. Existing rows get null. Rollback drops the column.
- `recurrences.capacity integer NULL CHECK (capacity IS NULL OR capacity > 0)`: the seats of a timetable's sessions when they differ from the item's capacity. Existing rows get null, which means the item's capacity. Rollback drops the column.

No change to `slots` beyond gap 8: a session is a slot with capacity above one. No change to the exclusion constraints.

### Surfaces

Creating, editing and canceling a session or a timetable is a command (3) under `/v1/classes`. Generating sessions ahead is a job (5), shared with gap 8. Booking a session and joining a waitlist on the public page is the public surface (4). Waitlist promotion runs inside whichever command, public request or job released the seat, so it inherits that surface. The roster and the sessions on the calendar are sync-read (1) through the existing `history_*` streams.

### API and sync contract

- `POST /v1/classes/sessions` (one session), `POST /v1/classes/timetables`, `PATCH /v1/classes/timetables/{id}`, `POST /v1/classes/timetables/{id}/cancel`, `POST /v1/classes/sessions/{id}/cancel`.
- `GET /book/{slug}/sessions?item_id=&from=&to=` returns sessions with `seats_left` and `waitlist_open`; `PublicBookingCreate` gains `slot_id`, required for class items and refused for services.
- `PublicBookingResult.status` can be `waitlisted`.
- `recurrences` streams gain the new columns; `tests/fixtures/sync_projections.json` is updated.

### UI

App-core gains `useClassTimetableForm` and session actions in `domain/classes.ts`, with copy under `strings.classes`. Web and mobile `Classes` screens list timetables and sessions with the shared `ListPage`, `DetailView` and `Modal`. Connect's class flow on `PublicBooking` shows a session list instead of the time grid, built from `publicBooking.ts`. The calendar shows empty sessions as blocks with their seat count.

### Tests

Happy: a timetable creates sessions to the horizon; a client books a seat; the seventh client in a class of six joins the waitlist and is promoted when a seat is canceled. Each 4xx: booking a class item without `slot_id`, a canceled session, a full session with the waitlist off, a session in the past. Security: staff can create sessions only for themselves, a session id from another business returns 404 on the public page. Idempotency and edge: two concurrent bookings for the last seat (two real connections), promotion when the waitlisted client owes a deposit, an empty session stays on the calendar.

Size: L.

## Gap 2: service-to-staff mapping, fairness and resources

### Problem

Every bookable-online member is offered for every service (`_online_staff` at `services/public.py:379-385`, used for all items in `page`, `slots` and `days`), so a groomer can be booked for a nail trim they do not do. "Any" takes the first free member ordered by `created_at` (`services/public.py:354-368`), so the owner, who is usually the oldest member, gets every "any" booking. Public bookings never reserve a room or station: `book` calls `create_booking_core` without a `resource_id` (`services/public.py:283-293`). `resources.capacity` exists with a CHECK (`models/scheduling.py:146,151`) but nothing reads it, and the resource exclusion constraint (`migrations/versions/20261010_000000_baseline.py:2255-2258`) allows exactly one live slot per resource at a time. There is also no API to manage rooms and stations, which CLI-23 lists as to do.

### Options

For the member list, option A is an array column `items.staff_ids text[]` where an empty array means every member. It follows the existing `items.addon_for` array, syncs with the item row in `business_shared` with no new stream, and needs no join. It has no foreign key, so a removed member's id stays in the array and readers filter by active members. Option B is a join table `item_staff (business_id, item_id, staff_id)` with foreign keys. It is stricter, but it needs its own sync stream entry, its own write path and a migration bridge for every reader.

For fairness, option A is least-booked: among the members free at that start, choose the one with the fewest live bookings on that local day, then that week, then by `created_at`. It is computed from data we already have and needs no schema. Option B is round-robin with a stored pointer per service, which needs a column and a write on every public booking. Option C is to keep first free and let the business order members, which is the current behaviour with a sort key.

For resources, option A is a pool per service, `items.resource_ids text[]`: a booking of that service needs one free resource from the pool, the server picks the first free one for public bookings, and staff can override. Option B is a single required resource per service, which fails for a salon with three identical stations. For `resources.capacity`, option A removes the column, because a class holds its room once whatever its attendance and a pool expresses "three stations"; option B implements counting with a per-resource advisory lock and a count check in place of the exclusion constraint, which loses the database backstop.

### Recommendation

We recommend `items.staff_ids` as an array with empty meaning everyone, least-booked choice for "any", `items.resource_ids` as a pool, and removing `resources.capacity`. Availability for a pooled service requires both a free member and a free resource from the pool for the same window, which the in-memory availability pass from gap 7 can do cheaply. We also add `/v1/resources` to create, rename and switch off rooms and stations, since a pool is useless without them.

### Schema changes (need explicit approval)

- `items.staff_ids text[] NOT NULL DEFAULT '{}'`: the members who perform the service; empty means every member. Existing rows get the empty array, so nothing changes for current businesses. Rollback drops the column.
- `items.resource_ids text[] NOT NULL DEFAULT '{}'`: the rooms or stations a booking of the service needs one of; empty means none. Existing rows get the empty array. Rollback drops the column.
- Drop `resources.capacity` and its CHECK `ck_resources_capacity`. Data impact: the stored values are discarded; every current row is 1 unless someone wrote another value by hand, which we will check before the migration. Rollback re-adds the column with default 1.

### Surfaces

Editing the member list and the pool is part of the existing item command (3), `PATCH /v1/items/{id}`. Resource management is a command (3). Choosing a member and a resource on a public booking is the public surface (4). Devices read both arrays through sync-read (1).

### API and sync contract

`ItemOut`, `ItemCreate` and `ItemPatch` gain `staff_ids` and `resource_ids`; the service validates that each id is an active member or resource in the business. `PublicService` lists only the members who perform it. New `GET/POST/PATCH /v1/resources`. The `items` projection in `business_shared` gains the two columns, and `resources` loses `capacity`; `sync_projections.json` is updated and `make gen-sync-schema` rerun.

### UI

The item editor (web and mobile `Catalog`, `useItemForm` in `domain/catalog.ts`) gains a member picker and a room or station picker built from the shared `Choice` component. A `Resources` section in Setup uses `ListPage` and `Modal`, with a new `domain/resources.ts` and `strings.resources`. `slotProblem` in `domain/bookings.ts` checks the pool. Connect needs no change beyond the narrower member list.

### Tests

Happy: a service limited to two members offers only them; "any" spreads three bookings across three free members; a pooled service books the second station when the first is taken. Each 4xx: an unknown or removed member id in `staff_ids`, an inactive resource in the pool, booking a member who does not perform the service. Security: a resource id from another business is refused; staff cannot edit items. Edge: all stations taken leaves the time closed even with free members; a removed member in `staff_ids` is ignored.

Size: L.

## Gap 3: removing a staff member

### Problem

`StaffService.remove` sets the member to removed and revokes their sessions, and nothing else (`services/staff.py:300-321`). Their future bookings stay on the calendar with nobody to do them, their active recurrences keep their `staff_id`, and the clients are not told. The manage link loads the member with `db.get` and no status check (`PublicManageService._visit`, `services/public.py:748-753`), so a client can reschedule into the removed member's calendar.

### Options

Option A refuses removal while the member has future live bookings or active recurrences, and returns the count so the owner can move them first. It is safe and simple, but moving forty visits one at a time is a poor experience. Option B makes removal carry a choice for future work: reassign to another member (each visit checked with `slot_problem`, the ones that clash reported and left for the owner) or cancel with client notices and deposit refunds. Option C removes the member and flags their visits as needing attention, which leaves clients booked with nobody.

### Recommendation

We recommend A and B together: `DELETE /v1/staff/{id}` without a choice returns 409 `staff_has_future_work` with the counts, and with `future: "reassign"` plus `reassign_to`, or `future: "cancel"`, it does the work in one command and reports what it could not move. Active recurrences follow the choice (reassigned, or canceled through `RecurrenceService.cancel`). The manage link refuses a reschedule when the visit's member is not active and offers cancel or a message to the business. Hours rows of a removed member stay, since nothing reads them once the member is inactive.

### Schema changes

None.

### Surfaces

Removal stays a command (3). The manage-link change is the public surface (4).

### API and sync contract

`DELETE /v1/staff/{id}` gains an optional body `{future, reassign_to}` and returns `{moved, canceled, left}` instead of 204. A new error code `staff_has_future_work`. `ManagedBooking` gains `can_reschedule: bool` so Connect stops offering a move it will refuse.

### UI

`domain/staff.ts` gains `useRemoveMember`, which previews the affected visits from the replica, and the `Team` screens on web and mobile show a `ConfirmDialog` with the choice. Connect's `PublicManage` hides the move action when `can_reschedule` is false.

### Tests

Happy: removal with reassign moves visits and series; removal with cancel notifies clients and refunds deposits. Each 4xx: no choice with future work (409), `reassign_to` removed or the same member, staff caller (403). Security: `reassign_to` from another business returns 404. Edge: a visit that clashes with the new member's calendar is reported and left; a repeated removal is a no-op; the manage link of a removed member's visit cannot reschedule.

Size: M.

## Gap 4: auto-completion and the no-show time guard

### Problem

Nothing completes a past visit: completion happens only in `BookingService.patch` (`services/bookings.py:593-595`) and the roster. Review requests read only completed bookings (`services/reviews.py:208-222`) and the returning-client flow reads the last completed visit (`services/returning.py:239-246`), so a business that never presses Complete sends no review requests and its returning clients look new. CLI-24 asks for visits left open to complete themselves the next morning. In the other direction, `patch` accepts `no_show` and `completed` for a visit that has not started (`services/bookings.py:586-598`), and `no_show` forfeits the deposit or charges the saved card (`services/bookings.py:808-842`), so a mistaken tap on next week's visit takes the client's money.

### Options

For completion, option A is a job every 15 minutes that completes confirmed bookings whose slot ended before the current local midnight of their business, so staff keep the whole day to mark no-shows. Option B completes at slot end plus a grace period, which is quicker but races staff who mark a no-show an hour later. Option C never completes automatically and reminds staff instead, which leaves the review and returning features dependent on discipline.

For the guard, option A refuses `no_show` before the start and `completed` before the start. Option B also refuses `completed` before the end, which blocks the common case of finishing early.

### Recommendation

We recommend option A for both. The job completes confirmed bookings (sets `completed_at`, completes a one-to-one slot, and a class slot once all its bookings are closed, in line with B3) and records an audit with no user. Pending bookings that were never approved and are now past are canceled with no notice. Checked-in status does not matter. A business can turn auto-completion off with `booking_policy.auto_complete` (default true). The guard returns 409 with code `visit_not_started` for `no_show` and `completed` before `starts_at`, on both `patch` and the roster `act`.

### Schema changes

None. `businesses.booking_policy` gains the key `auto_complete: bool`, which is a JSON shape change in the API contract.

### Surfaces

Auto-completion is a job (5), `run_complete_past_bookings` in `services/bookings.py` with a cron entry in `tasks/worker.py`. The guard is in the existing command (3).

### API and sync contract

`BookingPolicy` and `BookingPolicyPatch` gain `auto_complete`. New error code `visit_not_started`. Completed rows reach devices through the existing history streams.

### UI

The Complete and No-show actions in `useBookingActions` (app-core) are disabled before the start, with the reason from `strings.bookings`. The online booking settings screen gains a toggle through `useOnlineBookingForm`.

### Tests

Happy: a visit that ended yesterday is completed by the job and a review request follows; a pending past visit is canceled. Each 4xx: no-show and complete before the start (409). Security: the job only touches its own business's rows when two businesses in different zones share a run (one in Vancouver, one in Halifax, run at a time that is past midnight in one and not the other). Idempotency: running the job twice completes nothing twice and writes one audit per booking; a no-show marked before the job runs is not overwritten.

Size: S.

## Gap 5: late-cancel policy

### Problem

Inside the cancel cut-off, the manage link refuses outright (`PublicManageService._blocked`, `services/public.py:714-733`), and outside it a collected deposit is always refunded (`services/public.py:698-701`). `late_cancel_deposit` is stored in the policy (`schemas/bookings.py:284`) but never read, which B7 hides until this decision. Clients whose plans change late therefore have to phone, and the business has no way to say "you may cancel late, but the deposit is kept".

### Options

Option A keeps the block, as today. Option B allows a late cancel online and applies the business's choice: keep the deposit (through the existing forfeit journal, `ledger.post_forfeit`) or refund it. Option C charges a late-cancel fee to the saved card off-session; the no-show path already charges the deposit amount this way (`services/bookings.py:818-841`), but a separate fee amount needs its own payment kind or a desk order, and off-session charges can fail or need authentication.

### Recommendation

We recommend option B now, with option C left in the "After launch" list where "a cancellation policy with a late-cancel fee" already sits. The policy key `late_cancel` takes `block`, `keep_deposit` or `refund_deposit` and replaces `late_cancel_deposit`. When it is `keep_deposit` and the deposit is still pending (not collected), the cancel goes through and nothing is charged. The booking page and the manage page show the policy in words before the client commits, and the manage cancel result says whether the deposit was kept. Staff cancels from the calendar inside the cut-off offer the same keep or refund choice, defaulting to the policy. Whether a cancel was late is derived from `canceled_at`, `starts_at` and the cut-off, so reports need no new column.

### Schema changes

None. `businesses.booking_policy` replaces `late_cancel_deposit` with `late_cancel`, a JSON shape change. Stored policies with `late_cancel_deposit` are rewritten in the same release by a data step in the migration, which needs approval as a data change: `keep` becomes `keep_deposit`, `refund` becomes `refund_deposit`, and a missing key becomes `block`.

### Surfaces

The manage cancel is the public surface (4); the staff cancel is the existing command (3); the forfeit posts through `ledger.post` as today.

### API and sync contract

`BookingPolicy.late_cancel`, `ManageCancelResult.deposit` gains `kept`, `PublicPolicy` carries the policy so Connect can state it, and `BookingPatch` gains an optional `deposit: "keep" | "refund"` for staff cancels inside the cut-off.

### UI

`useOnlineBookingForm` gains a choice for the policy; Connect's `PublicBooking` and `PublicManage` show the policy text from `strings.publicBooking`; the staff cancel dialog gains the keep or refund choice through `useBookingActions`.

### Tests

Happy: a late cancel with `keep_deposit` forfeits the collected deposit and the ledger balances; with `refund_deposit` it refunds. Each 4xx: `block` inside the cut-off (409 with the reason), a status that cannot be canceled. Security: a manage token of another business's booking cannot read the policy of this one. Idempotency: a repeated cancel returns the same result and posts one journal; a deposit that settles after the late cancel is kept or refunded according to the policy (builds on B2).

Size: M.

## Gap 6: the hours model

### Problem

Several parts of the hours model do not fit how businesses work or are only half built.

- A window cannot end at midnight or run overnight: `ck_hours_local_window` requires `end_time > start_time` (`models/scheduling.py:114-119`) and the API repeats the rule (`schemas/hours.py:41-43`). An all-day row uses `time.max` on the server (`services/bookings.py:1366-1373`) but the next midnight on devices (`domain/bookings.ts:449-453`), so the two disagree by a microsecond at the edge.
- `basis = 'date'` rows are read by `open_windows` and by devices (`domain/bookings.ts:431-445`), but no API writes them; only the seed does (`scripts/seed_demo.py:807-829`). A date row with `available = false` and times set is ignored, so a "break" written that way closes the whole day.
- The week command refuses days with more than one window (`services/hours.py:100-104`, code `hours_split_week`), and the editor cannot create them, so a lunch break cannot be expressed at all.
- Buffers are ignored at window edges: `open_slots` fits only the duration inside the window (`services/bookings.py:952`) and `is_within_hours` checks only the visit (`services/bookings.py:1380-1391`), while the conflict check includes buffers (`services/bookings.py:153-163`).
- The default step is the service length plus buffers (`services/bookings.py:946`), so a 45 minute service offers 10:00, 10:45 and 11:30, which clients find odd and which leaves gaps after other bookings.

### Options

For midnight and overnight, option A allows `end_time = '00:00'` to mean the next midnight and nothing else. Option B allows any `end_time <= start_time` to mean the next day, which supports overnight shifts but makes every window potentially span two local dates in `open_windows`, `is_within_hours` and the device mirror. Option C keeps the rule and treats an all-day row as the next midnight everywhere.

For date rows, option A adds a writer, `POST /v1/hours/{staff_id}/dates`, for extra or changed hours on a date, limited to `available = true` windows, with closures and time off staying in exceptions. Option B removes the `date` basis entirely, since time off already covers closed days. Extra opening days (a holiday rush Sunday) are common enough that we prefer A.

For split days, option A changes the week command to carry a list of windows per day (up to three); multiple rows per weekday are already allowed by the schema. Option B keeps one window per day and adds breaks as a separate concept.

For buffers, option A requires buffers to fit inside working hours, since preparation and clean-up are work. Option B lets buffers fall outside hours, which is the current behaviour of `open_slots` but not of the conflict check.

### Recommendation

We recommend: midnight-only end times now (option A), with the same representation able to grow into overnight shifts later; date overrides through a new API for available windows only, and date rows with `available = false` disallowed by CHECK; split days in the week command and the editor; buffers inside hours, applied the same way in `open_slots`, `is_within_hours` and app-core `slotProblem`; and a default step of 30 minutes for new businesses with "follow the service length" kept as a choice. A break is two windows.

### Schema changes (need explicit approval)

- Replace `ck_hours_local_window` with `(start_time IS NULL AND end_time IS NULL) OR (start_time IS NOT NULL AND end_time IS NOT NULL AND (end_time > start_time OR end_time = '00:00'))`. Data impact: none, since it only widens. Rollback restores the old CHECK, which fails if a midnight row exists; the rollback step first rewrites `00:00` ends to `23:59`.
- Add `ck_hours_date_available`: `basis != 'date' OR available`. Data impact: the seed's `av_holiday` row becomes a closure exception in `seed_demo.py`; on any other database the migration converts `date` rows with `available = false` into `exception` rows covering that local day, which is a data change needing approval. Rollback drops the CHECK; converted rows stay as exceptions.

### Surfaces

The week replacement stays an offline command (2), now with windows per day. Date overrides are a command (3), since they are rare and edited from the online settings screen; if they must work offline, they become a second offline command with the same receipt and revision rules as the week. Availability reads are unchanged.

### API and sync contract

`WeekDay` becomes `{weekday, windows: [{start_time, end_time}]}` with an empty list meaning closed; `hours_split_week` goes away. The outbox payload in `packages/sync` (`hours.ts`) changes shape; pending entries in old shape are discarded with a notice, consistent with the no-compatibility rule. New `POST/DELETE /v1/hours/{staff_id}/dates`. `BookingPolicy.step_min` defaults to 30 for new businesses. No sync stream changes.

### UI

`useWeekEditor` in `domain/hours.ts` edits a list of windows per day; web and mobile `Hours` render an add-window action per day with shared `Field` and `Button`. A date override list joins the time-off list in `useTeamWeek`. `slotProblem` and the device `windows` function adopt buffers inside hours and the midnight end.

### Tests

Happy: a split Tuesday offers no times over lunch; a window ending at midnight offers a 23:00 one-hour slot on both server and device; an extra Sunday offers times. Each 4xx: overlapping windows in one day, more than three windows, end before start that is not midnight, a date override for a removed member. Security: staff editing another member's date override (403). Edge: buffers make the last start of the day earlier; 23 and 25 hour days with midnight ends (Toronto, Halifax); a replayed week operation with windows returns the original revision.

Size: L.

## Gap 7: availability and calendar query performance

### Problem

On the server, `open_slots` runs one `conflicting_slot` query per candidate start (`services/bookings.py:950-958`), and `open_windows` loads every hours row for the member on each call (`services/bookings.py:1359-1361`). `open_days` repeats that for 14 days and every member (`services/public.py:446-487`), and `next_openings` for up to 7 days per service (`services/public.py:212-230`). A business with five members and 15 minute steps runs thousands of queries for one date strip.

On devices, every time range filter wraps the column in `utcSql`, a `datetime(CASE ...)` expression (`packages/app-core/src/datetime.ts:571-573`), which defeats the `slots_business_start` and `slots_staff_start` indexes, so the calendar query (`domain/bookings.ts:240-253`) scans every synced slot. The time-off form loads 400 days of events (`domain/hours.ts:726-728`) and the series screens 730 days (`domain/recurrences.ts:295,616`). The audit's probe (`.scratchpad/scheduling-audit-fe/perf.test.ts`) shows a full scan on 30,000 slots.

### Options

On the server, option A loads the member's slots, exceptions and hours for the whole requested range in three queries and computes free starts in a pure function, which can be unit-tested against the per-candidate path. Option B caches computed availability in Redis and invalidates it on writes, which adds an invalidation surface across bookings, hours, time off and items. Option C moves the computation into SQL with `generate_series`, which is fast but hard to keep in step with the device mirror.

On devices, option A adds a plain text range prefilter on the raw column next to the exact `utcSql` predicate, with bounds widened by a day, so SQLite uses the index and the exact predicate trims the edges. Option B canonicalizes timestamps in the sync rules so the raw text compares correctly, which changes the format for every reader. Option C stores an epoch integer column on `slots` and `bookings`, which is a schema change to fix a client query. Separately, the long ranges can shrink: the time-off form needs only the time-off window, and the series screens need only the series' own dates.

### Recommendation

We recommend option A on both sides, plus the shorter ranges. The server keeps its rule that `book` and `reschedule` check the one chosen start under the staff lock with `slot_problem`; the batch path only lists. A property test asserts that the batch path and `slot_problem` agree on every candidate across daylight-saving weeks, extending the property suite planned in plan.md. We measure before and after with a seeded business of five members and a year of bookings and record the numbers in the progress file; caching is considered only if the batch path is still slow.

### Schema changes

None.

### Surfaces

Unchanged: public reads (4) and sync-read (1).

### API and sync contract

None. `/days` keeps its limit of 14.

### UI

`utcSql` gains a companion that emits the prefilter, used by `EVENTS_SQL`, `today.ts`, `classes.ts` and `search.ts`. `useTimeOffForm` queries only its window, and `useSeriesContext` takes the series' first and last dates.

### Tests

Unit: the pure availability function across windows, buffers, closures and existing slots. Property: batch equals per-candidate. Performance: a backend test that bounds the query count for `/days` (a fixed number per request, independent of steps), and an app-core test with sql.js that asserts the query plan uses the index. Edge: a slot that starts the previous local day and overlaps today is still found by the widened prefilter.

Size: M.

## Gap 8: recurrence horizon and occurrence edits

### Problem

A series is expanded once when it is created and capped at 60 occurrences (`services/bookings.py:1001,1033`); B5 makes a request beyond the cap fail instead of truncating, but a weekly client still runs out after about a year, and a series with no end is refused (`services/bookings.py:1074-1075`). The recurrence row stores no local start time (`models/scheduling.py:158-180`); the time is read back from slots, so a generation job has nothing authoritative to extend from. Dates skipped at creation because they clashed are reported once and not stored, so nothing can tell a skipped date from a date that was never part of the rule. The API can change one specific visit by date (`services/bookings.py:1340-1351`), but the series screen always sends the next upcoming one (`domain/recurrences.ts:726`).

### Options

Option A generates occurrences on a rolling horizon: the recurrence stores its local start time and the date it has been generated through, and a nightly job extends each active series to the horizon (for example 26 weeks), recording dates it skips because of clashes and notifying the member. Option B raises the cap and keeps eager expansion, which is one constant to change but still cannot express an open-ended series and fills device replicas with years of rows. Option C computes occurrences on read and creates the booking when the date arrives, which breaks the rule that the calendar is the synced rows and the guarantee that the slot is reserved.

### Recommendation

We recommend option A. Each slot of a series also records the local date of the occurrence it was generated for, so the job can tell that a visit moved to another day still belongs to its original date and does not create it again. Dates the job or the creator skipped are stored on the recurrence, and so are dates a staff member removed from the series. A series may be open-ended (no count and no until). The series screen lets staff pick any upcoming visit for a "this visit only" change, which the API already supports. The same job generates class sessions for gap 1.

### Schema changes (need explicit approval)

- `recurrences.local_time time NULL`: the wall-clock start in the business zone. Backfilled from the earliest live slot of each series, converted to local time. Rollback drops the column.
- `recurrences.generated_through date NULL`: the last local date generated. Backfilled from the latest slot of each series. Rollback drops the column.
- `recurrences.skipped date[] NOT NULL DEFAULT '{}'`: dates left out by a clash or removed by staff. Existing rows get the empty array; past skips are not recoverable and stay unknown. Rollback drops the column.
- `slots.recurrence_date date NULL` with CHECK `recurrence_id IS NULL OR recurrence_date IS NOT NULL` added after the backfill: the occurrence a slot was generated for. Backfilled from the local date of `starts_at` for slots with a `recurrence_id`. Rollback drops the CHECK and the column.
- A partial unique index `uq_slots_recurrence_date` on `(recurrence_id, recurrence_date) WHERE status <> 'canceled'`, so a concurrent job run cannot create the same occurrence twice. Rollback drops the index.

### Surfaces

Generation is a job (5), `run_extend_recurrences` in `services/bookings.py`, nightly at a fixed hour. Create, change and cancel remain commands (3).

### API and sync contract

`RecurrenceCreate` accepts neither `count` nor `until` for an open series, and the cap applies only to what is generated at once. `RecurrenceOut` gains `local_time`, `generated_through` and `skipped`. The `recurrences` and `slots` projections gain the new columns.

### UI

`useSeriesRecord` lets the user pick the visit a change starts from; the series summary shows skipped dates and "continues" for open series, with copy in `strings.recurrences`. The composer offers "no end date".

### Tests

Happy: a weekly open series generates 26 weeks, and a week later the job adds one more. Each 4xx: a series with both `count` and `until`, a change with a date not in the series. Security: the job never extends a canceled series or one whose member was removed (it ends it and notifies the owner). Idempotency and edge: two concurrent job runs create each occurrence once; a visit moved to another day is not recreated; a series across the November daylight-saving change keeps 10:00 local; a monthly series on the 31st.

Size: L.

## Gap 9: time zone rule changes and stale client data

### Problem

Slots store instants only. When the rules for a zone change after a visit was booked, the stored instant no longer means the local time the client agreed to. The 2026b update keeping British Columbia on UTC-7 is the current example: a visit booked before the update for 10:00 on a November date was stored as the instant for 10:00 PST, which now reads as 11:00. Nothing records the intended wall time, so the server cannot detect or repair this.

On the client side, Connect and the staff apps format times with the device's time zone database. A device with older data shows the wrong local time for the same instant. The page already sends `now` with the business's offset (`services/public.py:205`), but no client compares it with what the device computes.

### Options

For stored instants, option A stores the local wall time of each slot when it is written and, after a tzdata upgrade, a job compares each future slot's local wall time with its instant under the new rules and re-anchors the ones that differ, refusing a move that would clash and reporting it. Option B keeps no local time and computes the old local times at upgrade with the previous tzdata version in a separate environment, which is a fragile operational step done under pressure. Option C treats instants as the agreement and accepts the shift.

For stale devices, option A has Connect render public times from server-supplied local wall times (a plain `2026-11-02T10:00` string per slot and per visit), which needs no time zone database on the device. Option B detects a mismatch between `page.now` and the device's computed offset and shows a warning. Option C does both: local strings on Connect, and on staff apps, where the replica holds instants, a startup check against a server `now` with a banner when the device disagrees.

### Recommendation

We recommend option A for stored instants and option C for devices. A change of the business's own zone is a different case: the instants stay and the wall times are rewritten, since the business moved, not the rules; this needs a decision. The re-anchor job runs after every deploy that changes the pinned `tzdata` and is otherwise idle.

### Schema changes (need explicit approval)

- `slots.local_starts_at timestamp without time zone NULL`: the wall-clock start in the business zone when the slot was written. Backfilled from `starts_at` with the current rules, which treats today's data as correct. Made NOT NULL after the backfill. Rollback drops the column.

### Surfaces

Re-anchoring is a job (5), `run_reanchor_slots`, with notifications to clients whose visit moved. The local strings are part of the public surface (4). The staff device check is a read through an existing command endpoint.

### API and sync contract

`PublicSlot`, `ManagedBooking` and the booking result gain `local_starts_at` (and `local_ends_at`). The session bootstrap response gains `now` with the business offset. The `slots` projection gains `local_starts_at`, so devices can also show the intended time when their database is stale.

### UI

Connect's `publicBooking.ts` and `PublicManage` format from the local strings. App-core gains `useZoneCheck`, which compares the server's offset with `Intl` and drives a `Notice` on web and mobile from `strings.common`.

### Tests

Happy: with the zone rules patched in a test (a fake zone provider), a future slot is re-anchored and the client notified. Each 4xx: none new. Security: the job only moves future live slots, never past or canceled ones. Edge: a re-anchor that would clash is reported and left; a slot in a gap or a repeated hour after the change; a device whose computed offset differs from `now` sees the banner; Connect renders the same text in `America/Vancouver` and `Asia/Tokyo` browsers.

Size: M.

## Gap 10: concurrency

### Problem

There are four separate races.

- `reschedule_count` can lose an update. The manage reschedule loads the booking without a lock (`services/public.py:735-746`), checks the limit (`services/public.py:613-615`), takes only the staff advisory lock (`services/public.py:619-622`), and increments the stale value (`services/public.py:636`). Two concurrent reschedules both pass the limit and both write the same count.
- Idempotency replay ignores the request body. `run_command` returns the stored response for a repeated key whatever the new body is (`core/command.py:64-76`), and the public book and manage paths do the same (`services/public.py:251-254,611-612,689-692`). A client that reuses a key for a different time gets a success for the old one. The hours receipt path already compares payloads (`services/hours.py:71-77`).
- Time-off creation does not take the staff lock (`services/bookings.py:1764-1795`), while booking writes do (`services/bookings.py:375-379`). A booking that checks exceptions just before the time off commits can land inside it.
- Hours replacement takes the business hours lock but not the staff lock (`services/hours.py:15-18,82`), and it returns only the new revision (`services/hours.py:120-128`). Bookings left outside the new hours are not reported, unlike time off, which returns `affected` (`services/bookings.py:1834-1857`).

### Options

For the count, option A locks the booking row with `SELECT ... FOR UPDATE` at the start of every manage mutation and checks after the lock. Option B uses a conditional `UPDATE ... SET reschedule_count = reschedule_count + 1 WHERE reschedule_count < :max RETURNING`. Option A also covers cancel racing reschedule, so we prefer it.

For idempotency, option A stores a hash of the canonical request on the key row and returns 422 `idempotency_key_reused` when a repeated key carries a different body. Option B folds the body hash into the key, so a changed body runs as a new command; that hides client bugs and can double-book.

For time off and hours, option A takes the member's staff lock (and, for a closure, every active member's lock in id order) before writing. Option B makes booking writes also take the business hours lock, which serializes every booking in a business.

### Recommendation

We recommend option A in each case, and the hours command returns `stranded`, the ids of future live bookings outside the new week, computed under the lock, as time off does. Devices already preview affected visits with `affectedBy` (`domain/hours.ts:509`) and show the server's list after the operation replays.

### Schema changes (need explicit approval)

- `commands.request_hash text NULL`: the SHA-256 of the canonical request body for the key. Existing rows get null and are replayed without comparison until they expire. Rollback drops the column.

### Surfaces

All in existing commands (3), the public surface (4) and the hours offline command (2).

### API and sync contract

New error code `idempotency_key_reused`. `HoursWeekResult` gains `stranded: list[str]`. `run_command` gains a `request` argument that callers pass so the hash covers the body, not only the path.

### UI

The hours outbox result handler in `packages/sync/src/hours.ts` keeps `stranded` and the `Hours` screens show a `Notice` linking to those visits. Connect maps `idempotency_key_reused` to a retry with a fresh key, since that only happens after the client changed its choice.

### Tests

Concurrency tests use two real connections: two reschedules at the limit (one refused), a booking and a time off for the same window (one of them refused or the booking reported as affected), a booking and an hours change (the booking reported as stranded). Idempotency: the same key with a different body returns 422 on `run_command`, public book, manage reschedule and manage cancel; the same key and body replays. Security: a key from one business never replays in another (existing unique constraint).

Size: M.

## Task order

Each task starts only after its schema change, if any, is approved. Within a task, the failing tests come first, as in plan.md.

- G1. Concurrency fixes: booking row locks on manage mutations, staff locks for time off, closures and hours, `stranded` on the hours result. No schema. (Gap 10, part.)
- G2. Idempotency request hashes on `commands`. Schema: `commands.request_hash`. (Gap 10, part.)
- G3. Time guards for no-show and complete, and the auto-completion job with `auto_complete`. (Gap 4.)
- G4. Staff removal with reassign or cancel, and manage links refusing removed members. (Gap 3.)
- G5. Late-cancel policy, replacing the setting B7 hid. Data step on `booking_policy`. (Gap 5.)
- G6. Server availability in one pass, with the query-count test and the property test. (Gap 7, server.) This comes before G8 to G11, which add more conditions to availability.
- G7. Device range prefilters and shorter ranges. (Gap 7, devices.) Independent of the server tasks and can run in parallel with them.
- G8. Hours model: split days, midnight ends, date overrides, buffers inside hours, default step. Schema: hours CHECKs and the date-row conversion. (Gap 6.)
- G9. Service-to-staff mapping and least-booked choice for "any". Schema: `items.staff_ids`. (Gap 2, part.)
- G10. Resource management, service pools and removing `resources.capacity`. Schema: `items.resource_ids`, drop `resources.capacity`. (Gap 2, part.)
- G11. Rolling recurrence generation with occurrence identity and skipped dates. Schema: recurrence columns, `slots.recurrence_date`, unique index. (Gap 8.)
- G12. Class timetables and sessions, booking into sessions only, waitlist and auto-promotion. Schema: `recurrences.resource_id`, `recurrences.capacity`. Depends on G6, G10 and G11. (Gap 1.)
- G13. Local wall times on slots, the re-anchor job and local strings on Connect, and the device zone check. Schema: `slots.local_starts_at`. Best done after G11 so generated slots write the column from the start. (Gap 9.)

Each task ends with the full gate for its side, `make gen-api` and `make gen-sync-schema` when the contract or sync rules change, and a review of `sync_projections.json` when a stream gains columns. The milestone audit from `CLAUDE.md` runs after G5, G10 and G13.

## Decisions needed

1. Should classes be booked only into sessions staff create (a timetable or one-off sessions), with computed class times from working hours removed?
2. When a waitlisted client owes a deposit, should a released seat be offered with a payment deadline, or should it go to the next waitlisted client who owes nothing?
3. Should the public page offer "join the waitlist" on full sessions, and should that be a per-business setting?
4. Is an array of member ids on the service (empty meaning everyone) acceptable, given it has no foreign key, or do we want a join table?
5. Should "any" choose the least-booked free member that day, or should the business be able to set an order?
6. May we drop `resources.capacity`, given that a pool of identical stations replaces it?
7. When a member is removed with future visits, should the default offered in the dialog be reassign or cancel?
8. Should past visits complete automatically after local midnight by default, and should never-approved pending visits that are now past be canceled silently?
9. For late cancels, is "block, keep deposit or refund deposit" enough for launch, with a separate late-cancel fee left for after launch?
10. Do we need overnight shifts at launch, or is a window ending at midnight enough?
11. Should date overrides exist (extra or changed hours on one date), or should we remove the `date` basis and rely on time off only?
12. Must buffers fit inside working hours?
13. Should new businesses default to 30 minute start times instead of following the service length?
14. How far ahead should recurring series and class timetables be generated (we suggest 26 weeks), and should open-ended series be allowed?
15. When the business changes its own time zone, should future visits keep their instants (and change local time) or keep their local time (and move)?
16. Should a tzdata change move future visits automatically and notify clients, or only flag them for staff to review?

## Decisions (2026-10-12)

The user accepted every recommendation above: classes are booked only into scheduled sessions; a released seat is offered to a waitlisted client who owes a deposit with a payment deadline; the public page offers the waitlist, on by default and per business; members are an array on the service; "any" picks the least-booked free member; `resources.capacity` is dropped; removal defaults to reassigning to any available member; auto-completion is on by default; late cancels are block, keep deposit or refund deposit; windows may end at midnight with overnight shifts deferred; date overrides stay and get a writer; buffers must fit inside working hours; new businesses default to 30 minute starts; series are generated 26 weeks ahead and may be open-ended; visits keep their local time when a business changes zone; a tzdata change flags visits for staff review. Each schema change still needs its own approval before its task starts.
