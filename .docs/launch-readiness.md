# Launch readiness

The work between today and taking paying customers, as end-to-end flows. Each ticket is one flow that can
be finished and checked by hand on its own. Built says what exists in the repo today (automated tests only;
nothing has had a full manual pass yet), To do says what is left, and QA is the manual run that closes the
ticket. Tickets are written to paste into Linear as is: the heading is the title, the rest is the
description.

Priority: P0 before the first paying customer, P1 within the first month. Size: S (up to two days),
M (up to a week), L (more than a week).

| # | Ticket | Priority | Size |
|---|---|---|---|
| 1 | Business sign-up to ready to take payments | P0 | M |
| 2 | Team invites and staff access | P0 | S |
| 3 | Catalog: every kind of item, end to end | P0 | M |
| 4 | Sales tax: set up, charge, report, file | P0 | M |
| 5 | Clients: add, edit, history, pets and notes | P0 | M |
| 6 | Online booking with a deposit | P0 | S |
| 7 | Running the day's schedule | P0 | M |
| 8 | Classes, rooms and stations | P1 | M |
| 9 | Invoice to paid | P0 | M |
| 10 | Selling in person (point of sale) | P0 | M |
| 11 | Packages, subscriptions and gift cards | P0 | M |
| 12 | Interac e-Transfer | P1 | L |
| 13 | Refunds and disputes | P0 | S |
| 14 | Money close: Today, reports, payouts | P0 | S |
| 15 | Staff pay | P1 | M |
| 16 | Two-way messages | P0 | L |
| 17 | Broadcasts with consent | P0 | L |
| 18 | Reviews | P1 | M |
| 19 | Forms and contracts | P1 | M |
| 20 | Mobile apps in the stores | P0 | M |
| 21 | Platform for production | P0 | L |
| 22 | Marketing site live | P0 | S |
| 23 | Final release QA and sign-off | P0 | M |

---

## 1. Business sign-up to ready to take payments
Priority: P0 · Size: M

Flow: a new owner signs up, sets up the business, connects Stripe and can take a card payment.

Built: email and Google sign-in, password reset, onboarding (name, web address, province), business profile with colour, tagline and logo (web), Stripe Connect onboarding with status shown in Setup › Getting paid, a script that connects the demo to a Stripe test account.

To do:
- A sign-up page with its own URL, so the marketing site's Start free lands on it.
- A production email sender for verify, reset and receipts.
- Stripe test keys added locally, then one full pass in test mode.

QA:
1. From the marketing site, click Start free and sign up with a new email.
2. Verify the email, finish onboarding, set the colour and upload a logo.
3. Complete Stripe onboarding with Stripe's test identity; Getting paid reads enabled.
4. Sign out, reset the password from the email, sign in with Google on the same address.
5. Take a $10 card payment on a test invoice (card 4242).
Done when every step works on web without a workaround.

## 2. Team invites and staff access
Priority: P0 · Size: S

Flow: the owner invites a staff member, who signs in and sees only what their role allows.

Built: owner, admin and staff roles, email invites, accept-invite page, role gates on screens and on the API.

To do: a full manual pass; fix anything the pass finds.

QA:
1. Invite a staff member and an admin; accept both in other browsers.
2. As staff: see only your own bookings and hours, Payments › Sales only, Setup › Team and hours only.
3. As staff, try a refund, a void and editing another member's hours: each is refused.
4. As admin: everything except owner-only settings.
Done when each role sees and can do exactly its list, on web, iPhone and Android.

## 3. Catalog: every kind of item, end to end
Priority: P0 · Size: M

Flow: the owner creates each kind of item with all its settings, and each one sells where it should.

Built: item kinds service, class, product, package, subscription, gift card; backend fields for deposit, capacity, buffers, package sessions, subscription interval, validity, tax class, SKU, cost and stock; restock; images on web; only services and classes are bookable online. The full item editor (edit, archive, every field, stock list with low-stock flags) is being built now.

To do:
- Finish the item editor on web and mobile.
- Image upload on mobile (needs the image picker and a new native build).

QA:
1. Create one of each kind with every field it offers, and an image.
2. Edit a price and archive an item; the archived item disappears from selling screens.
3. Check each item shows where it is sold: services and classes on the booking page, products in Sales and invoices, packages, subscriptions and gift cards in their own checkout.
4. Track stock on a product: set 3, sell 2, refund 1, restock 5; the count reads 7 and the low-stock flag clears.
Done when every kind can be created, edited, sold and archived on web and mobile.

## 4. Sales tax: set up, charge, report, file
Priority: P0 · Size: M

Flow: a business turns tax on, charges the right tax per item and province, sees it in reports and records the return.

Built: tax engine for every province; tax class per item (standard, GST or HST only, exempt) copied onto each line; GST/HST report with PST and QST shown apart; recording a filed return clears tax set aside for the period.

