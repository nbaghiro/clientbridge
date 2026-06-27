# Slice 3 — Calendar & Booking (plan)

A flexible, **custom-built** calendar (no calendar library — like PocketSuite on all 3 platforms) plus
the atomic booking command behind it. The view-model + layout math live in `@clientbridge/app-core`
(shared, UI-agnostic); web and mobile only differ in rendering.

## 1. Goals
- A calendar that supports **many view modes** and is easy to extend (the reason to build it custom).
- **Booking is server-authoritative** — creating/moving an appointment goes through a command with an
  atomic conflict check; the result syncs back to every device. *Double-booking is impossible.*
- **Read local, write via command:** the calendar reads `sessions`/`bookings` from the on-device
  replica (`useQuery`); writes go through `POST /v1/bookings` etc.

## 2. Data model → calendar (already built; `models/scheduling.py`)
- **`sessions`** = a capacity-bearing block of time (item, **staff**, optional resource, `starts_at`/
  `ends_at`, `capacity`, `booked_count`, status). **This is the calendar event.** An appointment = a
  session with `capacity 1`; a class = `capacity N`.
- **`bookings`** = a client ↔ session record (`session_id`, denormalized `staff_id`, `client_id`,
  status pending→confirmed→completed/canceled/no_show, `source` online|manual, price, deposit). One
  session has 1 booking (appointment) or N (class).
- **`availability`** = per-staff working hours: `recurring` (weekday + start/end time) or `date`
  (one-off override), `is_available`. Drives bookable-slot computation, **not** the event grid.
- **`resources`** = rooms/equipment. **`schedules`** = recurring series (freq/interval/byday/until) →
  expands to sessions (job, deferred to Phase 7).
- **Sync:** sessions/bookings/availability/schedules already sync — `member_self` (a staffer sees own)
  + `business_full` (owner/admin sees all); resources via `business_shared`. So the calendar has its
  data locally with no extra rules work.

