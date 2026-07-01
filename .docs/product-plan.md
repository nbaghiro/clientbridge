# Clientbridge — Product Build Plan (full-stack slices)

How we ship the product from here: **vertical product slices**. Each slice delivers one product area
end-to-end — backend surface(s) → sync rules → web screens → mobile screens → tests — and is demoable
on both platforms before the next starts. This complements [`backend-plan.md`](backend-plan.md) (the
backend phases) and follows the same data-dependency order; here we add the web/mobile half.

## Why vertical (not backend-first)
- Always demoable: a working, sync-driven feature on web + mobile after every slice.
- The backend is validated by real UI immediately, so it can't drift from what screens need.
- Matches how the product was designed (by screen: Today, Calendar, Clients, Invoice, Inbox).
- The data-dependency chain still sets the order: Clients → Catalog/Tax → Booking → Invoices → Payments.

## The within-slice rhythm (the pattern slice 1 established)
1. **Backend** — model (if new) → migration → service/command → `api/v1` router + DTOs → tests → `make gen-api`.
2. **Sync** — add the table(s) to `infra/powersync/sync-rules.yaml` → `make gen-sync-schema`.
3. **Web** — page(s) under `apps/web/src/pages` + components; read via `useQuery` (local PowerSync), write via the typed api-client → syncs back. **Put UI-agnostic logic (row types, query hooks, mutations, formatters) in `@clientbridge/app-core`, not in the screen.**
4. **Mobile** — screen(s) under `apps/mobile/src/screens`; same read/write pattern, importing the same `@clientbridge/app-core`; only the markup differs.
5. **Verify + commit** (lint/tsc/tests green; screenshot mobile; reload web).
6. **Audit at the slice/phase boundary** — before starting the next slice, review the changeset against the principles (layering · the 5 surfaces · role gates vs `WRITE_POLICY` · the 4-part test matrix · web↔mobile duplication · stray comments) and fix High/Medium findings then. See `CLAUDE.md` → "Milestone audit". (The Catalog & Tax audit caught an unguarded REST write + a router doing raw queries.)

Every slice clears the 4-part test matrix (happy · each 4xx · security invariants · idempotency/edge)
and keeps the 90% branch-coverage gate. Read local, write via command/sync — the server is the source
of truth; clients are optimistic caches.

## Slice sequence

| # | Slice | Backend phase | Depends on | Size |
|---|---|---|---|---|
| 1 | **App shell + Clients** ✅ | Ph 0 (clients) | auth | — done |
| 2 | **Catalog & Tax** | Ph 3 | Clients | M |
| 3 | **Calendar & Booking** | Ph 4 | Catalog/Tax | L |
| 4 | **Invoices & Estimates** | Ph 5 | Booking, Tax | M–L |
| 5 | **Payments** | Ph 6 | Invoices | L |
| 6 | **Today / Dashboard** | aggregation | 3 + 4 + 5 | S–M |
| 7 | **Inbox & Notifications** | Ph 7 | Booking | L |
| 8 | **Documents & Reviews** | Ph 8 | Booking | M |
| 9 | **Hardening & Prod** | Ph 9 | continuous | — |

---

### Slice 1 — App shell + Clients ✅ done
Sidebar/router (web) + tab bar with FAB (mobile); Clients list/search/add full-stack; read via sync,
write via `POST /v1/clients`. Proved the local-first loop across both platforms.

### Slice 2 — Catalog & Tax (the pricing core + a moat piece)
- **Backend:** catalog items (service / product / class), packages, subscriptions, gift cards. **Tax
  engine** (`services/tax_service`, pure + golden-tested): per-province GST/HST/PST/QST, **line-level**,
  compound vs additive (QC QST-on-GST), small-supplier (<$30k) mode, registration numbers,
  inclusive vs exclusive pricing.
