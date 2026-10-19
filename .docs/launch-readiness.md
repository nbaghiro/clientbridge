# Launch readiness

The work between today and the finished product, as seven stages in order. Each stage is a state of the product, written as what a business can do, and it is done when its QA pass runs clean on web, iPhone and Android, as the owner and as staff. The stories in a stage are the flows that get it there. Work through the stages in order; the last step of stage 7 is the final release pass.

This file is the source of truth for every ticket. Each story below has its full description, in the same text as its Linear issue. Linear is the tracker: https://linear.app/clientbridgeca/initiative/launch-2e6ce8efe3c9, where each stage is a project closed by its QA pass milestone and dependencies are blocks relations. Size: S is up to two days (estimate 1), M up to a week (3) and L more than a week (5).

## Keeping Linear in sync

- This file comes first. A new story is written here, under its stage, in the layout below: the heading `### <Title> (CLI-n)`, a line with its size and area, then When this is done, Surfaces, Flow, Built, To do, QA and Depends on. When this is done is the story's done-when line.
- Then the story is created in Linear with the same title and description, in its stage project and that stage's QA pass milestone, with its Area label, its estimate and a blocks relation from each story it depends on. Its `CLI-n` key goes back into the heading and the stage table.
- Status lives in Linear. When work ships, the Built and To do lines are updated here first and copied to Linear.
- A periodic check compares this file with Linear: titles, descriptions, stage, area, estimate and dependencies. Drift is fixed in Linear from this file, not the other way round.
- Linear is changed through its GraphQL API with `linear --workspace clientbridgeca api '<query>' --variables-json '<json>'`. A dependency is `issueRelationCreate` with type `blocks`, from the prerequisite (`issueId`) to the story that depends on it (`relatedIssueId`). Priority is not used.

| Stage                           | Story                                                          | Linear | Size |
| ------------------------------- | -------------------------------------------------------------- | ------ | ---- |
| 1. Get set up                   | Sign-up, sign-in and password reset                            | CLI-5  | S    |
| 1. Get set up                   | Onboarding, business profile and branding                      | CLI-6  | S    |
| 1. Get set up                   | Team invites and roles                                         | CLI-7  | S    |
| 1. Get set up                   | Stripe connect and payout status                               | CLI-8  | S    |
| 1. Get set up                   | Tax registration and per-item tax classes                      | CLI-9  | M    |
| 1. Get set up                   | Plan subscription, trial and billing                           | CLI-10 | L    |
| 2. Load clients and the catalog | Client records: add, edit, archive, search                     | CLI-11 | S    |
| 2. Load clients and the catalog | Pets, students and properties on clients                       | CLI-12 | M    |
| 2. Load clients and the catalog | Notes and client history timeline                              | CLI-13 | M    |
| 2. Load clients and the catalog | Saved cards and bank accounts                                  | CLI-14 | S    |
| 2. Load clients and the catalog | Tags and duplicate merging                                     | CLI-15 | M    |
| 2. Load clients and the catalog | Services and classes: duration, buffers, capacity, deposits    | CLI-16 | S    |
| 2. Load clients and the catalog | Products: SKU, cost, price, images (web and mobile)            | CLI-17 | M    |
| 2. Load clients and the catalog | Stock tracking, low stock and restock                          | CLI-18 | S    |
| 2. Load clients and the catalog | Packages, memberships and gift card items                      | CLI-19 | S    |
| 3. Book and complete a visit    | Staff hours, time off and closures                             | CLI-20 | M    |
| 3. Book and complete a visit    | Calendar: create, move, cancel, complete, no-show              | CLI-21 | M    |
| 3. Book and complete a visit    | Recurring bookings                                             | CLI-22 | M    |
| 3. Book and complete a visit    | Classes                                                        | CLI-23 | M    |
| 3. Book and complete a visit    | Reminders and end-of-day completion                            | CLI-24 | S    |
| 3. Book and complete a visit    | Booking page with deposits and embedding                       | CLI-25 | S    |
| 3. Book and complete a visit    | Booking add-ons                                                | CLI-26 | S    |
| 3. Book and complete a visit    | Client self-service cancel and reschedule                      | CLI-28 | M    |
| 4. Get paid                     | Online shop and pickup orders                                  | CLI-27 | M    |
| 4. Get paid                     | Sales with services and products                               | CLI-29 | S    |
| 4. Get paid                     | Card and Tap to Pay checkout with receipts                     | CLI-30 | M    |
| 4. Get paid                     | Interac debit on Tap to Pay                                    | CLI-31 | M    |
| 4. Get paid                     | Tips at checkout                                               | CLI-32 | M    |
| 4. Get paid                     | Discounts                                                      | CLI-33 | M    |
| 4. Get paid                     | Estimates: create, send, accept, convert                       | CLI-34 | S    |
| 4. Get paid                     | Invoices: create, send, void, pay link                         | CLI-35 | S    |
| 4. Get paid                     | Recording payments in the app                                  | CLI-36 | M    |
| 4. Get paid                     | PDF invoices, estimates and receipts                           | CLI-37 | M    |
| 4. Get paid                     | Packages, memberships and gift cards: sell, use, renew, expire | CLI-38 | M    |
| 4. Get paid                     | Refunds and chargebacks                                        | CLI-39 | S    |
| 5. See the money                | Today dashboard                                                | CLI-40 | S    |
| 5. See the money                | Reports: income, sales by item, GST/HST, T4A                   | CLI-41 | S    |
| 5. See the money                | Tax returns and remittance                                     | CLI-42 | S    |
| 5. See the money                | Stripe reconciliation, fees and payouts                        | CLI-43 | S    |
| 5. See the money                | Staff pay: earnings, approval, payment                         | CLI-44 | M    |
| 6. Talk to clients              | Two-way inbox with a text number per business                  | CLI-45 | L    |
| 6. Talk to clients              | Broadcasts with consent and opt-out                            | CLI-46 | L    |
| 6. Talk to clients              | Google review invitations                                 | CLI-47 | M    |
| 6. Talk to clients              | Intake forms                                                   | CLI-48 | S    |
| 6. Talk to clients              | Contracts, signing and signed PDFs                             | CLI-49 | M    |
| 7. Go live                      | Production hosting, deploys and security                       | CLI-50 | L    |
| 7. Go live                      | Backups, monitoring and alerts                                 | CLI-51 | M    |
| 7. Go live                      | iPhone and Android store release                               | CLI-52 | M    |
| 7. Go live                      | Marketing site launch                                          | CLI-53 | S    |
| 7. Go live                      | Final release QA and sign-off                                  | CLI-54 | M    |

---

## 1. Get set up

Done when: A business can sign up, set up its profile, invite staff, connect Stripe, switch on tax and pick a plan.

QA pass:

1. From the marketing site, sign up with a new email and enter the emailed code; sign out and back in on web, iPhone and Android, then with Google and with an authenticator code.
2. Finish onboarding, set the colour, tagline and logo, and check that the booking, pay and shop pages use them.
3. Invite a staff member and an admin; as staff, see only your own bookings and hours, and have a refund, a void and editing another member's hours refused.
4. Connect Stripe with the test identity until the status reads ready, then take a $10 test card payment.
5. Switch on tax for an Ontario business: a $100 invoice charges $13 HST and an exempt line charges nothing.
6. Check the 14-day trial, subscribe to Premium yearly, and see the seat count rise when a staff member joins.

Run it in order on one business, on web, iPhone and Android, as the owner and again as staff where the steps involve roles.

### Sign-up, sign-in and password reset (CLI-5)

Size: S · Area: Accounts and settings

**When this is done:** A new owner gets in and back in on every platform without help.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** A new owner signs up, verifies their email, signs out and back in, resets a forgotten password, signs in with Google and turns on two-step verification.

**Built:** the auth service, self-hosted Ory Kratos, for email and password, email verification and recovery codes, Google sign-in, authenticator apps, backup codes and security keys (web), and the Sign-in & security settings; `/signup` has its own URL; web holds an HttpOnly session cookie and mobile a session token. Invites need the invited address verified.

**To do:**

