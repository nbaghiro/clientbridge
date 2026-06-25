# Clientbridge — Data Model (v1)

Locked after a full option-by-option review (see [data-model-options.md](data-model-options.md)).
Conventions in [architecture.md](architecture.md): prefixed-ULID PKs · `snake_case` plural tables ·
`created_at`/`updated_at` + `created_by` + **`business_id`** on scoped rows · money = integer **cents** +
`currency` · soft-delete via `deleted_at` where noted · enums = `text`+`CHECK` · status + key lifecycle
timestamps · lightweight config in `jsonb` · per-business numbering via Postgres sequences.

**37 tables · 10 domains.** No general ledger (Stripe Connect custodies + pays out).

## Decisions
tenancy = **`businesses`** (business + billing; multi-location via `parent_business_id`) + `users` +
`staff` (invites folded in) · catalog = one `items(kind)` + split sold-instances · scheduling =
**`sessions` + `bookings`** (a session is any slot incl. 1:1) + single **`availability`** table
(type recurring/date + `is_available`) · invoices + estimates separate sharing **polymorphic `lines`** ·
payments lean (Stripe Connect; no ledger) · messaging = threads + messages + **`broadcasts`** ·
forms = typed `form_fields` + jsonb answers · numbering via sequences.

## ID prefixes
`bz_`business `us_`user `st_`staff ·
`cl_`client `sj_`subject `cns_`consent `nt_`note ·
`it_`item `pkg_`package `sub_`subscription `gc_`gift_card ·
`ses_`session `bk_`booking `av_`availability `rs_`resource `sch_`schedule ·
`inv_`invoice `est_`estimate `ln_`line `tx_`tax_rate ·
`pay_`payment `pm_`payment_method `po_`payout `pal_`payout_allocation ·
`th_`thread `msg_`message `bro_`broadcast ·
`frm_`form `ff_`form_field `fr_`form_response `con_`contract `sig_`signature ·
`rv_`review `rvr_`review_request ·
`fl_`file `aud_`audit_log `wh_`webhook

---

## identity (3)
| Table | Key columns |
|---|---|
| **businesses** | business/location + billing. `name`, `slug`, `parent_business_id?`, `timezone`, `locale` (en/fr), `province`, `gst_hst_number`, `qst_number`, `is_tax_registered`, `brand jsonb`, `plan`, `billing_email`, `stripe_customer_id`, `stripe_account_id` (Connect), `payout_schedule`, `avg_rating`, `review_count`, `status` |
| **users** | `email` (unique), `password_hash?`, `oauth jsonb`, `name`, `phone`, `avatar_url` |
| **staff** | user ↔ business (staff + invites). `business_id`, `user_id?`, `role` (owner/admin/staff/contractor), `is_payee`, `payout_ref`, `default_rate`/`rate_type`, `title`, `color`, `status` (active/invited), `invite_email?`, `invite_token?` |

## crm (4)
| Table | Key columns |
|---|---|
| **clients** *(soft-del)* | `name`, `email`, `phone`, `user_id?`, `tags text[]`, `status`, `lifetime_value_cents`, `custom_fields jsonb` |
| **subjects** | pet/vehicle/child/property: `client_id`, `kind`, `name`, `attributes jsonb` |
| **consents** | CASL: `client_id`, `channel` (sms/email), `basis` (express/implied), `status`, `source`, `captured_at`, `expires_at` |
| **notes** | generic: `parent_type`, `parent_id`, `author_user_id`, `body`, `pinned` |

## catalog (4)
| Table | Key columns |
|---|---|
| **items** | catalog (`kind`: service/class/product/package/subscription/gift), `name`, `price_cents`, `duration_min`, `capacity`, `tax_rate_id?`, `category`, `color`, `online_bookable`, `buffer_before/after_min`, `deposit_type`/`deposit_value`, `interval`/`frequency`, `session_count`/`validity_days`, `pack`, `active`, `custom_fields jsonb` |
| **packages** | client's package: `client_id`, `item_id`, `sessions_total`, `sessions_used`, `expires_at`, `status`, `payment_id?` |
| **subscriptions** | client's sub: `client_id`, `item_id`, `status` (active/paused/canceled/past_due), `current_period_start/end`, `payment_method_id`, `provider_ref`, `trial_end_at` |
| **gift_cards** | `code` (unique), `item_id?`, `initial_cents`, `balance_cents`, `purchaser_client_id?`, `recipient`, `expires_at`, `status` |

## scheduling (5)
| Table | Key columns |
|---|---|
| **sessions** | any slot (1:1 or group). `item_id`, `staff_id`, `resource_id?`, `starts_at`, `ends_at`, `capacity` (1 for 1:1), `booked_count`, `recurrence_id?` (→ schedule), `status` |
| **bookings** *(soft-del)* | client's seat in a session. `session_id`, `client_id`, `subject_id?`, `status` (pending/confirmed/completed/canceled/no_show), `source` (online/manual), `package_id?`, `invoice_id?`, `price_cents`, `deposit_required`, `confirmed_at`/`completed_at`/`canceled_at`, `custom_fields jsonb` |
| **availability** | open/closed time, one table. `staff_id`, `type` (recurring/date), `weekday?`, `date?`, `start_time?`, `end_time?` (null = all-day), `is_available` (open/closed), `note?`. *Bookable = recurring + date overrides − bookings.* |
| **resources** | rooms/equipment: `name`, `kind` (sessions carry `resource_id`) |
| **schedules** | recurrence rule generating sessions. `item_id`, `staff_id?`, `client_id?`, `frequency` (daily/weekly/monthly), `interval`, `byday`, `count?`, `until?`, `start_date`, `status` |

