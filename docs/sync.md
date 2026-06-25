# Clientbridge — Offline Sync Architecture

**Engine: PowerSync** (locked 2026-06-24). Self-hosted service next to our Postgres (managed cloud
as fallback). Topology = **Option A** (PowerSync reads the Postgres WAL directly) **+ views/RLS as the
backend control plane**. Writes always go **through FastAPI** (server-authoritative).

## Why PowerSync (decision record)
Only engine that delivers, for our fixed stack, **all of**: real offline **SQLite on both** React web
(WASM/OPFS) **and** Expo RN (op-sqlite + SQLCipher), **WAL-driven server-initiated push**, and
**per-business partial replication** — with **no Node** and minimal bespoke code, OSS self-host or cloud.
- **ElectricSQL** rejected: no offline SQLite persistence on Expo/RN today (PGlite doesn't run on RN);
  excellent for web read-sync only. Revisit if `expo-pglite` ships.
- **DIY** rejected for v1: a real live offline engine is ~2–4 months + permanent maintenance. Revisit
  only if vendor risk/cost becomes unacceptable (PocketSuite-grade delta-sync is the fallback shape).
See [data-model-options.md] reasoning style; full comparison in chat/research.

## Topology
```
 Expo (op-sqlite, SQLCipher) ─┐                              ┌── logical replication (WAL) ──┐
 React web (WASM/OPFS)        ─┤── WebSocket (read sync) ──► PowerSync Service ◄──────────────┤ Postgres
        ▲  reads from local SQLite (offline-first)            (Sync Rules: bucket by           │ (source of truth)
        │                                                       business_id + role, from JWT)   │
        └── local writes → uploadData() ──► FastAPI /sync/upload ──(validate + authorize)──────┘ writes
```
- **Reads:** Postgres → PowerSync → client, governed by **Sync Rules** + **JWT claims** + **views/RLS**. FastAPI is *not* in the read loop.
- **Writes:** local SQLite (optimistic) → upload queue → **FastAPI `/sync/upload`** → authz/validate → Postgres. Server is authoritative.
- **Server-initiated push:** *any* write that hits Postgres — a Stripe/Interac webhook, a cron job, another staff member's action — flows out via the WAL automatically, <1s, to the relevant devices.

## Components
### Postgres
- `wal_level = logical`; a `powersync` **publication** + a logical **replication slot**.
- A read-only `powersync` role with `REPLICATION`. Sync rules read from base tables **or curated views**.
- Stable PKs (text ULID ✅). Soft-delete (`deleted_at`) so deletes propagate as updates.
- `GENERATED STORED` columns are excluded from the WAL → expose derived values via **views**, not stored-generated columns.

### PowerSync Service (Docker, self-hosted)
- Config = Postgres connection + **Sync Rules YAML** + **JWKS URL** (to validate FastAPI-issued JWTs).
- ⚠️ Mid-migration **Sync Rules (stable) → Sync Streams (beta ~2026)** — build on Sync Rules; evaluate Streams later.

### FastAPI backend
- **JWT issuance** — short-lived tokens with claims: `sub` (user_id), `business_ids` (the user's active businesses), `role`; published via a **JWKS endpoint** PowerSync trusts. A `GET /sync/token` refresh endpoint feeds the client connector's `fetchCredentials`.
- **`POST /sync/upload`** — the write choke point. Receives the client's queued `PUT/PATCH/DELETE` ops; for each: authorize (row's `business_id` ∈ caller's businesses + role permits), validate business rules, apply to Postgres. **Rejects writes to server-only tables** (payments/payouts/tax_rates/etc.). This is where server-authoritative reconciliation lives.

### Clients (shared `packages/sync`)
- **Web:** `@powersync/web` + WASM SQLite (OPFS).
- **Expo:** `@powersync/react-native` + `@powersync/op-sqlite` (**SQLCipher** at-rest encryption). **Expo dev builds / EAS Build only — not Expo Go.**
- Shared connector: `uploadData()` → `POST /sync/upload`; `fetchCredentials()` → `GET /sync/token`.

## Read sync — partial replication by business + role
Sync Rules sketch (one bucket set per business the user belongs to; a second, role-gated bucket for financials):
```yaml
bucket_definitions:
  business_core:
    parameters: |
      SELECT business_id FROM memberships
      WHERE user_id = request.user_id() AND status = 'active'
    data:
      - SELECT * FROM clients    WHERE business_id = bucket.business_id AND deleted_at IS NULL
      - SELECT * FROM sessions   WHERE business_id = bucket.business_id
      - SELECT * FROM bookings   WHERE business_id = bucket.business_id AND deleted_at IS NULL
      - SELECT * FROM invoices   WHERE business_id = bucket.business_id
      - SELECT * FROM items      WHERE business_id = bucket.business_id
      # … all client-synced tables (see scope table)

  business_financials:                 # owner/admin only
    parameters: |
      SELECT business_id FROM memberships
      WHERE user_id = request.user_id() AND role IN ('owner','admin') AND status='active'
    data:
      - SELECT * FROM payments WHERE business_id = bucket.business_id
      - SELECT * FROM payouts  WHERE business_id = bucket.business_id
```
- **Column-level control / redaction** → point a `data:` query at a **view** (e.g. `v_clients_safe`) instead of the base table; enforce **RLS** where needed.
- **Access changes propagate automatically:** add/remove a member or change a role → the parameter query re-evaluates → buckets are added/removed → the device syncs or forgets that data with no extra code.

## Sync scope — what lives on-device
| Class | Tables | On client |
|---|---|---|
| **Read + write** | clients · subjects · consents · notes · items · packages · subscriptions · gift_cards · sessions · bookings · availability · resources · schedules · invoices · estimates · lines · threads · messages · broadcasts · forms · form_fields · form_responses · contracts · signatures · reviews · review_requests · files(meta) | local SQLite; writes via `uploadData` |
| **Read-only (server-authoritative)** | payments · payment_methods · payouts · payout_allocations · tax_rates · businesses(own) · memberships(own business) | synced down; client writes **rejected** by `/sync/upload` |
| **Server-only (never synced)** | webhook_events · audit_logs† | Postgres only |

†`audit_logs` may later sync read-only to power the client activity timeline. `payment_methods`/`payments` originate from Stripe/Interac or the backend — clients read, never write card data.

## Write path & conflict model
- Client writes optimistically to local SQLite → queued → `uploadData()` → `POST /sync/upload`.
- FastAPI **authorizes + validates + applies** → Postgres → WAL → fans back out; the authoritative row overwrites the optimistic local copy.
- **Conflicts:** server-authoritative. Benign concurrent field edits = **last-write-wins by `updated_at`**; the backend can **reject/transform** (e.g. no double-booking a `session` past capacity, no paying an already-`paid` invoice). Money creation (`payments`/`payouts`) is backend/webhook-only, so it never originates as an offline client write — eliminating the riskiest conflict class.

## Schema implications (mirrored in schema.md §Sync)
- `updated_at` on every table (delta ordering) — ✅ present.
- **Extend `deleted_at` (soft-delete) to all client-synced tables** so deletes propagate (client queries filter `deleted_at IS NULL`).
- Stable text ULID PKs — ✅. **No outbox table** (WAL-based).
- Infra migration: `wal_level=logical` + `powersync` publication + replication slot + `powersync` role.
- Optional `v_*_safe` **views** for column redaction; **RLS** where row visibility needs DB enforcement.

## Open items — confirm in a 1–2 day spike before full build
1. **Sync Rules vs Sync Streams** — pick the API to build on.
2. **`uploadData` validation/conflict hooks** for sessions/bookings/invoices (capacity, paid-state, etc.).
3. **License / pricing** — self-host vs cloud at solo/small-business scale.
4. **op-sqlite + SQLCipher** key management on device (where the encryption key lives).
5. Multi-business users — `business_ids` claim (array) and bucket fan-out behaviour.
