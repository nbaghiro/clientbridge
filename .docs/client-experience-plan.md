# Clientbridge — Client Experience Plan (the customer-facing surfaces)

The end-customer surfaces — booking, pay, forms, contracts, reviews, and a future client account — are
the second public face of the product (alongside the marketing site). This plan captures their current
state (from a 2026-07-02 three-part audit) and a phased path to a branded, embeddable, client-rendered
experience. The provider/admin app is out of scope here except where it edits customer-facing config.

## Working name
The provider product is **Clientbridge** ("the bridge between you and your clients"). The customer-facing
layer is the client's side of that bridge. Proposed umbrella name: **Connect** (Clientbridge Connect) —
covering the embeddable **widgets** and the **client portal**. Alternatives: **Bridge** (brand the
customer experience itself — "Powered by Bridge", removed under white-label) or **Frontdesk**. Decision
pending; "Connect" used below as a placeholder.

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
- **Client auth = magic-link/OTP, single-business first.** Start with a client logging into **one
  business's** portal (a login → that business's one `clients` row), which sidesteps the cross-business
  identity problem entirely; add a cross-business identity layer only if demand appears. Wire
  `clients.user_id`, add a `ClientPrincipal` + client-session issuance (can mirror the refresh-token
  families), and client-scoped-by-`client_id` reads.
- **Web/PWA for customers, not a native client app.** Customers get a responsive, installable web
  experience; the Expo app stays provider-only.

## Phased plan

### Phase 0 — Decisions
Name (Connect / Bridge / Frontdesk); single-business vs cross-business portal (recommend single-business
first); embed model (recommend snippet + iframe fallback); confirm web/PWA-only for customers.

### Phase 1 — Complete + fix the current surfaces *(days; immediate value, no new infra)*
- **Build the missing `PublicReview` page** + `/review/:token` route + `createPublicReviewClient`/
  `usePublicReview` hook — the backend and the notification link already exist and currently 404.
- Small correctness/polish on the four existing pages while they're open.

### Phase 2 — Lean, branded client bundle *(the big UX + perf win; prerequisite for widgets)*
- Split the client surfaces into their own bundle (no PowerSync, no admin pages, no COEP), reusing the
  `usePublic*` hooks + tokens.
- Wire `businesses.brand` end-to-end: editable in Account (+ logo upload), exposed in every public API
  context, rendered on the pages, and driving runtime CSS-var theming (the business's primary color).
- Result: fast, on-brand hosted client pages.

### Phase 3 — Embeddable widgets *(the "PocketSuite widgets" deliverable)*
- Production CORS allowlist (per-business origins).
- Embeddable JS snippet + web-component + iframe fallback (`postMessage` resize/success). "Book Now" /
  "Pay" / "Request review" embeds a business drops on its own site.
- Bot protection (Turnstile/CAPTCHA) on the booking/pay `POST`s; Redis-backed rate limiting; token TTLs +
  an aging job; trustworthy client-IP. (These are the M3/M4 hardening items, scoped to the public edge.)

### Phase 4 — Authenticated client portal
- Client identity + magic-link/OTP auth; `ClientPrincipal`; wire `clients.user_id` (single-business).
- Client-scoped reads: appointments (upcoming/past), invoices + payments, saved cards, package/
  subscription balances, message threads.
- Client-initiated actions: rebook (reuse `create_booking_core`), pay any open invoice (reuse
  `open_card_payment`, discovered by client not by `pay_token`), reply in messaging.
- Dedup hardening: normalize email/phone, reconcile the pay/form/review flows that today never touch
  client identity.

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