To do:
- A switch to mark the business as tax-registered (today a new business collects no tax).
- Confirm with an accountant which services carry PST in BC, Saskatchewan and Manitoba, then set sensible defaults per item kind.
- Fix the Nova Scotia HST rate if it has changed.

QA:
1. In an Ontario business, switch tax on and invoice $100: $13 HST.
2. In a BC business, invoice a service set to GST only and a product set to standard: GST on both, PST only on the product.
3. Mark one line exempt: no tax on it.
4. Download the quarter's GST/HST report and record the return; tax set aside on Today drops by the amount filed.
Done when every figure matches a hand calculation.

## 5. Clients: add, edit, history, pets and notes
Priority: P0 · Size: M

Flow: staff keep a full record of each client and what has happened with them.

Built: add and search clients, lifetime value for owners and admins, saved cards (web and mobile) and bank accounts (web), pets, notes and tags in the data and synced to devices.

To do:
- Edit and archive a client.
- Screens for pets (and other subjects) and notes, and the pet shown on its bookings.
- A history timeline: bookings, invoices, payments and messages.
- Tags set in the app (they drive broadcast audiences).

QA:
1. Add a client on a phone; edit their phone number on web.
2. Add a pet with breed and notes; book it; the groomer sees the pet on the booking on mobile.
3. After a visit, the client's history shows the booking, invoice, payment and message.
4. Archive a client: they leave search, their invoices remain.
Done when the record reads the same on web and both phones.

## 6. Online booking with a deposit
Priority: P0 · Size: S

Flow: a client books on the business's booking page, pays a deposit, and the visit appears for staff.

Built: public booking page per business with services, staff choice, open times and the deposit checkout; embeddable on the business's site; deposits applied to the final invoice, kept on a no-show, refundable in full; new clients created from the booking.

To do: a manual pass with Stripe test keys; client self-service cancel and reschedule (P1, can follow launch).

QA:
1. As a new client on a phone, book a service with a deposit and pay with card 4242.
2. The booking appears on Schedule on web and on the staff member's phone, deposit collected.
3. Complete the visit and send the invoice: the balance is reduced by the deposit.
4. Book a second visit and mark it a no-show: the deposit is kept.
Done when the client, staff and money side all agree.

## 7. Running the day's schedule
Priority: P0 · Size: M

Flow: staff run a full day from the schedule: set hours, take and move bookings, close each visit.

Built: weekly hours per staff member; day, week, month, staff and agenda views on web (day and agenda on mobile); create, drag to reschedule, cancel; double-booking checks for staff and stations; recurring series; reminders the day before.

To do:
- Completed and No-show buttons (the backend has both).
- Time off and one-day closures.
- Edit or cancel a whole recurring series; series longer than 60 visits.
- Week view on mobile.
- Past bookings marked completed automatically.

QA:
1. Set hours, then add a day off; the booking page offers no times that day.
2. Book, drag to a new time, try to double-book (refused), complete one visit, mark another no-show.
3. Create a weekly series across a daylight-saving change; every visit keeps its time; cancel the series from a visit.
4. Repeat steps 2 and 3 on iPhone and Android.
Done when a full day can be run without leaving the schedule.

## 8. Classes, rooms and stations
Priority: P1 · Size: M

Flow: a business runs group classes and books shared rooms or stations.

Built: class capacity and seat counts in the booking engine; rooms and stations checked for clashes.

To do: screens to manage rooms and stations, pick them on a booking, and see a class roster.

QA:
1. Create a class of 6; book 6 from the booking page; the 7th is refused.
2. Open the roster: all six listed.
3. Book two services on the same station at the same time: the second is refused.
Done when classes and rooms work without touching the database.

## 9. Invoice to paid
Priority: P0 · Size: M

Flow: write an estimate, turn it into an invoice, get paid any way the client pays, and send a receipt.

Built: one editor on web and mobile for invoices and estimates, catalog or free-text lines, draft editing, send, void, accept, convert, pay link with card or Interac, tax lines per province, itemised receipts.

To do:
- Record a payment in the app: charge a saved card, or record cash or a received e-Transfer.
- PDF invoices, estimates and receipts.
- Discounts on a line or the whole invoice.

QA:
1. Write an estimate, accept it, convert it, send the invoice.
2. Record $20 cash: Partial. Charge the rest to the saved card: Paid.
3. On another invoice, pay through the pay link in a private window with card 4242.
4. Open the PDF and the receipt email: lines, tax and total are right.
Done when each way of paying ends in the right status on web and mobile.

## 10. Selling in person (point of sale)
Priority: P0 · Size: M

Flow: staff ring up services and products at the front desk and take payment.

Built: Sales on web and mobile; Tap to Pay on mobile; card payment for a sale on web (backend done, screen being built now); receipt by email or text for walk-ins; stock moves on paid and refunded sales; retail commission for the staff member on the sale; sales by item report.

