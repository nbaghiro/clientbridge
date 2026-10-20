# Check-in

## Question

Check-in is currently one button. For most service businesses, arriving also means paperwork: an intake form, a signed waiver, proof of a pet's vaccination, a deposit, or a few notes the staff member should see before starting. This exploration sets out how check-in can carry that work, and which parts we already have.

## What exists today

- **Check-in** is a command, `POST /v1/bookings/{id}/check-in`, which sets `bookings.checked_in_at`. Today on web and mobile calls it straight from the agenda row. There's no confirmation, no message, and no undo for a mis-tap. The schedule's booking panel doesn't offer it. Classes have their own roster check-in.
- **Site and place businesses** have a departure step first: "On my way" (`departed_at`), then "Arrive" on site.
- **Forms** (`forms`, `fields`, `responses`) can be sent manually, or `send_on = "booking"`, which sends the form once to a client on their first booking. A response can carry a signature, and its parent is a client, a subject or a booking.
- **Contracts** (`contracts`, `signatures`) are versioned. A signature snapshots the signed text and version, with typed or drawn signing, and its parent is a client, a subject or a booking.
- **Subjects** (a pet, student, property or site) hold attributes. The app already raises alerts from them: a nervous temperament, allergies, and a rabies vaccination that has expired or expires within 45 days.
- **Deposits** have a lifecycle on the booking (`deposit_status`), and staff can collect one from the booking panel.
- **Files** can attach to bookings, so before and after photos exist.
- **The client's manage link** (`manage_token`) lets clients view, move or cancel a booking, and now pay a pending deposit.

Most of what a check-in needs is already stored. What's missing is a way to say which of these a visit needs, a place that gathers them at arrival, and a way for the client to finish them before they arrive.

## The model: what a visit needs before it starts

I'd describe check-in as a short list of **arrival requirements**, worked out for each visit. Each requirement has:

- **a kind**: answer a form, sign a contract, provide a subject record (for example a vaccination date with proof), pay the deposit, or a staff step (confirm belongings, take a before photo);
- **a cadence**: once per client, once per subject, every visit, or again after a period (re-sign the waiver every 12 months);
- **who completes it**: the client ahead of time, the client at the desk, or the staff member;
- **whether it blocks**: required before check-in, or a warning that staff can check in past.

Requirements come from the service being booked, plus a few that apply to the whole business (such as a general waiver). Whether a requirement is met is derived from records we already keep: a submitted response for the right form and parent, a signature at the current contract version, a subject attribute that's valid on the visit date, or the deposit status. We store the rule, not a copy of the answer, the same way balances come from the ledger rather than a stored column.

Overriding a blocking requirement ("checked in without the waiver") is allowed for managers, needs a reason, and is recorded in the audit log.

## The flows

**Before the visit.** The reminder message and the manage link show the client what's still needed: "Before your visit: answer the intake form and sign the grooming waiver." Each item opens the form or signing page we already have. When everything's done, the manage link says the client is ready. Staff see the same status on the agenda row, so a visit with nothing outstanding reads as ready, and one with a missing waiver shows that before the client walks in.

**At the desk.** Check in opens a sheet with the following:

- the client and the subject;
- the service, time and staff member;
- alerts from the subject, such as an allergy or an expired vaccination;
- the requirement list, with each item done, outstanding or waived.

For each outstanding item, staff can send the link again, or hand the device to the client to fill in or sign there. Check in is enabled once blocking items are done, or after an override. Staff steps (belongings, before photo) sit in the same list.

**Hand-over mode.** On a tablet or phone at the desk, the client sees only their own outstanding items, with a large signing area, and the device returns to the staff view when they finish. This reuses the public form and signing pages inside the app instead of building a second editor.

**On site.** For site and property businesses, "Arrive" opens the same sheet with the staff steps that fit the job (before photos, site access notes, equipment check).

**Self check-in, later.** A client can tap "I'm here" from their manage link or a QR code at the desk. That marks the visit arrived and tells the staff member, who confirms from the sheet.

## Data model

The first step needs no schema change: the sheet can show forms already sent to the client, pending signatures, deposit status and subject alerts, all from existing tables.

Requirements need new storage, which needs its own approval before any change. One shape:

- `requirements` (business scoped): `item_id` (null for business-wide), `kind` (`form`, `contract`, `subject_field`, `deposit`, `staff_step`), the referenced form or contract, `cadence`, `valid_days`, `completed_by` and `blocking`.
- No per-visit status table. Status is computed from responses, signatures, subject attributes and the deposit. Overrides go in the audit log.

Checking in while a blocking item is open stays a server-side rule: the existing check-in command checks the requirements and refuses unless an override comes with it, so every client gets the same answer.

## Phases

1. **A confirm sheet built from what exists.** The sheet appears on Today and in the booking panel, on web and mobile. It shows alerts, forms and signatures already sent to this client, and the deposit, with actions to resend a link or check in. A toast confirms the check-in. Undo needs a small command for visits (class rosters already have one), but no schema change.
2. **Requirements on services.** This adds setup under each service and business-wide waivers, with the cadence and blocking rules. The server enforces them on check-in, and audited overrides are possible. Reminders and the manage link list outstanding items. This phase needs the schema change above.
3. **Hand-over mode and staff steps.** The client fills in and signs on the staff device, before photos sit in the checklist, and the site arrival steps come in.
4. **Self check-in** from the manage link or a desk QR code, with a notification to staff.

## Open questions

- Should a requirement attach to the client or to the subject? Vaccination proof belongs to each pet, while a waiver usually belongs to the owner. The parent types already allow both.
- Should the default for a new requirement be blocking or a warning? A warning is gentler to set up, but a waiver that isn't enforced does little.
- Should class rosters use the same requirements? Group classes often need a waiver too.
- Is check-in still possible while the device is offline? Check-in is an online command today. Enforcing requirements on the server keeps it that way.
