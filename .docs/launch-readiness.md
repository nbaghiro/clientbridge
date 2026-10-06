# Launch readiness

The work between today and taking paying customers, grouped into 10 epics and 41 stories. Each story is one flow that can be built and checked by hand on its own across the backend, web and mobile, once the stories it depends on are done. Built says what exists in the repo today, To do says what is left, and QA is the manual run that closes the story. Each epic ends with its own QA pass, and the last story is the full release pass.

Jira is the working copy: project ENG at https://clientbridge-ca.atlassian.net/jira/software/c/projects/ENG/boards/3. Dependencies are Blocks links there.

Priority: P0 before the first paying customer, P1 within the first month, P2 after. Size: S (up to two days), M (up to a week), L (more than a week).

| Epic | Story | Key | Priority | Size |
|---|---|---|---|---|
| 1. Accounts and settings | Sign-up, sign-in and password reset | ENG-2 | P0 | S |
| 1. Accounts and settings | Onboarding, business profile and branding | ENG-3 | P0 | S |
| 1. Accounts and settings | Team invites and roles | ENG-4 | P0 | S |
| 1. Accounts and settings | Stripe connect and payout status | ENG-5 | P0 | S |
| 1. Accounts and settings | Tax registration and per-item tax classes | ENG-6 | P0 | M |
| 2. Clients | Client records: add, edit, archive, search | ENG-8 | P0 | S |
| 2. Clients | Pets and other subjects on clients | ENG-9 | P0 | M |
| 2. Clients | Notes and client history timeline | ENG-10 | P1 | M |
| 2. Clients | Saved cards and bank accounts | ENG-11 | P0 | S |
| 2. Clients | Tags and duplicate merging | ENG-12 | P2 | M |
| 3. Catalog and inventory | Services and classes: duration, buffers, capacity, deposits | ENG-14 | P0 | S |
| 3. Catalog and inventory | Products: SKU, cost, price, images (web and mobile) | ENG-15 | P0 | M |
| 3. Catalog and inventory | Stock tracking, low stock and restock | ENG-16 | P0 | S |
| 3. Catalog and inventory | Packages, memberships and gift card items | ENG-17 | P0 | S |
| 4. Scheduling | Staff hours, time off and closures | ENG-19 | P0 | M |
| 4. Scheduling | Calendar: create, move, cancel, complete, no-show | ENG-20 | P0 | M |
| 4. Scheduling | Recurring bookings | ENG-21 | P1 | M |
| 4. Scheduling | Classes, rooms and stations | ENG-22 | P1 | M |
| 4. Scheduling | Reminders and end-of-day completion | ENG-23 | P1 | S |
| 5. Online booking and shop | Booking page with deposits and embedding | ENG-25 | P0 | S |
| 5. Online booking and shop | Booking add-ons | ENG-26 | P1 | S |
| 5. Online booking and shop | Online shop and pickup orders | ENG-27 | P1 | M |
| 5. Online booking and shop | Client self-service cancel and reschedule | ENG-28 | P1 | M |
| 6. Front desk sales and orders | Sales with services and products | ENG-30 | P0 | S |
| 6. Front desk sales and orders | Card and Tap to Pay checkout with receipts | ENG-31 | P0 | M |
| 6. Front desk sales and orders | Tips at checkout | ENG-32 | P0 | M |
| 6. Front desk sales and orders | Discounts | ENG-33 | P0 | M |
| 7. Invoices and payments | Estimates: create, send, accept, convert | ENG-35 | P0 | S |
| 7. Invoices and payments | Invoices: create, send, void, pay link | ENG-36 | P0 | S |
| 7. Invoices and payments | Recording payments in the app | ENG-37 | P0 | M |
| 7. Invoices and payments | PDF invoices, estimates and receipts | ENG-38 | P0 | M |
| 7. Invoices and payments | Packages, memberships and gift cards: sell, use, renew, expire | ENG-39 | P0 | M |
| 7. Invoices and payments | Interac e-Transfer matching | ENG-40 | P1 | L |
| 7. Invoices and payments | Refunds and chargebacks | ENG-41 | P0 | S |
| 8. Money, tax and staff pay | Today dashboard | ENG-43 | P0 | S |
| 8. Money, tax and staff pay | Reports: income, sales by item, GST/HST, T4A | ENG-44 | P0 | S |
| 8. Money, tax and staff pay | Tax returns and remittance | ENG-45 | P0 | S |
| 8. Money, tax and staff pay | Stripe reconciliation, fees and payouts | ENG-46 | P0 | S |
| 8. Money, tax and staff pay | Staff pay: earnings, approval, payment | ENG-47 | P1 | M |
| 9. Messaging and documents | Two-way inbox with a text number per business | ENG-49 | P0 | L |
| 9. Messaging and documents | Broadcasts with consent and opt-out | ENG-50 | P0 | L |
| 9. Messaging and documents | Review requests and moderation | ENG-51 | P1 | M |
| 9. Messaging and documents | Intake forms | ENG-52 | P1 | S |
| 9. Messaging and documents | Contracts, signing and signed PDFs | ENG-53 | P1 | M |
| 10. Platform and launch | Production hosting, deploys and security | ENG-55 | P0 | L |
| 10. Platform and launch | Backups, monitoring and alerts | ENG-56 | P0 | M |
| 10. Platform and launch | iPhone and Android store release | ENG-57 | P0 | M |
| 10. Platform and launch | Marketing site launch | ENG-58 | P0 | S |
| 10. Platform and launch | Final release QA and sign-off | ENG-59 | P0 | M |

---

## 1. Accounts and settings (ENG-1)

A business can sign up, set itself up, add its team, connect Stripe and switch on sales tax.

