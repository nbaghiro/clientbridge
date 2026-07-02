# Clientbridge — Client Experience Plan (the customer-facing surfaces)

The end-customer surfaces — booking, pay, forms, contracts, reviews, and a future client account — are
the second public face of the product (alongside the marketing site). This plan captures their current
state (from a 2026-07-02 three-part audit) and a phased path to a branded, embeddable, client-rendered
experience. The provider/admin app is out of scope here except where it edits customer-facing config.

## Name — Connect (decided 2026-07-02)
The provider product is **Clientbridge**; the customer-facing layer is **Connect** (Clientbridge
Connect) — the umbrella for the embeddable **widgets** and the **client portal**. White-label removes
the "Powered by Connect" chrome.

## Current state (audited, cited)

**Five surfaces, four built.** `PublicBooking` (`/book/:slug`), `PublicPay` (`/pay/:token`),
`PublicForm` (`/form/:token`), `PublicContract` (`/contract/:token`) exist as React pages in `apps/web`.
The **review page is missing**: the backend serves `GET/POST /review/{token}` and notifications email
`{web_base_url}/review/{token}`, but there is no `PublicReview.tsx`, no `/review/:token` route, and no
client hook — so **review-request links currently 404**. (Bug, cheap fix.)

**Already client-rendered — nothing to de-server-render.** All surfaces are 100% CSR React (no SSR,
no prerender). The "instead of server-rendered" instinct is already satisfied; the real gaps are
**packaging, branding, and richness**, not the rendering model.

**But they ride the monolithic provider SPA.** The public routes live in the *same* `apps/web` bundle
as the entire admin app, statically imported, so a customer hitting `/book/{slug}` downloads the whole
provider SPA **and boots PowerSync/wa-sqlite** — none of which the public page uses. `vite.config.ts`
also sets COOP/COEP `require-corp` (for PowerSync's OPFS SQLite), which actively **fights iframe
embedding**. The public data layer itself is cleanly decoupled: plain REST clients + `usePublic*` hooks
in `@clientbridge/app-core`, **no PowerSync, no session** — reusable as-is.

**No embeddability.** No iframe/JS-snippet/web-component; the only share mechanism is hosted full-page
links from notifications. CORS is **dev-only localhost** — no production allowlist for business origins.

**Branding is dead end-to-end.** `businesses.brand` JSONB (`{logo_url, primary, tagline}`) is seeded but
**never editable (absent from `BusinessSettingsUpdate`), never sent to the public API (contexts carry
only `business_name`), and never rendered** — customers see the business *name* on stock **Pewter**
tokens. The token system has 6 themes in CSS but **no runtime theming seam** (nothing sets `data-theme`);
web tokens are CSS-variables (runtime-themeable once a seam exists), mobile bakes Pewter literals. No
custom domains, no white-label.

**Client identity/portal ≈ zero.** `clients.user_id` FK exists but is **never written or read**. There
is no client auth, session, or "my account" of any kind — the whole `Principal`/auth stack requires an
active `Staff` row (a provider). Dedup is per-business, loose (email-OR-phone, no normalization), and
only the booking flow dedups; the same person is **N client rows across N businesses**.

**Security posture (for embedding at scale).** Rate-limiting is **in-process** (per-instance, 30/min/IP,
`X-Forwarded-For` spoofable), **no CAPTCHA/bot protection**, tokens are ~128-bit but **never expire**
(no aging job), the Interac reference code is only 32-bit, and the booking `slug` is enumerable by design.

**The good news — business logic is already shared.** `create_booking_core`, the payment-open helpers
(`open_card_payment`/`open_interac_payment`/`open_booking_deposit`), the tax engine, and `file_service`
uploads are reused by both the authed provider path and the public path. **A portal and widgets need the
identity/auth/scoped-read + packaging + branding tiers — not a logic rewrite.**

## Vision — three pillars

1. **Branded, embeddable client widgets.** Booking, pay, forms, contracts, reviews — each a lean,
   client-rendered React widget that (a) reflects the business's brand (logo, colors, tagline), (b)
   embeds in the business's own website (a JS snippet that mounts the widget, with an iframe fallback for
   isolation), *and* works as a hosted, deep-linkable page, (c) is great on mobile browsers (responsive,
   PWA-installable). All reuse the existing `usePublic*` REST hooks.