To do:
- Finish the web Sales checkout and the receipt fields.
- Tips at checkout, paid to the staff member.
- A run of Tap to Pay on real phones.

QA:
1. On web, ring up a groom and a shampoo, take card 4242, send a receipt to an email.
2. On a real phone, ring up a product and pay with Tap to Pay.
3. Check stock dropped, the seller's commission shows in Staff pay, and both sales show in Sales by item.
4. Refund one sale: stock returns and the commission is reversed.
Done when a full front-desk day can be run on web and on a phone.

## 11. Packages, subscriptions and gift cards
Priority: P0 · Size: M

Flow: sell prepaid visits, memberships and gift cards, then use, renew and expire them.

Built: sell each from Sales or the client panel through its own checkout; use a package session per visit; monthly subscription charges by Stripe with an invoice each period; redeem gift cards by code; expiry books the unused balance as revenue.

To do:
- A price change reaching existing subscriptions.
- Pause a subscription.
- A full pass with Stripe's test clock.

QA:
1. Sell a 5-visit package; use two visits; 3 remain.
2. Start a subscription; advance Stripe's test clock a month; the second invoice is Paid.
3. Sell a $100 gift card; redeem $40; $60 remains.
4. Run the expiry job on an expired package and card: their balances move to revenue.
Done when every balance in the app matches what was sold, used or charged.

## 12. Interac e-Transfer
Priority: P1 · Size: L

Flow: a client pays an invoice by Interac e-Transfer and it is matched automatically.

Built: a payment request with a reference code, matched to the invoice when the transfer is reported.

To do:
- A real bank feed to report incoming transfers.
- Overpayments, short payments and expired requests handled and shown to the owner.
- A button to send a request from an invoice.

QA:
1. Request $84 from an invoice; send a matching transfer; the invoice turns Paid.
2. Send $50 against another request: it is flagged for the owner, not lost.
3. Let a request expire: it is marked expired and a new one can be sent.
Done when every transfer ends up matched or flagged.

## 13. Refunds and disputes
Priority: P0 · Size: S

Flow: return money correctly, and handle a chargeback.

Built: full, partial and repeated refunds as credit notes, refunds made in Stripe's dashboard recorded, deposits and entitlements unwound; disputes book the withdrawn funds and fee, a won dispute reverses them, inquiries move no money.

To do:
- Follow refunds that start pending or fail later.
- A disputed gift card or package is suspended, and the invoice no longer reads Paid.

QA:
1. Refund $10 of a $50 payment, then the rest: invoice reads Refunded, tax set aside drops.
2. Refund a gift card purchase in full; it can no longer be redeemed.
3. Open a test dispute on a package payment: the package is suspended; win it: restored.
Done when the money and the client's entitlements agree after each case.

## 14. Money close: Today, reports, payouts
Priority: P0 · Size: S

Flow: at the end of a day or a month, every money figure agrees with Stripe and the bank.

Built: Today (revenue, awaiting payment, tax set aside, recent activity), income, GST/HST, T4A and sales-by-item reports with CSV, Stripe payouts under Reports, Stripe fees per payment, a nightly check against Stripe's balance.

To do:
- Today's schedule and the next GST filing date on Today.
- Retry the fee lookup when Stripe hasn't settled it yet.

QA:
1. After a day of test sales, compare Today, the income report and Stripe's test balance: equal to the cent.
2. Check each payment's fee against Stripe's dashboard.
3. When a test payout lands, it shows under Reports › Bank deposits.
Done when nothing needs to be explained away.

## 15. Staff pay
Priority: P1 · Size: M

Flow: staff earn from their work, the owner approves and pays, and the year-end slip adds up.

Built: earnings from paid booking invoices and from retail sales (commission rate per staff member), approve, mark paid, T4A report.

To do:
- Set each staff member's pay and commission in Team and hours (being built now).
- Earnings from tips and from invoice lines that aren't bookings.

QA:
1. Set a staff member to 40% on services and 10% on retail.
2. They complete a $100 groom and sell a $30 product: earnings $40 and $3.
3. Approve and mark paid; the T4A for the year includes $43.
Done when earnings match the rates by hand.

## 16. Two-way messages
Priority: P0 · Size: L

Flow: staff text and email clients and replies come back to the right business.

Built: inbox threads by text and email, new message, reply; one shared text number.

To do:
- A text number per business, with replies routed by number so they can't reach another business.
- Check the text provider's signature on incoming messages.

QA:
1. Text a client; reply from their phone; the reply lands in the same thread on web and mobile.
2. Two businesses text the same client phone; each reply reaches only the business it answers.
Done when no reply can reach the wrong business.

## 17. Broadcasts with consent
Priority: P0 · Size: L

