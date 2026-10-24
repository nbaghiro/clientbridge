# Shared resources

Some visits need a free thing as well as a free person: a car at a driving school, a treatment room at a clinic, the studio room for a yoga class, a kennel for an overnight stay. Today a thing is covered only when it belongs to one staff member, because their calendar covers it. This plan adds shared resources. A service names the resources it can use, and booking needs both a free staff member and one free resource from that list. It works the way staff per service (`items.staff_ids`) already does, with "any free room" in place of "any free staff".

## Scope

In:
- named resources;
- a service's pool of resources;
- availability that needs both a free staff member and a free resource;
- picking a resource automatically or by staff;
- carrying the resource through every move;
- classes and programs holding one room;
- turning a resource out of service;
- the database refusing a double-booked resource;
- settings, the service form, booking detail and a calendar filter on web and mobile;
- demo data.

Out, until a business asks:
- a visit that needs two resources at once;
- maintenance windows on a resource;
- a resource's own opening hours;
- utilisation reports;
- letting clients pick the resource on Connect.

## Schema

Each change needs explicit approval. All three are additive, so no existing row changes. This brings back the shape removed in cb0014 (`7122d26c`), without its `category` and `capacity` columns.

| # | Change | Downgrade |
| --- | --- | --- |
| R1 | Table `resources`: `id` (prefix `rs_`), `business_id` FK, `name varchar NOT NULL`, `active bool NOT NULL DEFAULT true`, `created_at`, `updated_at`; index `ix_resources_business_id`; unique `(business_id, lower(name))` | refuses while a slot or item references a resource; otherwise drops |
| R2 | `items.resource_ids varchar[] NOT NULL DEFAULT '{}'`, services and classes only; empty means the service needs no resource | drop |
| R3 | `slots.resource_id varchar NULL`, FK `resources`; GiST exclusion `excl_slots_resource_overlap` on `(business_id, resource_id, tstzrange(starts_at, ends_at, '[)'))` where `resource_id IS NOT NULL AND status <> 'canceled'`; partial index on `(business_id, resource_id, starts_at)` where `resource_id IS NOT NULL` | refuses while set; otherwise drops the constraint, index and column |

Why each design choice:
- **No capacity column.** A pool of eight reformers is eight rows, so the exclusion constraint enforces every case and nothing needs counting under a lock.
- **No category.** The settings screen calls them "Rooms and equipment", and per-business wording isn't needed yet.
- **No deleted_at.** `active=false` keeps a resource's history and offers it for nothing new. The plate, transmission or room size goes in the name.

One migration (cb0031 or the next free id) holds R1 to R3. `btree_gist` already exists. The exclusion constraint is hand-written SQL in the migration, the same as the staff one.

## Backend

**Models** (`models/scheduling.py`): add `Resource`. `Item.resource_ids` is in `models/catalog.py`. Add `Slot.resource_id`. The prefix `rs_` goes in `core/ids.py`.

**Resources concept**: new files `api/resources.py`, `schemas/resources.py` and `services/resources.py`, plus `tests/test_resources.py`.
- `GET /v1/resources`: any member can call it, though the data mostly arrives through sync.
- `POST /v1/resources` and `PATCH /v1/resources/{id}` (name, active), for managers only, using `assert_role` inside the service, through `run_command` and idempotent.
  - Duplicate name: 409 `resource_name_taken`.
  - Turning a resource inactive while upcoming visits hold it: allowed. The visits keep it. The response returns `upcoming` (a count) so the screen can say "3 upcoming visits still use it".
- No delete endpoint. Turning a resource inactive is the only way to retire it.

**Catalog** (`services/catalog.py` `_assert_shape`): `resource_ids` is allowed only on services and classes, otherwise 422.
- Each newly added id must be an active resource of the same business, otherwise 404. Ids are deduplicated and sorted, as with `staff_ids`.
- Removing a resource from a service's list doesn't touch booked visits.

**Locking**: a new `lock_resources(db, business_id, *ids)` uses the same advisory-lock scheme as `lock_staff`, in a key space of its own and in sorted order.
- Every path that takes a resource locks staff first, then every resource in the service's pool, so two bookings can't both pick the same "first free" room.
- The exclusion constraint is the backstop. Its IntegrityError maps to 409 `resource_busy`, never a 500.

**Availability**: one shared rule. A start is open when the staff member is open, as today, and at least one active resource in the pool is free for the window widened by the item's buffers.
- `resource_free(db, business_id, ids, window)` loads the pool's live slots over the window in one query, ending at the partial index from R3. It returns the free ids in pool order.
- `open_slots` and `open_starts` (bookings.py ~1667-1717) take the busy intervals of the pool resources and drop starts where every resource is busy.
- `_offered` and `open_days` (public.py ~790-824) and the manage-link move reads follow, so Connect only offers times that have a resource.
- A service with an empty `resource_ids` skips all of this, so today's behaviour and speed don't change.

**Booking**: `create_booking_core` (~501) picks the resource.
- Explicit `resource_id` when staff choose one: it must be in the pool and free, otherwise 422 `resource_not_in_pool` or 409 `resource_busy`.
- Otherwise the first free one in pool order.
- Nothing free: 409 `no_resource`.
- `BookingCreate` and `BookingMove` gain an optional `resource_id`. Connect never sends one.
- `slot_problem` (~417) and `conflicting_slot` (~272) gain the resource check. `check()` (~937) reports problem `resource` and offers the free alternatives.

