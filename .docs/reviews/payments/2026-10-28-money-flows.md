# Money flows review, 2026-10-28

Scope: every flow that moves money on `main` at `a4fcf595`: client payments through Stripe, refunds and disputes, deposits, gift cards and packages, memberships, Clientbridge's own plan billing, the business's Stripe account and payouts, webhooks, replay and reconciliation, cash and manual payments, tax, staff pay, reports and the web, mobile and Connect screens that drive them. The review was read-only. Each High finding was checked against the code; the rest are confirmed by reading the code unless marked plausible. Items that [Payments and Stripe](../../payments.md) or [launch readiness](../../launch-readiness.md) already list as known limitations are left out.

## How money moves

**Client payments.** For a pay link, a booking deposit, a shop order, a desk card sale, a saved card or a PAD debit, the server derives the amount from the ledger and creates a direct charge on the business's connected account with the platform's application fee (`open_card_payment`, `open_booking_deposit`, `open_order_card_payment`, `open_entitlement_payment` in `services/payments.py`). A pending `Payment` row records the attempt and Stripe.js confirms it in the browser. Only the `payment_intent.succeeded` webhook settles it: `apply_stripe_event` dedupes the event, `_settle_payment` reads Stripe's real fee from the balance transaction (answering 503 until it is visible), posts `ledger.post_payment` and `post_fees`, and recomputes the invoice or order status from the ledger. Deposits are then applied to the visit's invoice or forfeited, and gift cards and packages are activated. The hourly replay job applies events Stripe couldn't deliver and the hourly reconciliation compares each business's balance transactions with the ledger.

**Money going back.** Refunds are owner or admin commands with an idempotency key (`refund_payment`). They unwind revenue and tax pro rata (`ledger.post_refund`), number a credit note and claw back staff commission. An inquiry dispute only alerts; an escalated one books the withdrawal and blocks refunds; a won dispute reverses it; a lost one unwinds the sale, books the part already used as a loss and ends a disputed membership. Deposits are refunded on a cancel and forfeited on a no-show. Gift cards and packages book breakage when they expire.

**Recurring money.** Memberships are Stripe subscriptions on the connected account, created at the desk. Each renewal webhook builds a local invoice, splits the tax out of the paid amount and posts the payment and fees; a failed renewal sends one notice per invoice. Clientbridge's own plan uses Checkout, the customer portal and seat sync on the platform account. A lapsed plan makes the business read-only while its memberships keep billing.

**Account and payouts.** Account status is mirrored from Stripe's v2 account events and the Refresh button. A payout moves Stripe balance to transit when Stripe creates it and transit to bank when Stripe pays it; a failed payout reverses both. Account, payout and report endpoints are owner or admin only.

**Outside Stripe.** Cash, e-Transfer and cheque payments post directly to the ledger. Invoice tax is fixed at issue, rounded half up per line and jurisdiction. Staff pay accrues as pending when a document is paid, moves to approved and then paid, and refunds leave clawbacks that the next pay run settles. Reports and the GST/HST remittance read ledger legs in the business's time zone. Money tables sync only to owners and admins; staff see only their own pay.

Checked and sound: role gates, tenancy scoping, sync visibility, webhook signature selection, event dedupe, refund tax unwinding, credit note numbering and staff pay locking.

## High

1. **A sale paid with a gift card books no sales tax.** `ledger.post_redemption` credits revenue with the whole redeemed amount, tax included. A sale covered by a gift card records its tax as revenue, so the GST/HST return and the remittance are understated while the receipt shows the tax. On a split sale all the tax lands on the cash leg, and revenue goes negative when the cash part is smaller than the tax.
2. **A card payment can settle on an invoice that was voided or paid meanwhile.** `_settle_payment` accepts a pending or declined payment and posts it without checking the invoice. Declined intents stay confirmable at Stripe, and voiding or recording cash doesn't cancel them, so a client retrying in a still-open tab overpays or pays a void invoice with nothing refunding it. Orders already refund in this case. `void_invoice` also checks for money without locking the invoice, so a void and a payment can cross.
3. **The pay page can charge a different amount than it shows.** The button label and tip percentages use the balance from page load, while `pay_card` charges the live balance plus the tip and neither takes the expected amount nor returns the charged one.

## Medium

**Payments in**

- Abandoned pay-link and deposit intents stay pending forever: `run_cancel_stale_intents` covers only desk sales, gift cards and packages, so voiding the invoice or recording cash is refused as "payment in progress".
- Retrying a declined saved card reuses the same Stripe idempotency key, so Stripe replays the stored decline.
- Two tabs paying with different tips race, because the invoice lock is taken after the Stripe call, and one cancels the other's intent.
- A declined deposit attempt whose intent Stripe already canceled makes the deposit button fail with `deposit_in_progress` for good.
- Connect pages show "paid" as soon as Stripe.js returns, without checking the intent's status, and ignore the return from a redirect. A void invoice still shows Pay and a generic error.
- Staff checkout and record-payment drop the server's stable codes for declines, required authentication and payments in progress.

**Refunds, disputes and gift cards**

- A sale paid entirely by gift card has no refund or void path, so the card balance can't be given back.
- A manual gift card redemption's ref is built from the remaining balance, so a second redemption at a balance seen before is a silent no-op. It also doesn't check the expiry date.
- Reversed gift card redemptions are tagged as ordinary reversals and counted in the return's taxable sales.
- A refund that goes from pending to failed tells neither staff nor the client.
- Dispute statuses the code doesn't list, such as `prevented`, are treated as live disputes: the withdrawal is booked and refunds are blocked.
- Deposit and online-order refunds ignore a dispute on the payment, so the cancel fails outright.

**Recurring**

- Two concurrent or retried membership creates can both charge the client; the loser is canceled without refunding its first invoice, and the unique index doesn't cover `past_due`.
- Deleting a saved card a membership uses detaches it at Stripe and then fails on the foreign key.
- Restoring an archived client doesn't undo the membership's scheduled end.
- A trial that expires sends no "memberships still charging" notice.
- Membership visits per period and member discount are stored but nothing applies them.
- Renewals that need customer authentication aren't handled, and a subscription that expires `incomplete` sends no notice.

**Ledger, payouts and integrity**

- Idempotency keys are optional on manual payments, so a keyless retry records cash twice.
- An enabled connected account is never re-read after a lost account event, and concurrent refreshes can overwrite newer status with older.
- The reconciliation queue starves busy businesses, one slow business can block every run, every source in the window costs Stripe calls each hour, and the balance check alerts on an in-flight webhook.
- The replay job spends its budget before filtering processed events.
- The payouts CSV shows our journal id instead of Stripe's payout id.

**Documentation drift.** `payments.md` says `GET /v1/plan` adopts a missed paid Checkout; it has been read-only since the Stripe hardening work. It also says reconciliation and replay don't skip a closed account yet; they do.

Aggregate queries sum across currencies, which matters only before a second currency is enabled.