Flow: the owner sends a broadcast that reaches only clients who agreed to hear from them.

Built: scheduled broadcasts to tagged clients.

To do: a consent record per client, an unsubscribe link, STOP handling for texts, a suppression list (required under CASL).

QA:
1. Unsubscribe one client by link and reply STOP from another.
2. Send a broadcast to their tag: neither receives it, the rest do.
3. Each client's consent and opt-out date shows on their record.
Done when an opted-out client can't be messaged by a broadcast.

## 18. Reviews
Priority: P1 · Size: M

Flow: ask for a review after a visit, collect it, and choose what is shown.

Built: review requests after a visit, reply, hide and publish.

To do: low ratings held for approval; sharing a review to Google.

QA:
1. After two visits, leave a 2-star and a 5-star review.
2. The 2-star waits for approval; the 5-star publishes.
3. Reply to one and share the other to Google.
Done when nothing low-rated publishes without the owner's choice.

## 19. Forms and contracts
Priority: P1 · Size: M

Flow: send an intake form and a contract, the client completes and signs, and the business keeps a copy.

Built: form builder and contract drafts on web, online signing with a record of time and IP.

To do: a signed PDF with the audit details; the builder on mobile; size and type limits on uploads.

QA:
1. Build an intake form and a contract; send both to a client.
2. Complete and sign them on a phone.
3. Download the signed PDF; it shows the signature, time and IP.
Done when a signed contract can be produced on request.

## 20. Mobile apps in the stores
Priority: P0 · Size: M

Flow: staff install the app from the App Store or Play Store and run their day on it.

Built: iPhone and Android apps with the same screens as web, offline use, push notifications, Tap to Pay, the new app icon.

To do:
- Signing, store listings and production builds pointed at production.
- Push certificates for production.
- Image upload (shared with ticket 3).

QA:
1. Install from TestFlight and the Play internal track; sign in as owner and as staff.
2. Turn on airplane mode, add a note, reconnect: the note reaches web.
3. Book online and check the staff phone gets a push.
Done when both store builds pass every mobile step in tickets 2, 5, 7 and 10.

## 21. Platform for production
Priority: P0 · Size: L

Flow: the system runs in production, is backed up, and tells us when something breaks.

Built: local Docker stack; CI builds and tests every app; production secrets checked at startup; Stripe integration with a pinned API version.

To do:
- Production hosting for the API, the job worker, web, Connect and the marketing site on their subdomains.
- Daily backups and point-in-time recovery, with one timed restore.
- Error tracking with alerts on every surface.
- Production CORS allow-list and security headers.
- Stripe live keys and the live webhook endpoint at the pinned version; the platform fee amount.

QA:
1. Deploy a tagged build to staging and run tickets 1 to 20 there.
2. Restore last night's backup into a scratch database and open a business from it.
3. Trigger a test error on each surface: an alert arrives with the stack trace.
4. Take one real $1 card payment in live mode and refund it.
Done when staging passes and the restore drill is timed and written down.

## 22. Marketing site live
Priority: P0 · Size: S

Flow: a visitor reads the site, trusts what it says, and signs up.

Built: home, features, solutions and eight trade pages, pricing, legal page shells, credits; static pages with content, link, accessibility and Lighthouse checks in CI.

To do:
- Privacy policy and terms from a lawyer; prices and the platform fee; a real contact address.
- Remove or build every capability a page describes that doesn't exist yet (live class spots, pausing a membership, sharing reviews to Google, "on the way" texts).
- Point Start free at the sign-up page and deploy on the main domain.

QA:
1. Search the built site for "[" placeholders: none.
2. Walk each trade page against the app; every claim holds.
3. From the live site, Start free creates an account and Sign in reaches the app.
Done when the live site makes no claim the product can't back.

## 23. Final release QA and sign-off
Priority: P0 · Size: M

Flow: one full pass of the product as owners, staff and clients use it, across devices, before launch.

Setup: staging with Stripe in test mode; owner hannah@birchbarkpets.ca and staff priya@birchbarkpets.ca, password demo1234; Chrome and Safari on a laptop, one iPhone and one Android phone with the store builds.

QA:
1. Owner day on web: schedule, a walk-in, two invoices paid by pay link and saved card, a gift card and a package sold, one refund.
2. Staff day on iPhone, then Android: own bookings, move one, add a client note, collect a deposit, a Tap to Pay sale.
3. Client side on a phone: book with a deposit, fill a form, sign a contract, pay an invoice, leave a review.
4. Money: Today, the income report, the GST/HST report, staff pay and Stripe's balance agree to the cent.
5. Sync: the same change made on web and a phone at once, and changes made offline, end up the same everywhere.
6. Log each failure as a bug linked to its ticket, with the step, the result, the expected result, the device and a screenshot.
Done when every P0 ticket is done, this pass is clean, no P0 bug is open, and both founders sign off.
