# Vertical gaps

Five product gaps keep otherwise well-fitting verticals off Clientbridge: clinics, trades, day camps, driving schools and mobile auto detailing. This plan closes them, and the uncovered verticals then follow as demo businesses and trade pages.

The schema stays concise. An audit of each need against the existing code (2026-10-22) showed that most of it builds on existing tables, so the plan now needs two columns. Each schema change is made only once it is approved, change by change.

## Done

- 87057333: staff can add a note to a booking; pickup permissions on a student.
- 2a5441af: the `vehicle` subject kind (cb0028).

## Step 1: no schema, built on what exists

1. Cleanup from the phase 0 and 1 review. Pickups and equipment share one repeating-group helper in app-core and one `RepeatingGroup` twin in `@clientbridge/ui`. `useNoteComposer` owns opening and cancelling, and cancelling clears the draft.
2. Series fix. Changing or cancelling a client's series finds its visits by `recurrence_id` without the client, so on a shared class slot it could act on other clients' seats. It is scoped to the series' client.
3. Business address on printed documents. `printedDoc` leaves the address and phone empty, although the legal address columns exist and sync. The letterhead reads them.
4. Insurance receipt. The existing invoice and sale receipts are the source, so a visit paid by invoice or at the desk both work. The receipt adds the practitioner's name and `staff.title`, which holds the credential and registration number ("RMT · Reg. 12345"). Staff open it from the booking, and the client from the manage page. A visit with no invoice or sale is refused with its own error code.
5. Treatment notes as forms. An admin keeps a SOAP form. Staff fill it on a visit through a new staff command, which submits the response at once, linked to the booking, with no client token and the author in its signature. Submitted responses are already final. The responses sync query leaves out rows with no token, so these notes never reach a device. A read endpoint checks author or manager and records an audit entry through `run_command`. An amendment is a further response on the same visit. Staff get a view of form answers, which they don't have today for intake forms either.
6. Add-ons that lengthen a visit. An add-on stays a product, and its `duration_min` adds to the visit. Booking stores the longer `slots.ends_at`, because the overlap constraint reads it. Connect asks for extras before the time, and offers only times that fit. Staff gain an "add add-on" action that uses the existing resize path. Add-on invoice lines carry the booking and staff, so they earn.
7. Crew as time-off blocks. Adding a helper checks their calendar under the staff lock, then writes an `hours` exception for the job's window, with the job as its reason and `booking:<id>` in its note. Availability already respects these blocks. Reschedule, client reschedule, cancel, series change and staff reassignment carry the blocks with the booking. Earnings and their reversal are keyed per staff member, from lines that carry the helper's `staff_id`, and tips already split by line.
8. Programs. Staff create a class series: empty class slots tagged with a recurrence that has no client. Enrolling books every remaining session or none, under the staff lock, with the price and deposit on the first booking. Seat dedupe moves from client to subject, so siblings can share a session. `items.session_count` is allowed on classes. Connect shows start dates with a seat on every day.
9. Driving school industry in onboarding, mapped to `student`.

## Step 2: needs schema

| # | Change | Why existing data doesn't cover it | Downgrade |
| --- | --- | --- | --- |
| S4 | `packages.subject_id varchar NULL` FK `subjects`; synced | No subject exists anywhere on a purchase. Deriving it from the first covered booking leaves a new pack unassigned and lets the wrong child's visit claim it. | drop |
| S7 | `items.staff_ids varchar[] NOT NULL DEFAULT '{}'` (empty means everyone) | No link exists between staff and the services they offer. Connect already filters on `PublicService.staff_ids`, but the server fills it with every staff member and never enforces it. This serves driving schools (manual and automatic) and any business where only some staff offer a service. | drop |

Dropped after the audit: `staff.registration_number` (it goes in the title), the `treatment` note parent (forms), service add-ons (products carry a duration), `slots.booking_id` (time-off blocks), and every cars change (the car goes with its instructor).

## Each step ships with

The four-part test matrix for every new command, app-core hooks shared by web and mobile, catalog copy, regenerated codegen, and demo data: Harbourside gets a SOAP form, notes and a receipt; Northlight gets a lengthening add-on and a two-person install; Lakeside gets a camp week. Each item lands on main on its own, through the full gate.
