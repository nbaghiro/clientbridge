# Connect hosts

Status: implemented on `connect-hosts` (worktree `.scratchpad/connect-hosts`, based on `origin/main` at `2a5441af`), ready for QA. Follow the [QA checklist](qa.md).

Connect used to serve every page on `book.`, `pay.` and `shop.` alike, with business pages under `/b/<slug>`, and nothing linked to `shop.`. Each host now serves only its own pages, and each business has its own subdomain for its public page.

## URL scheme

| URL                                                                         | Page                                           |
| --------------------------------------------------------------------------- | ---------------------------------------------- |
| `<slug>.D`                                                                  | The business's public page, the link to share  |
| `book.D/<slug>`                                                             | Booking (`?service=`, `?staff=`, `?starts=`)   |
| `book.D/m/<token>`, `/form/<token>`, `/contract/<token>`                    | A visit, intake form and contract              |
| `shop.D/<slug>`, `/<slug>/checkout`, `/order/<token>`                       | The shop and a pickup order                    |
| `pay.D/i/<token>`, `/e/<token>`, `/r/<token>`, `/setup`                     | Invoice, estimate, receipt and bank setup      |

The bare `book.D`, `shop.D` and `pay.D` redirect to the marketing site, and any other path on a host is Connect's not-found page. There are no redirects from the old `/b/` paths, `pay.D/order/` or `book.D/payment-method`, since nothing outside development and staging has used them.

## Decisions

- **The public page gets the subdomain.** It is the business's identity and links out to booking and the shop, so it sits above `book.` and `shop.` rather than under one of them. Payment forms stay on `book.`, `shop.` and `pay.`, so no business subdomain needs registering with Stripe.
- **The slug is a DNS label.** 3 to 40 lowercase letters, digits or dashes, starting and ending with a letter or digit. Reserved: the environment hosts, the mail record names, Connect's root paths, a few names kept for our own pages, and anything containing `clientbridge`. `assert_public_slug` in `services/business.py` checks it and answers `slug_invalid` or `slug_reserved`; the existing unique index answers a taken slug with `slug_taken`, which also closes the check-then-insert race onboarding had.
- **Owners and admins can change the slug** in Business settings. The form warns that shared links and QR codes stop working. A change is audited and updates the Stripe account's business website. There is no history table for old slugs.
- **No schema change.** The rules live in the service. A database CHECK constraint on `businesses.slug` was proposed and not approved, so it is not part of this branch.
- **Host routing is one function.** `connectSite(origin, urls)` in app-core `runtime.ts` decides which site an origin serves, and Connect mounts only that site's routes. Links between sites are absolute and built from the runtime URLs.
- **Development runs the same routing.** Every `*.localhost` name reaches the Vite server on its own port, so `book.localhost:8709` and `birchbark.localhost:8709` work with no setup, and the e2e suites use the same names.

## What changed

- **Backend:** `BUSINESS_PAGE_URL` (`https://{slug}.D`), `BOOK_BASE_URL` (renamed from `CONNECT_BASE_URL`), `SHOP_BASE_URL` and `PAY_BASE_URL`, all derived from `BASE_DOMAIN`. Order links move to `shop.`, the bank setup link to `pay.D/setup`, and Stripe's business website to the business page. CORS adds every business page through `allowed_origin_regex()`. `PATCH /v1/business` takes `slug`.
- **Web image and infra:** `/config.js` carries `pageUrl`, `bookUrl`, `shopUrl` and `payUrl`. Caddy serves business pages on `*.{BASE_DOMAIN}`, redirects the bare Connect hosts, and sets framing per host. The cloud stack adds a wildcard A record and a `<env>-pages` Gateway listener; each environment stack adds a `pages` route. The deploy smoke test checks every host and a business page.
- **Staff apps:** Get set up shares the business page, onboarding shows the slug as `<slug>.D`, Business settings edits it, Products shows the shop link (with a QR code on web), and the embed snippet uses `<connect-booking>`.
- **Connect:** per-host routes, a host-derived slug (`useSlug`), absolute links between sites, and a `connect-shop` embed element. Each widget loads from its own host.

## Rollout

1. An administrator applies the cloud stack (`pulumi up --stack cloud`) for the wildcard records and the pages listeners. The environment deploy's smoke test opens a business page, so it fails until this is applied.
2. Merge. Staging deploys as usual. Production waits for its approval.
3. Existing staging Stripe accounts keep their old `book.D/b/<slug>` business website until the owner changes the slug. `scripts.payment_accounts` fills only an empty website, so it leaves them as they are.

## Deferred

- Server-rendered titles and link previews for business pages, and indexing them in production (logged in launch-readiness, Connect's deferred scope).
- Custom domains for business pages.
- Uptime checks for the Connect hosts. The `app.` check already covers the web pod, and the smoke test covers routing on each deploy.
