# Launch readiness

What has to be built, fixed and checked by hand before Clientbridge takes paying customers. Groups run
from the platform and the core of the product outward. Each group is an epic and each ticket is written to
paste into Linear or Jira as is: the heading is the title, the first line holds the fields, and the lines
below are the description. Every group starts with its own QA run, and group 13 is the final release pass.

**Fields.** Status: Done (built and tested, needs a manual pass), Needs work (usable, with gaps), Not built,
or To do for the final QA tickets.
Priority: P0 before the first paying customer, P1 within the first month, P2 later. Size: S (up to two days),
M (up to a week), L (more than a week). The label is the group code.

**Summary.** 62 product tickets: 26 Done, 15 Needs work, 21 Not built. 40 are P0, and 18 of those are still open. Group 13 adds 6 final QA tickets.

| Group | Tickets | P0 open (Needs work or Not built) |
|---|---|---|
| PLT Platform and launch | 6 | 5 |
| ACC Accounts and setup | 6 | 1 |
| SCH Schedule and bookings | 7 | 1 |
| CLI Clients | 6 | 1 |
| CAT Catalog | 2 | 1 |
| INV Invoices and estimates | 6 | 1 |
| PAY Payments | 7 | 0 |
| ENT Packages, subscriptions, gift cards | 3 | 2 |
| MON Money and reports | 4 | 0 |
| MSG Messages and reviews | 5 | 2 |
| APP Customer pages and apps | 6 | 1 |
| WEB Marketing site | 4 | 3 |
| QA Final QA round | 6 | 6 (all To do) |

---

## 1. PLT Platform and launch

Group QA, runs on its own once the group's tickets are done.
Setup: staging environment, access to the hosting account, the Stripe dashboard.
Run: deploy a tagged build to staging, restore last night's backup into a scratch database, trigger one test error on each surface, scan the response headers, then take a $1 live charge and refund it.
Done when: every PLT ticket passes on staging.

### PLT-1 Production hosting for the API, worker and front ends
Status: Not built · Priority: P0 · Size: L · Label: PLT
Built: local Docker stack; CI builds and tests every app.
Remaining: production images for the API and the job worker, a process manager, and deploys for web, Connect and the marketing site on their subdomains.
QA: deploy to a staging environment and run the full QA pass there.

### PLT-2 Database backups and a restore drill
Status: Not built · Priority: P0 · Size: M · Label: PLT
Built: nothing beyond the local database.
Remaining: daily backups and point-in-time recovery for Postgres and the sync database, plus one timed restore.
QA: restore last night's backup into a scratch database and open the demo business from it.

### PLT-3 Error tracking and alerts
Status: Not built · Priority: P0 · Size: S · Label: PLT
Built: nothing.
Remaining: error capture with alerts for the API, worker, web, Connect and both mobile apps.
QA: trigger a test error on each surface and check it arrives with a stack trace and the user's business.

### PLT-4 Production CORS and security headers
Status: Not built · Priority: P0 · Size: S · Label: PLT
Built: production secrets are checked at startup; cross-origin access is open to localhost only.
Remaining: an allow-list of the production origins, plus HSTS, CSP, frame and host protection.
QA: sign in on the production web app and load Today; check the response headers with a header scanner.

### PLT-5 Stripe test pass and live setup
Status: Needs work · Priority: P0 · Size: S · Label: PLT
Built: Stripe Connect, pinned API version, webhooks, and a script that connects the demo business to a test account.
Remaining: add test keys and run every card flow; then live keys, the live webhook endpoint at the pinned version, and the platform fee amount.
QA: run the PAY tickets in test mode, then take one real $1 charge in live mode and refund it.

### PLT-6 Muted text contrast in the shared theme
Status: Needs work · Priority: P1 · Size: S · Label: PLT
Built: the marketing site uses a darker muted grey that passes.
Remaining: the shared muted grey measures about 4.2:1 on light grey, below the 4.5:1 standard, in the web and mobile apps.
QA: check muted text on Today and Clients with a contrast checker on web, iPhone and Android.

---

## 2. ACC Accounts and setup

