# Clientbridge — Gap-closure Roadmap / Backlog

Authoritative "what's left" list. Produced 2026-07-01 by a six-domain code audit (scheduling/booking ·
billing/payments · CRM/messaging/reviews · catalog/subs/docs/dashboard · Phase-9 hardening ·
unwired-model/product). This **supersedes** the stale slice/phase status in `product-plan.md` (only
Slice 1 ticked) and `backend-plan.md` (only Phases 0–2 ticked) for the question "what's remaining."

## Baseline — what's already built (do not re-chase)
Backend Phases 0–8 + M1 + M2-slice-1 are done and verified end-to-end: clients → catalog → scheduling →
bookings (incl. **recurring series**) → invoices/estimates → payments/payouts → Stripe Connect (Custom,
KYC sync, direct charges, saved cards, deposits, refunds full-amount), **mobile Tap-to-Pay** (real
Terminal SDK), POS/Terminal orders, packages/subscriptions/gift-card sale+redeem, Interac request+match,
public pay/book/form/contract/review token pages, forms/contracts/e-sign (text snapshot + IP + audit),
reviews + review-request cron, broadcasts (scheduled fan-out), team invites/roles, inbound SMS→thread,
6 arq crons (reminders/reap-unpaid/broadcasts/overdue-sweep/maintenance/review-requests), **mobile push**
registration, webhook idempotency (Stripe signature verified), refresh rotation + reuse-detection, RS256/
JWKS path, i18n string catalog (English), income/GST-HST/T4A reports + CSV, 3 dashboard KPIs.

## Legend & milestones
`[S/M/L]` = rough size. Priority is encoded by section:
- **M3 — Launch blockers (P0):** cannot ship to real paying users without these.
- **Correctness bugs:** silently wrong today; fix ASAP regardless of milestone.
- **M4 — Completeness (P1):** needed to be a real, complete product (not just an alpha).
- **M5 — Depth & growth (P2):** toward a mature PocketSuite-class OS.

---

## 🔴 M3 — Launch blockers (P0)

### Security & secrets
- [S] **Fail-fast on default secrets in prod.** `config.py` ships `jwt_secret="clientbridge-dev-secret-do-not-use-in-prod"` (also committed in `powersync.yaml`); app access tokens always sign HS256 with it. A deploy that forgets to override silently runs on a public key → token forgery. Add a startup assertion that all secrets are non-default when `env!=dev`.
- [S] **Prod CORS + security headers.** `main.py` adds CORS only when `env=='dev'`, so the prod web app (separate origin) can't call the API at all; no HSTS/CSP/X-Frame/TrustedHost. Add a prod origin allowlist + baseline headers.
- [S] **Verify the real Twilio HMAC on inbound SMS.** `webhooks.py` compares a static shared secret, not Twilio's request signature — spoofable, and won't work against real Twilio. (Interac uses the same static-secret pattern; revisit when a real provider lands.)

### Ops / deploy
- [M] **Production containers.** `infra/docker/` is empty; `dev-api` is uvicorn `--reload`. Need a prod API image + arq-worker image + prod server (gunicorn/uvicorn workers) + process manager.
- [M] **DB backups + restore drill.** No backup/PITR for Postgres or `powersync_storage`; data (money + PII) is unrecoverable.
- [S] **Error tracking (Sentry/Rollbar).** No capture/alerting on server, web, or mobile — prod failures are invisible.

### Functional-completeness blockers
- [S] **Make tax collection enable-able.** `is_tax_registered` defaults False and is only set in the seed; it's absent from `BusinessSettingsUpdate` and onboarding. A live tenant collects **zero tax** with no way to turn it on — neuters the core Canadian-tax value prop.
- [M] **Catalog editor exposes the full item shape.** The form posts only 5 of ~20 fields, so `session_count`/`interval`/`frequency`/deposit/capacity/validity can't be set — and `package_service`/`subscription_service` hard-raise without them. **Packages and subscriptions are unsellable end-to-end** until this is wired.
- [L] **CASL/consent + opt-out.** The `consents` table was dropped; broadcasts blast every active client with no consent record, no unsubscribe link, no SMS STOP handling, no suppression list. Legal blocker for the marketing/broadcast feature in-region.
- [L] **Two-way-SMS tenancy.** One global Twilio number shared across all businesses; inbound routes by matching client phone across tenants ("pick oldest" on collision). Needs per-business provisioned numbers + a number→business routing table, else cross-tenant leakage.

---