## billing (4)
| Table | Key columns |
|---|---|
| **invoices** | `client_id`, `number` (per-biz seq), `status` (draft/sent/partial/paid/overdue/void), `currency`, `subtotal_cents`, `tax_total_cents`, `total_cents`, `amount_paid_cents`, `balance_cents`, `issued_at`, `due_at`, `paid_at`/`voided_at`, `notes` |
| **estimates** | `client_id`, `number`, `status` (draft/sent/accepted/declined/expired), totals, `valid_until`, `accepted_at`/`declined_at`, `converted_invoice_id?` |
| **lines** | polymorphic: `parent_type` (invoice/estimate), `parent_id`, `description`, `item_id?`, `booking_id?`, `quantity`, `unit_amount_cents`, `amount_cents`, `tax_rate_id?`, `tax_amount_cents` |
| **tax_rates** | `jurisdiction` (GST/HST/PST/QST), `province`, `rate_bps`, `name` (system-seeded per province) |

## payments (4) — Stripe Connect custody + payouts, no ledger
| Table | Key columns |
|---|---|
| **payments** | money-in: `client_id`, `kind` (payment/deposit/refund), `parent_payment_id?`, `invoice_id?`/`booking_id?`, `amount_cents`, `currency`, `method` (card/interac/eft/cash/other), `provider` (stripe/interac/manual), `provider_ref`, `reference_code` (Interac match), `fee_cents`, `net_cents`, `status`, `paid_at` |
| **payment_methods** | `client_id`, `type` (card/bank_eft/interac), `brand`, `last4`, `provider`, `provider_ref`, `is_default`, `mandate_status` (PAD), `status` |
| **payouts** | Stripe payout mirror to the provider's bank: `amount_cents`, `status`, `arrival_at`, `provider_ref`, `bank_last4` |
| **payout_allocations** | staff earnings/split: `staff_id`, `source_type` (booking/invoice_line/class_session/tip/sale), `source_id`, `basis` (rate/percent/fixed), `rate`, `amount_cents`, `status` (pending/approved/paid), `payout_id?` |

## messaging (3)
| Table | Key columns |
|---|---|
| **threads** | inbox: `client_id`, `channel` (sms/email/chat), `last_message_at`, `unread_count`, `status` |
| **messages** | `thread_id`, `direction` (in/out), `channel`, `sender_user_id?`, `body`, `status` (draft/sent/delivered/read/failed), `broadcast_id?`, `provider_ref`, `attachments jsonb` |
| **broadcasts** | bulk SMS/email to a segment (CASL-gated): `name`, `channel`, `audience jsonb`, `status`, `scheduled_at` |

## documents (5) — intake forms + contracts/e-sign
| Table | Key columns |
|---|---|
| **forms** | the form: `name`, `attach_to text[]` (booking/client/intake), `require_signature`, `active` |
| **form_fields** | typed questions: `form_id`, `type` (text·longtext·number·currency·select·multiselect·checkbox·date·time·email·phone·address·file·image·signature·rating), `name`, `label`, `help`, `required`, `options jsonb`, `validation jsonb`, `default`, `position` |
| **form_responses** | `form_id`, `client_id`, `parent_type`/`parent_id`, `status`, `submitted_at`, `answers jsonb` (keyed by field `name`) |
| **contracts** | template: `name`, `body`, `version`, `always_require`, `expires`, `active` |
| **signatures** | signed instance: `contract_id`, `client_id`, `parent_type`/`parent_id?` (booking/invoice), `signed_at`, `signature_image_id?`, `signed_body` (snapshot), `ip`, `status` |

## reviews (2)
| Table | Key columns |
|---|---|
| **reviews** | `client_id`, `booking_id?`, `rating` (1–5), `body`, `response`, `responded_at`, `sent_to_google`, `status` *(rolls up to `businesses.avg_rating`/`review_count`)* |
| **review_requests** | solicitation: `client_id`, `booking_id?`, `channel` (sms/email), `token`, `status` (sent/opened/completed/expired), `sent_at`, `reminder_count`, `review_id?` |

## platform (3)
| Table | Key columns |
|---|---|
| **files** | S3: `parent_type`, `parent_id`, `kind`, `s3_key`, `content_type`, `size` |
| **audit_logs** | activity feed: `actor_user_id`, `action`, `entity_type`, `entity_id`, `changes jsonb` |
| **webhook_events** | provider events (Stripe/Interac/Twilio): `provider`, `type`, `payload jsonb`, `processed_at` |

---

## Polymorphic patterns
- **`lines.parent_type/parent_id`** → one line table for invoices + estimates.
- **`payments`** nullable over invoice/booking + `kind`/`method`/`reference_code`; `fee_cents`/`net_cents` per payment.
- **`items.kind`** = whole catalog · **`sessions`** = every slot · **`staff`** = staff + invites · **`payout_allocations.source_type`** = any earning source · **`notes`/`files`/`audit_logs` parent_type** generalize the rest.

## Core relationship (get-paid loop)
```
schedule ─▶ session ─< bookings >─ client          booking ─> invoice ─< lines
              │  └─ item                                │          │
         member(staff)/resource                     package?     payments ─(refund)
                                                                     └ Stripe Connect ⇒ payout to bank
```
