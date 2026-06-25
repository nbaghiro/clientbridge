# Clientbridge — Data Model Options (compare & decide)

For each area with a real design fork: the options, a 1-line schema sketch, pros/cons, and a
recommendation. Uncontroversial tables (`tax_rates`, `reviews`, `files`, `webhook_events`,
`counters`, `invitations`, `consents`, `resources`) have one obvious shape and are omitted.

**Three "presets"** if you'd rather choose a whole philosophy than go area-by-area:
- **P1 · Lean** — max consolidation, polymorphic, fewer tables (~33), more validation in the app layer. *(my v2)*
- **P2 · Explicit** — a table per concept, DB-enforced FKs, ~46 tables, more boilerplate but self-documenting.
- **P3 · PocketSuite-faithful** — everyone-a-`user`, polymorphic lines/payments, `type` discriminators, lifecycle timestamps.

Each option below is tagged with the preset(s) it fits.

---

## 1 · People & tenancy
- **A · Workspaces + `clients` table** `(P1/P2)` — `accounts → workspaces → clients`; staff via memberships; a client may link to a `user`. → clean tenancy, clients are first-class, but a person who is both a client and a pro exists twice.
- **B · Everyone-is-a-`user`** `(P3)` — one `users` table; `clients`/`payees` are link rows `(owner→person)`. → zero identity duplication, cross-business identity, easy merges; but heavier queries and weaker per-workspace isolation.
- **C · Per-workspace `contacts`** — one `contacts` table per workspace; a contact has flags `is_client`/`is_staff`. → one people table, simple; but no global identity across workspaces.
- **→ Rec: A** — workspaces tenancy is your choice; clients-as-first-class keeps scoping/indexing clean. Borrow B's `client.user_id?` link for self-serve.

## 2 · Members / staff
- **A · Unified `staff`** `(P1)` — `scope` (account/workspace), `scope_id`, `role`, `is_payee`. → one table, multi-workspace per user.
- **B · `account_members` + `workspace_members`** `(P2)` — explicit. → clearer, but two near-identical tables.
- **C · role on `users`** — `users.workspace_id` + `role`. → simplest; breaks if a person works in >1 workspace.
- **→ Rec: A** (B if you value explicitness).

## 3 · Catalog (services / products / packages / subs / gifts)
- **A · One `items` (`kind`)** `(P1/P3)` — whole catalog in one table. → fewest tables; wide table with kind-specific nulls.
- **B · Split per kind** `(P2)` — `services`, `products`, `package_plans`, `subscription_plans`. → each lean & typed; more tables + a union for "list everything sellable".
- **C · `items` + `plans`** — `items` (service/class/product) + `plans` (package/subscription). → middle ground.
- **→ Rec: A** for booking simplicity, **C** if package/subscription configs get heavy.