## 🟠 Correctness bugs — ✅ ALL FIXED (2026-07-02)
- ✅ **Availability ignored business timezone.** Now interpreted in `business.timezone` (`is_within_availability` + `open_slots`), DST-safe, with a regression guard. (`d50e44c`)
- ✅ **Refund didn't reverse the payout allocation.** `_reconcile_invoice` now removes pending, not-yet-paid-out booking allocations when a refund drops the invoice below fully-paid. (`5f03709`)
- ✅ **GST/HST return conflated PST/QST.** The report now apportions each paid row's tax by the active rate ratio; `tax_collected_cents` is federal-only, with separate `pst_cents`/`qst_cents` (web + mobile show them). (`76e4bae`)
- ✅ **Client lifetime value was always $0.** `_recompute_client_ltv` now rolls it up from settled payments (minus refunds) at every settle/refund point, plus a backfill migration. (`5f03709`)
- ✅ **Resources weren't conflict-checked.** `create_booking_core` now rejects an overlapping same-resource session, backed by a GiST exclusion constraint. (`cd2b39f`)

---

## 🟡 M4 — Completeness (P1)

### Payments & billing
- [M] **Take/record payment in-app.** No UI hits `POST /payments/invoice/{id}` — can't charge a saved card, take a partial/deposit, or record cash/cheque/manual e-Transfer; payment only happens via the public link.
- [M] **Partial & multiple refunds.** Backend refunds the full amount only; one-refund-per-payment unique index; UI sends no amount.
- [M] **Tips.** No tip capture at any checkout (card/Terminal/pay-link) and no tip payout, though `payout_allocations` has a `tip` source and the UI labels it.
- [M] **Discounts / promo codes.** No line- or order-level discount, no coupon model — anywhere.
- [M] **Web POS card-present.** Web reader panel is a stub ("not wired in this build"); only mobile Tap-to-Pay works. Also: resume held orders into the cart; no physical-reader (WisePOS/BBPOS) discovery.
- [M] **Interac ingestion + lifecycle.** Match logic exists but there's no real bank/Interac provider ingestion, no stale-request expiry (holds invoice "room" forever), no surplus handling; the authed per-invoice Interac request has no UI.
- [M] **Payout splits beyond bookings.** Only booking lines allocate; POS sales, tips, and non-booking invoice lines never credit staff.
- [M] **Invoice/estimate/receipt PDF.** No printable/downloadable document; clients get only a web link.

### Scheduling & booking
- [M] **Recurring-series lifecycle (M2 deferred follow-ups):** edit-series, cancel-series, rolling-window top-up cron for unbounded series (hard-caps at 60 today), a single "series booked" confirmation (series create sends none), explicit detach-occurrence.
- [M] **Time-off / blackout / date-exception UI.** Backend fully supports `type='date'` overrides; the only editor writes the weekly recurring grid — no way to mark a vacation/holiday/one-off-hours day.
- [M] **Resource management UI + conflict enforcement.** (Also the correctness bug above — needs a create/list/pick UI plus resource-aware slotting.)
- [M] **Mobile calendar parity.** Mobile has only agenda/day; web has day/week/month/staff. Shared helpers exist; mobile doesn't render week/month/staff.
- [M] **Client self-service + lifecycle jobs.** Public clients can't cancel/reschedule their own booking; no cron auto-marks past bookings completed/no-show (stale "confirmed" leaks reporting + un-forfeited no-shows).

### CRM / messaging / reviews
- [M] **Client edit/delete UI + tags/status/custom fields.** Backend accepts them; the app is add-only with name/email/phone. Tags are the only broadcast segment input yet can't be set.
- [M] **Notes UI.** `notes` is modeled, synced, and write-authorized — no screen or hook.
- [M] **Subjects UI** (pets/vehicles/children/property). Modeled + synced + `bookings.subject_id` — no UI (vertical differentiator, unreachable).
- [M] **Client 360 view.** Detail shows only payment methods/subs/packages; no booking/invoice/message/note history.
- [L] **Client merge/dedupe.** Duplicates accumulate (online booking OR-match, inbound SMS phone-match, manual) with no combine.
- [M] **Message templates / merge fields / quick replies.** Compose + broadcast are free-text only.
- [M] **Broadcast depth.** Real segmentation (status/LTV/recency/service/subject, not just tags), pre-send recipient preview, and no silent 500-recipient truncation; draft/edit/cancel a scheduled broadcast; retry/throttle on delivery.
- [M] **Review gating/moderation.** Submissions auto-publish regardless of rating (a 1-star goes public instantly); "send to Google" is an unwired flag with no real GBP/Facebook integration.
- [L] **Client-facing portal.** `clients.user_id` is unused; every client interaction is a one-shot emailed token page. No login, history, rebook, invoice list, or messaging.

### Documents / files
- [M] **Signed-contract PDF** (with audit block) for both parties; text-only snapshot today.
- [M] **File upload limits.** No server-enforced max size / content-type allowlist / malware scan on uploads, including the unauthenticated token-gated form/contract upload surfaces.

### Dashboard / analytics
- [S] **Today page: add today's-schedule section + surface the GST filing-due date** (both absent from the hero screen).
- [L] **Business analytics.** Reporting is CRA-compliance-only; no revenue trends, top services, new-vs-returning, retention/churn, utilization, or no-show/cancellation rates.

