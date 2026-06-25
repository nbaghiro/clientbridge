# Clientbridge — Authorization & Visibility

How we decide **who sees and can change what**. The read-side "RLS" is **PowerSync Sync Rules** (the
sync stream replicates from the WAL and *bypasses* Postgres RLS, so policies live in the sync rules,
not the DB). Writes are authorized in FastAPI. Postgres RLS is optional defense-in-depth for the API.

## User types (three tiers)
| Tier | Modeled as | Logs into | Scope |
|---|---|---|---|
| **Provider team** | `staff.role` on a `users` row | provider app | their business(es), role-scoped |
| **Client** | `clients.user_id` (optional) | (future) client portal | only their own relationship with that business |
| **Platform admin** | Clientbridge-internal (not tenant data) | internal console | cross-tenant — separate from this model |

## Provider roles (`staff.role`)
| Role | Billing / ownership | Other staff's work | Financials | Inbox / reviews |
|---|---|---|---|---|
| **owner** | ✅ | ✅ all | ✅ | ✅ |
| **admin** | ❌ | ✅ all | ✅ | ✅ |
| **staff** | ❌ | ❌ (own only) | ❌ | ❌ |
| **contractor** | ❌ | ❌ (own only) | own earnings | ❌ |

## Visibility model — **employee model** (default)
| Data | owner / admin | staff |
|---|---|---|
| Own calendar (sessions/bookings/availability) | ✅ all members | ✅ own only |
| Shared client book (clients, subjects, consents, docs) | ✅ | ✅ |
| Catalog (items, packages, tax, resources, forms) | ✅ | ✅ |
| Own earnings (`payout_allocations` where member = me) | ✅ all | ✅ own |
| Financials (invoices, payments, payouts, others' pay) | ✅ | ❌ |
| Inbox / broadcasts / reviews | ✅ | ❌ |
| Activity log (`audit_logs`) | ✅ | ❌ |
| Settings / billing / staff management | owner (+admin ops) | ❌ |

*(Contractor / booth-rental "siloed" model — each provider owns their own clients — is a future toggle:
`clients.owner_staff_id` + a per-business setting.)*

## Enforcement layers
| Path | Mechanism |
|---|---|
| **Reads (sync)** | **PowerSync Sync Rules** — per-role buckets; the device only ever receives its slice |
| **Writes** | **FastAPI `/sync/upload`** — actor (JWT `sub` → staff) + role gate each op (server-authoritative) |
| **API reads** (reports/RPC) | FastAPI authz, **+ optional Postgres RLS** on the app's DB role |
| Postgres RLS | optional defense-in-depth; **not** the sync filter (replication bypasses it) |

## The sync buckets (`infra/powersync/sync-rules.yaml`)
- **`business_shared`** (every active member) — reference data + the client book + client docs.
- **`staff_self`** (per staff) — own `sessions`/`bookings`/`availability`/`schedules`/`payout_allocations`.
- **`business_full`** (owner/admin) — **all** members' work + financials + inbox + **`audit_logs`**.

**Device read scope:** staff = `business_shared` + `staff_self` · owner/admin = those + `business_full`.

## How "owner sees workers' activity" works
Three columns carry it — no new entities:
- `sessions.staff_id` / **`bookings.staff_id`** (denormalized, migration 0003) — who does the work.
- `payout_allocations.staff_id` — their earnings.
- `audit_logs.actor_user_id` — *who did what* (the activity feed), synced only to owner/admin via `business_full`.

## Write-path authorization (FastAPI `/sync/upload`) — implemented
`backend/src/clientbridge/sync/upload.py` resolves the actor (JWT `sub`, or `dev_user_id` in dev),
loads their active `staff` rows, then for each op enforces a **`WRITE_POLICY`** table:
- The row's `business_id` must be one the actor belongs to (PUT reads it from the data; PATCH/DELETE
  looks up the existing row).
- **`WRITE_POLICY[table] = (min_tier, own_only)`** — `min_tier` `team` (any active staff) vs `admin`
  (owner/admin); `own_only` means a non-admin may only touch rows where `staff_id` is theirs.
  - **team-writable:** clients · subjects · consents · notes · files · form_responses · signatures ·
    threads · messages, and (own-only) sessions · bookings · availability · schedules.
  - **admin-only:** items · packages · invoices · estimates · lines · payment_methods ·
    payout_allocations · broadcasts · reviews · …
  - **not writable via sync** (server-authoritative): `payments` · `payouts` · `tax_rates` ·
    `businesses` · `staff` · `audit_logs` · `webhook_events` → 403.
- Values are **coerced** from the client's SQLite types back to Postgres (bool/JSONB/array/date/time);
  PUT = upsert, PATCH = partial update, DELETE = soft-delete (`deleted_at`) where present. Whole batch
  is one transaction — any auth failure rolls it all back (`403`). Covered by `tests/test_sync_upload.py`.
- *Still TODO:* deeper business-rule validation (capacity, paid-state) inside the apply step.