2. **Authenticated client portal.** A persistent "my account" where a customer logs in (magic-link/OTP —
   customers won't set passwords) to see upcoming/past appointments, invoices + payment history, saved
   cards, package/subscription balances, rebook, and message the business. Reuses the shared server
   logic; adds the new client-identity + client-scoped-read tier.
3. **Per-business theming → custom domains / white-label.** The brand drives the look at runtime;
   eventually a business serves the experience on its own domain with Clientbridge chrome removed.

## Architecture decisions (the forks, with recommendations)

- **Keep CSR React; split into a lean client bundle.** Do *not* server-render. Instead give the client
  surfaces their own Vite entry / build target (a small `apps/client`, or a second input in `apps/web`)
  with **no PowerSync, no provider pages, and the COEP header dropped** — so a customer downloads tens of
  KB, not the whole admin app. This is the single highest-leverage change and the prerequisite for
  everything else. The `usePublic*` hooks move/stay in `app-core` and are imported by both.
- **Ship both hosted pages and embeds.** Hosted deep-linkable pages (as today, but lean + branded) for
  links/QR, plus an **embeddable snippet** (`<script>` mounts a widget; iframe fallback for CSS/COEP
  isolation) with `postMessage` for auto-resize and success events.
- **Wire `businesses.brand` end-to-end.** Editable in Account (+ logo upload via the existing
  `file_service`) through the server-authoritative command path (`businesses` is not sync-writable),
  exposed in every public context, rendered, and driving runtime CSS-variable theming on web (override
  `--accent`/`--primary`). Mobile theming refactor is deferred (customers have no mobile app).
- **Client auth = magic-link/OTP, cross-business from day one (decided).** One login represents a
  *person* who may be a customer of many businesses, so the portal needs a **`customers` identity layer
  above the per-business `clients` rows**: a customer account (verified email/phone) linked to N
  `clients` rows (one per business). Wire `clients.user_id` (or a `clients.customer_id` FK to the new
  identity table), add a `ClientPrincipal`/`CustomerPrincipal` + magic-link/OTP session issuance
  (mirroring the refresh-token families), client-scoped-by-`client_id` reads that fan out across the
  customer's linked businesses, and a **link/claim flow** (a customer proves ownership of an email/phone
  → claims the matching `clients` rows across businesses). This is the largest single piece of the plan
  — see the dependency + risk note under Phase 4.
- **Web/PWA for customers, not a native client app.** Customers get a responsive, installable web
  experience; the Expo app stays provider-only.

## Phased plan

### Phase 0 — Decisions ✅ (2026-07-02)
Name = **Connect**. Portal identity = **cross-business from day one** (customer identity layer over
per-business client rows). Embed model = snippet + iframe fallback. Customers = web/PWA (no native app).

### Phase 1 — Complete + fix the current surfaces *(days; immediate value, no new infra)*
- **Build the missing `PublicReview` page** + `/review/:token` route + `createPublicReviewClient`/
  `usePublicReview` hook — the backend and the notification link already exist and currently 404.
- Small correctness/polish on the four existing pages while they're open.

### Phase 2 — Lean, branded client bundle *(the big UX + perf win; prerequisite for widgets)*
- ✅ **Brand read+render** (`bc2bd0c`): validated `PublicBrand` on all 5 public contexts + a shared
  `PublicFrame` rendering logo/tagline + runtime `--accent` theming across the 4 pages.
