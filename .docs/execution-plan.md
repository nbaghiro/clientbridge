# Clientbridge — Execution Plan

How to close the gaps in [`roadmap.md`](roadmap.md). That doc is **what's left** (M3/M4/M5 + correctness
bugs); this is the **order, grouping, and dependencies** to get there. Every item in `roadmap.md` is
covered by exactly one phase below; phase names cite the roadmap sections they drain.

## Guiding principles
- **Correctness before features.** Fix the silently-wrong things first — building on a broken tax split,
  wrong timezones, or a refund/payout money bug just multiplies the cleanup.
- **Ship in vertical increments.** Each phase is a small number of coherent, independently-shippable
  PRs (backend model→service/command→api→tests→`gen-api`, then web, then mobile — the established
  slice rhythm), not a big-bang.
- **Two hard gates.** (1) **Launch-ready** after M3 + correctness. (2) **Complete product** after M4.
  M5 is a standing backlog pulled by demand, not a blocking milestone.
- **Conventions apply to every item** (see `CLAUDE.md`): layer-first (thin router → service owns the
  txn → `scoped()` tenancy); the **5 surfaces** (server-only invariant → command, not sync-write);
  role gates match `WRITE_POLICY`; the **4-part test matrix** (happy · each 4xx · security/tenant ·
  idempotency) with the 90% branch-cov gate; the `no-inline-ui-string` lint rule for all UI copy;
  a **milestone audit** at each phase boundary; commit single-line imperative (no trailer) → push →
  verify CI green.

## Decision gates (resolve before the phases they block)
| # | Decision | Blocks | Recommended default |
|---|---|---|---|
| D1 | **Hosting target** (Fly/Render/AWS/…) | Phase 4 (prod deploy, PowerSync prod topology) | Pick a managed container host (Fly.io or Render) — smallest ops surface for a solo/small team |
| D2 | **Interac provider** (real bank/aggregator vs. manual-confirm) | Phase 3 Interac ingestion polish; the "wedge" claim | Ship manual-confirm + reference-match now; treat true bank ingestion as M5 |
| D3 | **Client portal now or later** (large, M4) | Phase 7 scope | Defer the full portal to end of M4; do the cheap self-serve cancel/reschedule (Phase 6) first |
| D4 | **Compliance depth for launch region(s)** | Phase 3 (CASL) + Phase 8 (export/RTBF) | CASL consent + export/erasure are M3/early-M4 if launching in Canada; softer if pilot-only |

---

## M3 — Launch blockers + correctness (the "can we ship to a paying user" gate)

Phases 1–4 can run as **parallel tracks** (they touch mostly disjoint areas); the ordering below is the
recommended critical path if done sequentially. Target: everything here is done before real users.

### Phase 1 — Security hardening + correctness bugs *(cheap, high-trust, no product deps — do first)*
Drains: roadmap **M3 Security & secrets** + **Correctness bugs**.
- **PR 1a — secure config:** fail-fast startup assertion that no secret is a dev default when `env!=dev`;
  prod CORS origin allowlist + TrustedHost + security headers (HSTS/CSP/X-Frame); real Twilio HMAC
  verification on inbound SMS (drop the static-secret compare). *Small; unblocks the prod web client.*
- **PR 1b — timezone correctness:** interpret `availability.start/end` in `business.timezone` across
  `open_windows`/`open_slots`/`is_within_availability`; DST-safe; golden tests per tz. *The biggest
  correctness fix — every non-UTC business is affected today.*
- **PR 1c — money/reporting correctness:** refund reverses its `PayoutAllocation`; GST/HST return
  splits by jurisdiction (persist the engine's per-jurisdiction breakdown, don't lump PST/QST);
  client `lifetime_value_cents` rollup on settlement + a backfill.
- **PR 1d — resource conflicts:** extend the overlap check **and** the GiST exclusion constraint to
  `(business_id, resource_id, time)`; add resource capacity. *(UI to manage resources is Phase 6.)*

### Phase 2 — Revenue unblock: tax + catalog *(two dead features come alive)*
Drains: roadmap **M3 tax toggle** + **catalog editor**.
- **PR 2a — tax on/off:** add `is_tax_registered` (+ small-supplier) to `BusinessSettingsUpdate` and a
  Tax-settings UI toggle; without it a live tenant collects zero tax.
- **PR 2b — full catalog editor:** expose `session_count`/`interval`/`frequency`/`deposit_*`/`capacity`/
  `validity_days` in the item form + DTOs, so package & subscription items are valid and sellable
  end-to-end. Wire `expires_at` from `validity_days` at purchase (activates the dead expiry sweep).

### Phase 3 — Compliance + messaging tenancy *(legal + cross-tenant correctness)*
Drains: roadmap **M3 CASL/consent** + **two-way-SMS tenancy**. (Gate D2/D4.)
- **PR 3a — consent/CASL:** consent model (per-channel opt-in/implied), unsubscribe link in email,
  SMS `STOP` handling, suppression list; gate `broadcast_recipients` + `notification_service` sends.
- **PR 3b — SMS tenancy:** per-business provisioned number + a number→business routing table; store the
  outbound Twilio SID in `provider_ref`; add the delivery-status callback route.

### Phase 4 — Prod deploy + observability *(gated by D1 hosting)*
Drains: roadmap **M3 Ops** + the deploy-shaped items from **M4 Ops**.
- **PR 4a — containers & server:** prod Dockerfiles (API + arq worker), gunicorn/uvicorn workers,
  supervised worker with retry/DLQ.
