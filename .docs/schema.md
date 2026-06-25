# Clientbridge — Schema Specification (LOCKED · v1)

DDL-ready detail for all **37 tables / 10 domains**. Companion to the conceptual
[data-model.md](data-model.md); this is the source of truth for the Alembic migration.
Status: **locked 2026-06-24.**

## Global conventions
- **PK:** `id text PRIMARY KEY` — prefixed ULID (`bz_01J…`), generated in app (`core/ids`).
- **FK:** `<name>_id text REFERENCES <table>(id)`; `ON DELETE` = `RESTRICT` by default,
  `CASCADE` only for owned children (noted per table).
- **Every table** has: `id`, `created_at timestamptz NOT NULL DEFAULT now()`,
  `updated_at timestamptz NOT NULL DEFAULT now()` (touched by trigger/ORM).
- **Business-scoped tables** add `business_id text NOT NULL REFERENCES businesses(id)`
  (**always indexed**) and `created_by text REFERENCES users(id)`.
- **Soft-delete** tables add `deleted_at timestamptz NULL` (tombstone; partial indexes exclude it).
- **Money:** `*_cents bigint NOT NULL DEFAULT 0`; `currency char(3) NOT NULL DEFAULT 'CAD'`.
- **Enums:** `text` + `CHECK (col IN (...))` (see catalog) — never PG `ENUM` (cheap to evolve).
- **JSON:** `jsonb NOT NULL DEFAULT '{}'` (objects) / `'[]'` (arrays).
- **Bools:** `boolean NOT NULL DEFAULT false`. **Times:** `timestamptz`; calendar times-of-day `time`.
- **Numbering:** per-business monotonic via Postgres `sequence` per (business, doc-type).

## Enum catalog
```
locale                  en | fr
business.status         active | suspended | canceled
business.payout_schedule daily | weekly | manual
membership.role         owner | admin | staff | contractor
membership.status       active | invited
membership.rate_type    percent | fixed | hourly
consent.channel         sms | email
consent.basis           express | implied
consent.status          granted | withdrawn
subject.kind            pet | vehicle | child | property
item.kind               service | class | product | package | subscription | gift
item.deposit_type       none | fixed | percent
item.frequency          daily | weekly | monthly
package.status          active | used | expired | canceled
subscription.status     active | paused | canceled | past_due
gift_card.status        active | redeemed | expired | void
session.status          scheduled | canceled | completed
booking.status          pending | confirmed | completed | canceled | no_show
booking.source          online | manual
availability.type       recurring | date
resource.kind           room | equipment
schedule.frequency      daily | weekly | monthly
schedule.status         active | ended | canceled
invoice.status          draft | sent | partial | paid | overdue | void
estimate.status         draft | sent | accepted | declined | expired
line.parent_type        invoice | estimate
tax_rate.jurisdiction   GST | HST | PST | QST
payment.kind            payment | deposit | refund
payment.method          card | interac | eft | cash | other
payment.provider        stripe | interac | manual
payment.status          pending | succeeded | failed | refunded | canceled
payment_method.type     card | bank_eft | interac
payment_method.mandate_status  none | pending | active | revoked
payout.status           pending | in_transit | paid | failed | canceled
payout_allocation.source_type  booking | invoice_line | class_session | tip | sale
payout_allocation.basis        rate | percent | fixed
payout_allocation.status       pending | approved | paid
thread.channel          sms | email | chat
message.direction       in | out
message.status          draft | queued | sent | delivered | read | failed
broadcast.channel       sms | email
broadcast.status        draft | scheduled | sending | sent | canceled
form.attach_to[]        booking | client | intake | invoice | subject
form_field.type         text | longtext | number | currency | select | multiselect |
                        checkbox | date | time | email | phone | address | file | image |
                        signature | rating
form_response.status    draft | submitted
signature.status        pending | signed | declined | expired
review.status           published | hidden | pending
review_request.status   sent | opened | completed | expired
note.parent_type        client | booking | subject | invoice | estimate
file.parent_type        client | subject | booking | invoice | message | form_response | signature
webhook_event.provider  stripe | interac | twilio | sendgrid
webhook_event.status    pending | processed | failed
```