Epic QA: run each story's QA below in order on one business, on web, iPhone and Android, then repeat the owner steps as staff and check every refusal matches the role.

### Sign-up, sign-in and password reset (ENG-2)
Priority: P0 · Size: S · Backend, web, iPhone and Android

Flow: A new owner signs up, verifies their email, signs out and back in, resets a forgotten password and signs in with Google.

Built: Email and password, Google sign-in, rotating sessions, reset and verify emails, sign-in screens on every platform.

To do:
- A sign-up page with its own URL, so the marketing site's Start free lands on it.
- A production email sender for verify and reset emails.

QA:
1. From the marketing site, click Start free and sign up with a new email; verify it.
2. Sign out and in on web, iPhone and Android.
3. Reset the password from the email, then sign in with Google on the same address.
4. Try a wrong password five times: the error is the same each time and no account detail leaks.
Done when: A new owner gets in and back in on every platform without help.

### Onboarding, business profile and branding (ENG-3)
Priority: P0 · Size: S · Backend, web, iPhone and Android

Flow: After sign-up the owner names the business, picks a web address and province, then sets contact details, logo, colour and tagline.

Built: Onboarding (name, web address, province), Setup › Business with contact details, timezone, brand colour, tagline and logo upload on web.

To do:
- Logo upload on mobile (shared with the products images story).
- Empty states on every screen that tell a new business what to do next.

QA:
1. Finish onboarding as a new owner and land on Today.
2. Set the colour, tagline and logo; the booking page, pay page and shop use all three.
3. Open every main screen with no data: each explains what to add first.
Done when: A new business looks like itself on its public pages within five minutes of signing up.

Depends on: Sign-up, sign-in and password reset (ENG-2).

### Team invites and roles (ENG-4)
Priority: P0 · Size: S · Backend, web, iPhone and Android

Flow: The owner invites staff and admins by email; each signs in and sees only what their role allows.

Built: Owner, admin and staff roles, email invites, accept-invite page, role gates on every screen and endpoint.

To do:
- A full manual pass and fixes for anything it finds.

QA:
1. Invite a staff member and an admin; accept both in other browsers.
2. As staff: own bookings and hours only, Payments › Sales only, Setup › Team and hours only.
3. As staff, try a refund, a void and editing another member's hours: each is refused.
4. As admin: everything except owner-only settings.
Done when: Each role sees and can do exactly its list, on web, iPhone and Android.

Depends on: Onboarding, business profile and branding (ENG-3).

### Stripe connect and payout status (ENG-5)
Priority: P0 · Size: S · Backend, web, iPhone and Android

Flow: The owner connects a Stripe account from Setup › Getting paid, completes verification and sees when they can take payments and receive payouts.

Built: Stripe Connect onboarding, verification status mirrored from Stripe, a script that connects the demo to a Stripe test account.

To do:
- Stripe test keys added locally and one full pass in test mode.
- Clear messages for each Stripe requirement that is still due.

QA:
1. Start onboarding, complete Stripe's test identity, return to the app: status reads ready.
2. Leave a requirement unfinished: the app says exactly what is missing.
3. Take a $10 test card payment once ready.
Done when: An owner knows at a glance whether they can take payments and why not.

Depends on: Onboarding, business profile and branding (ENG-3).

### Tax registration and per-item tax classes (ENG-6)
Priority: P0 · Size: M · Backend, web, iPhone and Android

Flow: The owner marks the business as tax-registered with its numbers, and each item charges the right tax for the province.

Built: Tax engine for every province; tax class per item (standard, GST or HST only, exempt) copied onto each line; GST/HST number field.

To do:
- A switch to mark the business tax-registered (today a new business collects no tax).
- Confirm with an accountant which services carry PST in BC, Saskatchewan and Manitoba, then set defaults per item kind.
- Check the Nova Scotia HST rate in the tax table.

QA:
1. Ontario business, tax on: a $100 invoice charges $13 HST.
2. BC business: a service set to GST only and a product set to standard; PST only on the product.
3. An exempt line charges nothing.
4. Tax off: nothing is charged anywhere.
Done when: Every taxed figure matches a hand calculation for the province.

Depends on: Onboarding, business profile and branding (ENG-3).

## 2. Clients (ENG-7)

Staff keep a complete, accurate record of every client and what has happened with them.

Epic QA: run each story's QA below in order on one business, on web, iPhone and Android, then repeat the owner steps as staff and check every refusal matches the role.

### Client records: add, edit, archive, search (ENG-8)
Priority: P0 · Size: S · Backend, web, iPhone and Android

Flow: Staff add a client, find them by name or phone, edit their details and archive them without losing their history.

Built: Add and search on web and mobile; lifetime value for owners and admins.

To do:
- Edit contact details and status.
- Archive and restore a client; archived clients leave search and pickers.

QA:
1. Add a client on a phone; find them by phone number on web.
2. Edit their email on web; the phone shows the change.
3. Archive them: gone from search and booking pickers, their invoices still there; restore them.
Done when: A client record can be kept up to date from any device.

### Pets and other subjects on clients (ENG-9)
Priority: P0 · Size: M · Backend, web, iPhone and Android

Flow: Staff record a client's pets (or vehicles, children) with details, and the pet shows on its bookings.

Built: Subjects with kind and attributes in the data, synced to devices; seeded demo pets.

To do:
- Add, edit and remove subjects from the client record.
- Pick the subject when booking; show it on the booking and the invoice line.

QA:
1. Add a dog with breed, weight and temperament to a client.
2. Book the dog; the groomer sees the dog on the booking on their phone.
3. Invoice the visit; the line names the dog.
Done when: Staff always know which pet a visit is for.

