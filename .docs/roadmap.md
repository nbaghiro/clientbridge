# Clientbridge — Roadmap

The authoritative **"what's left"** backlog and the **order** to close it. For *how it works* see
[architecture.md](architecture.md); for *how we build* see [engineering.md](engineering.md).

Milestones by priority: **M3** launch-blockers · **M4** completeness · **M5** depth & growth. Sizes `[S/M/L]`.
This supersedes the historical phase/slice plans (now consolidated away — the built alpha outran them).

---

## Baseline — what's already built (do not re-chase)

Backend + web + mobile are alpha-complete end-to-end: clients → catalog → scheduling → bookings (incl.
**recurring series**) → invoices/estimates → payments/payouts → **Stripe Connect** (Custom, KYC sync, direct
charges, saved cards, deposits, refunds) → **mobile Tap-to-Pay** (real Terminal SDK) → POS/Terminal orders →
packages/subscriptions/gift-card sale+redeem → **Interac** request+match → public pay/book/form/contract/
review token pages → forms/contracts/e-sign (text snapshot + IP + audit) → reviews + review-request cron →
broadcasts (scheduled fan-out) → team invites/roles → inbound SMS→thread → **6 arq crons** → **mobile push**
→ webhook idempotency (Stripe signature-verified) → refresh rotation + reuse-detection → RS256/JWKS →
i18n string catalog (English) → income/GST-HST/T4A reports + CSV → dashboard KPIs. **Connect** customer app
(lean, PowerSync-free, branded, embeddable widgets) ships the five public surfaces + a per-business landing.

---

## Recently hardened

**Correctness bugs (2026-07-02) — ✅ all fixed:** availability now interpreted in the business timezone
(DST-safe) · refund reverses its payout allocation · GST/HST return apportions PST/QST separately · client
lifetime value rolls up from settled payments (+ backfill) · resources conflict-checked (GiST constraint).

**Full-codebase security/correctness review (2026-07-02) — ✅ fixed:** staff-invite account-takeover (accept
now requires the existing password) · unverified-OAuth-email login rejected · constant-time login (no
enumeration timing oracle) · **fail-closed prod secrets** (startup validator — was M3) · gift-card/package
lost-update row locks + a per-staff `pg_advisory_xact_lock` for booking capacity/buffer TOCTOU · over-refund
of partly-used entitlements blocked · recurrence occurrences re-localized per date (DST drift) · the dead
calendar query fixed (SQLite bare-`+00`) · Inbox wrong-recipient · accept-invite stale-replica reset ·
broadcasts + client LTV made command-only · send-notifications moved inside the idempotent command · CI now
runs the production build.

---

## 🔴 M3 — Launch blockers (P0)

Cannot ship to real paying users without these.

### Security & secrets
- ✅ **Fail-fast on default secrets in prod.** *(done — `config.py` `_require_prod_secrets` refuses to boot
  on the dev JWT default / empty Stripe secret when `env!=dev`.)*
- [S] **Prod CORS + security headers.** `main.py` adds CORS only in dev, so the prod web app (separate origin)
  can't call the API; no HSTS/CSP/X-Frame/TrustedHost. Add a prod origin allowlist + baseline headers.
- [S] **Verify the real Twilio HMAC on inbound SMS.** `webhooks.py` compares a static shared secret, not
  Twilio's request signature — spoofable. (Interac uses the same static-secret pattern; revisit with a real provider.)

### Ops / deploy
- [M] **Production containers.** `infra/docker/` is empty; `dev-api` is uvicorn `--reload`. Need a prod API
  image + arq-worker image + prod server (gunicorn/uvicorn workers) + process manager.
- [M] **DB backups + restore drill.** No backup/PITR for Postgres or `powersync_storage`; money + PII is unrecoverable.
- [S] **Error tracking (Sentry/Rollbar).** No capture/alerting on server, web, or mobile.

### Functional-completeness blockers
- [S] **Make tax collection enable-able.** `is_tax_registered` defaults False and is absent from
  `BusinessSettingsUpdate`/onboarding — a live tenant collects **zero tax** with no way to turn it on.
- [M] **Catalog editor exposes the full item shape.** The form posts only 5 of ~20 fields, so
  `session_count`/`interval`/`frequency`/deposit/capacity/validity can't be set — **packages and
  subscriptions are unsellable end-to-end** until this is wired.
- [L] **CASL/consent + opt-out.** Broadcasts blast every active client with no consent record, unsubscribe
  link, SMS STOP handling, or suppression list. Legal blocker for the marketing feature in-region.
- [L] **Two-way-SMS tenancy.** One global Twilio number across all businesses; inbound routes by matching
  client phone across tenants. Needs per-business numbers + a number→business routing table (else cross-tenant leakage).

---

## 🟠 M4 — Completeness (P1)

Needed to be a real, complete product (not just an alpha). Grouped by domain; largely parallelizable.

