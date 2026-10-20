# Checkout

## Question

Checkout is where a visit ends: the client pays, the work is recorded and the next visit is often set up. Today the register handles the payment well, but the steps around it are spread across other screens or happen later on their own. This exploration lists what checkout does now, what a business would expect it to cover, and the gaps that are easy to miss.

It pairs with [check-in](../check-in/README.md). Forms and contracts matter less here than at arrival, with one exception covered below: a sign-off for site jobs.

## What exists today

**The register** (`useSale` in app-core `pos.ts`, web `POS.tsx`, mobile `POS.tsx`):

- **Lines:** a visit goes on the ticket as a line, with today's visits listed by state (ready, in progress, on a ticket, later today, paid). Catalog items and add-ons can be added beside it, and each line can name the staff member who did it.
- **Discounts:** on a line or on the whole sale.
- **Tips:** preset options, split by service or given to one person.
- **Payment:** Tap to Pay, a saved card, a new card, or cash with change.
- **Selling credit:** gift cards, packages and memberships can be sold from the register.
- **Other ticket actions:** a ticket can be held and resumed, and a receipt goes out by email or SMS.
- **Deposits:** a collected deposit is credited on the ticket, and is marked `applied` once the sale is paid.
- Since step 1, Checkout on Today opens the register with that visit already on the ticket.

**When the sale is paid** (`payments.py` `_sync_visits`), each visit on it gets `charged_at`. Retail commission accrues on product lines (`ensure_order_earning`).

**Completing a visit** is a separate action: Complete visit in the booking panel, or the nightly job that closes past visits when the business turns on `auto_complete`. Review requests go out from a job at 8:00 for visits completed in the last seven days.

**Credit the client already holds:**

- Gift cards can be redeemed by an admin through their own command (`redeem_gift_card`).
- Package sessions can be used through `consume_session`.

Neither of these is a payment option at the register.

## Gaps

These are the places where the current flow and what a business expects drift apart, roughly in order of how often they'd come up.

1. **Paying doesn't complete the visit.** A paid visit stays open until someone presses Complete visit or the nightly job runs (if it's on). Until then, Today and the schedule still show it as in progress or needing to be closed, and the review request waits for completion. I'd expect paying for a visit to complete it, with Complete visit kept for visits settled some other way (on an invoice, or no charge).
2. **No way to book the next visit.** Grooming, cleaning and lessons usually repeat. Recurring series exist, but nothing at checkout offers "Book again in 6 weeks with Hannah", so rebooking means going to the schedule and starting again.
3. **Gift cards and packages can't pay at the register.** A client with a gift card balance, or a package that covers this service, can't use it at checkout. The admin redeems or consumes it separately, and the ticket is then settled some other way. A visit booked against a package (`bookings.package_id`) should be covered by it automatically.
4. **No "put it on their account".** Some clients are billed monthly or pay by invoice. The register can't turn a ticket into an invoice, so staff have to leave the register and build the invoice by hand.
5. **One payment method per sale.** Splitting a bill across cash and card, or across two cards, isn't possible.
6. **The visit's outcome isn't recorded here.** The client doesn't get a short note on how the visit went, the products used or aftercare advice. A grooming "report card" or an aftercare note usually goes out with the receipt. Booking photos exist, so after photos could go into the same message.
7. **Service commission at the register may not accrue.** Earnings accrue per booking when an invoice is paid (`ensure_earnings`), and on product lines when a sale is paid. I found no path that accrues the groomer's service commission when the visit is paid at the register. This needs a test to confirm before it's treated as a bug, because it affects staff pay.
8. **Site jobs have no sign-off.** For site and property businesses, the end of a job often needs the client's signature that the work was done, with after photos attached. This is where contracts and signatures are useful at checkout: a short sign-off, kept on the booking.

## The model: what closes a visit

Mirroring arrival requirements, checkout can be described as the steps that **close a visit**. Each one is optional and set per service or per business:

- **Settle**: take payment on the register, cover it with a package, gift card or membership, or put it on the client's account as an invoice. Settling completes the visit.
- **Record**: a short visit note for the client, products used, and after photos.
- **Sign off**: for site jobs, the client's signature on a completion note, using the existing signature flow with the booking as its parent.
- **Follow up**: book the next visit, and send the receipt, visit note and (later) the review request together.

Payment stays the only required step. The others appear when the service or business has them turned on, so a small business with walk-in clients sees the register as it is now.

## The flow

**From Today or the schedule**, Checkout opens the register with the visit on the ticket, as it does now. The ticket shows any credit the client holds next to the payment options: "Package: 3 of 6 sessions left" or "Gift card balance $40".

**Paying**, with a card, cash, credit or "on account", completes the visit in the same command. A paid visit then reads as done everywhere.

**After payment**, the confirmation screen offers the follow-up steps in place of the plain receipt step:

- **Book next visit**: the same service and staff member, with times suggested from the service's usual interval.
- **Visit note**: a short text, with after photos picked from the booking, sent with the receipt.
- **Receipt**: email or SMS, as now.

**For a site job**, "Complete job" on the booking asks for the sign-off and after photos before it settles, so the record and the invoice go out together.

## Data model

Most of the first step needs no schema change:

- Completing a visit when its sale is paid is a change to the payment path.
- Rebooking reuses the booking composer.
- Covering a visit with a package uses the existing `package_id` and session use.

The parts that need new storage, each needing approval first:

- **A visit note** that the client can see. Notes exist with a booking parent, but they're staff notes, so a client-visible note needs a flag or its own kind.
- **A usual rebooking interval on a service**, such as "every 6 weeks".
- **Split payments**, which touch the order and payment model and need their own design.

## Phases

1. **Close the loop.** Paying completes the visit, a package covers its visit automatically, and a gift card can pay on the register. The confirmation screen gets "Book next visit", reusing the composer. A test first settles the service commission question (gap 7), then I fix it if it's real.
2. **On account.** The register can turn a ticket into an invoice for clients who are billed later.
3. **Visit note and after photos** sent with the receipt, plus the sign-off for site jobs.
4. **Split payment.**

## Open questions

- Should paying always complete the visit, or only when the visit has started? Paying ahead for a later visit is rare at a desk but possible.
- Should a visit note go out with the receipt by default, or only when staff write one?
- Should rebooking suggest the same staff member, or the first open time with anyone?
- If gap 7 is real, should service commission accrue on the sale's visit lines the same way it does on invoices, including the split rules in `_split`?