- **PR 4b — data safety:** Postgres + `powersync_storage` backups/PITR + a tested restore drill.
- **PR 4c — observability:** Sentry (server/web/mobile); structured logging + request-id; readiness/
  liveness probes.
- **PR 4d — pipeline:** CD workflow with migration gating; PowerSync prod topology (RS256/JWKS wired,
  TLS, isolated bucket storage, replication-slot resilience); dependency/security scanning in CI.

> **🚦 Gate: Launch-ready.** M3 + correctness done → safe to onboard real paying tenants.

---

## M4 — Completeness (the "real product, not an alpha" gate)

Grouped by domain; phases are **largely parallelizable**. Each is a sequence of vertical slices.

### Phase 5 — Payments completeness
Drains roadmap **M4 Payments & billing**: in-app take/record payment (saved card, partial, cash/cheque/
manual); partial + multiple refunds; **tips** (checkout + payout allocation); **discounts/promo codes**
(line+order, tax-correct); web card-present; payout splits for POS/tips/non-booking lines; invoice/
estimate/receipt **PDF**; Interac ingestion + stale-request expiry (per D2).

### Phase 6 — Scheduling completeness
Drains roadmap **M4 Scheduling**: recurring-series **edit/cancel/top-up cron/confirmation/detach** (the
M2 deferred follow-ups); **time-off/blackout/date-exception UI**; **resource management UI** (pairs with
Phase 1d's enforcement); **mobile calendar** week/month/staff parity; client self-serve cancel/
reschedule + an auto complete/no-show job.

### Phase 7 — CRM / messaging / reviews completeness
Drains roadmap **M4 CRM/messaging/reviews**: client **edit/delete + tags/status/custom-fields UI**;
**notes UI**; **subjects UI**; **client 360 view**; **merge/dedupe**; message **templates**; broadcast
depth (segmentation, recipient preview, no silent 500 cap, draft/cancel, retry/throttle); **review
gating/moderation** + real Google integration; **client portal** (large — per D3, do last in M4).

### Phase 8 — Docs / dashboard / analytics / compliance
Drains roadmap **M4 Documents/files + Dashboard/analytics + Compliance/audit**: signed-contract **PDF**;
file size/type limits + malware scan; Today **schedule section** + filing-due; **business analytics**
(trends, top services, retention, utilization, no-show rates); **data export**; **right-to-be-forgotten/
erasure/account deletion**; **audit the sync-write path**.

### Phase 9 — Remaining ops hardening (P1 tier)
Drains roadmap **M4 Ops**: **Postgres RLS** (defense-in-depth); **Redis-backed rate limiting** + auth
brute-force lockout; **React error boundaries**; **data import / migrate-from-competitor**; broaden
**push** (new booking / message / cancellation).

> **🚦 Gate: Complete product.** M4 done → competitive with a PocketSuite-class incumbent on core.

---

## M5 — Depth & growth (standing backlog, pull by demand)

Not sequenced; group into tracks and pull the highest-demand ones. From roadmap **M5**:
- **Growth/commerce:** memberships/loyalty · waitlists · online store + inventory · embeddable booking
  widget · online gift-card purchase + balance-check + ledger apply · discounts already in Phase 5.
- **Platform/scale:** multi-location (`parent_business_id`) · public/developer API + keys + outbound
  webhooks · platform-admin role + support console · granular/custom permissions · `businesses.status`
  suspend/offboard.
- **Feature depth:** subscription pause/resume/trial/plan-change · package auto-consume-on-booking ·
  cancellation policy + late-cancel fee · configurable/multiple reminders · calendar sync (Google/iCal) ·
  group/class scheduling UI + roster · conditional form fields + full validation · countersign/multi-
  party e-sign + draw pad.
- **Tax/reporting depth:** place-of-supply · inclusive pricing · per-line exempt/override · compound-tax ·
  rate-edit + remittance UI · ITCs/expenses → net profit · real T4A slip/e-file · statements ·
  dunning cadence + subscription retry/auto-cancel · dispute lifecycle tracking.
- **Platform hygiene:** access-token revocation/jti denylist · retention/PII purge · metrics/tracing ·
  slow-query/index/sync-rule audit · DB pool tuning · blue-green/rollback · multi-currency · decide
  `custom_fields` (wire a builder or drop) · accessibility pass + jsx-a11y gate · offline-conflict UX ·
  Stripe onboarding pending-verification/bank detail.

---

## Sequencing at a glance
```
D1..D4 decisions
      │
Phase 1 (security+correctness) ─┐
Phase 2 (tax+catalog) ──────────┤ parallel tracks
Phase 3 (consent+SMS tenancy) ──┤
Phase 4 (deploy+observability) ─┘  ← needs D1
      │
   [Launch-ready gate]
      │
Phase 5 (payments) ─┐
Phase 6 (scheduling)├ parallel; Phase 7 portal last (D3)
Phase 7 (CRM/msg)  ─┤
Phase 8 (docs/analytics/compliance) ┤
Phase 9 (ops P1)   ─┘
      │
   [Complete-product gate]
      │
M5 tracks (demand-pulled)
```

## Notes
- **Parallelism:** with more than one worker, Phases 1–4 and later 5–9 run concurrently since they touch
  mostly disjoint modules; the only ordering constraints are D1→Phase 4, Phase 1d→Phase 6 resource UI,
  and Phase 2b (catalog editor) before any package/subscription polish.
- **Also refresh the stale docs** (`product-plan.md`, `backend-plan.md`, `data-model.md`/`schema.md` say
  36 tables; live = 41) — a small housekeeping PR, best done alongside Phase 8.
</content>