### Payments & billing
- [M] **Take/record payment in-app** (no UI hits `POST /payments/invoice/{id}`; payment only via the public link).
- [M] **Partial & multiple refunds** (backend refunds full amount only; UI sends no amount).
- [M] **Tips** (no capture at any checkout; `payout_allocations` has a `tip` source but no path).
- [M] **Discounts / promo codes** (none, line- or order-level).
- [M] **Web POS card-present** (web reader panel is a stub; only mobile Tap-to-Pay works; no resume-held-order).
- [M] **Interac ingestion + lifecycle** (match logic exists; no real bank ingestion, no stale-request expiry, no surplus handling; authed per-invoice Interac request has no UI).
- [M] **Payout splits beyond bookings** (POS sales, tips, non-booking invoice lines never credit staff).
- [M] **Invoice/estimate/receipt PDF** (clients get only a web link).

### Scheduling & booking
- [M] **Recurring-series lifecycle:** edit/cancel series, rolling-window top-up cron (hard-caps at 60), a
  single "series booked" confirmation, explicit detach-occurrence.
- [M] **Time-off / blackout / date-exception UI** (backend supports `type='date'`; the only editor writes the weekly grid).
- [M] **Resource management UI + conflict enforcement** (needs create/list/pick UI + resource-aware slotting).
- [M] **Mobile calendar parity** (mobile has agenda/day; web has day/week/month/staff — shared helpers exist).
- [M] **Client self-service + lifecycle jobs** (public clients can't cancel/reschedule; no cron auto-marks past bookings completed/no-show).

### CRM / messaging / reviews
- [M] **Client edit/delete UI + tags/status/custom fields** (app is add-only; tags are the only broadcast segment yet can't be set).
- [M] **Notes UI** · [M] **Subjects UI** (pets/vehicles/…) — both modeled, synced, write-authorized, no screen (a vertical differentiator, unreachable).
- [M] **Client 360 view** (detail shows only payment methods/subs/packages; no booking/invoice/message/note history).
- [L] **Client merge/dedupe** (duplicates accumulate with no combine).
- [M] **Message templates / merge fields / quick replies** (compose + broadcast are free-text only).
- [M] **Broadcast depth** (real segmentation, recipient preview, no silent 500-cap, draft/cancel, retry/throttle).
- [M] **Review gating/moderation** (submissions auto-publish regardless of rating; "send to Google" is unwired).
- [L] **Client-facing portal** — see *Connect* below.

### Documents / files / dashboard / compliance
- [M] **Signed-contract PDF** (with audit block); text-only snapshot today.
- [M] **File upload limits** (no max size / content-type allowlist / malware scan, incl. the token-gated public upload surfaces).
- [S] **Today page:** add today's-schedule section + surface the GST filing-due date.
- [L] **Business analytics** (reporting is CRA-compliance-only; no trends, top services, retention, utilization, no-show rates).
- [M] **Data export** (PIPEDA/Law 25 subject access) · [L] **Right-to-be-forgotten / erasure / account deletion** (only soft-delete exists; PII incl. in PowerSync storage persists forever).
- [M] **Audit the sync-write path** (`/sync/upload` writes no `audit_logs` → incomplete forensic trail).

### Ops (P1 tier)
- [L] **Postgres RLS** (defense-in-depth behind app-layer `scoped()`).
- [M] **Redis-backed rate limiting** (in-process resets per replica, covers only 5 public routes) + [M] **auth brute-force lockout/backoff**.
- [S] **Structured logging + request-id** · [S] **readiness/liveness** (health is static).
- [M] **arq worker retry/DLQ/supervision** · [M] **CD + migration gating** · [M] **PowerSync prod topology** (RS256/JWKS wired, TLS, isolated storage, replication-slot resilience) · [S] **dependency/security scanning** in CI.
- [S] **React error boundaries** (one render error white-screens the app).
- [M] **Data import / migrate-from-competitor** (biggest switching-cost reducer).
- [S] **Broaden push** to the events staff want (new booking, new message, cancellation).

---

## 🟢 M5 — Depth & growth (P2)

Standing backlog, pulled by demand — not a blocking milestone.

- **Growth/commerce:** multi-location (`parent_business_id` is fully dead) · memberships/loyalty/rewards ·
  waitlists + auto-promote · online store + inventory · online gift-card purchase + balance-check +
  apply-at-checkout.
- **Platform/scale:** public/developer API + keys + outbound webhooks (`webhook_events` is inbound-only) ·
  platform-admin (cross-tenant) role + support console · granular/custom permissions (`contractor` is
  cosmetic) · `businesses.status` suspend/offboard.
- **Feature depth:** subscription pause/resume/trial/plan-change · package auto-consume-on-booking + expiry
  wiring · cancellation policy + late-cancel fee · configurable/multiple reminders · calendar sync
  (Google/iCal) · group/class scheduling UI + roster + per-staff/travel buffers · conditional form fields +
  full validation · countersign/multi-party e-sign + draw-signature pad.
- **Tax/reporting depth:** place-of-supply (per-client province) · inclusive pricing · per-line exempt/
  override · compound-tax · rate-edit + remittance UI · ITCs/expenses → net profit · real T4A slip/e-file ·
  client statements · dunning cadence + subscription retry/auto-cancel · dispute lifecycle tracking.
- **Platform hygiene:** access-token revocation/jti denylist (de-provisioned staff keep access ≤15 min) ·
  retention/PII purge · metrics/tracing · slow-query/index/sync-rule perf audit · DB pool tuning ·
  blue-green/rollback · multi-currency (CAD hardcoded on create) · decide `custom_fields` (wire a builder or
  drop) · accessibility pass + jsx-a11y gate · offline-conflict UX · Stripe onboarding pending-verification detail.

---

## Execution order

### Decision gates (resolve before the phases they block)
| # | Decision | Blocks | Recommended default |
|---|---|---|---|
| D1 | **Hosting target** (Fly/Render/AWS/…) | prod deploy + PowerSync prod topology | a managed container host (Fly.io/Render) — smallest ops surface for a small team |
| D2 | **Interac provider** (real bank/aggregator vs manual-confirm) | Interac ingestion polish; the "wedge" claim | ship manual-confirm + reference-match now; true bank ingestion is M5 |
| D3 | **Client portal now or later** | Connect Phase 4 scope | defer the full portal to end of M4; do cheap self-serve cancel/reschedule first |
| D4 | **Compliance depth for launch region(s)** | CASL + export/RTBF | CASL consent + export/erasure are M3/early-M4 if launching in Canada |

### The two gates
1. **🚦 Launch-ready** — M3 + correctness done → safe to onboard real paying tenants.
2. **🚦 Complete product** — M4 done → competitive with the category incumbents on core.

### Sequencing
```
D1..D4 decisions
      │
  M3: security+correctness ─┐  (correctness before features — a broken tax split/timezone/refund multiplies cleanup)
      tax + catalog unblock ─┤ parallel tracks (mostly disjoint modules)
      consent + SMS tenancy ─┤
      deploy + observability ┘  ← needs D1
      │  [Launch-ready gate]
      │
  M4: payments · scheduling · CRM/messaging · docs/analytics/compliance · ops-P1   (parallel; portal last, per D3)
      │  [Complete-product gate]
      │
  M5 tracks (demand-pulled)
```
Every item follows the [engineering.md](engineering.md) conventions: layer-first, the 5 surfaces (invariant →
command), role gates match `WRITE_POLICY`, the 4-part test matrix + 90% coverage, a milestone audit at each
phase boundary, single-line commits → push → verify CI green.

---

## Connect — the customer experience

The customer-facing layer (booking, pay, forms, contracts, reviews + a future client portal), branded
**Connect**. Provider-facing config (brand editing) is in the provider app.

**Done (Phases 0–3):** name + cross-business-identity decisions · brand read+render (validated `PublicBrand`
+ shared `PublicFrame` + runtime `--accent` theming) · brand edit path in provider Account · the lean
`apps/connect` app (PowerSync-free, 232 KB vs web's 643 KB, no COEP so it embeds) with all five public pages
+ a per-business landing · the embed mechanism (`public/embed.js` web components + iframe + `postMessage`
resize/success + a config-driven CORS allowlist).

**Remaining:**
- **Phase 4 — authenticated client portal (cross-business).** The largest piece: a net-new **customer
  identity tier** (a `customers` account with magic-link/OTP, linked to the per-business `clients` rows via a
  claim flow), client-scoped reads fanning across a customer's businesses (appointments, invoices/payments,
  saved cards, package/sub balances, messages), and client-initiated writes (rebook, pay any open invoice,
  reply). The underlying business logic (`create_booking_core`, the `open_*` payment helpers, `file_service`)
  is already shared. **Risk:** a mis-linked account leaks one customer's data across businesses — the
  tenant-isolation invariant now spans *customer → many businesses*; consider a single-business slice first to
  de-risk the auth plumbing, then layer cross-business linking on top. *(Gated by D3.)*
- **Phase 5 — richness, PWA, white-label.** Richer pickers (real slot/calendar, multi-item cart), conditional
  forms, countersign (overlaps the M4 backlog); PWA install; custom domains + white-label (host-based tenant
  resolution + chrome removal); a mobile ThemeContext refactor only if a branded mobile preview is needed.
- **Public-edge hardening (do once, at the edge; overlaps M3/M4):** bot protection (Turnstile/CAPTCHA) on
  booking/pay `POST`s · Redis-backed rate limiting · token TTLs + aging · trustworthy client-IP · per-business
  `frame-ancestors` CSP + iframe `sandbox`.
