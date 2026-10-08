# Backend permissions inventory

T01a records the captured T00 schema at HEAD `9372caf` plus the archived dirty changes. This is a table and relationship inventory, not a completed route/job permission matrix or an RLS implementation. The executable declaration is `backend/src/clientbridge/core/policies.py`; `tests/test_scoping.py` checks the metadata inventory and rejects missing/unknown entries, incorrect scope/key declarations, nullable tenant keys and missing tenant-root foreign keys.

## Scope decisions

`tenant` means a row belongs to one business, including server-only commands, audits, devices, returning challenges and payment setup links. `businesses.id` is the tenant root; the other 39 tenant tables use `business_id`. Staff declares that column directly rather than inheriting `BusinessScoped`. Identity users/sessions/tokens and inbound webhook routing are global. `operational` is reserved for explicitly reviewed global operational tables; none currently exist. Domain owner names identify the current model module, not a database role or an authorization grant.

Public tokens and published slugs are resolution mechanisms, not table-wide authorization. A tenant classification does not mean every staff member can read or mutate the table. Role, capability, closed-business exceptions and per-client ownership remain to be specified in subsequent T01 slices.

## Actual table policies

| Table | Classification | Tenant key | Domain owner |
|---|---|---|---|
| `accounts` | tenant | `business_id` | ledger |
| `addons` | tenant | `business_id` | scheduling |
| `audits` | tenant | `business_id` | platform |
| `bookings` | tenant | `business_id` | scheduling |
| `broadcasts` | tenant | `business_id` | messaging |
| `businesses` | tenant | `id` | business |
| `clients` | tenant | `business_id` | clients |
| `commands` | tenant | `business_id` | platform |
| `consents` | tenant | `business_id` | clients |
| `contracts` | tenant | `business_id` | documents |
| `devices` | tenant | `business_id` | platform |
| `entries` | tenant | `business_id` | ledger |
| `estimates` | tenant | `business_id` | billing |
| `fields` | tenant | `business_id` | documents |
| `files` | tenant | `business_id` | platform |
| `forms` | tenant | `business_id` | documents |
| `gift_cards` | tenant | `business_id` | catalog |
| `hours` | tenant | `business_id` | scheduling |
| `inventory` | tenant | `business_id` | catalog |
| `invoices` | tenant | `business_id` | billing |
| `items` | tenant | `business_id` | catalog |
| `lines` | tenant | `business_id` | billing |
| `messages` | tenant | `business_id` | messaging |
| `notes` | tenant | `business_id` | clients |
| `orders` | tenant | `business_id` | billing |
| `packages` | tenant | `business_id` | catalog |
| `payment_methods` | tenant | `business_id` | payments |
| `payment_setup_links` | tenant | `business_id` | payments |
| `payments` | tenant | `business_id` | payments |
| `recurrences` | tenant | `business_id` | scheduling |
| `resources` | tenant | `business_id` | scheduling |
| `responses` | tenant | `business_id` | documents |
| `returning_challenges` | tenant | `business_id` | returning |
| `reviews` | tenant | `business_id` | reviews |
| `sessions` | identity | none | auth |
| `signatures` | tenant | `business_id` | documents |
| `slots` | tenant | `business_id` | scheduling |
| `staff` | tenant | `business_id` | business |
| `subjects` | tenant | `business_id` | clients |
| `subscriptions` | tenant | `business_id` | catalog |
| `threads` | tenant | `business_id` | messaging |
| `tokens` | identity | none | auth |
| `users` | identity | none | business |
| `webhooks` | routing | none | platform |

## Concrete relationships

Every declared foreign key is listed below. `?` marks a nullable source column. The 39 `business_id → businesses.id` relationships are non-null. All current foreign keys reference a single target ID; they do not bind child and parent business IDs together. User references intentionally target global identity. Parent existence is database-enforced; same-business and same-client ownership require service validation today. Composite ownership constraints and validation of existing data are intended T10 work, not guarantees added by this inventory.