- ✅ **Brand edit path** (`f4899aa`): editable in provider Account (logo URL, colour picker, tagline)
  via `BrandInput` (validated) on `BusinessSettingsUpdate`. Logo *file upload* deferred — needs
  durable public file serving (today's file URLs are short-lived presigned).
- ✅ **New app `apps/connect`** (`c90fb15` carve-out, `68567d4` app) — customer surfaces now in
  their own lean Vite app (port 8709, no COEP, no PowerSync). Bundle 232 KB vs web's 643 KB;
  verified PowerSync-free. Includes the previously-missing **Review page** (Phase-1 404 fixed).
  Backend `connect_base_url` repoints the customer notification links. Remaining: production
  deploy/hosting wiring for the new origin (environment-specific).
  - **Separate app, not a 2nd Vite entry** — its own origin/deploy so it can drop the COEP
    `require-corp` header (`apps/web` needs it for PowerSync OPFS; it fights embedding + logos).
  - No PowerSync, no provider pages, no auth gate. Port 8710 (confirm vs `.docs/ports.md`).
  - Holds the 5 public pages (Booking/Pay/Form/Contract + the **new Review** page, folding in the
    Phase-1 404 fix) + a connect-local `PublicFrame`.
  - **Sharing = packages only, never app→app.** Reuses `@clientbridge/app-core` (public subset),
    `@clientbridge/tokens`, `@clientbridge/config`. The heavy PowerSync drivers (`@powersync/web`,
    `wa-sqlite`) already live in `apps/web/lib`, not `app-core`, so Connect gets the lean bundle by
    simply not importing `apps/web`.
  - **`StatusPill` + `CardConfirm` are duplicated into Connect** (decided) — small, stable; no shared
    UI package, no provider churn.
  - **Carve `@clientbridge/app-core/public`** (decided) — a PowerSync-free subpath barrel. Extract the
    public form/contract clients out of the mixed `forms.ts`/`contracts.ts` into `publicForm.ts`/
    `publicContract.ts`; move payment-display helpers (`payMethods`, `invoiceStatusIntent`) into
    `publicPay.ts`; add `publicReview.ts`. Guarantees zero PowerSync in the Connect bundle.
  - Backend: add `connect_base_url`; repoint the customer notification links (`/pay`, `/form`,
    `/contract`, `/review`) to it.
- Result: fast, on-brand, embeddable-ready hosted client pages.

### Phase 3 — Embeddable widgets *(the "PocketSuite widgets" deliverable)*
- ✅ **Embed mechanism** (`c60a8a6`): `public/embed.js` registers `<connect-booking|pay|form|contract|
  review>` web components; each mounts the matching Connect page in an `<iframe>?embed=1`,
  auto-resizes via `postMessage`, and emits a bubbling `connect:success` DOM event. Connect has an
  embed mode (compact, transparent, height-reporting). A bare `<iframe>` works as the no-JS fallback.
  Config-driven CORS allowlist (`cors_allow_origins`) so the prod Connect origin can reach the public
  API. Cross-origin QA harness at `apps/connect/examples/embed-demo.html`.
- **Deferred hardening** (before wide production): bot protection (Turnstile/CAPTCHA) on booking/pay
  `POST`s; Redis-backed rate limiting; token TTLs + aging; trustworthy client-IP; per-business
  `frame-ancestors` CSP + iframe `sandbox`. (M3/M4 public-edge items — do once.)

### Phase 4 — Authenticated client portal (cross-business)
The largest piece — a net-new **customer identity tier** (the business logic underneath is already
shared). Sub-steps, roughly ordered:
1. **Identity + auth.** A `customers` account (verified email/phone) + magic-link/OTP session +
   `CustomerPrincipal`. Link a customer → the per-business `clients` rows they own (via a
   `clients.customer_id` FK, backfilled by a claim flow).
2. **Dedup + normalization (prerequisite for correct linking).** Normalize email/phone on `clients`;
   reconcile the pay/form/review flows that never touch client identity today; a claim flow where a
   customer proves an email/phone and adopts the matching `clients` rows across businesses.
3. **Client-scoped reads** (scoped by the customer's linked `client_id`s, fanning across businesses):
   appointments (upcoming/past), invoices + payments, saved cards, package/subscription balances,
   message threads — all net-new read services over existing data.
4. **Client-initiated writes:** rebook (reuse `create_booking_core`), pay any open invoice (reuse
   `open_card_payment`, discovered by customer not by `pay_token`), reply in messaging.
5. **Session security:** revocation, TTLs, CSRF for the cookie/session surface (the token pages don't
   need it, a logged-in portal does).

**Risk / cost note:** cross-business identity is materially larger than a single-business portal —
the fan-out reads, the claim/link flow, and dedup reconciliation are the bulk of the work, and a
mis-linked account leaks one customer's data across businesses, so this phase needs its own security
pass (the tenant-isolation invariant now spans *customer → many businesses*, not just one business).
Consider shipping a **single-business slice first internally** (one login, one business) to de-risk the
auth/session plumbing, then layer the cross-business linking on top — same end state, safer path.

### Phase 5 — Richness, PWA, white-label
- Richer pickers (real slot/calendar, multi-item cart), conditional forms, countersign (overlaps the M4
  completeness backlog). PWA install. Custom domains + white-label (host-based tenant resolution + chrome
  removal). Mobile ThemeContext refactor only if a branded mobile preview is needed.

## Sequencing notes
- **Phase 1 is independent** and shippable immediately (fixes a live 404).
- **Phase 2 gates Phase 3** (widgets need the lean, brandable bundle first).
- **Phase 4 (portal) is independent of 2–3** and can run in parallel — its cost is a new identity/auth
  tier, not touched by the widget packaging work.
- Phase 3's hardening (CORS, bot protection, Redis rate-limit, token TTLs) overlaps the M3/M4 launch
  hardening in `roadmap.md` — do it once, at the public edge.
</content>