---

## identity
```
businesses                                                          -- bz_  (NOT business-scoped)
  id text pk · name text not null · slug text not null UNIQUE       -- public booking handle
  parent_business_id text null fk→businesses                        -- multi-location
  locale text not null default 'en' · timezone text not null
  province text not null · gst_hst_number text null · qst_number text null
  is_tax_registered bool default false
  brand jsonb default '{}'                                          -- logo, colors, etc.
  plan text · billing_email text · stripe_customer_id text          -- Clientbridge subscription
  stripe_account_id text · payout_schedule text default 'weekly'    -- Stripe Connect
  avg_rating numeric(2,1) null · review_count int default 0         -- reviews rollup
  status text default 'active'
  created_at · updated_at
  idx: (slug) unique, (parent_business_id)

users                                                               -- us_  (global, NOT scoped)
  id text pk · email citext not null UNIQUE · password_hash text null
  oauth jsonb default '{}'                                          -- {google:{sub}}
  name text · phone text · avatar_url text
  created_at · updated_at
  idx: (email) unique

staff                                                         -- mb_
  id text pk · business_id fk not null · user_id text null fk→users -- null while invited
  role text not null · is_payee bool default false
  payout_ref text null                                              -- staff Stripe connected acct
  default_rate numeric null · rate_type text null
  title text · color text
  status text not null default 'active'                             -- active | invited
  invite_email text null · invite_token text null · invited_at timestamptz null
  created_at · updated_at
  idx: (business_id), (user_id), (business_id,user_id) unique where user_id not null,
       (invite_token) unique where invite_token not null
```

## crm
```
clients                                                             -- cl_   (soft-del)
  id text pk · business_id fk not null · created_by fk→users
  name text not null · email citext null · phone text null
  user_id text null fk→users                                        -- if client self-serves
  tags text[] default '{}' · status text default 'active'
  lifetime_value_cents bigint default 0 · custom_fields jsonb default '{}'
  deleted_at null · created_at · updated_at
  idx: (business_id), (business_id,email), (business_id,phone)

subjects                                                            -- sj_
  id text pk · business_id fk not null · client_id fk→clients not null
  kind text not null · name text not null · attributes jsonb default '{}'
  created_at · updated_at
  idx: (business_id,client_id)

consents                                                            -- cns_  (append-only log)
  id text pk · business_id fk not null · client_id fk→clients not null
  channel text not null · basis text not null · status text not null
  source text · captured_at timestamptz not null default now() · expires_at timestamptz null
  created_at · updated_at
  idx: (business_id,client_id,channel), (expires_at) where basis='implied'

notes                                                               -- nt_
  id text pk · business_id fk not null · author_user_id fk→users null
  parent_type text not null · parent_id text not null
  body text not null · pinned bool default false
  created_at · updated_at
  idx: (business_id,parent_type,parent_id)
```