## 4 · Sold instances (a client's package / subscription / gift)
- **A · One `entitlements` (`kind`)** `(P1)` — sessions/period/balance columns, mostly-null per kind. → one table; sparse.
- **B · `package_grants` + `subscriptions` + `gift_cards`** `(P2/P3)` — distinct lifecycles. → cleaner per type (subscriptions especially differ a lot); 3 tables.
- **→ Rec: B** — honestly subscriptions (recurring billing state) differ enough from packages (session counter) and gifts (balance) that splitting is clearer. *(This is where I'd walk back my v2 consolidation.)*

## 5 · Invoices vs estimates
- **A · One `invoices` (`type`)** `(P1)` — estimate = `type='estimate'`. → one doc table + one lines table; status space gets mixed.
- **B · Separate `invoices` + `estimates`** `(P2/P3)` — distinct status lifecycles. → clearer; some shape duplication.
- **→ Rec: B** if estimates get their own flows (accept/decline/convert); **A** if estimates are just "draft invoices".

## 6 · Line items
- **A · Polymorphic `lines`** `(P1/P3)` — `parent_type`/`parent_id`. → one table for invoice/estimate/booking lines; loses a FK constraint, needs app-side integrity.
- **B · Per-doc line tables** `(P2)` — `invoice_lines`, `estimate_lines`. → real FKs + cascade; duplication.
- **→ Rec: A** (PS-proven, big simplicity win) — *unless* you went **5B** (separate estimates), in which case **B** pairs naturally.

## 7 · Payments / money movement
- **A · One polymorphic `payments`** `(P1)` — `kind` (payment/deposit/refund), `method` (card/interac/eft/cash), nullable invoice/booking/entitlement, Interac via `reference_code`, refund via `parent_payment_id`. → one table, all rails; busy table.
- **B · `payments` + `refunds` + `interac_requests`** `(P2/P3)` — explicit per concern. → each table focused; Interac auto-match logic isolated; more tables/joins.
- **C · Double-entry `ledger`** — every cent is a `ledger_entries` row (debit/credit), `payments` references it. → audit-perfect, reporting-friendly; most complex, overkill for v1.
- **→ Rec: B** — payments is the riskiest domain; explicit `refunds` + `interac_requests` (the auto-match queue) are worth their own tables for clarity and ops. Keep `payments` polymorphic over docs.

## 8 · Scheduling (1:1 vs group classes)
- **A · `bookings` + `class_sessions`** `(P1/P3)` — class occurrence holds capacity; bookings reference it. → one calendar; clean classes.
- **B · `bookings` only** — class = a parent booking + child bookings (attendees). → fewest tables; self-referential and fiddly.
- **C · `appointments` + `class_registrations`** `(P2)` — fully separate. → clearest per use-case; two calendars to merge.
- **→ Rec: A**.

## 9 · Availability
- **A · One `availability` (`kind`)** `(P1)` — working_hours + time_off in one. → one table; mixed columns.
- **B · `availability_rules` + `time_off`** `(P2/P3)` — recurring vs date-range. → cleaner shapes.
- **→ Rec: B** — recurring weekly hours and one-off blocks are different enough; cheap to keep separate.

## 10 · Forms & contracts / e-sign
- **A · `templates` + `submissions`** `(P1)` — `kind` (form/contract), schema/answers in `jsonb`. → 2 tables for everything; jsonb-heavy.
- **B · `form_templates`+`form_responses` and `contracts`+`signatures`** `(P2)` — 4 tables, forms vs contracts separated. → clearer; e-sign fields are first-class.
- **C · PocketSuite-style** `(P3)` — `types`+`fields`+`records`+`values` + `contracts`+`signatures` (6). → fully relational fields, queryable answers; most tables/joins.
- **→ Rec: B** — forms and contracts/e-sign are different enough (and e-sign has legal/audit fields) that separating them reads better than one `kind`'d table; still far simpler than PS.

## 11 · Custom fields
- **A · `custom_fields jsonb` + `templates` for structured forms** `(P1)` — → flexible, no schema churn; not SQL-queryable.
- **B · EAV `field_defs` + `field_values`** `(P2/P3)` — → queryable/reportable on custom fields; classic EAV pain.
- **→ Rec: A** for v1 (jsonb), revisit EAV only if customers need to filter/report on custom fields.

## 12 · Messaging & activity feed
- **A · `threads` + `messages` + `audit_logs`** `(P1/P2)` — inbox separate from system activity. → clean inbox UX; client timeline = merge messages + audit.
- **B · One `messages`/`events` table** `(P3)` — comms + system activity unified, polymorphic FKs. → cheap client timeline from one table; inbox queries get noisier.
- **→ Rec: A**.

## 13 · Notes & files
- **A · Generic `notes` + `files` (`parent_type`/`parent_id`)** `(P1/P3)` — → 2 tables for all entities.
- **B · Per-entity** `(P2)` — `client_notes`, `booking_attachments`… → real FKs; many tables.
- **→ Rec: A**.

## 14 · Cross-cutting (quick)
| Choice | Options | Rec |
|---|---|---|
| **Money** | integer cents+currency `(P1/P2)` · NUMERIC dollars `(P3)` | **cents** |
| **PK** | prefixed ULID `(P1)` · UUID `(P2)` · bigint `(P3)` | **prefixed ULID** |
| **State** | status + key lifecycle timestamps `(P1)` · status only `(P2)` · timestamps-only `(P3)` | **status + lifecycle timestamps** |
| **created_by** | on every row `(all)` | **yes** |

---

## My recommended blend (not pure P1)
A pragmatic mix — mostly Lean, but **split the few places where lifecycles genuinely differ**:
- People/tenancy **A**, memberships **A**, catalog **A**, scheduling **A**, availability **B**, lines **A**, custom fields **A**, messaging **A**, notes/files **A**, money cents, ULID, status+timestamps.
- **Walk back 3 v2 consolidations** → **4B** (split package_grants / subscriptions / gift_cards), **7B** (split refunds + interac_requests), **10B** (split forms vs contracts/signatures). And **5/6**: keep invoices+estimates split (**5B/6B**) *or* unified (**5A/6A**) — your call.

Net table count of the recommended blend: **~38** (vs 33 lean / 46 explicit) — still far simpler than PocketSuite's 119, with stronger clarity exactly where money and lifecycles live.