| Source table | Declared foreign keys |
|---|---|
| `accounts` | `business_id → businesses.id` |
| `addons` | `booking_id → bookings.id`; `business_id → businesses.id`; `item_id → items.id`; `staff_id? → staff.id` |
| `audits` | `business_id → businesses.id`; `performed_by? → users.id` |
| `bookings` | `business_id → businesses.id`; `client_id → clients.id`; `invoice_id? → invoices.id`; `order_id? → orders.id`; `package_id? → packages.id`; `slot_id → slots.id`; `staff_id? → staff.id`; `subject_id? → subjects.id` |
| `broadcasts` | `business_id → businesses.id`; `created_by? → users.id` |
| `businesses` | none |
| `clients` | `business_id → businesses.id`; `created_by? → users.id`; `user_id? → users.id` |
| `commands` | `business_id → businesses.id` |
| `consents` | `business_id → businesses.id`; `client_id → clients.id`; `recorded_by? → users.id` |
| `contracts` | `business_id → businesses.id` |
| `devices` | `business_id → businesses.id`; `user_id → users.id` |
| `entries` | `account_id → accounts.id`; `business_id → businesses.id` |
| `estimates` | `business_id → businesses.id`; `client_id → clients.id`; `converted_invoice_id? → invoices.id` |
| `fields` | `business_id → businesses.id`; `form_id → forms.id` |
| `files` | `business_id → businesses.id` |
| `forms` | `business_id → businesses.id` |
| `gift_cards` | `business_id → businesses.id`; `item_id? → items.id`; `payment_id? → payments.id`; `purchaser_client_id? → clients.id` |
| `hours` | `business_id → businesses.id`; `staff_id? → staff.id` |
| `inventory` | `business_id → businesses.id`; `created_by? → users.id`; `item_id → items.id`; `line_id? → lines.id` |
| `invoices` | `business_id → businesses.id`; `client_id → clients.id` |
| `items` | `business_id → businesses.id`; `covers_item_id? → items.id`; `created_by? → users.id`; `variant_parent_id? → items.id` |
| `lines` | `booking_id? → bookings.id`; `business_id → businesses.id`; `estimate_id? → estimates.id`; `invoice_id? → invoices.id`; `item_id? → items.id`; `order_id? → orders.id`; `staff_id? → staff.id` |
| `messages` | `broadcast_id? → broadcasts.id`; `business_id → businesses.id`; `sent_by? → users.id`; `thread_id → threads.id` |
| `notes` | `business_id → businesses.id`; `created_by? → users.id` |
| `orders` | `approved_by? → users.id`; `business_id → businesses.id`; `client_id? → clients.id`; `staff_id → staff.id` |
| `packages` | `business_id → businesses.id`; `client_id → clients.id`; `item_id → items.id`; `payment_id? → payments.id` |
| `payment_methods` | `business_id → businesses.id`; `client_id → clients.id` |
| `payment_setup_links` | `business_id → businesses.id`; `client_id → clients.id` |
| `payments` | `booking_id? → bookings.id`; `business_id → businesses.id`; `client_id? → clients.id`; `invoice_id? → invoices.id`; `order_id? → orders.id`; `parent_payment_id? → payments.id` |
| `recurrences` | `business_id → businesses.id`; `client_id? → clients.id`; `item_id → items.id`; `staff_id? → staff.id` |
| `resources` | `business_id → businesses.id` |
| `responses` | `business_id → businesses.id`; `client_id? → clients.id`; `form_id → forms.id` |
| `returning_challenges` | `business_id → businesses.id`; `client_id? → clients.id` |
| `reviews` | `booking_id? → bookings.id`; `business_id → businesses.id`; `client_id → clients.id` |
| `sessions` | `user_id → users.id` |
| `signatures` | `business_id → businesses.id`; `client_id → clients.id`; `contract_id → contracts.id` |
| `slots` | `business_id → businesses.id`; `item_id → items.id`; `recurrence_id? → recurrences.id`; `resource_id? → resources.id`; `staff_id → staff.id` |
| `staff` | `business_id → businesses.id`; `invited_by? → users.id`; `user_id? → users.id` |
| `subjects` | `business_id → businesses.id`; `client_id → clients.id` |
| `subscriptions` | `business_id → businesses.id`; `client_id → clients.id`; `item_id → items.id`; `payment_method_id? → payment_methods.id` |
| `threads` | `business_id → businesses.id`; `client_id → clients.id` |
| `tokens` | `user_id → users.id` |
| `users` | none |
| `webhooks` | none |