Depends on: Client records: add, edit, archive, search (ENG-8).

### Notes and client history timeline (ENG-10)
Priority: P1 · Size: M · Backend, web, iPhone and Android

Flow: Staff add notes to a client and see everything that has happened with them in one timeline.

Built: Notes in the data and synced; the client panel shows saved methods, subscriptions and packages.

To do:
- Add and edit notes on the client.
- A timeline of bookings, invoices, payments, messages and notes, newest first.

QA:
1. Add a note on a phone; it shows on web.
2. After a visit, the timeline lists the booking, invoice, payment and message in order.
Done when: The full story of a client fits on one screen.

Depends on: Client records: add, edit, archive, search (ENG-8).

### Saved cards and bank accounts (ENG-11)
Priority: P0 · Size: S · Backend, web, iPhone and Android

Flow: Staff save a client's card or bank account (pre-authorized debit), make one the default and remove old ones.

Built: Add a card on web and mobile, bank account on web, make default, remove; only chargeable methods can be default.

To do:
- Bank account entry on mobile.
- A run with Stripe test keys.

QA:
1. Add card 4242 on a phone and make it default.
2. Add a bank account on web; its mandate shows active.
3. Remove the older card; it can no longer be charged.
Done when: Saved methods can be managed from any device and charged reliably.

Depends on: Client records: add, edit, archive, search (ENG-8); Stripe connect and payout status (ENG-5).

### Tags and duplicate merging (ENG-12)
Priority: P2 · Size: M · Backend, web, iPhone and Android

Flow: Staff tag clients for broadcasts and merge two records that are the same person.

Built: Tags in the data, used as broadcast audiences.

To do:
- Set and remove tags in the app.
- Merge two clients, moving bookings, invoices, payments, pets and messages.

QA:
1. Tag two clients and send a broadcast to the tag.
2. Merge a duplicate: every booking and invoice now sits under one client.
Done when: Duplicates can be cleaned up without losing anything.

Depends on: Client records: add, edit, archive, search (ENG-8).

## 3. Catalog and inventory (ENG-13)

Everything a business sells is set up once, with its price, tax, image and stock.

Epic QA: run each story's QA below in order on one business, on web, iPhone and Android, then repeat the owner steps as staff and check every refusal matches the role.

### Services and classes: duration, buffers, capacity, deposits (ENG-14)
Priority: P0 · Size: S · Backend, web, iPhone and Android

Flow: The owner sets up services and classes with length, buffers, capacity and deposit, and they appear on the booking page.

Built: A full item editor on web and mobile with every field by kind; only services and classes can be booked online.

To do:
- A manual pass of every field against the booking engine.

QA:
1. Create a 60-minute service with a 10-minute buffer and a 25% deposit.
2. Create a class of 6.
3. Both show on the booking page with the right times, price and deposit; edit the price and see it update.
Done when: What the owner sets is exactly what clients can book.

Depends on: Tax registration and per-item tax classes (ENG-6).

### Products: SKU, cost, price, images (web and mobile) (ENG-15)
Priority: P0 · Size: M · Backend, web, iPhone and Android

Flow: The owner adds retail products with SKU, cost, price, tax class and an image, and sells them everywhere.

Built: Products with SKU, cost and tax class in the item editor; image upload on web; products in Sales, invoices, the shop and add-ons.

To do:
- Image upload on mobile (image picker and a new native build), also used for the logo.
- Archive and restore a product.

QA:
1. Add a shampoo with SKU, cost, price and a photo taken on the phone.
2. It shows in Sales, the invoice editor and the shop with its image.
3. Archive it: it leaves every selling screen; restore it.
Done when: A product is set up once and sells the same way everywhere.

Depends on: Tax registration and per-item tax classes (ENG-6).

### Stock tracking, low stock and restock (ENG-16)
Priority: P0 · Size: S · Backend, web, iPhone and Android

Flow: Stock counts drop as products sell, rise on refunds and restocks, and low items are flagged.