- Deploy the auth service under the API host at `api.<base>/auth` (the Gateway strips the prefix) with its own `auth` database, the host-only `__Host-cb_session` session cookie, WebAuthn for `app.<base>`, and the admin API on the private network only.
- Production secrets: `AUTH_COOKIE_SECRET` and `AUTH_CIPHER_SECRET` (32 characters; passed to Kratos as `SECRETS_COOKIE` and `SECRETS_CIPHER`, and it refuses to start without them, since `kratos.yml` holds none) and `AUTH_EMAIL_HOOK_SECRET` (set on both the auth service and the API), with `COURIER_HTTP_REQUEST_CONFIG_URL` pointing at the API over the private network and the auth service running its courier (`--watch-courier` or `kratos courier watch`); Resend needs the verified sending domain and the three email settings (see Email delivery in engineering.md).
- Set `BASE_DOMAIN` (`clientbridge.ca`, `staging.clientbridge.ca`): it derives `WEB_BASE_URL` (`app.`), the only origin that gets credentialed CORS and may send the session cookie, and `CORS_ALLOW_ORIGINS` (`book.`, `pay.` and `shop.`), served without credentials; the marketing site makes no API calls. Set `TRUSTED_PROXY_HOPS=2` behind Google's load balancer.
- Google OAuth client with the auth service's callbacks (`https://api.clientbridge.ca/auth/self-service/methods/oidc/callback/google` and the same path on `api.staging.clientbridge.ca`) and consent screen; set `GOOGLE_OAUTH_CLIENT_ID`/`SECRET`.
- Rate limits on `/auth/self-service/*` at the proxy: Kratos OSS has no login lockout.
- Security keys on mobile (native passkeys need associated domains); mobile has authenticator apps and backup codes, and tells a key-only account to add one of those on the web.

**QA:**

1. From the marketing site, click Start free and sign up with a new email; enter the emailed code.
2. Sign out and in on web, iPhone and Android.
3. Reset the password with the emailed code, then sign in with Google on the same address.
4. Turn on an authenticator app in Setup › Sign-in & security; sign out and back in with a code on each platform.
5. Try a wrong password repeatedly: the error is the same each time, no account detail leaks, and the proxy starts refusing.

**Depends on:** nothing

### Onboarding, business profile and branding (CLI-6)

Size: S · Area: Accounts and settings

**When this is done:** A new business looks like itself on its public pages within five minutes of signing up.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** After sign-up the owner names the business, picks a web address and province, then sets contact details, logo, colour and tagline.

**Built:** Onboarding (name, web address, province), Setup › Business with contact details, timezone, brand colour, tagline and logo upload on web.

**To do:**

- Logo upload on mobile (shared with the products images story).
- Empty states on every screen that tell a new business what to do next.

**QA:**

1. Finish onboarding as a new owner and land on Today.
2. Set the colour, tagline and logo; the booking page, pay page and shop use all three.
3. Open every main screen with no data: each explains what to add first.

**Depends on:** Sign-up, sign-in and password reset (CLI-5)

### Team invites and roles (CLI-7)

Size: S · Area: Accounts and settings

**When this is done:** Each role sees and can do exactly its list, on web, iPhone and Android.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** The owner invites staff and admins by email; each signs in and sees only what their role allows.

**Built:** Owner, admin and staff roles, email invites, accept-invite page, role gates on every screen and endpoint.

**To do:**

- A full manual pass and fixes for anything it finds.

**QA:**

1. Invite a staff member and an admin; accept both in other browsers.
2. As staff: own bookings and hours only, Payments › Sales only, Setup › Team and hours only.
3. As staff, try a refund, a void and editing another member's hours: each is refused.
4. As admin: everything except owner-only settings.

**Depends on:** Onboarding, business profile and branding (CLI-6)

### Stripe connect and payout status (CLI-8)

Size: S · Area: Accounts and settings

**When this is done:** An owner knows at a glance whether they can take payments and why not.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** The owner connects a Stripe account from Setup › Getting paid, completes verification and sees when they can take payments and receive payouts.

**Built:** Accounts v2 connected accounts with embedded onboarding and account management, verification status mirrored from Stripe's thin account events, each due requirement worded from the catalog (`requirementCopy`), and `make stripe-setup`, which creates Accounts v2 test merchants for the demo.

**To do:**

- Stripe test keys added locally and one full pass in test mode.

**QA:**

1. Start onboarding, complete Stripe's test identity, return to the app: status reads ready.
2. Leave a requirement unfinished: the app says exactly what is missing.
3. Take a $10 test card payment once ready.

**Depends on:** Onboarding, business profile and branding (CLI-6)

### Tax registration and per-item tax classes (CLI-9)

Size: M · Area: Accounts and settings

**When this is done:** Every taxed figure matches a hand calculation for the province.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** The owner marks the business as tax-registered with its numbers, and each item charges the right tax for the province.

**Built:** Tax engine for every province with dated rates (Nova Scotia HST 14% from 2025-04-01) applied on the supply date in the business zone, the same rates on devices (`taxRates.ts`), tax fixed at issue; tax class per item (standard, GST or HST only, exempt) copied onto each line; the registration switch and numbers under Setup › Sales tax on web and mobile.

**To do:**

- Confirm with an accountant which services carry PST in BC, Saskatchewan and Manitoba, then set defaults per item kind.

**QA:**

1. Ontario business, tax on: a $100 invoice charges $13 HST.
2. BC business: a service set to GST only and a product set to standard; PST only on the product.
3. An exempt line charges nothing.
4. Tax off: nothing is charged anywhere.

**Depends on:** Onboarding, business profile and branding (CLI-6)

### Plan subscription, trial and billing (CLI-10)

Size: L · Area: Accounts and settings

**When this is done:** Every business is either trialing, paying through Stripe, or read-only, and the owner can see which and why.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** A new business gets a 14-day trial without a card, the owner picks Premium or Team, monthly or yearly, in Stripe Checkout, and later manages the payment method, invoices and cancellation in the Stripe Billing Portal. When the trial ends without a plan, or Stripe ends the subscription, the business becomes read-only and keeps its data. The design is in the Platform billing section of `.docs/architecture.md`.

**Built:** the plan columns on `businesses` (migration `cb0007`), the owner-only plan endpoints (`GET /v1/plan`, checkout, change, portal), the platform subscription webhook handler, Premium seat billing with the daily seat sync, the trial reminder job, the read-only gate (402 `plan_required`, public flows 409 `business_unavailable`), the web plan page and shell notices, the read-only plan section on mobile; plan Checkout (customer account, flexible billing mode, trial carry-over, automatic tax), the Billing Portal and plan item changes; onboarding that reuses an account created for billing; `scripts.stripe_setup` planning the products, the five lookup-key prices, the portal configuration and the platform webhook endpoint; the two plans on the marketing site's pricing page; the contract tier for the Checkout, Portal and subscription calls.

**To do:**

- The e2e tier against a Test Clock: Checkout with `customer_account` at the pinned version, trial carry-over, renewal, a failed payment through past due to cancellation, and a yearly plan with the monthly seat item.
- Live mode: `scripts.stripe_setup` refuses live mode, so create the objects in the live Dashboard with the same ids and metadata the script uses, so a later sandbox comparison and the backend find them:
  - Products `clientbridge_premium`, `clientbridge_team` and `clientbridge_seat` with tax code `txcd_10103001`.
  - CAD recurring prices, tax behaviour exclusive, with lookup keys `premium_month` (49.99), `premium_year` (499.90), `team_month` (99.99), `team_year` (999.90) and `seat_month` (10.00).
  - A Billing Portal configuration with `metadata.clientbridge=portal`: payment method update, invoice history, email and address updates, cancellation at period end, no subscription update, return URL `https://<web host>/setup/plan`. Its id goes in `STRIPE_PORTAL_CONFIGURATION`.
  - Webhook endpoints at the pinned API version: the Connect endpoint (`connect=true`, `metadata.clientbridge=connect_webhook`) and the platform endpoint (`connect=false`, `metadata.clientbridge=platform_webhook`) for `customer.subscription.created`, `.updated` and `.deleted`, whose signing secret goes in `STRIPE_PLATFORM_WEBHOOK_SECRET`; and the thin event destination (`metadata.clientbridge=account_events`). Production refuses to start without `STRIPE_PLATFORM_WEBHOOK_SECRET` and `STRIPE_PORTAL_CONFIGURATION`.