- **Web:** Catalog page (list items, add/edit with price + tax category); Settings → Tax (province,
  registration #, small-supplier toggle).
- **Mobile:** Catalog screen (list + add item).
- **Invariant:** tax is server-authoritative — a golden case per province must pass; (province, items,
  registration) → correct line + invoice tax.

### Slice 3 — Calendar & Booking (the heart of the app)
- **Backend:** `scheduling_service` (recurring availability + exceptions + resource capacity →
  bookable slots; conflict detection); recurring schedules (RRULE → `sessions`); **booking command**
  (`POST /bookings`: atomic capacity/conflict check, deposit, lifecycle pending→confirmed→
  completed/canceled/no_show, reschedule/cancel); **public booking** (unauth surface #4).
- **Web:** Calendar (day/week), new-booking flow (client + service + slot), availability settings,
  public booking page.
- **Mobile:** Calendar/agenda, new booking; wire the **+ FAB → new booking**; set **Today** as default tab.
- **Invariant:** double-booking is impossible (the capacity check is atomic in the command); a public
  booking lands booking + session + client in Postgres → syncs to the owner's devices.

### Slice 4 — Invoices & Estimates
- **Backend:** invoice service (build from bookings/lines, **per-business numbering** via a Postgres
  sequence, totals via the tax engine, balance = total − payments, status lifecycle, send via email);
  estimates → accept → convert to invoice; **public invoice** view + pay link (surface #4).
- **Web:** Invoices list, invoice builder/detail, estimate flow, public invoice.
- **Mobile:** Invoices list + detail.
- **Invariant:** numbering unique/sequential per business; invoice math satisfies the verifier
  invariants (total = Σ lines + tax; balance = total − payments).

### Slice 5 — Payments (the money loop, the differentiator)
- **Backend:** **Stripe Connect** (account-link onboarding, PaymentIntents incl. tap-to-pay, refunds,
  **webhooks** → `payments`/`payouts` + reconciliation, idempotent + signature-verified via
  `webhook_events`); **Interac e-Transfer** (request + **auto-match by reference code** — the wedge);
  EFT/PAD; payout **allocations** (staff splits); **GST/HST remittance** set-aside (Σ tax on paid
  invoices). No fund custody — Stripe holds funds (avoids money-transmitter licensing).
- **Web:** take payment, pay link, Stripe onboarding, payment/payout status.
- **Mobile:** take payment, payment status.
- **Invariant:** Stripe test card → invoice paid → payout mirrored → staff split recorded; Interac
  auto-match demoable; webhooks idempotent.

### Slice 6 — Today / Dashboard
- **Backend:** aggregation reads (revenue today, awaiting payment, GST/HST set-aside, rebook rate,
  today's schedule, recent activity from `audit_logs`).
- **Web:** the Today dashboard (the design's hero screen).
- **Mobile:** the **Today** tab (replaces the placeholder; becomes the default tab).
- Can grow incrementally — start with whatever data exists after slices 3–5.

### Slice 7 — Inbox & Notifications (server-initiated everything)
- **Backend:** **arq worker** on Redis (reminders, recurring generation, payout reconciliation, review requests, schedule-window roll-forward); **email + Twilio SMS**; messaging/inbox
  (threads, inbound SMS webhook → thread, **broadcasts**).
- **Web:** Inbox (threads), notification settings.
- **Mobile:** Inbox tab.
- **Proof:** a reminder job sends SMS and the booking change appears on-device instantly via sync.

### Slice 8 — Documents & Reviews
- **Backend:** files (S3/minio presigned), intake forms (`form_responses`), contracts/e-sign
  (signature + audit + PDF), reviews (request job → public submission → rollup on `businesses`).
- **Web:** forms, contracts, reviews; attach files to records.
- **Mobile:** forms, file attach.

### Slice 9 — Hardening & Prod (continuous; dedicated pass at the end)
- Postgres **RLS** (per-request `SET LOCAL` + `business_id WITH CHECK`); **data-subject rights** (export, right-to-be-forgotten, retention); rate limiting + lockout + RS256/JWKS in prod;
  observability (Sentry, metrics, tracing, slow-query/index/sync-rule audit); deployment (prod
  containers, migration gating, backups, PowerSync prod topology).

## Sequencing notes
- **3 → 4 → 5** is the spine (booking produces lines → invoices total them → payments settle them).
- **Slice 6 (Dashboard)** can begin partially after slice 3 and fill in as 4–5 land.
- **Slice 7 (jobs/notifications) infra** can start as soon as bookings exist (reminders need them).
- **Slice 9** runs continuously (tests, RLS-where-cheap) with a focused pass before launch.
- Build **web-first, then mobile** within each slice (faster iteration; mobile mirrors the web UX).