Built: Optional stock per product, movements on paid and refunded sales and invoices (a repeated webhook can't move stock twice), restock, low-stock filter.

To do:
- A manual pass across every way a product can be sold.

QA:
1. Track stock on a product: set 3, low at 1.
2. Sell 2 at the desk: 1 left and flagged low.
3. Refund one: 2 left. Restock 5: 7 left, no longer low.
4. Order more than the stock in the online shop: refused.
Done when: The count in the app matches the shelf after a day of sales.

Depends on: Products: SKU, cost, price, images (web and mobile) (ENG-15).

### Packages, memberships and gift card items (ENG-17)
Priority: P0 · Size: S · Backend, web, iPhone and Android

Flow: The owner sets up prepaid packages, monthly memberships and gift cards as items, ready to sell.

Built: Item fields for package sessions and validity, subscription interval and frequency, open-amount gift cards; these kinds can't be sold as plain lines.

To do:
- A manual pass of each kind's fields.

QA:
1. Create a 5-visit package valid for a year, a monthly membership and a gift card.
2. Each appears in Sales under its own checkout, not in the cart.
Done when: Each kind can be set up without touching the database.

Depends on: Tax registration and per-item tax classes (ENG-6).

## 4. Scheduling (ENG-18)

Staff run their whole day from the schedule.

Epic QA: run each story's QA below in order on one business, on web, iPhone and Android, then repeat the owner steps as staff and check every refusal matches the role.

### Staff hours, time off and closures (ENG-19)
Priority: P0 · Size: M · Backend, web, iPhone and Android

Flow: Each staff member's weekly hours, days off and business closures decide what can be booked.

Built: Weekly hours per staff member on web and mobile; open times respect them, including one-day closures in the data.

To do:
- Add time off for a staff member and close the business for a day.
- Show closures on the schedule.

QA:
1. Set Tuesday to Saturday, 10 to 4: the booking page offers nothing on Monday for them.
2. Add a day off next week: no times that day; other staff unaffected.
3. Close the business on a holiday: no one is bookable.
Done when: Open times always match when people are actually working.

Depends on: Team invites and roles (ENG-4).

### Calendar: create, move, cancel, complete, no-show (ENG-20)
Priority: P0 · Size: M · Backend, web, iPhone and Android

Flow: Staff book, move and cancel visits, then mark each one completed or a no-show.

Built: Day, week, month, staff and agenda views on web (day and agenda on mobile), create, drag to reschedule, cancel, double-booking checks for staff and stations; the backend supports completed and no-show.

To do:
- Completed and No-show buttons on web and mobile.
- Week view on mobile.

QA:
1. Book, drag to a new time, try to double-book the same person (refused).
2. Mark one visit completed and another a no-show; a deposit on the no-show is kept.
3. Repeat on iPhone and Android, including the week view.
Done when: Every visit ends in the right state from any device.

Depends on: Staff hours, time off and closures (ENG-19); Services and classes: duration, buffers, capacity, deposits (ENG-14).

### Recurring bookings (ENG-21)
Priority: P1 · Size: M · Backend, web, iPhone and Android

Flow: Staff book a repeating visit and later change or cancel the whole series.

Built: Weekly or monthly series with a set number of visits, created from one form, kept at the same local time.

To do:
- Edit or cancel the whole series.
- Series longer than 60 visits.
- One confirmation for the series instead of one per visit.

QA:
1. Create a weekly series of 6 across a daylight-saving change: every visit keeps its time.
2. Move the series to a new weekday, then cancel it from one visit.
Done when: A regular client's series can be managed in one action.

Depends on: Calendar: create, move, cancel, complete, no-show (ENG-20).

### Classes, rooms and stations (ENG-22)
Priority: P1 · Size: M · Backend, web, iPhone and Android

Flow: A business runs group classes with a capacity and books shared rooms or stations without clashes.

Built: Class capacity and seat counts in the booking engine; rooms and stations checked for clashes.

To do:
- Manage rooms and stations.
- Pick a room or station on a booking.
- A class roster.

QA:
1. Create a class of 6, book 6 online; the 7th is refused.
2. Open the roster: all six listed.
3. Book two services on the same station at once: the second is refused.
Done when: Classes and rooms run without touching the database.

Depends on: Calendar: create, move, cancel, complete, no-show (ENG-20).

### Reminders and end-of-day completion (ENG-23)
Priority: P1 · Size: S · Backend, email and text

Flow: Clients get a reminder before each visit, and past visits close themselves at the end of the day.

Built: A reminder the day before by email or text.

To do:
- Choose when reminders go out.
- Mark past visits completed automatically if staff didn't.

QA:
1. Set reminders to 2 hours before; book for later today: the reminder arrives with the right time and address.
2. Leave a visit open past the end of the day: it is completed next morning.
Done when: No visit is forgotten by the client or left open by staff.

Depends on: Calendar: create, move, cancel, complete, no-show (ENG-20).

## 5. Online booking and shop (ENG-24)

Clients book, add products and buy online from the business's own pages.

Epic QA: run each story's QA below in order on one business, on web, iPhone and Android, then repeat the owner steps as staff and check every refusal matches the role.

### Booking page with deposits and embedding (ENG-25)
Priority: P0 · Size: S · Backend, Connect (client pages), web, iPhone and Android

Flow: A client books on the business's page, pays the deposit, and the visit appears for staff; the page can sit on the business's own website.

Built: A public booking page per business with services, staff choice, open times, deposit checkout and new-client creation; an embed snippet.

To do:
- A run with Stripe test keys.
- Embed instructions in Setup › Online booking.

QA:
1. As a new client on a phone, book a service with a deposit and pay with card 4242.
2. The booking shows on web and the staff phone with the deposit collected; the client exists.
3. Paste the embed snippet into a test page: booking works inside it.
Done when: A client can book and pay a deposit without contacting the business.

Depends on: Services and classes: duration, buffers, capacity, deposits (ENG-14); Stripe connect and payout status (ENG-5); Staff hours, time off and closures (ENG-19).

### Booking add-ons (ENG-26)
Priority: P1 · Size: S · Backend, Connect, web, iPhone and Android

Flow: While booking, a client adds products to the visit; they land on the visit's invoice.

Built: An optional add-on step on the booking page; add-ons stored on the booking; Create invoice from the booking includes them; staff can remove them before invoicing.

To do:
- A manual pass end to end.

QA:
1. Book with a shampoo add-on.
2. Staff see it on the booking on a phone and remove nothing.
3. Create the invoice from the booking: the shampoo is a line, the deposit reduces the balance.
Done when: Add-ons always reach the invoice and are charged once.

Depends on: Booking page with deposits and embedding (ENG-25); Products: SKU, cost, price, images (web and mobile) (ENG-15).

### Online shop and pickup orders (ENG-27)
Priority: P1 · Size: M · Backend, Connect, web, iPhone and Android

Flow: A client orders products from the business's shop page, pays by card, and collects them once staff mark the order ready.

Built: A shop page per business for products marked sell online, card payment, pickup orders in Sales with Mark ready and Picked up, notifications to owner and client.

To do:
- A run with Stripe test keys.

QA:
1. On a phone, order a shampoo and a brush and pay with card 4242.
2. The owner is notified; the order shows in Sales as waiting for pickup.
3. Mark it ready: the client gets the message. Mark it picked up.
4. Stock dropped by one each.
Done when: Online orders are paid, prepared and collected without a phone call.

Depends on: Stock tracking, low stock and restock (ENG-16); Stripe connect and payout status (ENG-5).

### Client self-service cancel and reschedule (ENG-28)
Priority: P1 · Size: M · Backend, Connect, web, iPhone and Android

Flow: A client cancels or moves their own booking from a link, within the business's rules.

Built: Nothing; clients have to contact the business.

To do:
- A manage-booking link in confirmations and reminders.
- Cancel and reschedule within a cut-off the business sets; deposit kept or refunded by the policy.

QA:
1. From the confirmation link, move a booking to another open time.
2. Cancel inside the cut-off: refused with the reason.
3. Cancel outside it: the slot opens and the deposit follows the policy.
Done when: Clients can change plans without staff, and the rules are enforced.

Depends on: Booking page with deposits and embedding (ENG-25).

## 6. Front desk sales and orders (ENG-29)

Staff sell services and products at the desk and take payment in any way the client pays.

Epic QA: run each story's QA below in order on one business, on web, iPhone and Android, then repeat the owner steps as staff and check every refusal matches the role.

### Sales with services and products (ENG-30)
Priority: P0 · Size: S · Backend, web, iPhone and Android

Flow: Staff ring up services and products for a client or a walk-in, and the sale is recorded with tax.

Built: Sales on web and mobile; cart with services, classes and products; client optional; gift cards, packages and subscriptions open their own checkout.

To do:
- A manual pass on web and both phones.

QA:
1. Ring up a groom and a shampoo for a client.
2. Ring up a walk-in sale with no client.
3. Open the gift card tile: it opens the gift card checkout, not the cart.
Done when: Any sale can be rung up in under a minute.

Depends on: Products: SKU, cost, price, images (web and mobile) (ENG-15).

### Card and Tap to Pay checkout with receipts (ENG-31)
Priority: P0 · Size: M · Backend, web, iPhone and Android

Flow: Staff take payment by saved card, new card or Tap to Pay, and the client gets an itemised receipt.

Built: Card checkout for sales on web and mobile, Tap to Pay on mobile, itemised receipts by email or text including walk-ins.

To do:
- A run with Stripe test keys.
- Tap to Pay on real iPhone and Android hardware.

QA:
1. On web, pay a sale with card 4242 and send a receipt to an email.
2. On a real phone, take a Tap to Pay payment.
3. Try a declined card (4000 0000 0000 0002): the sale stays open with a clear message.
4. The receipt lists each line, tax and total.
Done when: Every way of paying at the desk ends in a paid sale and a correct receipt.

Depends on: Sales with services and products (ENG-30); Stripe connect and payout status (ENG-5).

### Tips at checkout (ENG-32)
Priority: P0 · Size: M · Backend, web, iPhone, Android and Connect (pay link)

Flow: A client adds a tip when paying, and it goes to the staff member who served them.

Built: Nothing; payments carry no tip.

To do:
- A tip choice (percentages and custom) at the desk, on Tap to Pay and on the pay link.
- The tip owed to the staff member on the ledger, outside sales tax, added to their earnings.
- Tips on receipts, in the income report and in Staff pay.

QA:
1. Ring up a $100 groom and add a 15% tip: no tax on the tip.
2. Tip on a pay link and on Tap to Pay.
3. Each tip shows under the right staff member in Staff pay and apart from sales in reports.
4. Refund a tipped payment: the tip is reversed from the earnings.
Done when: Every tip reaches the right person and never carries tax.

Depends on: Card and Tap to Pay checkout with receipts (ENG-31); Staff pay: earnings, approval, payment (ENG-47).

### Discounts (ENG-33)
Priority: P0 · Size: M · Backend, web, iPhone and Android

Flow: Staff take an amount or a percentage off a line or a whole sale, invoice or estimate, and tax follows the discounted price.

Built: Nothing.

To do:
- Line and whole-document discounts as a percentage or amount, with a reason.
- Tax after the discount; discounts on documents, receipts and reports.
- A discount limit for staff.

QA:
1. Discount one line 10% and the whole sale $5: totals and tax match a hand calculation.
2. Convert a discounted estimate: the discount carries to the invoice.
3. As staff, go over the limit: refused.
Done when: Every discounted total and its tax match a hand calculation.

Depends on: Sales with services and products (ENG-30); Invoices: create, send, void, pay link (ENG-36).

## 7. Invoices and payments (ENG-34)

The business bills clients and gets paid correctly, whatever they buy and however they pay.

Epic QA: run each story's QA below in order on one business, on web, iPhone and Android, then repeat the owner steps as staff and check every refusal matches the role.

### Estimates: create, send, accept, convert (ENG-35)
Priority: P0 · Size: S · Backend, web, iPhone and Android

Flow: Staff write an estimate, send it, the client accepts it, and it becomes an invoice.

Built: One editor on web and mobile, catalog or free-text lines, draft editing, send, accept, decline, convert.

To do:
- A manual pass on every platform.

QA:
1. Write an estimate on a phone and send it.
2. Accept it, convert it: the invoice has the same lines and tax.
3. Decline another: it can't be converted.
Done when: A quote becomes a bill without retyping anything.

Depends on: Products: SKU, cost, price, images (web and mobile) (ENG-15); Tax registration and per-item tax classes (ENG-6).

### Invoices: create, send, void, pay link (ENG-36)
Priority: P0 · Size: S · Backend, web, iPhone, Android and Connect (pay page)

Flow: Staff invoice a client, send it, and the client pays through the link; unpaid invoices can be voided.

Built: Create and edit drafts, send, void (blocked while a payment is in progress), invoice from a booking, pay link by card or Interac, tax lines per province.

To do:
- A run with Stripe test keys.

QA:
1. Create an invoice from a completed booking and send it.
2. Pay through the link in a private window with card 4242: Paid on web and phones.
3. Void another unpaid invoice; try to void one with a payment in progress: refused.
Done when: Invoices move from draft to paid or void with the right status everywhere.

Depends on: Estimates: create, send, accept, convert (ENG-35); Stripe connect and payout status (ENG-5).

### Recording payments in the app (ENG-37)
Priority: P0 · Size: M · Backend, web, iPhone and Android

Flow: Staff take payment on an invoice in the app: charge a saved card, or record cash or a received e-Transfer.

Built: The backend endpoint; payment today happens only through the pay link.

To do:
- Charge a saved card from the invoice.
- Record cash or an e-Transfer received, with partial amounts.

QA:
1. Record $20 cash on a $50 invoice: Partial.
2. Charge the rest to the saved card: Paid.
3. Today and reports show both payments.
Done when: Every way a client actually pays can be recorded on the invoice.

Depends on: Invoices: create, send, void, pay link (ENG-36); Saved cards and bank accounts (ENG-11).

### PDF invoices, estimates and receipts (ENG-38)
Priority: P0 · Size: M · Backend, web, iPhone and Android

Flow: Every invoice, estimate and receipt can be downloaded or attached as a PDF that matches the app.

Built: Web pages and emails only.

To do:
- PDFs with logo, address, GST/HST number, lines, taxes and totals.
- Attached to the emails and downloadable on web and mobile.

QA:
1. Send an invoice and an estimate: each email has a matching PDF.
2. Take a payment: the receipt PDF lists lines, tax and total.
3. Download each from a phone.
Done when: Every PDF matches its record in the app.

Depends on: Invoices: create, send, void, pay link (ENG-36).

### Packages, memberships and gift cards: sell, use, renew, expire (ENG-39)
Priority: P0 · Size: M · Backend, web, iPhone and Android

Flow: Clients buy prepaid visits, memberships and gift cards, then use, renew and let them expire, with balances always right.

Built: Sell each through its own checkout; one session used per visit; monthly charges by Stripe with an invoice each period; redeem gift cards by code; expiry books the unused balance as revenue.

To do:
- A price change reaching existing memberships.
- Pause a membership.
- A full pass with Stripe's test clock.

QA:
1. Sell a 5-visit package, use two visits: 3 remain.
2. Start a membership, advance Stripe's test clock a month: the second invoice is Paid.
3. Sell a $100 gift card, redeem $40: $60 remains.
4. Run the expiry job: expired balances move to revenue.
Done when: Every balance in the app matches what was sold, used or charged.

Depends on: Packages, memberships and gift card items (ENG-17); Saved cards and bank accounts (ENG-11).

### Interac e-Transfer matching (ENG-40)
Priority: P1 · Size: L · Backend, web, iPhone, Android and Connect (pay page)

Flow: A client pays an invoice by e-Transfer and it is matched automatically, or flagged when it doesn't fit.

Built: A payment request with a reference code, matched to the invoice when a transfer is reported.

To do:
- A real bank feed for incoming transfers.
- Overpayments, short payments and expired requests shown to the owner.
- Send a request from an invoice.

QA:
1. Request $84; send a matching transfer: Paid.
2. Send $50 against another request: flagged, not lost.
3. Let a request expire and send a new one.
Done when: Every transfer ends up matched or flagged.

Depends on: Invoices: create, send, void, pay link (ENG-36).

### Refunds and chargebacks (ENG-41)
Priority: P0 · Size: S · Backend, web, iPhone and Android

Flow: Staff refund all or part of a payment, and chargebacks are tracked to their outcome.

Built: Full, partial and repeated refunds as credit notes; dashboard refunds recorded; deposits, stock and entitlements unwound; disputes book the withdrawn funds and fee, a won dispute reverses them.

To do:
- Follow refunds that start pending or fail later.
- Suspend a disputed gift card or package and stop the invoice reading Paid.

QA:
1. Refund $10 of $50, then the rest: Refunded, tax set aside drops.
2. Refund a gift card purchase: it can't be redeemed.
3. Open a test dispute on a package payment: suspended; win it: restored.
Done when: Money and the client's entitlements agree after every case.

Depends on: Card and Tap to Pay checkout with receipts (ENG-31); Packages, memberships and gift cards: sell, use, renew, expire (ENG-39).

## 8. Money, tax and staff pay (ENG-42)

The owner always knows what came in, what is owed, what tax to remit and what staff have earned.

Epic QA: run each story's QA below in order on one business, on web, iPhone and Android, then repeat the owner steps as staff and check every refusal matches the role.

### Today dashboard (ENG-43)
Priority: P0 · Size: S · Backend, web, iPhone and Android

Flow: The owner opens Today and sees revenue, money awaiting payment, tax set aside and recent activity.

Built: Revenue today, awaiting payment, GST/HST set aside, recent activity, synced live to every device.

To do:
- Today's schedule on the same screen.
- The next GST/HST filing date.

QA:
1. Take a payment: Today updates on web and phones within seconds.
2. Figures match the income report for the day.
Done when: Today answers how the day is going without opening a report.

Depends on: Card and Tap to Pay checkout with receipts (ENG-31).

### Reports: income, sales by item, GST/HST, T4A (ENG-44)
Priority: P0 · Size: S · Backend, web, iPhone and Android

Flow: The owner runs reports for any period and downloads them for the bookkeeper.

Built: Income, sales by item, GST/HST (PST and QST apart) and T4A, with CSV downloads, in the business timezone.

To do:
- A manual pass against hand totals.

QA:
1. After a test week, check each report's totals against the sales and payments made.
2. Download each CSV and open it in a spreadsheet.
Done when: A bookkeeper can work from the downloads without questions.

Depends on: Card and Tap to Pay checkout with receipts (ENG-31).

### Tax returns and remittance (ENG-45)
Priority: P0 · Size: S · Backend, web, iPhone and Android

Flow: At the end of a period the owner records the return they filed, and tax set aside resets.

Built: Record a filed return per period; tax set aside drops by the amount; overlapping or unfinished periods refused.

To do:
- A manual pass with real quarter totals.

QA:
1. Download the quarter's GST/HST report and record the return.
2. Today's tax set aside drops by the amount filed.
3. Try the same period again: refused.
Done when: Tax set aside always equals what is still owed to the CRA.

Depends on: Reports: income, sales by item, GST/HST, T4A (ENG-44).

### Stripe reconciliation, fees and payouts (ENG-46)
Priority: P0 · Size: S · Backend, web, iPhone and Android

Flow: Every payment's Stripe fee and every payout to the bank is recorded and agrees with Stripe.

Built: Fees per payment from Stripe, payouts under Reports › Bank deposits, a nightly check against Stripe's balance.

To do:
- Retry the fee lookup when Stripe hasn't settled it yet.

QA:
1. After test payments, each fee matches Stripe's dashboard.
2. When a test payout lands, it shows under Bank deposits.
3. The nightly check reports no difference.
Done when: Our figures and Stripe's agree to the cent.

Depends on: Stripe connect and payout status (ENG-5).

### Staff pay: earnings, approval, payment (ENG-47)
Priority: P1 · Size: M · Backend, web, iPhone and Android

Flow: Staff earn from services and retail sales, the owner approves and pays, and the year-end T4A adds up.

Built: Pay rate and retail commission per staff member; earnings from paid booking invoices and sales; approve and mark paid; T4A report.

To do:
- Earnings from invoice lines that aren't bookings.

QA:
1. Set 40% on services and 10% on retail.
2. A $100 groom and a $30 product: earnings $40 and $3.
3. Approve and mark paid; the T4A includes $43.
Done when: Earnings match the rates by hand.

Depends on: Team invites and roles (ENG-4); Card and Tap to Pay checkout with receipts (ENG-31).

## 9. Messaging and documents (ENG-48)

The business talks to clients, collects reviews, forms and signatures, and keeps a copy of everything.

Epic QA: run each story's QA below in order on one business, on web, iPhone and Android, then repeat the owner steps as staff and check every refusal matches the role.

### Two-way inbox with a text number per business (ENG-49)
Priority: P0 · Size: L · Backend, web, iPhone and Android

Flow: Staff text and email clients from one inbox, and replies always come back to the right business.

Built: Threads by text and email, new message, reply; one shared text number.

To do:
- A text number per business, with replies routed by number.
- Check the text provider's signature on incoming messages.

QA:
1. Text a client; reply from their phone: the reply lands in the thread on web and mobile.
2. Two businesses text the same client phone: each reply reaches only its business.
Done when: No reply can reach the wrong business.

Depends on: Client records: add, edit, archive, search (ENG-8).

### Broadcasts with consent and opt-out (ENG-50)
Priority: P0 · Size: L · Backend, web, iPhone and Android

Flow: The owner sends a broadcast that reaches only clients who agreed to hear from them.

Built: Scheduled broadcasts to tagged clients.

To do:
- A consent record per client, an unsubscribe link, STOP handling for texts and a suppression list (CASL).

QA:
1. Unsubscribe one client by link and reply STOP from another.
2. Broadcast to their tag: neither receives it, the rest do.
3. Each client's consent and opt-out date shows on their record.
Done when: An opted-out client can't receive a broadcast.

Depends on: Two-way inbox with a text number per business (ENG-49); Tags and duplicate merging (ENG-12).

### Review requests and moderation (ENG-51)
Priority: P1 · Size: M · Backend, Connect (review page), web, iPhone and Android

Flow: After a visit the client is asked for a review; the owner approves, replies or hides it.

Built: Review requests after visits, reply, hide and publish.

To do:
- Hold low ratings for approval.
- Share a review to Google.

QA:
1. Leave a 2-star and a 5-star review.
2. The 2-star waits for approval; the 5-star publishes.
3. Reply to one and share the other to Google.
Done when: Nothing low-rated publishes without the owner's choice.

Depends on: Calendar: create, move, cancel, complete, no-show (ENG-20).

### Intake forms (ENG-52)
Priority: P1 · Size: S · Backend, Connect (form page), web, iPhone and Android

Flow: The owner builds an intake form; clients fill it in before their first visit, and answers sit on their record.

Built: Form builder on web, public form page, responses stored.

To do:
- The builder on mobile.
- Send automatically to new clients when they book.
- Size and type limits on uploads.

QA:
1. Build a form with text, choice and a file upload.
2. Book as a new client: the form arrives; fill it in on a phone.
3. Answers show on the client's record on web and mobile.
Done when: The business has every new client's answers before the visit.

Depends on: Client records: add, edit, archive, search (ENG-8).

### Contracts, signing and signed PDFs (ENG-53)
Priority: P1 · Size: M · Backend, Connect (sign page), web, iPhone and Android

Flow: The owner sends a contract, the client signs online, and a signed PDF is kept.

Built: Contract drafts on web, online signing with time and IP recorded.

To do:
- A signed-contract PDF with signature, time, IP and the text as signed.
- Contracts on mobile.

QA:
1. Send a contract and sign it on a phone.
2. Download the signed PDF from the client's record: signature, time and IP are on it.
Done when: A signed contract can be produced on request.

Depends on: Client records: add, edit, archive, search (ENG-8).

## 10. Platform and launch (ENG-54)

The product runs safely in production, ships in the app stores and goes live with a clean QA pass.

Epic QA: run each story's QA below in order on one business, on web, iPhone and Android, then repeat the owner steps as staff and check every refusal matches the role.

### Production hosting, deploys and security (ENG-55)
Priority: P0 · Size: L · Backend, job worker, web, Connect and the marketing site

Flow: Every part of the system runs in production on its own subdomain, deploys from CI, and is locked down.

Built: Local Docker stack; CI builds and tests every app; production secrets checked at startup; Stripe API version pinned.

To do:
- Production hosting for the API, worker, web, Connect and the site on their subdomains.
- Deploys from CI to staging and production.
- A production CORS allow-list and security headers (HSTS, CSP, frame and host protection).
- Stripe live keys and the live webhook at the pinned version.

QA:
1. Deploy a tagged build to staging and run every story's QA there.
2. Scan the response headers: all present.
3. Take a real $1 payment in live mode and refund it.
Done when: Staging passes and production deploys with one command.

### Backups, monitoring and alerts (ENG-56)
Priority: P0 · Size: M · Backend, web, iPhone and Android

Flow: Data is backed up and can be restored, and we hear about errors before customers do.

Built: Nothing in production.

To do:
- Daily backups and point-in-time recovery for the database and the sync store.
- One timed restore drill, written down.
- Error tracking with alerts on every surface.

QA:
1. Restore last night's backup into a scratch database and open a business from it.
2. Trigger a test error on each surface: an alert arrives with the stack trace and the business.
Done when: A restore is timed and documented, and every surface reports errors.

Depends on: Production hosting, deploys and security (ENG-55).

### iPhone and Android store release (ENG-57)
Priority: P0 · Size: M · iPhone and Android

Flow: Staff install the app from the stores and run their day on it, online or offline, with notifications.

Built: Both apps with the same screens as web, offline sync, push notifications, Tap to Pay and the app icon.

To do:
- Signing, store listings and production builds pointed at production.
- Push certificates for production.

QA:
1. Install from TestFlight and the Play internal track; sign in as owner and staff.
2. Airplane mode, add a note, reconnect: it reaches web.
3. Book online: the staff phone gets a push.
Done when: Both store builds pass every mobile step in the stories above.

Depends on: Production hosting, deploys and security (ENG-55).

### Marketing site launch (ENG-58)
Priority: P0 · Size: S · Marketing site

Flow: A visitor reads the site, trusts what it says, and signs up.

Built: Home, features, solutions with eight trade pages, pricing, legal shells and credits; content, link, accessibility and Lighthouse checks in CI.

To do:
- Privacy policy and terms from a lawyer; prices and the platform fee; a contact address.
- Remove or build every capability a page describes that doesn't exist yet.
- Point Start free at the sign-up page and deploy on the main domain.

QA:
1. Search the built site for "[" placeholders: none.
2. Walk each trade page against the app; every claim holds.
3. From the live site, Start free creates an account.
Done when: The live site makes no claim the product can't back.

Depends on: Production hosting, deploys and security (ENG-55); Sign-up, sign-in and password reset (ENG-2).

### Final release QA and sign-off (ENG-59)
Priority: P0 · Size: M · Everything

Flow: One full pass of the product as owners, staff and clients use it, across devices, before launch.

Built: Demo business Birchbark Pet Studio; owner hannah@birchbarkpets.ca and staff priya@birchbarkpets.ca, password demo1234.

To do:
- Run the pass on staging with the store builds; log each failure as a bug linked to its story.

QA:
1. Owner day on web: schedule, walk-in, invoices, a gift card and a package, one refund.
2. Staff day on iPhone, then Android: own bookings, a note, a deposit, a Tap to Pay sale.
3. Client side on a phone: book, add a product, fill a form, sign, pay, review, order from the shop.
4. Money: Today, reports, staff pay and Stripe agree to the cent.
5. Sync: changes made at once and offline end up the same everywhere.
Done when: Every P0 story is done, this pass is clean, no P0 bug is open, and both founders sign off.

---

## After launch

Not tracked in Jira yet. These are pulled in by demand once the launch stories are done.

- **Growth and commerce:** multiple locations per business (needs a location model), loyalty and rewards,
  waitlists with auto-promote, online gift card purchase and balance check.
- **Platform and scale:** a public developer API with keys and outbound webhooks (`webhooks` is inbound
  only), a platform admin role and support console, custom permissions (`contractor` has staff permissions
  today), suspending or offboarding a business through `businesses.status`.
- **Feature depth:** membership pause, trial and plan change, package sessions used automatically on
  booking, a cancellation policy with a late-cancel fee, configurable reminders, Google and iCal calendar
  sync, per-staff and travel buffers, conditional form fields, countersigning and a drawn signature.
- **Tax and reporting depth:** place of supply by client province, tax-inclusive pricing, compound tax,
  expenses and input tax credits for net profit, real T4A slips and e-filing, client statements, dunning
  and subscription retry.
- **Platform hygiene:** access-token revocation (removed staff keep access for up to 15 minutes), retention
  and PII purge, metrics and tracing, a query and sync-rule performance audit, blue-green deploys and
  rollback, more than one currency (CAD is fixed on create), a decision on `custom_fields`, offline
  conflict handling in the apps.

### Connect, the client experience

Connect is the client-facing layer: booking, pay, shop, forms, contracts, reviews and a per-business
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