## Polymorphic and indirect relationships

| Source | Current target contract | Current enforcement and remaining work |
|---|---|---|
| `notes.parent_type/parent_id` | client → clients; subject → subjects; booking → bookings | Type CHECK only at DB layer; IDs have no FK. Require same tenant and parent/client policy. |
| `files.parent_type/parent_id` | business → businesses; client → clients; subject → subjects; item → items; signature → signatures; form_response → responses | Type CHECK; no parent FK. FileService validates public business/item media parents, not all private parent types. Complete purpose/parent checks and verified-upload lifecycle remain T10/T38. |
| `responses.parent_type/parent_id`, `signatures.parent_type/parent_id` | optional client, subject or booking | Type CHECK; no parent FK. Concrete client FK does not prove the polymorphic parent belongs to that client. Both-null/pair consistency and tenant/client checks need explicit contracts. |
| `accounts.owner_type/owner_id` | business, client, staff, platform, gift_card or package | Owner-type CHECK and tenant-scoped account identity index; no owner FK. Platform is a logical party, not a platform table. Validate domain-specific ownership before adding constraints. |
| `entries.owner_type/owner_id` | copied account owner | Concrete account FK exists; copied owner pair has no FK or owner-type CHECK. Append-only journal/trigger invariants are separate from a complete ownership policy. |
| `entries.source_type/source_id`, `subject_type/subject_id` | service-defined financial source/subject; optional | No closed DB type vocabulary or FK. Preserve historical identifiers; enumerate event-specific references before enforcement. |
| `audits.entity_type/entity_id` | service-defined audited entity | No FK/type CHECK. Historical/deleted entities can remain meaningful; audit retention must not require a live parent. |
| `entries.journal_id`, `ref` | journal grouping and idempotent financial reference | No journal/reference target table. They are logical identities, not missing FKs to infer. |
| `items.addon_for` | item IDs in an array | No FK; validate ownership and retained/deleted target behavior explicitly. |
| `businesses.brand`, `responses.answers`, signature strokes and other JSON/custom fields | media references, form-defined file answers, domain-specific payloads | JSON does not declare relational ownership. Known logo/avatar file references and file/image answers need semantic validation; arbitrary custom data must not be interpreted as trusted capabilities. |
| Provider references on businesses, clients, items, payments, subscriptions, payment_methods and payment_setup_links | provider account/customer/price/payment/subscription/setup/mandate identities | External identities, not local table FKs. `payment_setup_links.account_id/customer_id` are provider IDs. Validate provider/account binding and lifecycle through their adapters. |

## Current enforcement versus intended protection

Current application services use `scoped()` and role gates; the integration test in `test_scoping.py` proves ordinary live-client reads isolate two businesses and exclude soft-deleted rows when requested. This new registry is not called to authorize requests and does not change runtime behavior. It does not prove every service uses scoping correctly. Database RLS, restricted runtime roles, immutable tenant IDs, composite tenant/client foreign keys and complete polymorphic validation are future implementation steps. Global identity and routing access must receive narrow grants/resolvers rather than a fabricated tenant key.

The concrete FK inventory includes all 44 ORM tables. Routes, jobs, sync visibility, public capability purposes, closed-business behavior and complete event/JSON reference vocabularies remain explicit T01 follow-up work; this document does not mark T01 complete.