- Dashboard: Stripe Tax with the head office address and our GST/HST and QST registrations, Billing customer emails, and Smart Retries that cancel the subscription after the last retry.

**QA:**

1. Sign up: the trial shows 14 days and no card is asked for.
2. Subscribe to Premium yearly during the trial: Checkout shows the remaining trial and the tax line, and the plan page shows the yearly price after returning.
3. Invite a staff member on Premium: the seat quantity in Stripe goes up by one.
4. Let a test clock run past a failed renewal: the business shows past due, then read-only after cancellation.

**Depends on:** Onboarding, business profile and branding (CLI-6); Team invites and roles (CLI-7)

---

## 2. Load clients and the catalog

Done when: A business can add its clients and their pets, then its services, products and stock, packages and gift card items.

QA pass:

1. Add a client on a phone, find them by phone number on web, edit them, then archive and restore them.
2. Add a dog with breed, weight and temperament, and a note; the note and the client timeline show on web.
3. Save card 4242 on a phone and a bank account on web, make the card the default, and remove the older card.
4. Tag two clients and merge a duplicate: every booking and invoice ends up under one client.
5. Create a 60-minute service with a 10-minute buffer and a 25% deposit, and a class of 6; both show on the booking page with the right times, prices and deposit.
6. Add a product with SKU, cost, price and a photo taken on the phone, track its stock at 3 with low at 1, and find it in Sales, the invoice editor and the shop.
7. Create a 5-visit package, a monthly membership and a gift card; each opens its own checkout in Sales.

Run it in order on one business, on web, iPhone and Android, as the owner and again as staff where the steps involve roles.

### Client records: add, edit, archive, search (CLI-11)

Size: S · Area: Clients

**When this is done:** A client record can be kept up to date from any device.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** Staff add a client, find them by name or phone, edit their details and archive them without losing their history.

**Built:** Add and search on web and mobile; lifetime value for owners and admins.

**To do:**

- Edit contact details and status.
- Archive and restore a client; archived clients leave search and pickers.

**QA:**

1. Add a client on a phone; find them by phone number on web.
2. Edit their email on web; the phone shows the change.
3. Archive them: gone from search and booking pickers, their invoices still there; restore them.

**Depends on:** nothing

### Pets, students and properties on clients (CLI-12)

Size: M · Area: Clients

**When this is done:** Staff always know which pet, student or property a visit is for.

**Surfaces:** Backend, web, iPhone, Android and Connect

**Flow:** The owner chooses at onboarding what clients book for: pets, students, properties, or only the
client. Staff record each client's subjects with that kind's details, and the subject shows on its
bookings. An owner or admin can change the kind later in business settings; existing subjects and their
details are kept, and the app asks for confirmation with a count first. A business that books only the
client shows no subject fields anywhere.

**Built:** `businesses.subject` (pet, student, property, site or NULL) synced to devices; per-kind details
validated on the server (pet: species, breed, weight, birthday, sex, temperament, coat, allergies, vet,
rabies vaccine, style; student: birthday, grade, school, allergies; property: address, rooms, access,
pets; site: address, building type, access, pets, internet, recorder location and an equipment list with
model, serial, location, install date and warranty end); add, edit and remove from the client record on web and mobile; the subject picker in the booking
composer, series and classes; Connect asks for the subject's name, and a property or site business also
asks for the address of a new one and matches it to the client's existing place by name and address; seeded demo pets.

**To do:**

- Show the subject on the invoice line.

**QA:**

1. Add a dog with breed, weight and temperament to a client.
2. Book the dog; the groomer sees the dog on the booking on their phone.
3. Onboard a property business; add a property with an address and access notes; book it online from
   Connect with a new property name and address, and check the property and address on the client record.
4. Onboard a student business; add a student with a grade and school; check the booking composer offers
   the student.
5. Change the pet business to properties; confirm the count, and check the existing pets still show
   with their details kept.
6. Onboard a business that books only the client; check that no subject fields show on the client
   record, the booking composer or Connect.

**Depends on:** Client records: add, edit, archive, search (CLI-11)

### Notes and client history timeline (CLI-13)

Size: M · Area: Clients

**When this is done:** The full story of a client fits on one screen.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** Staff add notes to a client and see everything that has happened with them in one timeline.

**Built:** Notes in the data and synced; the client panel shows saved methods, subscriptions and packages.

**To do:**

- Add and edit notes on the client.
- A timeline of bookings, invoices, payments, messages and notes, newest first.

**QA:**

1. Add a note on a phone; it shows on web.
2. After a visit, the timeline lists the booking, invoice, payment and message in order.

**Depends on:** Client records: add, edit, archive, search (CLI-11)

### Saved cards and bank accounts (CLI-14)

Size: S · Area: Clients

**When this is done:** Saved methods can be managed from any device and charged reliably.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** Staff save a client's card or bank account (pre-authorized debit), make one the default and remove old ones.

**Built:** Add a card on web and mobile, bank account on web, make default, remove; only chargeable methods can be default.

**To do:**

- Bank account entry on mobile.
- A run with Stripe test keys.

**QA:**

1. Add card 4242 on a phone and make it default.
2. Add a bank account on web; its mandate shows active.
3. Remove the older card; it can no longer be charged.

**Depends on:** Stripe connect and payout status (CLI-8); Client records: add, edit, archive, search (CLI-11)

### Tags and duplicate merging (CLI-15)

Size: M · Area: Clients

**When this is done:** Duplicates can be cleaned up without losing anything.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** Staff tag clients for broadcasts and merge two records that are the same person.

**Built:** Tags in the data, used as broadcast audiences.

**To do:**

- Set and remove tags in the app.
- Merge two clients, moving bookings, invoices, payments, pets and messages.

**QA:**

1. Tag two clients and send a broadcast to the tag.
2. Merge a duplicate: every booking and invoice now sits under one client.

**Depends on:** Client records: add, edit, archive, search (CLI-11)

### Services and classes: duration, buffers, capacity, deposits (CLI-16)

Size: S · Area: Catalog and inventory

**When this is done:** What the owner sets is exactly what clients can book.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** The owner sets up services and classes with length, buffers, capacity and deposit, and they appear on the booking page.

**Built:** A full item editor on web and mobile with every field by kind; only services and classes can be booked online.

**To do:**

- A manual pass of every field against the booking engine.

**QA:**

1. Create a 60-minute service with a 10-minute buffer and a 25% deposit.
2. Create a class of 6.
3. Both show on the booking page with the right times, price and deposit; edit the price and see it update.

**Depends on:** Tax registration and per-item tax classes (CLI-9)

### Products: SKU, cost, price, images (web and mobile) (CLI-17)

Size: M · Area: Catalog and inventory

**When this is done:** A product is set up once and sells the same way everywhere.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** The owner adds retail products with SKU, cost, price, tax class and an image, and sells them everywhere.

**Built:** Products with SKU, cost and tax class in the item editor; image upload on web; products in Sales, invoices, the shop and add-ons.

**To do:**

- Image upload on mobile (image picker and a new native build), also used for the logo.
- Archive and restore a product.

**QA:**

1. Add a shampoo with SKU, cost, price and a photo taken on the phone.
2. It shows in Sales, the invoice editor and the shop with its image.
3. Archive it: it leaves every selling screen; restore it.

**Depends on:** Tax registration and per-item tax classes (CLI-9)

### Stock tracking, low stock and restock (CLI-18)

Size: S · Area: Catalog and inventory

**When this is done:** The count in the app matches the shelf after a day of sales.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** Stock counts drop as products sell, rise on refunds and restocks, and low items are flagged.