### Compliance / audit
- [M] **Data export** (PIPEDA/Law 25 subject access + portability). None.
- [L] **Right-to-be-forgotten / erasure / account deletion.** Only soft-delete exists; PII (incl. in PowerSync bucket storage) persists forever.
- [M] **Audit the sync-write path.** Command services write `audit_logs`; the `/sync/upload` PUT/PATCH/DELETE path (clients, notes, availability, messages…) writes none → incomplete activity feed / forensic trail.

### Ops (P1 tier)
- [L] **Postgres RLS** (per-request `SET LOCAL` + `business_id WITH CHECK`) as defense-in-depth behind app-layer `scoped()`.
- [M] **Rate limiting for real.** In-process limiter (resets per replica) covering only 5 public routes; move to Redis and cover auth + commands.
- [M] **Auth brute-force lockout / backoff** on login/refresh/forgot-password.
- [S] **Structured logging + request-id correlation;** [S] **readiness/liveness** checks (health is static, doesn't touch PG/Redis/PowerSync/S3).
- [M] **arq worker: retry/DLQ/supervision** + a supervised prod worker process; [M] **CD + migration gating;** [M] **PowerSync prod topology** (RS256/JWKS wired, TLS, isolated storage, replication-slot resilience); [S] **dependency/security scanning** in CI.
- [S] **React error boundaries** (web + mobile) — one render error white-screens the app today.
- [M] **Data import / migrate-from-competitor** (clients/services/history CSV) — biggest switching-cost reducer.
- [S] **Broaden push** to the events staff want (new booking, new message, cancellation).

---

## 🟢 M5 — Depth & growth (P2)

- [L] **Multi-location** (`parent_business_id` is fully dead — no hierarchy/switcher/cross-location reporting).
- [L] **Memberships / loyalty / rewards** (points, tiers, member pricing, referrals).
- [M] **Waitlists** for full slots/classes + auto-promote when a hold is reaped.
- [L] **Online store** — public product catalog/cart/checkout + **inventory** (products are POS-only, no stock tracking).
- [M] **Embeddable booking widget** (only a hosted `/book/{slug}` page today).
- [L] **Public/developer API + API keys + outbound webhooks** (`webhook_events` is inbound-only).
- [M] **Platform-admin (cross-tenant) role + support console;** [M] **granular/custom permissions** (`contractor` role is currently cosmetic — same perms as `staff`).
- [M] **Subscription pause/resume/trial/plan-change** (`paused`/`trial_end_at` unreachable); **package auto-consume on booking** + **expiry wiring** (`expires_at` never set → expiry sweep is dead).
- [M] **Gift cards: online purchase + balance check + apply-at-checkout** (redemption is a bare balance decrement, disconnected from the ledger — no `method='gift_card'` payment) + expiry.
- [M] **Cancellation policy + late-cancel fee;** [M] **configurable/multiple reminders** (single fixed 24h today).
- [L] **Calendar sync** (Google/iCal export feed + external-busy import).
- [M] **Group/class scheduling UI + roster** (classes are lazily created on first booking; no published empty class); **per-staff/travel buffers**.
- [M] **Forms: conditional/branching fields + full server-side validation** (only `required` is enforced); **contracts: countersign/multi-party + draw-signature pad** (signing can succeed with neither typed name nor image).
- [M] **Tax depth:** place-of-supply (per-client province), inclusive pricing, per-line exempt/override, compound-tax support, rate-edit + registered/small-supplier UI, remittance-summary UI.
- [L] **Reports:** ITCs/expenses → net profit, real T4A slip (box 048)/CRA e-file, client statements.
- [M] **Dunning cadence** (day 7/14/30) + subscription retry/card-update prompt/auto-cancel; **dispute lifecycle** tracking (record, funds-on-hold, evidence, won/lost) + `payout.failed`/`payment_intent.processing` handlers.
- [S] **Access-token revocation / jti denylist** (de-provisioned staff keep access up to 15 min); [M] **retention/PII purge;** [M] **metrics/tracing;** [M] **slow-query/index/sync-rule perf audit;** [S] **DB pool tuning;** [M] **blue-green/rollback.**
- [M] **Multi-currency** (CAD hardcoded on create despite a currency column); [S] **`businesses.status` suspend/offboard** for the product's own SaaS dunning; [S] **decide `custom_fields`** (wire a field-builder or drop the vestigial jsonb columns); [M] **accessibility pass** + jsx-a11y gate; [M] **offline-conflict UX** (sync is last-write-wins with no surfacing); [S] **Stripe onboarding:** surface pending-verification + payout-bank detail.

---

## Housekeeping
- **Refresh the stale docs** (deferred; separate task): `product-plan.md` (only Slice 1 ticked), `backend-plan.md` (only Phases 0–2 ticked), and `data-model.md`/`schema.md` (say 36 tables; live schema is **41** — adds `orders`, `device_tokens`, `idempotency_keys`, plus columns like `businesses.stripe_charges_enabled`/`kyc_status`, `items.stripe_price_id`, `bookings.deposit_status`/`reminded_at`, `invoices.pay_token`).
</content>
</invoke>
