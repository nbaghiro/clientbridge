# Connect hosts QA

Run locally with `make dev-api`, `make dev-connect` and `make dev-web` over a seeded database, and open Connect on `*.localhost:8709` (no hosts file needed). On staging, replace `localhost:8709` with `staging.clientbridge.ca` once the cloud stack is applied and the branch is deployed.

## Business page

- [ ] `birchbark.localhost:8709` shows Birchbark's page: cover, services, team, hours, contact.
- [ ] Book on the page opens `book.localhost:8709/birchbark`; a service's time opens it with that service and time chosen.
- [ ] Shop on the page opens `shop.localhost:8709/birchbark`.
- [ ] The jump links (`#services`, `#team`, `#visit`, `#policies`) scroll on the same page.
- [ ] `missing-business.localhost:8709` shows the business-not-found page.

## Booking and visit pages (`book.`)

- [ ] `book.localhost:8709/birchbark` books a visit and then opens `/m/<token>`.
- [ ] The navigation's business name and Home link go to `birchbark.localhost:8709`.
- [ ] "Book again" on a past visit's page opens `book.localhost:8709/birchbark`.
- [ ] A form and a contract open from the visit page's to-do list, and from texted links.
- [ ] `book.localhost:8709/i/<token>` and `/b/birchbark/book` show page not found.

## Shop (`shop.`)

- [ ] `shop.localhost:8709/birchbark` lists the online products; the cart survives checkout and reload.
- [ ] A paid order opens `shop.localhost:8709/order/<token>`, and its receipt opens on `pay.`.
- [ ] The order texts link to `shop.localhost:8709/order/<token>`.

## Pay (`pay.`)

- [ ] Invoice, estimate and receipt texts link to `pay.localhost:8709/i/`, `/e/` and `/r/`.
- [ ] A bank account link sent from a client's profile opens `pay.localhost:8709/setup#token=…` and completes.

## Staff apps (web and mobile)

- [ ] Onboarding shows the slug with `.localhost:8709` after it; typing "Birch Bark" gives `birch-bark`.
- [ ] Business settings shows the web address. Changing it shows the warning, and saving moves the business page to the new subdomain.
- [ ] A slug that is too short, reserved (`shop`, `api`) or taken is refused with its own message.
- [ ] Get set up shares the business page. Today's quiet day shares the booking link.
- [ ] Online booking shows `book.localhost:8709/<slug>` and its QR code, and the embed snippet uses `<connect-booking>`.
- [ ] Products shows the shop link (with a QR code on web), and notes when no product sells online.

## Embeds

- [ ] `apps/connect/examples/embed-demo.html` shows the booking and shop widgets, and a pasted pay, form or contract token mounts its widget. Each resizes and reports `connect:success`.
- [ ] A page on `book.` other than booking, forms and contracts refuses to be framed, as do `shop.` order pages and every `pay.` page but invoices.

## Deployed only

- [ ] The bare `book.`, `shop.` and `pay.` redirect to the marketing site.
- [ ] A seeded business page (for example `birchbark.staging.clientbridge.ca`) loads with a valid certificate.
- [ ] `app.staging.clientbridge.ca` and the other named hosts still reach their own apps.
- [ ] The marketing site's demo links open each demo business's page.
