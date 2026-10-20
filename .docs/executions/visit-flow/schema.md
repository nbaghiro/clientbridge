# Visit flow schema

Status: one approved column, `files.shared_at` (approved 2026-10-20, migration `cb0027`). Every other need below is met by tables we already have, or worked out when it's read. The site sign-off, which would need one CHECK change, is out of scope and listed at the end for later.

## How each need is met without new storage

| Need                         | Where it comes from                                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forms to fill before a visit | Forms with `send_on = 'booking'` already mark a form as one every client answers. A client still owes it while they have no submitted response to that form.                                                              |
| A waiver to sign             | A form with `require_signature`, sent on booking. Its response carries the signature, so a waiver is just a signed intake form.                                                                                           |
| Re-sign when it changes      | Contracts are versioned. A signature at an older `contract_version` than the contract's `version` reads as outstanding.                                                                                                   |
| Pet records                  | `subjectAlerts` already reads `rabies_until`, allergies and temperament from subject attributes.                                                                                                                          |
| Deposit                      | `bookings.deposit_status` and `deposit_amount_cents`.                                                                                                                                                                     |
| Checking in past an item     | Not stored as its own record. When a visit is checked in with items still outstanding, the check-in command's audit entry lists them.                                                                                     |
| Usual rebooking interval     | Worked out from the client's own history for that service: the gap between their last two visits, or the recurrence series' interval if the booking belongs to one. With no history, there's no suggestion.               |
| Visit note for the client    | Sent as a message in the client's existing thread, so it's stored in `messages` with everything else they've been sent. It links to the manage page, which shows the booking's photos (files already attach to bookings). |
| Package covering a visit     | `bookings.package_id` and the existing session use.                                                                                                                                                                       |
| Gift card credit             | The ledger's redemption journal, posted with the sale as its source.                                                                                                                                                      |

## Approved: `files.shared_at`

A nullable `timestamptz` on `files`: when staff shared a booking photo with the client. While it's null, the photo stays inside the business. Only booking photos (`parent_type = 'booking'`, `purpose = 'photo'`) use it.

- **Behaviour:** the client's manage page shows only shared photos. `POST /v1/files/{id}/share` sets or clears the column, for an owner, an admin or the visit's staff member, and the change is audited.
- **Sync:** the column is on the members' `files` stream, and `sync_projections.json` was updated.
- **Data impact:** existing photos start unshared. Main never showed booking photos to clients, so nothing that was visible becomes hidden.
- **Rollback:** the downgrade drops the column, and the manage page then shows no photos.

## What this gives up

- Requirements apply to the whole business, not to one service. Every "on booking" form is owed by every client.
- Nothing blocks check-in. Outstanding items show on the sheet, the agenda and the manage link, and staff decide. The audit entry records what was skipped.
- There are no staff-step checklists, such as belongings or a before photo.

Any of these can come back later if a business needs it. When one does, it should extend a table we already have rather than add a new one.

## Optional later: site sign-off

`forms.send_on` gains a third value, `'completion'`: a form, usually with a signature, that the client completes when a site job finishes. This only widens the existing CHECK constraint, and existing rows are unaffected. A downgrade narrows it again after moving any `'completion'` forms back to `'manual'`. The sign-off is out of scope for this execution, so this execution changes no schema. Adding the sign-off later would need explicit approval of this change first.