## 3. Surfaces (the decision rule)
| Operation | Surface | Why |
|---|---|---|
| Render the calendar | **sync read** | just authorized rows, already on-device |
| Create / reschedule / cancel a booking | **command** (`POST/PATCH /v1/bookings`) | capacity + conflict are server-only invariants → atomic |
| Bookable slots for a service/staff/day | **command** (`GET /v1/slots`) | computed from availability − existing sessions |
| Edit availability / working hours | **sync write** (`/sync/upload`, staff-own) | plain per-staff data, no invariant |
| Public booking (client, no login) | **public** (surface #4) | unauthenticated; creates booking + client server-side |

## 4. Backend build
- **`services/scheduling_service`** —
  - `slots(item_id, staff_id, date)` → expand the staff's availability for that weekday/date, subtract
    existing sessions, step by the item's `duration_min` (+ buffers) → list of open start times.
  - `conflicts(staff_id, starts_at, ends_at, exclude_session?)` → overlapping non-canceled sessions.
- **Booking command** (`run_command`, so audit + idempotency come for free — closes audit **M5**):
  - `POST /v1/bookings` — appointment path: create a `session` (capacity 1) + `booking`, **atomically
    conflict-checked**. Group path (book into an existing class session): `booked_count++` under a row
    lock if `booked_count < capacity`.
  - `PATCH /v1/bookings/{id}` — reschedule (move the session, re-check conflict) / set status
    (confirm, complete, cancel, no_show). Cancel frees capacity.
- **The "impossible to double-book" guarantee** = a Postgres **exclusion constraint** on `sessions`
  (`EXCLUDE USING gist (business_id WITH =, staff_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
  WHERE status <> 'canceled'`) via a `btree_gist` migration. The command relies on it for atomicity;
  a concurrent double-book raises → mapped to **409 Conflict**. (Manual bookings may override
  availability; the exclusion is the hard rule. Public bookings additionally must fall in a slot.)
- **`GET /v1/slots`** — surfaces `scheduling_service.slots` for the new-booking UI + public booking.
- **Wire `is_tax_registered` → tax** later at invoicing; not needed here. (closes **L8** context)
- **Tests** (4-part matrix): book happy path · **double-book → 409** · book outside capacity → 409 ·
  cancel frees capacity · tenant isolation · staff-can-only-touch-own (role) · idempotency-key replay ·
  slots golden case. **Defer:** the recurring-schedule expansion **job** (Phase 7) — v1 creates
  sessions directly.

## 5. The custom calendar engine — `@clientbridge/app-core/calendar` (the centerpiece)
All UI-agnostic; web + mobile import it and only render differently.
- **View-model:** `CalendarEvent { id, sessionId, bookingId, start, end, title, subtitle, status,
  color, staffId, capacity, bookedCount }`.
- **Data hook:** `useCalendarEvents(rangeStart, rangeEnd, { staffId? })` — one `useQuery` JOINing
  `sessions` (in range) ⋈ `bookings` ⋈ `clients` (name) ⋈ `items` (name, color) → `CalendarEvent[]`.
  Reactive: a booking that syncs in appears instantly.
- **Layout math (ported from PocketSuite's model):**
  - one scalar **`PX_PER_MIN`** drives the grid; `top = minutesFromDayStart(start) * PX_PER_MIN`,
    `height = max(duration * PX_PER_MIN - gap, MIN_H)`.
  - **overlap → columns:** sort by start → greedily chain into overlap *groups* (join iff
    `start < group.maxEnd`) → within a group, equal-width columns up to
    `floor(width / MIN_CARD_W)`, remainder collapses to a **"+N" overflow** chip → sheet.
  - returns `PositionedEvent { event, topPx, heightPx, leftPct, widthPct }`.
- **Range builders:** `dayColumns(date, n)` (n = 1 day / 3-day / 7 week), `monthMatrix(date)`
  (6×7), `agendaByDay(events)` (grouped list). **Business-hours window** auto-expands 0–24 if an
  event falls outside.
- **Mutations:** `createBooking(api, input)`, `rescheduleBooking(api, id, start)`,
  `setBookingStatus(api, id, status)`, `useSlots(api, …)` — same `ApiLike` pattern as clients/catalog.
- **Date utilities** kept dependency-light (small helpers; no moment/dayjs unless we add one shared dep).

## 6. Web calendar UI (`apps/web`)
- A `<CalendarGrid>` time-grid renderer (CSS-grid gutter + day columns; absolute event blocks from the
  shared `PositionedEvent`; current-time line; auto-scroll to now/business-start).
- **Views v1:** **Day · Week** (share the grid) · **Agenda** (list) · **Month** (cell grid + "+N").
  View switcher + Today + prev/next (skip by view granularity) + a staff filter.
- **New booking:** modal — client (search) + service (from catalog) + staff + date/time (with
  `useSlots` suggestions) → `createBooking`. Event tap → detail popover (confirm/complete/cancel/
  reschedule).

## 7. Mobile calendar UI (`apps/mobile`)
- **Agenda (default)** — horizontally-scrollable day strip + a list per day (matches the design mock).
- **Day** — the same time-grid engine rendered with RN `View`/absolute layout.
- **+ New booking** via the existing **FAB** "Create" sheet (we already stubbed it) → the booking form.
- Event tap → detail screen (status actions). (Week on phone = optional/compact.)

## 8. Build sequence (within the slice)
1. **Backend** — exclusion-constraint migration → `scheduling_service` (slots + conflicts) → booking
   command (`POST/PATCH /v1/bookings`) + `GET /v1/slots` → tests → `gen-api`.
2. **app-core/calendar** — view-model, layout math, range builders, `useCalendarEvents`, mutations
   (with unit tests on the layout/overlap math — pure, fast).
3. **Web** — `<CalendarGrid>` + Day/Week/Agenda/Month + new-booking + detail.
4. **Mobile** — Agenda + Day + new-booking + detail.
5. **Verify + commit**, then the **milestone audit** (per CLAUDE.md).

## 9. Scope: v1 vs deferred (DECIDED 2026-06-26)
- **v1 (confirmed):** appointment booking (atomic via the exclusion constraint); **Day · Week ·
  Agenda · Month · Staff-lane/Resource-columns** views on web; Agenda + Day on mobile;
  **drag-to-reschedule** (shared px→min→snap-5 math; web `@dnd-kit`, RN gesture-handler); new-booking +
  detail + cancel; `GET /v1/slots` suggestions.
- **Deferred (own sub-slices / later):** **public booking page** (surface #4 — follow-up sub-slice);
  class/group booking into existing sessions; availability-editing UI (Settings → Scheduling);
  recurring-series UI + the roll-forward job (Phase 7); the "this vs all future" recurring-drag prompt.

## 10. Decisions (locked 2026-06-26)
1. **Views:** full set incl. **staff-lane / resource columns**.
2. **Reschedule:** **drag-to-reschedule in v1** (shared snap math; per-platform gesture binding).
3. **Public booking:** **deferred** to a follow-up sub-slice.
4. **Atomicity:** **Postgres `btree_gist` exclusion constraint** on `sessions`.
