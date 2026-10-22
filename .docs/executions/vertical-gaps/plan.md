# Vertical gaps

Five product gaps keep otherwise well-fitting verticals off Clientbridge: clinics, trades, day camps, driving schools and mobile auto detailing. This plan closes them in an order that builds each piece on the last, so the uncovered verticals can follow as demo businesses and trade pages.

The schema stays concise. Each need is first mapped to existing tables, and nothing that can be worked out when it's read is stored. The whole plan adds three columns and widens three CHECKs, with no new table. Every change is listed in one table at the end, and none is made until it is approved, change by change.

## Order

| Phase | Gap | Effort | Schema |
| --- | --- | --- | --- |
| 0 | Fixes with no schema change: staff can add a note to a booking; pickup permissions on a student | S | none |
| 1 | Mobile auto detailing: a `vehicle` subject kind | S | S1 |
| 2 | Clinics: insurance receipts and treatment notes | M | S2, S3 |
| 3 | Lesson and class packs per student | S | S4 |
| 4 | Trades: service add-ons that lengthen a visit, then a crew on one booking | L | S5, S6 |
| 5 | Day camps and programs: one enrolment across several days | M | none |
| 6 | Driving schools: lessons by transmission, the car going with its instructor | S | none |

Phases 1 to 3 stay out of scheduling and money code. Phase 4 changes availability and staff earnings, and phases 5 and 6 reuse that work.

## Phase 0: no schema change

- Booking notes. `notes.parent_type` already allows `booking`, but the notes API accepts only `client` and `subject`. The API and service accept a booking parent, scoped to the business.
- Pickup permissions. `StudentAttributes` gains `pickups` (up to 10 people, each with a name, relation, phone and note) and `no_pickup`. Both live in the existing `subjects.attributes`. The student form edits them, and the class roster and Today show "May be picked up by".

## Phase 1: vehicles

A business whose clients book work on a car chooses "Vehicles". Make, model, year, colour, plate, size, parking spot and notes live in `subjects.attributes`, the same way pets and sites keep their details. Vehicles count as a place kind, so Directions, On my way and Connect's address step work as they do for sites. This follows the commit that added `site` (6816592c).

## Phase 2: clinics

- Insurance receipt. The practitioner's credential is the existing `staff.title` ("RMT"), so only the registration number is stored. A paid visit by a practitioner with a number offers an insurance receipt to staff from the booking, and to the client from their manage page. It is rendered when it's asked for, from the visit, its invoice, payments and refunds, with the invoice number as the receipt number, so nothing about the receipt is stored. An unpaid visit, or a practitioner with no number, is refused with its own error code.
- Treatment notes. A treatment note is a row in `notes` with parent `treatment` and the visit as its parent id. Its SOAP sections are a fixed template in the body. The author and time come from `created_by` and `created_at`, so saving is signing. A treatment note is never edited or deleted. Each amendment is a further treatment note on the same visit, and the order comes from `created_at`. The sync stream leaves out `parent_type = 'treatment'`, so the notes are read only through the API: by the author, owners and admins, and every read writes an audit entry. They show on the client's history. Retention, about ten years under provincial colleges, is documented, and an automated purge is out of scope.

## Phase 3: packs per student

A package can belong to one subject under a client ("Maya: 6 of 10 left"). Covering a visit with it checks that the visit is for that subject. A package with no subject keeps today's meaning: it covers any of the client's subjects.

## Phase 4: trades

- Service add-ons. The existing `addons` table already links an add-on to its booking and staff, and an add-on can now be a service. The visit's length is the service plus its add-ons' `duration_min`, worked out when it's read. Connect offers only times that fit the longer visit, staff adding or removing an add-on re-checks the calendar, and add-on lines earn commission through their staff.
- Crew. The booking keeps its lead. Each extra member gets a hold slot at the same time, with `slots.booking_id` pointing at the job, so the existing overlap constraint, availability checks and per-staff sync cover them. A hold slot is never offered for booking. Moving, cancelling and completing the booking carries its holds with it. Each member earns at their own rate, on an even share of the visit, and tips split the same way, so there is no share column. Helpers see the hold on their calendar through sync and read the job through the API.

## Phase 5: programs

A program is a class whose slots come from a recurrence that already exists: `recurrences.byday` and `count` give the days and the number of sessions, and `slots.recurrence_id` ties the days together. A class with `session_count` set (today used only by packs) enrols as a whole program of that many sessions. One enrolment books every remaining slot of the recurrence or none, for one price, with the deposit taken on the first day. The enrolment is the client's bookings on that recurrence, so it isn't stored. Each day keeps its own roster and check-in, and Connect shows the start dates that still have a seat on every day.

## Phase 6: driving schools

At a small driving school each instructor teaches in their own dual-control car, so the instructor's calendar is already the car's calendar and the existing overlap constraint keeps a car out of two lessons at once. Manual and automatic lessons are two services, offered by the instructors whose car fits. The car's make and plate go in the instructor's title ("Instructor · Corolla, auto"). A shared pool of fewer cars than instructors isn't covered; it would need its own resource and is left out until a school asks for it.

## Schema changes

Each change only adds, so no existing row changes. A downgrade drops what it added, and refuses to run while rows still use it where noted.

| # | Phase | Change | Downgrade |
| --- | --- | --- | --- |
| S1 | 1 | `ck_businesses_subject` adds `vehicle` | refuses while a business uses it |
| S2 | 2 | `staff.registration_number varchar NULL` | drop |
| S3 | 2 | `notes.parent_type` CHECK adds `treatment` (parent id is a booking); the notes sync query leaves it out | refuses while treatment notes exist |
| S4 | 3 | `packages.subject_id varchar NULL` FK `subjects`; synced | drop |
| S5 | 4 | `ck_items_addon_kind` allows `product` and `service` | refuses while a service add-on exists |
| S6 | 4 | `slots.booking_id varchar NULL` FK `bookings`, set only on crew holds; synced | refuses while set |

Dropped from the earlier draft because the data already exists or can be worked out: `staff.credential` (it's `title`), a `treatment_notes` table (it's `notes`), a `crew` table and its share column (hold slots and an even split), a slot capacity change (holds are found by `booking_id`), `items.byday` and `bookings.enrolment_id` (recurrences), and a `cars` table with `items.needs_car` and `slots.car_id` (the car goes with its instructor).

## Each phase ships with

The four-part test matrix for every new command, app-core hooks shared by web and mobile, catalog copy, the regenerated API client, sync schema and strings, and a demo update: Harbourside gets registration numbers, treatment notes and an insurance receipt; Northlight gets a service add-on and a two-person install; Lakeside gets a camp week and pickups. Each phase lands on main on its own, through the full gate.