Group QA, runs on its own once the group's tickets are done.
Setup: a fresh email address, a second browser, Stripe test keys.
Run: sign up a new business, finish onboarding, switch tax on, set the colour and logo, complete Stripe onboarding, invite a staff member and accept in the second browser.
Done when: the new business can take a card payment, and the staff member sees only what their role allows.

### ACC-1 Sign up, sign in, Google sign-in, password reset
Status: Done · Priority: P0 · Size: S · Label: ACC
Built: email and password, Google sign-in, rotating sessions, reset and verify emails.
Remaining: a sign-up page with its own link (the marketing site's Start free lands on sign-in), and a production email sender.
QA: sign up a new business, sign out and in, reset the password from the email, sign in with Google.

### ACC-2 Onboarding
Status: Done · Priority: P0 · Size: S · Label: ACC
Built: business name, web address and province, then Today.
Remaining: none beyond ACC-4.
QA: a new account lands on onboarding, then Today, and every empty screen explains what to do next.

### ACC-3 Team, roles and invites
Status: Done · Priority: P0 · Size: S · Label: ACC
Built: owner, admin and staff roles; email invites; staff see their own bookings and hours, Payments › Sales and Setup › Team and hours.
Remaining: none known.
QA: invite a staff member, accept in another browser, and check they can't open other Payments tabs, other staff hours or business settings.

### ACC-4 Switch on tax collection
Status: Not built · Priority: P0 · Size: S · Label: ACC
Built: the tax engine for every province, and a GST/HST number field.
Remaining: no switch to mark a business as tax-registered, so a new business collects no tax.
QA: register an Ontario business, switch tax on, issue a $100 invoice and check $13 HST.

### ACC-5 Business profile and branding
Status: Done · Priority: P1 · Size: S · Label: ACC
Built: name, contact details, timezone, province, brand colour, tagline and logo upload on web.
Remaining: logo upload on mobile (APP-4).
QA: upload a logo and change the colour, then check the booking and pay pages use both.

### ACC-6 Getting paid (Stripe onboarding)
Status: Done · Priority: P0 · Size: S · Label: ACC
Built: Stripe Connect onboarding from Setup › Getting paid, with verification status shown.
Remaining: a run with real test keys (PLT-5).
QA: start onboarding, complete Stripe's test identity, and check status reads enabled and a card can be charged.

---

## 3. SCH Schedule and bookings

Group QA, runs on its own once the group's tickets are done.
Setup: the demo business, owner on web, staff on a phone, Stripe test keys.
Run: set a staff member's hours, book online with a deposit, see it on the staff phone, move it, mark it completed and invoice it; book a second visit and mark it a no-show; create a weekly series.
Done when: the deposit is applied on the first visit, kept on the no-show, and every visit shows on both devices.

### SCH-1 Working hours and closures
Status: Needs work · Priority: P1 · Size: M · Label: SCH
Built: weekly hours per staff member on web and mobile; open times and the booking page respect them, including one-day closures stored in the data.
Remaining: no screen to add time off or close a single day.
QA: set one staff member to Tuesday to Saturday, 10 to 4, check the booking page offers no Monday times for them, and check other staff are unaffected.

### SCH-2 Create, move, cancel, complete and no-show
Status: Needs work · Priority: P0 · Size: S · Label: SCH
Built: new booking from Schedule (web) and the + menu (mobile), drag to reschedule, cancel, and double-booking checks for staff and stations.
Remaining: no Completed or No-show button (the backend has both); mobile shows only the day and agenda views.
QA: book, drag to a new time, try to double-book the same person (refused), mark completed, then cancel another. Repeat on iPhone and Android.

### SCH-3 Recurring bookings
Status: Needs work · Priority: P1 · Size: M · Label: SCH
Built: weekly or monthly series with a set number of visits, created from one form.
Remaining: the whole series can't be edited or cancelled, a series stops at 60 visits, and the client gets one confirmation per visit.
QA: create a weekly series of 6 across a daylight-saving change, check every visit keeps its local time, then cancel one visit.

### SCH-4 Deposits
Status: Done · Priority: P0 · Size: S · Label: SCH
Built: a fixed or percentage deposit per service, collected online or from the booking, applied to the final invoice, kept on a no-show, refundable in full.
Remaining: marking a no-show needs the button from SCH-2.
QA (Stripe test keys): book a deposit service online with card 4242, check the deposit shows as collected, then send the invoice and check the balance drops by the deposit.

### SCH-5 Online booking page
Status: Done · Priority: P0 · Size: S · Label: SCH
Built: a public page per business with services, staff choice, open times and the deposit checkout; it can be embedded on the business's own site.
Remaining: clients can't cancel or reschedule from it.
QA: open Birchbark's booking page, book as a new client, and check the booking appears on Schedule and the client is created.

### SCH-6 Classes, rooms and stations
Status: Not built · Priority: P1 · Size: M · Label: SCH
Built: class capacity and seat counts in the booking engine; rooms and stations are checked for clashes.
Remaining: screens to manage rooms and stations and to see a class roster.
QA: create a class of 6, book 6 from the booking page, check the 7th is refused and the roster lists all six.

### SCH-7 Reminders and end-of-day upkeep
Status: Needs work · Priority: P1 · Size: S · Label: SCH
Built: a reminder the day before each booking, sent by email or text.
Remaining: reminder timing isn't configurable, and past bookings are never marked completed automatically.
QA: book for tomorrow, run the reminder job, check the message arrives with the right time and address.

---

## 4. CLI Clients

Group QA, runs on its own once the group's tickets are done.
Setup: the demo business, owner on web and a phone.
Run: add a client on the phone, edit them on web, add a pet and a note, book the pet, tag two clients, archive a third.
Done when: every change shows on both devices and nothing linked to the archived client is lost.

### CLI-1 Add and find clients
Status: Done · Priority: P0 · Size: S · Label: CLI
Built: add with name, email and phone; search; lifetime value for owners and admins.
Remaining: none.
QA: add a client on mobile, find them by name and phone on web.

### CLI-2 Edit and archive clients
Status: Not built · Priority: P0 · Size: S · Label: CLI
Built: nothing; the app is add-only.
Remaining: edit contact details and status; archive a client without losing their history.
QA: edit a phone number on web and see it on mobile; archive a client and check they leave search but their invoices remain.

### CLI-3 Notes and pets (subjects)
Status: Not built · Priority: P1 · Size: M · Label: CLI
Built: notes and subjects (pets, vehicles, children) exist in the data and sync to devices.
Remaining: screens to add and edit them, and to show the pet on bookings.
QA: add a pet with breed and notes, book it, check the pet shows on the booking for the groomer on mobile.

### CLI-4 Client history
Status: Not built · Priority: P1 · Size: M · Label: CLI
Built: the client panel shows saved methods, subscriptions and packages.
Remaining: bookings, invoices, payments and messages on one timeline.
QA: open a regular client and check the last three visits, their invoices and the latest message are all listed.

### CLI-5 Tags and merging duplicates
Status: Not built · Priority: P2 · Size: M · Label: CLI
Built: tags exist in the data and drive broadcast audiences.
Remaining: set tags in the app; merge two duplicate clients.
QA: tag two clients, send a broadcast to the tag; merge a duplicate and check bookings and invoices move over.

### CLI-6 Saved cards and bank accounts
Status: Done · Priority: P0 · Size: S · Label: CLI
Built: add a card on web and mobile, add a bank account (pre-authorized debit) on web, make default, remove; only chargeable methods can be default.
Remaining: bank account entry on mobile.
QA (Stripe test keys): add card 4242 on mobile, make it default, then remove the older card.

---

## 5. CAT Catalog

Group QA, runs on its own once the group's tickets are done.
Setup: the owner on web.
Run: create one item of each kind (a service with a deposit and buffer, a class with capacity, a product, a package, a subscription, a gift card) and give each an image.
Done when: each item appears where it is sold: booking page, Sales, the invoice editor and the client panel.

### CAT-1 Full item editor
Status: Needs work · Priority: P0 · Size: M · Label: CAT
Built: create services, classes, products, packages, subscriptions and gift cards with name, kind, price, duration and category.
Remaining: the editor sets 5 of about 20 fields, so deposits, capacity, buffers, package sessions, subscription interval and validity can't be set; items can't be edited or archived.
QA: create a 5-visit package valid for a year and a monthly subscription, then sell each (ENT-1, ENT-2).

### CAT-2 Item images
Status: Done · Priority: P1 · Size: S · Label: CAT
Built: upload or replace an image on web; shown in Sales, the invoice editor and the booking page.
Remaining: upload on mobile (APP-4).
QA: upload an image for a service and check it on the booking page and in Sales on both apps.

---

## 6. INV Invoices and estimates

Group QA, runs on its own once the group's tickets are done.
Setup: the demo business, Stripe test keys, a private window.
Run: write an estimate, accept and convert it, send the invoice, record $20 cash, pay the rest through the pay link, open the PDF, refund part of the card payment.
Done when: the invoice moves through Draft, Sent, Partial, Paid and the refund, and Today matches at each step.

### INV-1 Create and edit invoices and estimates
Status: Done · Priority: P0 · Size: S · Label: INV
Built: one editor on web and mobile, lines from the catalog or free text, edit while in draft, subtotal, tax lines and total.
Remaining: none.
QA: create a draft from two catalog items, edit a line, and check the tax lines match the province.

### INV-2 Send, void and convert
Status: Done · Priority: P0 · Size: S · Label: INV
Built: send an invoice, void it (blocked while a payment is in progress), accept or decline an estimate and convert it to an invoice.
Remaining: none.
QA: send an estimate, accept it, convert it, send the invoice, then void a different unpaid invoice.

### INV-3 Pay link
Status: Done · Priority: P0 · Size: S · Label: INV
Built: a public page where the client pays an invoice by card or starts an Interac e-Transfer.
Remaining: a run with real test keys.
QA (Stripe test keys): copy the pay link, pay in a private window with card 4242, check the invoice turns Paid on web and mobile.

### INV-4 Record a payment in the app
Status: Not built · Priority: P0 · Size: M · Label: INV
Built: the backend endpoint exists; payment happens only through the pay link.
Remaining: charge a saved card, or record cash or a received e-Transfer, from the invoice.
QA: record $20 cash on a $50 invoice, check it reads Partial, then charge the rest to the saved card.

### INV-5 PDF invoices, estimates and receipts
Status: Not built · Priority: P1 · Size: M · Label: INV
Built: clients get a web link only.
Remaining: a PDF attached to the email and downloadable from the app.
QA: send an invoice and open the attached PDF; check totals, tax lines and the GST/HST number.

### INV-6 Discounts and tips
Status: Not built · Priority: P1 · Size: M · Label: INV
Built: nothing.
Remaining: line and invoice discounts; a tip at checkout that goes to the staff member's pay.
QA: discount a line 10%, add a $10 tip, check the total, the tax and the staff member's earnings.

---

## 7. PAY Payments

Group QA, runs on its own once the group's tickets are done.
Setup: Stripe test keys, the Stripe test dashboard open, a real phone for Tap to Pay.
Run: pay online with a good, a declined and a 3D Secure card, charge a saved card, tap a card on the phone, match an Interac transfer, refund part of a payment, open a test dispute.
Done when: each payment's state, fee and payout match the Stripe dashboard.

### PAY-1 Card payments and saved cards
Status: Done · Priority: P0 · Size: S · Label: PAY
Built: one checkout on web, mobile and the public pages for deposits, gift cards, packages, subscriptions and pay links; one idempotency key per attempt.
Remaining: a run with real test keys.
QA (Stripe test keys): pay with 4242, a declined card (4000 0000 0000 0002) and a 3D Secure card (4000 0025 0000 3155); each ends in the right state.

### PAY-2 Tap to Pay on mobile
Status: Done · Priority: P0 · Size: S · Label: PAY
Built: Stripe Terminal on iPhone and Android for point-of-sale orders.
Remaining: a run on real devices with live hardware support.
QA: ring up a sale on a real phone and tap a test card; check the order is Paid and the receipt is sent.

### PAY-3 Card payment at the web point of sale
Status: Not built · Priority: P1 · Size: M · Label: PAY
Built: web Sales builds the order and leaves it open for Tap to Pay on mobile.
Remaining: a backend path to pay an order with an online card, then the web checkout.
QA: ring up a sale on web and pay with card 4242.

### PAY-4 Interac e-Transfer
Status: Needs work · Priority: P1 · Size: L · Label: PAY
Built: a payment request with a reference code, matched to the invoice when the transfer arrives.
Remaining: a real bank feed; overpayments, short payments and expired requests; a button to send a request from an invoice.
QA: request $84, send a matching transfer, check the invoice turns Paid; send $50 against another request and check it is flagged, not lost.

### PAY-5 Refunds
Status: Done · Priority: P0 · Size: S · Label: PAY
Built: full, partial and repeated refunds, booked as credit notes; Stripe dashboard refunds are recorded too.
Remaining: follow a refund that starts pending or fails later.
QA: refund $10 of a $50 payment, then the rest; check the invoice reads Refunded and the tax set aside drops.

### PAY-6 Disputes
Status: Needs work · Priority: P1 · Size: S · Label: PAY
Built: the withdrawn funds and fee are booked; a won dispute reverses them; inquiries move no money.
Remaining: a disputed gift card or package stays usable, and the invoice stays Paid.
QA: trigger a test dispute on a gift card payment and check the card is suspended.

### PAY-7 Payouts and fees
Status: Done · Priority: P0 · Size: S · Label: PAY
Built: Stripe fees per payment, payouts listed under Reports › Bank deposits, a nightly check against Stripe's balance.
Remaining: retry the fee lookup when Stripe hasn't settled it yet.
QA: after a test payment, check the fee matches Stripe's dashboard and the payout appears when it is paid.

---

## 8. ENT Packages, subscriptions and gift cards

Group QA, runs on its own once the group's tickets are done.
Setup: the catalog items from CAT, Stripe test keys with a test clock.
Run: sell a package and use a visit, run the expiry job on an expired package, start a subscription and advance the test clock a month, sell a gift card and redeem part of it.
Done when: every balance shown in the app matches what was sold, used, expired or charged.

### ENT-1 Packages
Status: Needs work · Priority: P0 · Size: S · Label: ENT
Built: sell from the client panel or Sales, use a session per visit, expire with the unused balance booked as revenue.
Remaining: depends on CAT-1 to create a package item.
QA: sell a 5-visit package, use two visits, check 3 remain and revenue rose by two fifths.

### ENT-2 Subscriptions
Status: Needs work · Priority: P0 · Size: M · Label: ENT
Built: start on a saved card, charged monthly by Stripe, an invoice each period, past-due and cancel.
Remaining: depends on CAT-1; a price change doesn't reach existing subscriptions; no pause.
QA (Stripe test keys): start a subscription, advance Stripe's test clock a month, check the second invoice is Paid.

### ENT-3 Gift cards
Status: Done · Priority: P1 · Size: S · Label: ENT
Built: sell on web and mobile, redeem by code, expire with the unused balance booked as revenue.
Remaining: none.
QA: sell a $100 card, redeem $40 at checkout, check $60 remains.

---

## 9. MON Money and reports

Group QA, runs on its own once the group's tickets are done.
Setup: run this after the PAY and ENT groups so there is test money to check.
Run: compare Today, the income report, the GST/HST report and the Stripe balance; record a GST return; approve and pay one staff earning; download the T4A.
Done when: all four money figures agree to the cent and the GST set aside drops by the amount filed.

### MON-1 Ledger accuracy
Status: Done · Priority: P0 · Size: S · Label: MON
Built: every money movement posts a balanced journal; covered by backend tests.
Remaining: a manual cross-check.
QA: after a day of test sales, check Today revenue, the income report and Stripe's balance agree to the cent.

### MON-2 Today
Status: Done · Priority: P0 · Size: S · Label: MON
Built: revenue today, awaiting payment, GST/HST set aside, recent activity.
Remaining: today's schedule on the same screen; the next GST filing date.
QA: take a payment and check Today updates on web and mobile within a few seconds.

### MON-3 Reports and tax remittance
Status: Done · Priority: P0 · Size: S · Label: MON
Built: income, GST/HST (PST and QST shown apart), T4A, CSV downloads, and recording a filed return.
Remaining: none.
QA: download the quarter's GST/HST CSV, record the return, check the set-aside figure drops by the amount filed.

### MON-4 Staff pay
Status: Needs work · Priority: P1 · Size: M · Label: MON
Built: earnings from paid booking invoices, approve, mark paid.
Remaining: earnings from point-of-sale sales, tips and non-booking invoice lines.
QA: complete and invoice a booking, pay it, approve and mark the earning paid; check the T4A figure.

---

## 10. MSG Messages and reviews

Group QA, runs on its own once the group's tickets are done.
Setup: two test phones or the text provider's test numbers, two businesses sharing one client phone number.
Run: text a client and reply, broadcast to a tag where one client unsubscribed and one replied STOP, request two reviews and leave one low and one high rating.
Done when: replies reach only the right business, opted-out clients get nothing, and the low rating waits for approval.

### MSG-1 Inbox
Status: Done · Priority: P0 · Size: S · Label: MSG
Built: two-way threads by text and email, new message, reply.
Remaining: none beyond MSG-2.
QA: message a client by text, reply from the phone, check the reply lands in the same thread on web and mobile.

### MSG-2 A text number per business
Status: Not built · Priority: P0 · Size: L · Label: MSG
Built: one shared number; replies are routed by matching the client's phone across businesses.
Remaining: a number per business and routing by number, so replies can't reach the wrong business; verify the provider's signature on incoming texts.
QA: two businesses share a client's phone number; a reply reaches only the business that texted.

### MSG-3 Broadcast consent and opt-out
Status: Not built · Priority: P0 · Size: L · Label: MSG
Built: scheduled broadcasts to tagged clients.
Remaining: a consent record per client, an unsubscribe link, STOP handling for texts, a suppression list (required under CASL).
QA: unsubscribe one client and reply STOP from another; a new broadcast reaches neither.

### MSG-4 Reviews
Status: Needs work · Priority: P1 · Size: M · Label: MSG
Built: review requests after a visit, reply, hide and publish.
Remaining: low ratings publish automatically; sharing a review to Google isn't connected.
QA: leave a 2-star and a 5-star review; check the 2-star waits for approval.

### MSG-5 Message templates
Status: Not built · Priority: P2 · Size: M · Label: MSG
Built: free text only.
Remaining: saved templates with client name, date and time filled in.
QA: send a template to two clients and check each gets their own details.

---

## 11. APP Customer pages and apps

Group QA, runs on its own once the group's tickets are done.
Setup: TestFlight and Play internal builds, one iPhone and one Android phone.
Run: install both apps, sign in, add a note offline and reconnect, receive a push for a new online booking, upload a service image, sign a contract on the phone.
Done when: every step works on both phones.

### APP-1 Public pay, form, contract and review pages
Status: Done · Priority: P0 · Size: S · Label: APP
Built: branded pages for each, opened from emailed or texted links.
Remaining: none.
QA: open each link in a private window on a phone and complete it.

### APP-2 Forms and contracts
Status: Needs work · Priority: P1 · Size: M · Label: APP
Built: form builder and contract drafts on web, online signing with a record of time and IP.
Remaining: a signed PDF, the builder on mobile, size and type limits on uploads.
QA: send a contract, sign it on a phone, check the signed record and download it.

### APP-3 App Store and Play Store builds
Status: Not built · Priority: P0 · Size: M · Label: APP
Built: iPhone and Android apps run from development builds.
Remaining: signing, store listings, production builds pointed at production, push certificates.
QA: install from TestFlight and the Play internal track, sign in, run the mobile parts of this list.

### APP-4 Image and logo upload on mobile
Status: Not built · Priority: P1 · Size: S · Label: APP
Built: upload works on web.
Remaining: add the image picker (needs a new native build) and the upload screens.
QA: upload a service image from the phone's photos and check it on web.

### APP-5 Offline use
Status: Done · Priority: P0 · Size: S · Label: APP
Built: the schedule, clients and notes are stored on the device and sync when back online.
Remaining: a manual pass.
QA: put the phone in airplane mode, open Schedule and a client, add a note, reconnect and check it reaches web.

### APP-6 Push notifications
Status: Done · Priority: P1 · Size: S · Label: APP
Built: push for new bookings, payments and messages.
Remaining: a run on real devices.
QA: book online and check the staff member's phone gets a notification.

---

## 12. WEB Marketing site

Group QA, runs on its own once the group's tickets are done.
Setup: the built site, a laptop and a phone.
Run: open every page at both widths, follow every button and link, search the pages for "[" placeholders, then use Start free to create an account.
Done when: no broken links, no placeholders, and Start free ends in a working account.

### WEB-1 Pages and quality checks
Status: Done · Priority: P0 · Size: S · Label: WEB
Built: home, features, solutions and eight trade pages, pricing, legal, credits; static pages with content, accessibility, link and Lighthouse checks in CI.
Remaining: none.
QA: open every page at phone and desktop width; follow every button.

### WEB-2 Legal text, pricing and contact
Status: Not built · Priority: P0 · Size: S · Label: WEB
Built: page shells with marked placeholders.
Remaining: privacy policy and terms from a lawyer, prices, the platform fee, a real contact address.
QA: search the built site for "[" placeholders; none remain.

### WEB-3 Check every product claim
Status: Needs work · Priority: P0 · Size: S · Label: WEB
Built: copy written as the finished product.
Remaining: every capability a page describes must exist or be removed (live class spots, pausing a membership, sharing reviews to Google, "on the way" texts); confirm BC PST on pet grooming and the Nova Scotia HST rate (the app's table says 15%).
QA: walk each trade page against this list and the app.

### WEB-4 Sign-up link and deploy
Status: Not built · Priority: P0 · Size: S · Label: WEB
Built: the site builds to static files; links come from settings.
Remaining: point Start free at the sign-up page (ACC-1), deploy on the main domain, set the production URLs.
QA: from the live site, Start free creates an account and Sign in reaches the app.

---

## 13. QA Final QA round

The release pass, run once every P0 ticket is Done and its group QA has passed. It checks the product as
customers and staff will use it, across devices, rather than one feature at a time.

Setup: staging (PLT-1) with Stripe in test mode and the demo business connected (PLT-5). Logins: owner
hannah@birchbarkpets.ca and staff priya@birchbarkpets.ca, password demo1234. Devices: Chrome and Safari on
a laptop, one iPhone and one Android phone with the store builds (APP-3).

Logging a failure: open a bug linked to the ticket being tested, with the step, what happened, what should
have happened, the device and a screenshot. Any P0 bug blocks QA-6.

### QA-1 Owner day on web
Status: To do · Priority: P0 · Size: M · Label: QA
Run: start at Today, check the schedule, take a walk-in booking, invoice two visits, take payment by pay link and saved card, sell a gift card and a package, refund one payment, record the day's numbers.
Pass: every step works without a workaround and Today matches the payments taken.

### QA-2 Staff day on a phone
Status: To do · Priority: P0 · Size: M · Label: QA
Run: sign in as staff on iPhone, then Android; check the day's bookings, move one, add a client note, collect a deposit on your own booking, ring up a Tap to Pay sale.
Pass: staff can do their own work and can't open other staff, settings or money screens.

### QA-3 Client side
Status: To do · Priority: P0 · Size: S · Label: QA
Run: on a phone in a private browser, book online with a deposit, fill in the intake form, sign the contract, pay an invoice by card and by Interac, leave a review.
Pass: each page is branded, works on a phone and lands in the business's app within a minute.

### QA-4 Money reconciliation
Status: To do · Priority: P0 · Size: S · Label: QA
Run: after QA-1 to QA-3, compare Today, the income report, the GST/HST report, staff pay and the Stripe test balance.
Pass: the figures agree to the cent.

### QA-5 Devices, offline and sync
Status: To do · Priority: P0 · Size: S · Label: QA
Run: make the same change on web and on a phone at once, then put the phone in airplane mode, make changes, and reconnect.
Pass: both devices end up with the same data and nothing is lost or duplicated.

### QA-6 Launch sign-off
Status: To do · Priority: P0 · Size: S · Label: QA
Run: confirm every P0 ticket is Done, every group QA passed, QA-1 to QA-5 passed, and no P0 bug is open.
Pass: both founders sign off.