**Carrying the resource through changes**: one helper, `keep_resource(db, booking, slot, new_window)`, called from every path that changes a visit's time.
- If the visit's resource is free in the new window, keep it. Otherwise move it to another free resource in the pool. Otherwise refuse with 409 `no_resource`.
- The paths: staff move and resize (`_target` ~1008, `move_slot` ~576), add-on lengthening (`_lengthen` ~1573), client move from the manage link, series change, a program schedule moving to another instructor, and staff reassignment.
- Crew blocks don't take a resource; the visit holds it.
- Cancel needs nothing, because a canceled slot leaves the constraint.

**Classes and programs**:
- A class session holds one resource for every attendee, and `capacity` stays the seat count.
- Joining an existing session (`open_class_slot` ~318) reuses its resource.
- Creating a session, through first booking or `ProgramService.create` (programs.py ~165), picks a resource for every day under the lock, all or none. A clash gives 409 `schedule_clash` naming the day and the problem `resource`.
- Moving a program to another instructor keeps its resources.

**Resource changes**: turning a resource inactive offers it for no new visit. Upcoming visits keep it until a move needs a new one.

**Errors**: `resource_busy`, `no_resource`, `resource_not_in_pool` and `resource_name_taken`, each with a catalog message and a `FAILURES` entry.

## Sync

`infra/powersync/sync-rules.yaml` changes:
- `resources` (`name`, `active`, `id`, `business_id`, timestamps) goes to every active member, in the same stream as items.
- `items.resource_ids` is added to the items query.
- `slots.resource_id` is added to both slot queries.

Then review `tests/fixtures/sync_projections.json` and run `make gen-sync-schema`. Resource writes are commands, not offline edits of the replica, because the pool and the constraint are server-side rules.

## Frontend

app-core:
- `domain/resources.ts`:
  - `RESOURCES_SQL` reads from the replica;
  - `useResources()`;
  - `useResourceForm` (name, active) on `useAsyncAction`;
  - `resourceName(id)`.
- `domain/catalog.ts`: `useServiceEditor` gains a "Needs" multi-select ("Nothing", or one or more resources). It's hidden while the business has no resources.
- `domain/bookings.ts`:
  - The schedule event SQL carries `resource_id`.
  - `slotProblem` and `planMove` return `resource`.
  - The booking composer and the move picker show the picked resource and let staff change it to another free one in the pool.
- `domain/programs.ts`: the program form shows the room each day will use.

Web and mobile, with thin screens over these hooks:
- **Settings > Rooms and equipment:** a list, add, rename, turn off, and an "N upcoming visits" note.
- **Service form:** the Needs picker.
- **Booking detail and booking sheet:** the resource's name and a Change control.
- **Calendar:** a filter by resource. On web it's a column view over the existing calendar grid. On mobile the filter narrows the list.
- **Classes and programs:** the room on each session.

Connect gets no new screens. It only offers times that have a resource.

The copy lives in `strings.resources` plus a few keys in `strings.catalog` and `strings.bookings`, through `make gen-strings`. New glyphs go in `icons.ts`. Then `make gen-api`.

## Demo data

- **Driving school** (the new demo from section F): cars "Corolla · auto · ABC 123", "Civic · auto · DEF 456" and "Golf · manual · GHI 789". Automatic lessons use the two automatic cars and manual lessons use the Golf. There are four instructors and three cars, so one lesson time is fully booked because no car is free.
- **Harbourside:** Rooms 1 to 3 plus "Couples room, table 1" and "table 2". Massage uses Rooms 1 to 3, and the couples massage uses the two couples tables, so the couples room can no longer be booked twice. Drop the matching "nothing keeps the couples room from being booked twice" sentence from the walkthrough.
- **Ridgeline:** "Studio" and "Turf". Classes use the Studio, so two classes can't overlap there.
- **Lakeside:** "Piano room" for piano lessons.
- `demo_validate` checks that no two live slots share a resource and that every slot's resource is in its item's pool.

## Tests

The four-part matrix for each command:
- **Resources:** create, rename, deactivate, duplicate name, staff role 403, another business 404, replay.
- **Catalog:** pool validation (kind, inactive, another business), dedupe.
- **Booking:**
  - auto-pick and explicit pick;
  - a resource outside the pool, a busy resource, no free resource;
  - two concurrent bookings on a pool of one, following the concurrent add-on remove test, where exactly one wins;
  - the IntegrityError backstop mapping to 409.
- **Availability:**
  - a time where staff are free and every resource is busy isn't offered, on staff and Connect reads;
  - buffers apply;
  - an empty pool is unchanged.
- **Carry-through:** every path listed above, keeping, switching and refusing.
- **Classes and programs:** a session holds one room, joining reuses it, a program schedule with a resource clash refuses all days.
- **Migration:** a round trip, and the downgrade refusing while a slot references a resource.
- **Sync:** the projection test.
- **App-core:** hooks, the editor payload, `slotProblem` and `planMove`, and the SQL tests.

## Order of work

1. Migration, models, the resources concept and catalog validation, with tests.
2. Locking, availability and booking pick, with tests. This is the core of the work.
3. Carrying the resource through every path, plus classes and programs, with tests.
4. Sync, codegen and app-core hooks.
5. Web and mobile screens.
6. Demo data, `demo_validate` and the architecture and engineering docs.
7. A milestone audit of the changeset against the CLAUDE.md checklist, with High and Medium findings fixed in their own commit.

Each step goes through `make format-check` and `make check`, and lands as single-line commits on the working branch.

## Risks

- **Availability cost.** Each candidate start now also needs the pool's busy intervals. One query per window per pool keeps it flat. Measure `open_days` on the driving-school demo before and after.
- **Deadlocks.** Staff locks are taken before resource locks, each in sorted order, everywhere.
- **Existing tests.** A service with an empty pool must behave exactly as today. The existing suite passing untouched is the proof.