## catalog
```
items                                                               -- it_
  id text pk · business_id fk not null · created_by fk→users
  kind text not null · name text not null · description text null
  price_cents bigint default 0 · currency char(3) default 'CAD'
  duration_min int null · capacity int null                         -- classes
  tax_rate_id text null fk→tax_rates · category text null · color text null
  online_bookable bool default true · buffer_before_min int default 0 · buffer_after_min int default 0
  deposit_type text default 'none' · deposit_value numeric null
  interval int null · frequency text null                           -- subscription plan
  session_count int null · validity_days int null                   -- package plan
  pack text null                                                    -- vertical-pack provenance
  active bool default true · custom_fields jsonb default '{}'
  created_at · updated_at
  idx: (business_id,kind,active)

packages                                                            -- pkg_  (a client's purchase)
  id text pk · business_id fk not null · client_id fk→clients not null · item_id fk→items not null
  sessions_total int not null · sessions_used int default 0
  expires_at timestamptz null · status text default 'active' · payment_id text null fk→payments
  created_at · updated_at
  idx: (business_id,client_id,status)

subscriptions                                                       -- sub_
  id text pk · business_id fk not null · client_id fk→clients not null · item_id fk→items not null
  status text default 'active' · current_period_start timestamptz · current_period_end timestamptz
  payment_method_id text null fk→payment_methods · provider_ref text null · trial_end_at timestamptz null
  created_at · updated_at
  idx: (business_id,client_id,status), (current_period_end)

gift_cards                                                          -- gc_
  id text pk · business_id fk not null · code text not null · item_id text null fk→items
  initial_cents bigint not null · balance_cents bigint not null
  purchaser_client_id text null fk→clients · recipient text null
  expires_at timestamptz null · status text default 'active'
  created_at · updated_at
  idx: (business_id,code) unique
```

## scheduling
```
sessions                                                            -- ses_
  id text pk · business_id fk not null · item_id fk→items not null · staff_id fk→staff not null
  resource_id text null fk→resources · recurrence_id text null fk→schedules
  starts_at timestamptz not null · ends_at timestamptz not null
  capacity int default 1 · booked_count int default 0 · status text default 'scheduled'
  created_at · updated_at
  idx: (business_id,staff_id,starts_at), (business_id,starts_at), (recurrence_id)

bookings                                                            -- bk_   (soft-del)
  id text pk · business_id fk not null · session_id fk→sessions not null · client_id fk→clients not null
  subject_id text null fk→subjects · package_id text null fk→packages · invoice_id text null fk→invoices
  status text default 'pending' · source text default 'manual'
  price_cents bigint default 0 · deposit_required bool default false
  confirmed_at timestamptz null · completed_at timestamptz null · canceled_at timestamptz null
  custom_fields jsonb default '{}' · deleted_at null · created_at · updated_at
  idx: (business_id,session_id), (business_id,client_id), (business_id,status)

availability                                                        -- av_
  id text pk · business_id fk not null · staff_id fk→staff not null
  type text not null                                                -- recurring | date
  weekday smallint null                                             -- 0..6 (recurring)
  date date null                                                    -- (one-off)
  start_time time null · end_time time null                         -- null = all-day
  is_available bool not null default true · note text null
  created_at · updated_at
  idx: (business_id,staff_id,type)

resources                                                           -- rs_
  id text pk · business_id fk not null · name text not null · kind text not null
  created_at · updated_at

schedules                                                           -- sch_  (recurrence rules)
  id text pk · business_id fk not null · item_id fk→items not null
  staff_id text null fk→staff · client_id text null fk→clients
  frequency text not null · interval int default 1 · byday text[] null
  count int null · until date null · start_date date not null · status text default 'active'
  created_at · updated_at
  idx: (business_id,status)
```