**Built:** Optional stock per product, movements on paid and refunded sales and invoices (a repeated webhook can't move stock twice), restock, low-stock filter.

**To do:**

- A manual pass across every way a product can be sold.

**QA:**

1. Track stock on a product: set 3, low at 1.
2. Sell 2 at the desk: 1 left and flagged low.
3. Refund one: 2 left. Restock 5: 7 left, no longer low.
4. Order more than the stock in the online shop: refused.

**Depends on:** Products: SKU, cost, price, images (web and mobile) (CLI-17)

### Packages, memberships and gift card items (CLI-19)

Size: S · Area: Catalog and inventory

**When this is done:** Each kind can be set up without touching the database.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** The owner sets up prepaid packages, monthly memberships and gift cards as items, ready to sell.

**Built:** Item fields for package sessions and validity, subscription interval and frequency, open-amount gift cards; these kinds can't be sold as plain lines.

**To do:**

- A manual pass of each kind's fields.

**QA:**

1. Create a 5-visit package valid for a year, a monthly membership and a gift card.
2. Each appears in Sales under its own checkout, not in the cart.

**Depends on:** Tax registration and per-item tax classes (CLI-9)

---

## 3. Book and complete a visit

Done when: A business can set its hours, book from the calendar and from its public page with a deposit, send reminders, let clients reschedule, and complete the visit.

QA pass:

1. Set a staff member's hours to Tuesday to Saturday, 10 to 4, add a day off and close the business on a holiday; the booking page offers only open times.
2. Book from the calendar, drag the visit to a new time, and try to double-book the same person: refused.
3. Create a weekly series of 6 across a daylight-saving change, move it to another weekday, then cancel it.
4. Fill a class of 6 online: the 7th is refused and the roster lists all six.
5. As a new client on a phone, book a service with a shampoo add-on and a deposit paid with card 4242; the booking shows on web and the staff phone with the deposit collected. Repeat inside an embedded page.
6. Set reminders to 2 hours before and book for later today: the reminder arrives with the right time and address.
7. From the confirmation link, reschedule; cancel inside the cut-off (refused) and outside it (the slot opens and the deposit follows the policy).
8. Complete one visit and mark another a no-show (the deposit is kept); leave a third open past the end of the day: it is completed next morning. Repeat on iPhone and Android, including the week view.

Run it in order on one business, on web, iPhone and Android, as the owner and again as staff where the steps involve roles.

### Staff hours, time off and closures (CLI-20)

Size: M · Area: Scheduling

**When this is done:** Open times always match when people are actually working.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** Each staff member's weekly hours, days off and business closures decide what can be booked.

**Built:** Weekly hours per staff member on web and mobile; time off for one member and closures for everyone (`/v1/time-off`), shown on the schedule; open times respect all three, and an hours change that leaves future visits outside the hours shows them for review; removing a member reassigns or cancels their future visits.

**To do:**

- The remaining scheduling design work tracked in `.docs/executions/scheduling/plan.md` (late-cancel policy, hours model, service-to-staff mapping, rolling recurrences, class timetables, local wall times).

**QA:**

1. Set Tuesday to Saturday, 10 to 4: the booking page offers nothing on Monday for them.
2. Add a day off next week: no times that day; other staff unaffected.
3. Close the business on a holiday: no one is bookable.

**Depends on:** Team invites and roles (CLI-7)

### Calendar: create, move, cancel, complete, no-show (CLI-21)

Size: M · Area: Scheduling

**When this is done:** Every visit ends in the right state from any device.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** Staff book, move and cancel visits, then mark each one completed or a no-show.

**Built:** Day, week, month, staff and agenda views on web (day and agenda on mobile), create, drag to reschedule, cancel, double-booking checks for staff; Complete and No-show on web and mobile, refused before the visit starts.

**To do:**

- Week view on mobile.

**QA:**

1. Book, drag to a new time, try to double-book the same person (refused).
2. Mark one visit completed and another a no-show; a deposit on the no-show is kept.
3. Repeat on iPhone and Android, including the week view.

**Depends on:** Services and classes: duration, buffers, capacity, deposits (CLI-16); Staff hours, time off and closures (CLI-20)

### Recurring bookings (CLI-22)

Size: M · Area: Scheduling

**When this is done:** A regular client's series can be managed in one action.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** Staff book a repeating visit and later change or cancel the whole series.

**Built:** Weekly or monthly series with a set number of visits, created from one form, kept at the same local time.

**To do:**

- Edit or cancel the whole series.
- Series longer than 60 visits.
- One confirmation for the series instead of one per visit.

**QA:**

1. Create a weekly series of 6 across a daylight-saving change: every visit keeps its time.
2. Move the series to a new weekday, then cancel it from one visit.

**Depends on:** Calendar: create, move, cancel, complete, no-show (CLI-21)

### Classes (CLI-23)

Size: M · Area: Scheduling

**When this is done:** Classes run without touching the database.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** A business runs group classes with a capacity.

**Built:** Class capacity and seat counts in the booking engine.

**To do:**

- A class roster.

**QA:**

1. Create a class of 6, book 6 online; the 7th is refused.
2. Open the roster: all six listed.

**Depends on:** Calendar: create, move, cancel, complete, no-show (CLI-21)

### Reminders and end-of-day completion (CLI-24)

Size: S · Area: Scheduling

**When this is done:** No visit is forgotten by the client or left open by staff.

**Surfaces:** Backend, email and text

**Flow:** Clients get a reminder before each visit, and past visits close themselves at the end of the day.

**Built:** A reminder the day before by email or text, previewed word for word under Setup › Reminders; past visits completed automatically after local midnight (on by default, switchable), and never-approved pending ones canceled.

**To do:**

- Choose when reminders go out.

**QA:**

1. Set reminders to 2 hours before; book for later today: the reminder arrives with the right time and address.
2. Leave a visit open past the end of the day: it is completed next morning.

**Depends on:** Calendar: create, move, cancel, complete, no-show (CLI-21)

### Booking page with deposits and embedding (CLI-25)

Size: S · Area: Online booking and shop

**When this is done:** A client can book and pay a deposit without contacting the business.

**Surfaces:** Backend, Connect (client pages), web, iPhone and Android

**Flow:** A client books on the business's page, pays the deposit, and the visit appears for staff; the page can sit on the business's own website.

**Built:** A public booking page per business with services, staff choice, open times, deposit checkout and new-client creation; an embed snippet.

**To do:**

- A run with Stripe test keys.

**QA:**

1. As a new client on a phone, book a service with a deposit and pay with card 4242.
2. The booking shows on web and the staff phone with the deposit collected; the client exists.
3. Paste the embed snippet into a test page: booking works inside it.

**Depends on:** Stripe connect and payout status (CLI-8); Services and classes: duration, buffers, capacity, deposits (CLI-16); Staff hours, time off and closures (CLI-20)

### Booking add-ons (CLI-26)

Size: S · Area: Online booking and shop

**When this is done:** Add-ons always reach the invoice and are charged once.

**Surfaces:** Backend, Connect, web, iPhone and Android

**Flow:** While booking, a client adds products to the visit; they land on the visit's invoice.

**Built:** An optional add-on step on the booking page; add-ons stored on the booking; Create invoice from the booking includes them; staff can remove them before invoicing.

**To do:**

- A manual pass end to end.

**QA:**

1. Book with a shampoo add-on.
2. Staff see it on the booking on a phone and remove nothing.
3. Create the invoice from the booking: the shampoo is a line, the deposit reduces the balance.

**Depends on:** Products: SKU, cost, price, images (web and mobile) (CLI-17); Booking page with deposits and embedding (CLI-25)

### Client self-service cancel and reschedule (CLI-28)

Size: M · Area: Online booking and shop

**When this is done:** Clients can change plans without staff, and the rules are enforced.

**Surfaces:** Backend, Connect, web, iPhone and Android

**Flow:** A client cancels or moves their own booking from a link, within the business's rules.

**Built:** A manage link (`/m/<token>` on Connect) in confirmations and reminders; cancel and reschedule within the business's cut-offs and move limit, enforced on the server under the member and booking locks, with a paid deposit refunded on an allowed cancel and refusals worded from their codes.

**To do:**

- A late-cancel policy that keeps the deposit (scheduling plan G5).

**QA:**

1. From the confirmation link, move a booking to another open time.
2. Cancel inside the cut-off: refused with the reason.
3. Cancel outside it: the slot opens and the deposit follows the policy.

**Depends on:** Booking page with deposits and embedding (CLI-25)

## 4. Get paid

Done when: A business can ring up sales, take card and Tap to Pay with tips and discounts, send estimates and invoices, record payments, hand out PDFs, refund, and sell packages and gift cards.

QA pass:

1. Ring up a groom and a shampoo for a client, and a walk-in sale with no client.
2. Pay on web with card 4242 and email the receipt; on a real phone take Tap to Pay with a credit card and an Interac card; a declined card leaves the sale open with a clear message.
3. Add a 15% tip to a $100 groom (no tax on the tip), and discount one line 10% and the sale $5; totals and tax match a hand calculation.
4. Write an estimate on a phone, send, accept and convert it: the invoice keeps the lines, discount and tax.
5. Create an invoice from a completed booking, send it and pay it through the link in a private window; void another; record $20 cash on a $50 invoice and charge the rest to the saved card.
6. Each email has a matching PDF; download the invoice, estimate and receipt PDFs from a phone.
7. Sell a 5-visit package and use two visits, start a membership and advance the test clock a month, and sell a $100 gift card and redeem $40.
8. Order two products in the online shop on a phone, mark the order ready and picked up; stock drops by one each.
9. Refund $10 of a $50 payment, then the rest; refund a gift card purchase; open and win a test dispute on a package payment.

Run it in order on one business, on web, iPhone and Android, as the owner and again as staff where the steps involve roles.

### Online shop and pickup orders (CLI-27)

Size: M · Area: Online booking and shop

**When this is done:** Online orders are paid, prepared and collected without a phone call.

**Surfaces:** Backend, Connect, web, iPhone and Android

**Flow:** A client orders products from the business's shop page, pays by card, and collects them once staff mark the order ready.

**Built:** A shop page per business for products marked sell online, card payment, pickup orders in Sales with Mark ready and Picked up, notifications to owner and client.

**To do:**

- A run with Stripe test keys.

**QA:**

1. On a phone, order a shampoo and a brush and pay with card 4242.
2. The owner is notified; the order shows in Sales as waiting for pickup.
3. Mark it ready: the client gets the message. Mark it picked up.
4. Stock dropped by one each.

**Depends on:** Stripe connect and payout status (CLI-8); Stock tracking, low stock and restock (CLI-18)

### Sales with services and products (CLI-29)

Size: S · Area: Front desk sales and orders

**When this is done:** Any sale can be rung up in under a minute.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** Staff ring up services and products for a client or a walk-in, and the sale is recorded with tax.

**Built:** Sales on web and mobile; cart with services, classes and products; client optional; gift cards, packages and subscriptions open their own checkout.

**To do:**

- A manual pass on web and both phones.

**QA:**

1. Ring up a groom and a shampoo for a client.
2. Ring up a walk-in sale with no client.
3. Open the gift card tile: it opens the gift card checkout, not the cart.

**Depends on:** Products: SKU, cost, price, images (web and mobile) (CLI-17)

### Card and Tap to Pay checkout with receipts (CLI-30)

Size: M · Area: Front desk sales and orders

**When this is done:** Every way of paying at the desk ends in a paid sale and a correct receipt.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** Staff take payment by saved card, new card or Tap to Pay, and the client gets an itemised receipt.

**Built:** Card checkout for sales on web and mobile, Tap to Pay on mobile, itemised receipts by email or text including walk-ins.

**To do:**

- A run with Stripe test keys.
- Tap to Pay on real iPhone and Android hardware.

**QA:**

1. On web, pay a sale with card 4242 and send a receipt to an email.
2. On a real phone, take a Tap to Pay payment.
3. Try a declined card (4000 0000 0000 0002): the sale stays open with a clear message.
4. The receipt lists each line, tax and total.

**Depends on:** Stripe connect and payout status (CLI-8); Sales with services and products (CLI-29)

### Interac debit on Tap to Pay (CLI-31)

Size: M · Area: Front desk sales and orders

**When this is done:** Interac debit cards pay at the desk like credit cards.

**Surfaces:** Backend, iPhone and Android

**Flow:** A client pays at the desk with an Interac debit card by Tap to Pay, and the sale or invoice is paid as it would be by credit card.

**Built:** Nothing. Terminal PaymentIntents are created with `card_present` only, so a Canadian debit card that only carries Interac cannot pay by Tap to Pay.

**To do:**

- Add `interac_present` to the Terminal PaymentIntent's payment method types for Canadian businesses.
- Decide whether an Interac debit payment is stored as a card payment or as a method of its own, and show it that way on receipts, reports and the payment record.
- Check how Stripe refunds `interac_present` payments, since some must be made with the card on the reader, and offer the right path in the refund dialog.

**QA:**

1. On a real phone with a Canadian test business, take a Tap to Pay payment with an Interac test card: the sale is Paid.
2. Refund it: the refund follows Stripe's Interac rules and the sale reads Refunded.
3. The receipt and the income report name the payment method.

**Depends on:** Card and Tap to Pay checkout with receipts (CLI-30)

### Tips at checkout (CLI-32)

Size: M · Area: Front desk sales and orders

**When this is done:** Every tip reaches the right person and never carries tax.

**Surfaces:** Backend, web, iPhone, Android and Connect (pay link)

**Flow:** A client adds a tip when paying, and it goes to the staff member who served them.

**Built:** Nothing; payments carry no tip.

**To do:**

- A tip choice (percentages and custom) at the desk, on Tap to Pay and on the pay link.
- The tip owed to the staff member on the ledger, outside sales tax, added to their earnings.
- Tips on receipts, in the income report and in Staff pay.

**QA:**

1. Ring up a $100 groom and add a 15% tip: no tax on the tip.
2. Tip on a pay link and on Tap to Pay.
3. Each tip shows under the right staff member in Staff pay and apart from sales in reports.
4. Refund a tipped payment: the tip is reversed from the earnings.

**Depends on:** Card and Tap to Pay checkout with receipts (CLI-30); Staff pay: earnings, approval, payment (CLI-44)

### Discounts (CLI-33)

Size: M · Area: Front desk sales and orders

**When this is done:** Every discounted total and its tax match a hand calculation.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** Staff take an amount or a percentage off a line or a whole sale, invoice or estimate, and tax follows the discounted price.

**Built:** Nothing.

**To do:**

- Line and whole-document discounts as a percentage or amount, with a reason.
- Tax after the discount; discounts on documents, receipts and reports.
- Staff apply any discount without approval.

**QA:**

1. Discount one line 10% and the whole sale $5: totals and tax match a hand calculation.
2. Convert a discounted estimate: the discount carries to the invoice.
3. As staff, discount a sale 50%: it is applied without an approval step.

**Depends on:** Sales with services and products (CLI-29); Invoices: create, send, void, pay link (CLI-35)

### Estimates: create, send, accept, convert (CLI-34)

Size: S · Area: Invoices and payments

**When this is done:** A quote becomes a bill without retyping anything.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** Staff write an estimate, send it, the client accepts it, and it becomes an invoice.

**Built:** One editor on web and mobile, catalog or free-text lines, draft editing, send, accept, decline, convert.

**To do:**

- A manual pass on every platform.

**QA:**

1. Write an estimate on a phone and send it.
2. Accept it, convert it: the invoice has the same lines and tax.
3. Decline another: it can't be converted.

**Depends on:** Tax registration and per-item tax classes (CLI-9); Products: SKU, cost, price, images (web and mobile) (CLI-17)

### Invoices: create, send, void, pay link (CLI-35)

Size: S · Area: Invoices and payments

**When this is done:** Invoices move from draft to paid or void with the right status everywhere.

**Surfaces:** Backend, web, iPhone, Android and Connect (pay page)

**Flow:** Staff invoice a client, send it, and the client pays through the link; unpaid invoices can be voided.

**Built:** Create and edit drafts, send, void (blocked while a payment is in progress), invoice from a booking, pay link by card, tax lines per province.

**To do:**

- A run with Stripe test keys.

**QA:**

1. Create an invoice from a completed booking and send it.
2. Pay through the link in a private window with card 4242: Paid on web and phones.
3. Void another unpaid invoice; try to void one with a payment in progress: refused.

**Depends on:** Stripe connect and payout status (CLI-8); Estimates: create, send, accept, convert (CLI-34)

### Recording payments in the app (CLI-36)

Size: M · Area: Invoices and payments

**When this is done:** Every way a client actually pays can be recorded on the invoice.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** Staff take payment on an invoice in the app: charge a saved card, or record cash or a received e-Transfer.

**Built:** Record payment on web and mobile: charge a saved card or the reader, or record cash with change, an e-Transfer or a cheque received, with partial amounts.

**To do:**

- A run with Stripe test keys.

**QA:**

1. Record $20 cash on a $50 invoice: Partial.
2. Charge the rest to the saved card: Paid.
3. Today and reports show both payments.

**Depends on:** Saved cards and bank accounts (CLI-14); Invoices: create, send, void, pay link (CLI-35)

### PDF invoices, estimates and receipts (CLI-37)

Size: M · Area: Invoices and payments

**When this is done:** Every PDF matches its record in the app.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** Every invoice, estimate and receipt can be downloaded or attached as a PDF that matches the app.

**Built:** Web pages and emails only.

**To do:**

- PDFs with logo, address, GST/HST number, lines, taxes and totals.
- Attached to the emails and downloadable on web and mobile.

**QA:**

1. Send an invoice and an estimate: each email has a matching PDF.
2. Take a payment: the receipt PDF lists lines, tax and total.
3. Download each from a phone.

**Depends on:** Invoices: create, send, void, pay link (CLI-35)

### Packages, memberships and gift cards: sell, use, renew, expire (CLI-38)

Size: M · Area: Invoices and payments

**When this is done:** Every balance in the app matches what was sold, used or charged.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** Clients buy prepaid visits, memberships and gift cards, then use, renew and let them expire, with balances always right.

**Built:** Sell each through its own checkout; one session used per visit; monthly charges by Stripe with an invoice each period; redeem gift cards by code; expiry books the unused balance as revenue.

**To do:**

- A price change reaching existing memberships.
- Pause a membership.
- A full pass with Stripe's test clock.

**QA:**

1. Sell a 5-visit package, use two visits: 3 remain.
2. Start a membership, advance Stripe's test clock a month: the second invoice is Paid.
3. Sell a $100 gift card, redeem $40: $60 remains.
4. Run the expiry job: expired balances move to revenue.

**Depends on:** Saved cards and bank accounts (CLI-14); Packages, memberships and gift card items (CLI-19)

### Refunds and chargebacks (CLI-39)

Size: S · Area: Invoices and payments

**When this is done:** Money and the client's entitlements agree after every case.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** Staff refund all or part of a payment, and chargebacks are tracked to their outcome.

**Built:** Full, partial and repeated refunds as credit notes; dashboard refunds recorded; deposits, stock and entitlements unwound; disputes book the withdrawn funds and fee, a won dispute reverses them.

**To do:**

- Suspend a disputed gift card or package while the case is open. A refund that fails after succeeding is reversed, and a lost dispute is written off with the sale unwound and the document reading refunded; an open or won case leaves it paid.

**QA:**

1. Refund $10 of $50, then the rest: Refunded, tax set aside drops.
2. Refund a gift card purchase: it can't be redeemed.
3. Open a test dispute on a package payment: suspended; win it: restored.

**Depends on:** Card and Tap to Pay checkout with receipts (CLI-30); Packages, memberships and gift cards: sell, use, renew, expire (CLI-38)

## 5. See the money

Done when: A business can see its day, its reports and its tax returns, reconcile with Stripe and pay its staff.

QA pass:

1. Take a payment: Today updates on web and phones within seconds and matches the day's income report.
2. After a test week, check each report's totals against the sales and payments made, and open each CSV in a spreadsheet.
3. Record the quarter's GST/HST return: tax set aside drops by the amount filed, and the same period is refused a second time.
4. Check each fee against Stripe's dashboard, see a test payout under Bank deposits, and confirm the nightly check reports no difference.
5. Set 40% on services and 10% on retail; a $100 groom and a $30 product earn $40 and $3; approve, mark paid, and find $43 on the T4A.

Run it in order on one business, on web, iPhone and Android, as the owner and again as staff where the steps involve roles.

### Today dashboard (CLI-40)

Size: S · Area: Money, tax and staff pay

**When this is done:** Today answers how the day is going without opening a report.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** The owner opens Today and sees revenue, money awaiting payment, tax set aside and recent activity.

**Built:** Revenue today, awaiting payment, GST/HST set aside, recent activity, synced live to every device.

**To do:**

- Today's schedule on the same screen.
- The next GST/HST filing date.

**QA:**

1. Take a payment: Today updates on web and phones within seconds.
2. Figures match the income report for the day.

**Depends on:** Card and Tap to Pay checkout with receipts (CLI-30)

### Reports: income, sales by item, GST/HST, T4A (CLI-41)

Size: S · Area: Money, tax and staff pay

**When this is done:** A bookkeeper can work from the downloads without questions.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** The owner runs reports for any period and downloads them for the bookkeeper.

**Built:** Income, sales by item, GST/HST (PST and QST apart) and T4A, with CSV downloads, in the business timezone.

**To do:**

- A manual pass against hand totals.

**QA:**

1. After a test week, check each report's totals against the sales and payments made.
2. Download each CSV and open it in a spreadsheet.

**Depends on:** Card and Tap to Pay checkout with receipts (CLI-30)

### Tax returns and remittance (CLI-42)

Size: S · Area: Money, tax and staff pay

**When this is done:** Tax set aside always equals what is still owed to the CRA.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** At the end of a period the owner records the return they filed, and tax set aside resets.

**Built:** Record a filed return per period; tax set aside drops by the amount; overlapping or unfinished periods refused.

**To do:**

- A manual pass with real quarter totals.

**QA:**

1. Download the quarter's GST/HST report and record the return.
2. Today's tax set aside drops by the amount filed.
3. Try the same period again: refused.

**Depends on:** Reports: income, sales by item, GST/HST, T4A (CLI-41)

### Stripe reconciliation, fees and payouts (CLI-43)

Size: S · Area: Money, tax and staff pay

**When this is done:** Our figures and Stripe's agree to the cent.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** Every payment's Stripe fee and every payout to the bank is recorded and agrees with Stripe.

**Built:** Fees per payment from Stripe, payouts under Reports › Bank deposits, a nightly check against Stripe's balance.

**To do:**

- A run with Stripe test keys. Payouts are booked when Stripe creates them and reversed when canceled, and settlement retries when the fees are not readable yet.

**QA:**

1. After test payments, each fee matches Stripe's dashboard.
2. When a test payout lands, it shows under Bank deposits.
3. The nightly check reports no difference.

**Depends on:** Stripe connect and payout status (CLI-8)

### Staff pay: earnings, approval, payment (CLI-44)

Size: M · Area: Money, tax and staff pay

**When this is done:** Earnings match the rates by hand.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** Staff earn from services and retail sales, the owner approves and pays, and the year-end T4A adds up.

**Built:** Pay rate and retail commission per staff member; earnings from paid booking invoices and sales; approve and mark paid; T4A report.

**To do:**

- Earnings from invoice lines that aren't bookings.

**QA:**

1. Set 40% on services and 10% on retail.
2. A $100 groom and a $30 product: earnings $40 and $3.
3. Approve and mark paid; the T4A includes $43.

**Depends on:** Team invites and roles (CLI-7); Card and Tap to Pay checkout with receipts (CLI-30)

---

## 6. Talk to clients

Done when: A business can text and email its clients from one inbox, send broadcasts, ask for reviews, and send forms and contracts.

QA pass:

1. Text a client and reply from their phone: the reply lands in the thread on web and mobile.
2. Have two businesses text the same phone: each reply reaches only its business.
3. Unsubscribe one client by link and reply STOP from another; a broadcast to their tag reaches everyone else, and each record shows the consent and opt-out date.
4. Configure a Google review link and request a review after a completed visit; confirm the invitation links directly to Google.
5. Build an intake form with text, choice and a file upload; book as a new client, fill it in on a phone, and see the answers on web and mobile.
6. Send a contract, sign it on a phone, and download the signed PDF with the signature, time and IP.

Run it in order on one business, on web, iPhone and Android, as the owner and again as staff where the steps involve roles.

### Two-way inbox with a text number per business (CLI-45)

Size: L · Area: Messaging and documents

**When this is done:** No reply can reach the wrong business.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** Staff text and email clients from one inbox, and replies always come back to the right business.

**Built:** Threads by text and email, new message, reply; one shared text number, with an inbound text routed to the business that last texted that phone (unmatched on a tie or no sender); Twilio signatures checked; phones stored as E.164; staff push on inbound texts and Connect messages.

**To do:**

- A text number per business, with replies routed by number and STOP scoped to that business.
- Run `scripts/normalize_phones.py` on existing rows once approved (it waits for approval as a data change).

**QA:**

1. Text a client; reply from their phone: the reply lands in the thread on web and mobile.
2. Two businesses text the same client phone: each reply reaches only its business.

**Depends on:** Client records: add, edit, archive, search (CLI-11)

### Broadcasts with consent and opt-out (CLI-46)

Size: L · Area: Messaging and documents

**When this is done:** An opted-out client can't receive a broadcast.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** The owner sends a broadcast that reaches only clients who agreed to hear from them.

**Built:** Scheduled broadcasts to tagged clients, sent one recipient at a time and resumable, held in quiet hours (21:00 to 09:00 local); a consent record per client and channel, a preferences link, sticky STOP for texts, email complaints withdrawing consent, and the business's address and contact in every broadcast email (CASL).

**To do:**

- One pass with Twilio and Resend test keys.

**QA:**

1. Unsubscribe one client by link and reply STOP from another.
2. Broadcast to their tag: neither receives it, the rest do.
3. Each client's consent and opt-out date shows on their record.

**Depends on:** Tags and duplicate merging (CLI-15); Two-way inbox with a text number per business (CLI-45)

### Google review invitations (CLI-47)

Size: M · Area: Messaging and documents

**When this is done:** Clients receive neutral invitations directly to Google after appointments.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** Save a Google review link, request a review manually or after a completed visit, and view invitation history.

**Built:** Direct Google invitations, booking/client validation and request history. Internal collection, approval, publication, replies and public ratings are removed.

**To do:** Google Business Profile account/location connection, online review reads and explicit Google reply management; see the Google Business reviews execution plan.

**QA:**

1. Requests require a saved Google URL and appropriate manager access.
2. An invitation links directly to Google and records the client and optional completed booking.
3. Duplicate booking requests are rejected; old internal submission and moderation endpoints return 404.

**Depends on:** Calendar: create, move, cancel, complete, no-show (CLI-21)

### Intake forms (CLI-48)

Size: S · Area: Messaging and documents

**When this is done:** The business has every new client's answers before the visit.

**Surfaces:** Backend, Connect (form page), web, iPhone and Android

**Flow:** The owner builds an intake form; clients fill it in before their first visit, and answers sit on their record.

**Built:** Form builder on web, public form page, responses stored.

**To do:**

- The builder on mobile.
- Send automatically to new clients when they book.
- Size and type limits on uploads.

**QA:**

1. Build a form with text, choice and a file upload.
2. Book as a new client: the form arrives; fill it in on a phone.
3. Answers show on the client's record on web and mobile.

**Depends on:** Client records: add, edit, archive, search (CLI-11)

### Contracts, signing and signed PDFs (CLI-49)

Size: M · Area: Messaging and documents

**When this is done:** A signed contract can be produced on request.

**Surfaces:** Backend, Connect (sign page), web, iPhone and Android

**Flow:** The owner sends a contract, the client signs online, and a signed PDF is kept.

**Built:** Contract drafts on web, online signing with time and IP recorded.

**To do:**

- A signed-contract PDF with signature, time, IP and the text as signed.
- Contracts on mobile.

**QA:**

1. Send a contract and sign it on a phone.
2. Download the signed PDF from the client's record: signature, time and IP are on it.

**Depends on:** Client records: add, edit, archive, search (CLI-11)

---

## 7. Go live

Done when: Clientbridge runs in production with backups and monitoring, the apps are in the stores, the site is live and the final release pass is clean.

QA pass:

1. Deploy a tagged build to staging, run the QA pass of stages 1 to 6 there, and check the security headers.
2. Take a real $1 payment in live mode and refund it.
3. Restore last night's backup into a scratch database and open a business from it; trigger a test error on each surface and check the alert.
4. Install from TestFlight and the Play internal track, sign in as owner and staff, edit working hours offline and see them reach web; confirm online-only commands explain that a connection is required, and get a push for an online booking.
5. Check that the live site has no placeholders, every claim holds, and Start free creates an account.
6. Run the final release pass: an owner day on web, a staff day on iPhone and Android, the client side on a phone, money that agrees to the cent, and changes made at once and offline that end up the same everywhere.

Run it in order on one business, on web, iPhone and Android, as the owner and again as staff where the steps involve roles.

### Production hosting, deploys and security (CLI-50)

Size: L · Area: Platform and launch

**When this is done:** Staging passes and production deploys with one command.

**Surfaces:** Backend, job worker, web, Connect and the marketing site

**Flow:** Every part of the system runs in production on its own subdomain, deploys from CI, and is locked down.

**Built:** Local Docker stack; CI builds and tests every app; production secrets checked at startup; Stripe API version pinned.

**To do:**

- Follow the deploy plan in `.docs/executions/deploy/plan.md` (tasks D00 to D15).
- Production hosting for the API, worker, web, Connect and the site on their subdomains.
- Deploys from CI to staging and production.
- A production CORS allow-list and security headers (HSTS, CSP, frame and host protection).
- Stripe live keys and the live webhook at the pinned version.

**QA:**

1. Deploy a tagged build to staging and run every story's QA there.
2. Scan the response headers: all present.
3. Take a real $1 payment in live mode and refund it.

**Depends on:** nothing

### Backups, monitoring and alerts (CLI-51)

Size: M · Area: Platform and launch

**When this is done:** A restore is timed and documented, and every surface reports errors.

**Surfaces:** Backend, web, iPhone and Android

**Flow:** Data is backed up and can be restored, and we hear about errors before customers do.

**Built:** Nothing in production.

**To do:**

- Logs, alerts and the restore drill follow the deploy plan in `.docs/executions/deploy/plan.md` (tasks D10 and D11).
- Daily backups and point-in-time recovery for the database and the sync store.
- One timed restore drill, written down.
- Error tracking with alerts on every surface.

**QA:**

1. Restore last night's backup into a scratch database and open a business from it.
2. Trigger a test error on each surface: an alert arrives with the stack trace and the business.

**Depends on:** Production hosting, deploys and security (CLI-50)

### iPhone and Android store release (CLI-52)

Size: M · Area: Platform and launch

**When this is done:** Both store builds pass every mobile step in the stories above.

**Surfaces:** iPhone and Android

**Flow:** Staff install the app from the stores and run their day on it, online or offline, with notifications.

**Built:** Both apps with the same screens as web, offline sync, push notifications, Tap to Pay and the app icon.

**To do:**

- Mobile build profiles against staging and production follow the deploy plan in `.docs/executions/deploy/plan.md` (task D09).
- Signing, store listings and production builds pointed at production.
- Push certificates for production.

**QA:**

1. Install from TestFlight and the Play internal track; sign in as owner and staff.
2. Airplane mode, add a note, reconnect: it reaches web.
3. Book online: the staff phone gets a push.

**Depends on:** Production hosting, deploys and security (CLI-50)

### Marketing site launch (CLI-53)

Size: S · Area: Platform and launch

**When this is done:** The live site makes no claim the product can't back.

**Surfaces:** Marketing site

**Flow:** A visitor reads the site, trusts what it says, and signs up.

**Built:** Home, features, solutions with eight trade pages, pricing, legal shells and credits; content, link, accessibility and Lighthouse checks in CI; a waitlist build for the time before the app is deployed (`VITE_WAITLIST=1`, `render.yaml`), whose sign-ups go to a Resend segment.

**To do:**

- Privacy policy and terms from a lawyer; prices and the platform fee; a contact address.
- Remove or build every capability a page describes that doesn't exist yet.
- Point Start free at the sign-up page and deploy on the main domain, replacing the waitlist build on Render, and email the waitlist.

**QA:**

1. Search the built site for "\[" placeholders: none.
2. Walk each trade page against the app; every claim holds.
3. From the live site, Start free creates an account.

**Depends on:** Sign-up, sign-in and password reset (CLI-5); Production hosting, deploys and security (CLI-50)

### Final release QA and sign-off (CLI-54)

Size: M · Area: Platform and launch

**When this is done:** Every launch story is done, this pass is clean, no bug that blocks launch is open, and both founders sign off.

**Surfaces:** Everything

**Flow:** One full pass of the product as owners, staff and clients use it, across devices, before launch.

**Built:** Demo business Birchbark Pet Studio; owner hannah@birchbark.example and staff priya@birchbark.example, password demo1234.

**To do:**

- Run the pass on staging with the store builds; log each failure as a bug linked to its story.

**QA:**

1. Owner day on web: schedule, walk-in, invoices, a gift card and a package, one refund.
2. Staff day on iPhone, then Android: own bookings, a note, a deposit, a Tap to Pay sale.
3. Client side on a phone: book, add a product, fill a form, sign, pay, order from the shop.
4. Money: Today, reports, staff pay and Stripe agree to the cent.
5. Sync: changes made at once and offline end up the same everywhere.

**Depends on:** nothing

## Final release pass (CLI-54)

The last step of stage 7: one full pass of the product as owners, staff and clients use it, on staging with the store builds. Log each failure as a bug linked to its story. The full story is under stage 7.

1. Owner day on web: schedule, walk-in, invoices, a gift card and a package, one refund.
2. Staff day on iPhone, then Android: own bookings, a note, a deposit, a Tap to Pay sale.
3. Client side on a phone: book, add a product, fill a form, sign, pay, order from the shop.
4. Money: Today, reports, staff pay and Stripe agree to the cent.
5. Sync: changes made at once and offline end up the same everywhere.

Done when: Every launch story is done, this pass is clean, no bug that blocks launch is open, and both founders sign off.

---

## After launch

Not tracked yet. These are pulled in by demand once the launch stages are done.

- **Growth and commerce:** multiple locations per business (needs a location model), loyalty and rewards,
  waitlists with auto-promote, online gift card purchase and balance check.
- **Buy now, pay later:** Affirm, Afterpay and Klarna as Stripe payment methods on each connected
  account, offered in the same Payment Element as cards and Link on our direct-charge PaymentIntents,
  once a business turns them on and Stripe activates the capabilities. Confirm current Canadian
  availability and fees in the Stripe docs first; provider fees are higher than card fees, so the
  platform fee for these methods needs a decision.
- **Platform and scale:** a public developer API with keys and outbound webhooks (`webhooks` is inbound
  only), a platform admin role and support console, custom permissions (`contractor` has staff permissions
  today), suspending or offboarding a business through `businesses.status`.
- **Feature depth:** membership pause, trial and plan change, package sessions used automatically on
  booking, a cancellation policy with a late-cancel fee, configurable reminders, Google and iCal calendar
  sync, per-staff and travel buffers, conditional form fields, countersigning and a drawn signature.
- **Tax and reporting depth:** place of supply by client province, tax-inclusive pricing, compound tax,
  expenses and input tax credits for net profit, real T4A slips and e-filing, client statements, dunning
  and subscription retry.
- **Auth provider independence:** the backend and the deployed names already treat Kratos as one
  implementation of the auth service, but app-core's auth hooks (`domain/auth.ts`) read Kratos's flow
  shapes: node names such as `totp_qr` and `lookup_secret_codes`, request bodies such as
  `{method: "password", identifier}`, and catalog keys by Kratos message id (`auth.flowMessages.<id>`).
  Replacing Kratos today means rewriting those hooks. The fix is an intent-level `IdentityLike` (sign in,
  sign up, send and verify a code, second factor, Google, password change, TOTP and backup codes,
  passkeys) returning our own results and error codes, with the Kratos mapping kept in the api-client's
  `identity.ts`, so a new provider is a new adapter and the hooks, screens and catalog stay.
- **Platform hygiene:** retention and PII purge, metrics and tracing, blue-green deploys and rollback, more than one currency (CAD is fixed
  on create), a decision on `clients.custom_fields`.
- **Sync follow-ups:** window the money tables with balances, lifetime value and old invoice status
  served by the API, because at 50k clients the ledger screens take 3 to 12 seconds on a device;
  browser-tab coordination and native resume; sanitized sync diagnostics and retention; whether the hours
  editor can express "no hours set"; an offline check on iOS, which the simulator cannot do per app.
- **A second language:** the catalogs, formatter and gates are in place with English only (see
  _Locale and time zones_ in the architecture doc). Adding French needs the translated catalog files,
  locale columns on businesses, users and clients (a schema change), the bodies of `activeLocale()` and
  `locale_for(...)`, language pickers, the device language through `expo-localization`, `/fr` routes and
  `hreflang` on the site, a per-locale prerender of the site (its content reads the catalog at import),
  Stripe's `locale` parameter, translated store listings, and a decision on whether a sent document keeps
  its language. Known gap to close then: the `no-composed-copy` rule cannot see text placed side by side in
  JSX. The localization
  audit of 2026-10-11 found more work that French needs:
  - A missing translation shows the raw key on both sides: `locale.ts` falls back to the key and
    `core/locale.py` passes the key to gettext. Both need a fallback chain to English before a partial
    catalog ships, and `gen-strings` needs the same ICU, `args` and missing-key checks for a translated
    file that it runs on `en-CA.json`.
  - Quebec's Charter of the French Language (as amended by Bill 96) applies to Quebec businesses, and
    contracts of adhesion must be offered in French first. Services, policies, descriptions and contract
    and form bodies are single text fields today, so supporting French and English versions of
    business-written content is a product and schema decision, not catalog work.
  - Almost every `locale_for(...)` call in `services/notifications.py` passes only the business, and one
    locale serves the client's email and SMS and the staff push for the same event. Separate client and
    staff languages need the builders' signatures to change, not only the body of `locale_for`. Connect
    does not read `navigator.languages`, nothing records a visitor's language when they book, and gift card
    recipients have no locale source.
  - Some English is written into data: the fallback invoice line "Visit" (`services/billing.py`) and the
    Stripe subscription product name, which is cached per item through `stripe_price_id`.
  - Search and sorting do not fold accents. Only the client directory search does; the command palette,
    Inbox, the booking picker and about 15 other searches use a plain lowercase match, and about 20 replica
    queries sort with SQLite `COLLATE NOCASE`, which folds ASCII only, so "Élise" sorts after "Zoé".
    `localeCompare` is called without the active locale, and Postgres has no `unaccent`.
  - Smaller items: the mobile polyfills load English Intl data only; the frontend ICU JSON and the backend
    `.po` catalog need one translation workflow and tool, and French plural rules need tests on both sides;
    `parseCents("12,50")` in English reads $1,250.00; SMS with French accents fall outside GSM-7 and cost
    more segments; the legal pages are placeholders.

### Connect, the client experience

Connect is the client-facing layer: booking, pay, shop, forms, contracts and a per-business
landing page, as a lean PowerSync-free app that can be embedded through `embed.js`. Still to come:

- **A signed-in client portal across businesses.** A new customer identity (magic link or one-time code)
  linked to each business's `clients` row through a claim flow, with reads across a customer's businesses
  (appointments, invoices, saved cards, balances, messages) and client actions (rebook, pay, reply). The
  booking and payment logic is already shared. The risk is a wrongly linked account showing one customer's
  data to another business, so we would start with a single business and add cross-business linking after.
- **Richer pages and white-label:** a real slot calendar, a multi-item cart, installable PWA, custom
  domains with host-based business lookup.
- **Public edge hardening:** bot protection on booking and pay requests, Redis-backed rate limiting, token
  expiry, a trustworthy client IP, a per-business `frame-ancestors` policy for embeds.