## billing
```
invoices                                                            -- inv_
  id text pk · business_id fk not null · client_id fk→clients not null
  number bigint not null                                            -- per-business sequence
  status text default 'draft' · currency char(3) default 'CAD'
  subtotal_cents bigint default 0 · tax_total_cents bigint default 0 · total_cents bigint default 0
  amount_paid_cents bigint default 0 · balance_cents bigint default 0
  issued_at timestamptz null · due_at timestamptz null · paid_at timestamptz null · voided_at timestamptz null
  notes text null · created_at · updated_at
  idx: (business_id,number) unique, (business_id,client_id), (business_id,status)

estimates                                                           -- est_
  id text pk · business_id fk not null · client_id fk→clients not null
  number bigint not null · status text default 'draft'
  subtotal_cents · tax_total_cents · total_cents (bigint)
  valid_until date null · accepted_at timestamptz null · declined_at timestamptz null
  converted_invoice_id text null fk→invoices · notes text null
  created_at · updated_at
  idx: (business_id,number) unique, (business_id,status)

lines                                                               -- ln_   (polymorphic, CASCADE)
  id text pk · business_id fk not null
  parent_type text not null · parent_id text not null               -- invoice | estimate
  description text not null · item_id text null fk→items · booking_id text null fk→bookings
  quantity numeric not null default 1
  unit_amount_cents bigint default 0 · amount_cents bigint default 0
  tax_rate_id text null fk→tax_rates · tax_amount_cents bigint default 0
  position int default 0 · created_at · updated_at
  idx: (parent_type,parent_id)

tax_rates                                                           -- tx_   (system-seeded; business_id null = global)
  id text pk · business_id text null fk→businesses
  jurisdiction text not null · province text not null · rate_bps int not null · name text not null
  created_at · updated_at
  idx: (province,jurisdiction)
```

## payments
```
payments                                                            -- pay_
  id text pk · business_id fk not null · client_id text null fk→clients
  kind text not null default 'payment' · parent_payment_id text null fk→payments   -- refunds
  invoice_id text null fk→invoices · booking_id text null fk→bookings
  amount_cents bigint not null · currency char(3) default 'CAD'
  method text not null · provider text not null · provider_ref text null
  reference_code text null                                          -- Interac e-Transfer auto-match
  fee_cents bigint default 0 · net_cents bigint default 0 · status text not null default 'pending'
  paid_at timestamptz null · created_at · updated_at
  idx: (business_id,status), (invoice_id), (provider_ref), (reference_code) unique where not null

payment_methods                                                     -- pm_
  id text pk · business_id fk not null · client_id fk→clients not null
  type text not null · brand text null · last4 text null
  provider text · provider_ref text · is_default bool default false
  mandate_status text default 'none' · status text default 'active'
  created_at · updated_at
  idx: (business_id,client_id)

payouts                                                             -- po_  (mirror of Stripe payouts)
  id text pk · business_id fk not null
  amount_cents bigint not null · status text not null · arrival_at timestamptz null
  provider_ref text null · bank_last4 text null · created_at · updated_at
  idx: (business_id,status), (provider_ref)

payout_allocations                                                  -- pal_  (staff earnings)
  id text pk · business_id fk not null · staff_id fk→staff not null
  source_type text not null · source_id text not null
  basis text · rate numeric null · amount_cents bigint not null
  status text default 'pending' · payout_id text null fk→payouts
  created_at · updated_at
  idx: (business_id,staff_id,status), (source_type,source_id), (payout_id)
```

## messaging
```
threads                                                             -- th_
  id text pk · business_id fk not null · client_id fk→clients not null
  channel text not null · last_message_at timestamptz null · unread_count int default 0
  status text default 'open' · created_at · updated_at
  idx: (business_id,last_message_at desc), (business_id,client_id,channel) unique

messages                                                            -- msg_  (CASCADE w/ thread)
  id text pk · business_id fk not null · thread_id fk→threads not null
  direction text not null · channel text not null · sender_user_id text null fk→users
  body text · status text default 'queued' · broadcast_id text null fk→broadcasts
  provider_ref text null · attachments jsonb default '[]'
  created_at · updated_at
  idx: (thread_id,created_at), (broadcast_id)

broadcasts                                                          -- bro_
  id text pk · business_id fk not null · created_by fk→users
  name text not null · channel text not null · audience jsonb default '{}'
  status text default 'draft' · scheduled_at timestamptz null
  created_at · updated_at
  idx: (business_id,status)
```

## documents
```
forms                                                               -- frm_
  id text pk · business_id fk not null · name text not null
  attach_to text[] default '{}' · require_signature bool default false · active bool default true
  created_at · updated_at

form_fields                                                         -- ff_   (CASCADE w/ form)
  id text pk · business_id fk not null · form_id fk→forms not null
  type text not null · name text not null · label text not null · help text null
  required bool default false · options jsonb default '[]' · validation jsonb default '{}'
  "default" text null · position int default 0
  created_at · updated_at
  idx: (form_id,position)

form_responses                                                      -- fr_
  id text pk · business_id fk not null · form_id fk→forms not null · client_id text null fk→clients
  parent_type text null · parent_id text null · status text default 'submitted'
  submitted_at timestamptz null · answers jsonb default '{}'        -- keyed by field name
  created_at · updated_at
  idx: (business_id,form_id), (parent_type,parent_id)

contracts                                                           -- con_  (template)
  id text pk · business_id fk not null · name text not null · body text not null
  version int default 1 · always_require bool default false · expires text null · active bool default true
  created_at · updated_at

signatures                                                          -- sig_  (signed instance)
  id text pk · business_id fk not null · contract_id fk→contracts not null · client_id fk→clients not null
  parent_type text null · parent_id text null
  signed_at timestamptz null · signature_image_id text null fk→files · signed_body text null   -- snapshot
  ip text null · status text default 'pending'
  created_at · updated_at
  idx: (business_id,contract_id), (parent_type,parent_id)
```

## reviews
```
reviews                                                             -- rv_
  id text pk · business_id fk not null · client_id fk→clients not null · booking_id text null fk→bookings
  rating smallint not null check (rating between 1 and 5)
  body text null · response text null · responded_at timestamptz null
  sent_to_google bool default false · status text default 'published'
  created_at · updated_at
  idx: (business_id,status,created_at)

review_requests                                                     -- rvr_
  id text pk · business_id fk not null · client_id fk→clients not null · booking_id text null fk→bookings
  channel text not null · token text not null · status text default 'sent'
  sent_at timestamptz · reminder_count int default 0 · review_id text null fk→reviews
  created_at · updated_at
  idx: (business_id,status), (token) unique
```

## platform
```
files                                                               -- fl_
  id text pk · business_id fk not null
  parent_type text not null · parent_id text not null
  kind text · s3_key text not null · content_type text · size bigint
  created_at · updated_at
  idx: (business_id,parent_type,parent_id)

audit_logs                                                          -- aud_  (append-only)
  id text pk · business_id fk not null · actor_user_id text null fk→users
  action text not null · entity_type text not null · entity_id text not null
  changes jsonb default '{}' · created_at
  idx: (business_id,entity_type,entity_id), (business_id,created_at desc)

webhook_events                                                      -- wh_  (NOT business-scoped initially)
  id text pk · provider text not null · type text not null
  payload jsonb not null · status text default 'pending' · processed_at timestamptz null
  created_at · updated_at
  idx: (provider,status), (created_at)
```

---

## Sync (PowerSync) — see [sync.md](sync.md)
Engine **locked = PowerSync** (reads the Postgres WAL; client reads via Sync Rules buckets, writes via
FastAPI `/sync/upload`). Schema impact:
- **`updated_at`** on every table (delta ordering) — ✅ present.
- **Soft-delete tombstones:** extend `deleted_at` to **all client-synced tables** so deletes propagate
  (clients filter `deleted_at IS NULL`). Today only `clients`/`bookings` carry it → add to the rest of
  the syncable set (see sync.md scope table).
- **Stable text ULID PKs** — ✅ (PowerSync requires a stable PK).
- **No outbox / `row_version` / change-log table** — PowerSync reads the WAL directly.
- **Partition key = `business_id`** — Sync Rules bucket by the user's businesses + role (JWT claims);
  role-gated buckets for financial tables (`payments`/`payouts`).
- **Infra (not schema):** `wal_level=logical` + a `powersync` publication + replication slot + a
  `REPLICATION` role.
- `GENERATED STORED` columns are excluded from the WAL → expose derived values via **views** (sync rules
  can read views; also used for column redaction / RLS).
