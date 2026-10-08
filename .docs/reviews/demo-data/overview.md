# Demo data review

Reviewed 8 October 2026. **The demo is useful for navigation and selected workflows, but is not yet a dependable, realistic end-to-end demonstration environment.** It has broad record coverage; the weak point is consistency between those records and the workflows that produced them.

There is one seeded business, Birchbark Pet Studio in Victoria, and three active sign-in identities: Hannah (owner), Diego (staff), and Priya (staff). Sam is an invitation, not a fourth working login. All three active users' stored password hashes match the documented demo password. This is not a collection of independent demo businesses.

## Scope and evidence

Read the complete 2,648-line [seed generator](../../../backend/scripts/seed_demo.py), its Stripe and asset setup, [Connect link helper](../../../backend/scripts/connect_links.py), [web fixture helper](../../../backend/scripts/web_fixtures.py), related models/services, PowerSync rules, shared client view-models and marketing mock data. The function-level [source coverage inventory](source-coverage.csv) records the reviewed seed sections.

Two data sets were checked separately:

| Snapshot | Shared current demo | Fresh reproduction |
|---|---:|---:|
| Database | `clientbridge` | `clientbridge_demo_audit_20261008` |
| Clients / pets | 13 / 14 | 12 / 13 |
| Bookings / slots | 584 / 582 | 574 / 572 |
| Invoices / estimates / orders | 451 / 5 / 5 | 451 / 4 / 5 |
| Payments / ledger entries | 460 / 5,829 | 457 / 5,861 |
| Messages / broadcasts / consents | 11 / 3 / 0 | 11 / 3 / 0 |

The shared database was inspected in read-only transactions. The fresh database was migrated and seeded independently, with Stripe setup and object uploads disabled. No shared data was reset, no provider transactions were made, and no notifications were sent. Source and seed behavior were analyzed; this review does not claim a new full browser/native walkthrough or live provider certification.

Seed SHA-256: `8aeab589673c6b5dc7c9d69e6578dd23ffbe5c47e7d6d6573bd274a2cee7c440`. Counts are snapshot-specific: the generator depends on the seed date, and the shared database contains previous walkthrough changes. Evidence and read-only audit scripts are under `.scratchpad/demo-data-review/`: `current.json`, `fresh.json`, `service-probes.json`, `assets.json`, `date-matrix.json`, and the fresh migration/seed logs. [Coverage counts](coverage.csv) preserve current-versus-fresh table totals.

## What holds together

- No missing or cross-business concrete parent references were found in the audited tenant graph. Booking subjects, clients, invoice clients and slot staff agree.
- No direct staff/resource overlaps or slot over-capacity were found. Pet overlaps and omitted service buffers are separate failures below.
- Journals balance by currency, account caches equal their entry sums, and copied ledger owners match their accounts.
- Invoice and order headers agree with their stored lines. Estimates do not all agree, and agreement with a tax engine is not proof of correct business tax classification.
- All 27 referenced local objects exist; sizes and content types match the file records.
- The current 120-day report summary service completes successfully.
- Draft/sent/void invoices, several booking states, subscription lifecycle states, a refund, a dispute, low-stock data and paid/open sale examples provide a useful starting point.

Stored invoice status `sent` and order status `open` are not themselves errors: paid/refunded states are derived from the ledger. A zero-balance gift card stored as active similarly derives a redeemed display state.

## Confirmed findings and recommended corrections

### Calendar, pets and client stories

**D01 — Business timezone is not the seed clock. High.** `NOW` uses the computer's local timezone; `at()` and filler hours follow it, while the business declares `America/Vancouver`. Both checked databases contain **222 slots outside the business-local working windows**. A current example, `ses_000`, starts at 06:00 Vancouver time despite 09:00 opening. Some fixed appointments also land on closed weekdays. Build times from a business `ZoneInfo` and explicit local calendar date, then convert to UTC. Validate every generated slot against the same availability rules used by booking services, including dated closures. Test on hosts in Toronto, Vancouver and UTC.

**D02 — Services are assigned to incompatible pets. High.** Filler selects a service and client/pet independently. Current/fresh counts are **105/110 definite cat-versus-dog service mismatches** and **70/71 small-dog grooms for pets above the advertised 25 lb maximum**. These are reproducible generator issues, not uncertain breed judgments: the seed itself identifies Miso as a cat and defines the weight limit. A broader first-pass check flagged 132/137 combinations; the confirmed count excludes general services such as nail trims whose species eligibility is ambiguous. Select eligible services from each pet's species, weight and care plan before allocating a time.

**D03 — Pet and buffer conflicts bypass realistic scheduling. High.** There are **12/18 overlapping booking pairs for the same pet**, plus **7/4 staff/resource gaps shorter than configured service buffers** in current/fresh data. Filler checks staff and resource intervals, but not pets or buffer-expanded intervals. Include pet/client occupancy and service buffers in placement; use the live booking constraints where possible. Historical exceptions should be deliberate scenarios with an explanation, not random conflicts.

**D04 — Random history contradicts the named customer stories. High.** Current Sophie is tagged new, described as a first-time client, and has **36 completed visits spanning months**. Olivia is tagged churn-risk with a note saying four months absent, but has **31 completed visits**, most recently 25 September. Yuki's quarterly cat-groom story has **44 completed visits in four months**, including unsuitable services. Preserve a small curated cast with explicit histories; generate additional background households to supply volume instead of repeatedly assigning work to the same 13 pets. Fatima's never-booked lead is currently a coherent exception worth preserving.

**D05 — Event chronology is impossible or misleading. High.** Seven bookings complete before their slots end because hand-authored appointments always complete after one hour, even for 75/120-minute services. Fresh data has **94 confirmation timestamps in the future** and a future overdue-notification timestamp already populated. Current data has **15 past pending/confirmed bookings**, versus zero immediately after a fresh seed. Most historical entities receive their creation timestamps at seed time: fresh data has 457 payments paid before record creation and 448 bookings starting before record creation. Backdate record creation and transitions in event order, use slot ends for completion, and distinguish a frozen demo date from a demo that advances with real time. Do not mark a future notification as already sent.

**D06 — Recurrence and calendar labels depend accidentally on seed day. Medium.** The puppy recurrence says Saturday but its only slot is always four days after seeding: on the reviewed date that is Monday. A seven-day seed matrix matches Saturday only once. Mochi's series declares eight visits, but seeding on 9 October generates seven because a closure causes a silent skip. “BC Day” and “Extra Sunday” are arbitrary offsets; “Holiday hours 2025” and spring campaigns are stale for the current autumn demo. Generate dates from the stated recurrence or change the story; represent skipped occurrences explicitly and calculate holiday/season labels from the scenario date.

### Money, estimates, stock and entitlements

**D07 — Grooming tax classification is wrong for the modeled BC business. High.** The seed's GST/PST markers are not persisted as item or line tax classes. Items default to `standard`; `_invoice_for()` adds both 5% and 7% to grooming. A $75 groom is therefore seeded at $84. BC explicitly lists grooming and other animal services as PST-exempt. Configure applicable animal-service lines as `federal_only`, keep retail tax classification separate, and derive all document totals through the tax engine. Update associated payments, refunds, deferred amounts, commissions and expectations together. The package purchase path also calls the standard `tax_for_amount()` helper, so changing item flags alone is insufficient. [BC PST Bulletin 127, Services to Animals](https://www2.gov.bc.ca/assets/gov/taxes/sales-taxes/publications/pst-127-veterinarians-pet-stores.pdf).

**D08 — Three estimates are internally inconsistent. High.** In both snapshots, `est_1001` displays **$346.50** while its stored lines add to **$324.93**; its $330 subtotal differs from the $309 sum of line amounts. All three lines also disagree with the current stored tax-class calculation. `est_1002` and `est_1004` have nonzero accepted totals but **no lines at all**; the latter links to a populated converted invoice. Build estimates from lines, compute their headers, and preserve the same accepted snapshot through conversion. Do not repair this by changing only the displayed totals.

**D09 — Fresh paid sales omit stock and staff-pickup consequences. High.** Fresh data has two paid tracked-product lines without sale stock movements. Opening stock and cached stock agree, which hides the missing reductions. `ord_web` also lacks a status token and its line is not `for_pickup`. Owners sync every line, but the staff pickup bucket only syncs `for_pickup=true`, so the seed can show an order without its packing line to staff. Seed via the paid-order lifecycle or reproduce its complete stock, token and sync-visible consequences. Current shared data has been changed and does not reproduce all three fresh-seed defects; it must not be used to certify the generator.

**D10 — Historical financial events collapse onto the seed date. High.** Fresh invoice journals span June–October, but **265 earning journals, 258 approvals and 248 staff-payment journals all occur on 8 October**. Eleven package-consumption journals, two redemptions and breakage also occur that day. Money balances remain correct while staff-pay history and period-based reporting tell a false story. Replay explicitly dated events through posting functions that accept an event time; never rewrite existing append-only ledger entries in place.

**D11 — Weekly payout generation subtracts previous payouts twice. Medium.** The ledger query already includes previous Stripe-account debits; `amount = on_hand - swept` subtracts accumulated payouts again. In the fresh reproduction, `po_demo_w2` pays $893.17 against a $2,115.42 pre-transfer ledger balance, with the difference exactly the first $1,222.25 payout. Some weeks disappear as a result. Use either the actual running balance or gross eligible credits minus paid transfers, not both. Model settlement availability and a failed payout at explicit dates, and assert the intended weekly payout policy. This is a seed arithmetic problem, not an unbalanced journal.

**D12 — Membership billing does not match the product or saved method. High.** Monthly Daycare costs $320, but `pay_sub_david` is an unlinked **$180 bank-EFT payment**. David's active subscription references a Visa method, while the note says Interac; the bank method claims an active mandate without a provider reference. There is no corresponding subscription invoice or explained historical price/discount. Create a complete subscription story with period, price snapshot, method, invoice, charge, tax and provider identity aligned. If showing a legacy price, make that explicit and retain its billing evidence.

**D13 — Entitlement balances lack visit/sale stories. Medium.** Eleven package uses have **zero booking package links**, and gift redemptions do not identify the sale being paid. The five-bath item lacks `covers_item_id`; its stated restriction is not represented. Sophie's “new” history includes an almost-used package purchased 50 days earlier. Link consumption/redemption to concrete visits or sales with the ownership and idempotency protections planned in backend hardening; align purchase, expiry and usage dates. This is partly a domain-model/workflow gap, not just missing seed rows.

**D14 — Purchased dollar-value gift cards use an inappropriate expiry scenario. High for this BC demo.** `gc_liam` has an expiry and `gc_expired` is purchased for its full $75 face value, then expires with $50 recognized as breakage. BC's regulator says purchased gift cards for a specific dollar amount cannot expire. These rows are not represented as promotional or specific-service exceptions. Keep purchased monetary cards non-expiring; demonstrate expiry only through a separately modeled eligible scenario, and ensure any breakage story has a valid basis. [Consumer Protection BC: gift cards](https://www.consumerprotectionbc.ca/consumer-help/consumer-information-gift-cards/).

### Provider-backed actions and communications

**D15 — Payment history looks operational but provider identities are synthetic. Blocking for live payment demos.** Both snapshots have **308 synthetic Stripe payment references**, seven active Stripe methods with fake or missing provider identities, and six saved-method clients without a Stripe customer. The current business still points at `acct_demo_birchbark`, with charges/payouts disabled; this process has no configured Stripe, Postmark or Twilio credentials. Connecting a genuine test account only updates the business and does not recreate the historical payment/customer/subscription objects. Card charges, saved cards, refunds, membership changes and embedded Stripe payment/payout surfaces cannot be assumed to work from these records. Provide an explicit deterministic simulation mode with a visible local outbox, or provision a coherent Stripe test-mode scenario with real account-bound objects. Label synthetic historical records as display-only until their action paths are supported.

**D16 — Broadcasts are empty and have no eligible audience. High.** All three broadcast bodies are null, both sent broadcasts have zero linked recipient messages, and there are zero consent records. Running the actual audience service yields **zero eligible recipients for every campaign**. Add realistic consent histories, including granted, implied and withdrawn examples; populate content, audience snapshots, messages and delivery outcomes consistently. A scheduled campaign must have a meaningful body and at least the intended eligible recipients. No actual outbound delivery was attempted in this review.

**D17 — Messaging ignores its authored timeline. Medium.** Conversation tuples contain date/hour/minute values, but `Message` creation ignores them. All 11 current messages share the exact seed timestamp, so thread order and “tomorrow” text do not match chronology. All incoming messages are already read; there is no unread inbox scenario. Set each message's actual timestamp, actor and provider/channel semantics; generate reminders from the linked appointment rather than literal weekday text. Include unread, failed and closed-thread cases where relevant.

### Documents, public profile and reviews

**D18 — Submitted forms could not pass current submission validation. High.** All four submitted intake responses lack required `owner_email` and `matting_consent` answers. Calling the actual form validator rejects all four at `owner_email`. Seed fully valid answers and signatures; add draft/opened/submitted states and real attachment references. A submitted status alone is not evidence of a valid completed form.

**D19 — Signed contracts lack the signed agreement and evidence fields. High.** All six seeded signed signatures store only a title in `signed_body`, rather than the agreement, and lack contract version, signing method and signer name. No signed-document attachment is seeded. Preserve the full immutable signed text and version with coherent signing evidence; distinguish generated-download behavior from a persisted artifact. Add a pending contract that can actually be signed in the demonstration.

**D20 — Reviews contradict their source visit and contain generic responses. Medium.** `rv_4` and `rv_5` were submitted before the linked visits ended. David has two different published reviews for the same booking. The cat-groom review receives a generic parking/wait apology that does not match its text, while another review references daycare against a grooming booking. Anchor request/submission/response times to the actual visit, use one coherent review story per visit unless repeats are explicitly supported, and write responses to the specific feedback. Add a held-review moderation case rather than equating a manually published low score with a policy failure.

**D21 — The public business profile is visibly incomplete. High for Connect demos.** The actual profile service returns **zero team members**, no about text, address, phone, email or gallery. Staff exists but `brand.public_staff_ids` is empty. Billing email is not the public-profile email. Populate the public brand contract, select the staff to display, and provide curated business/contact/gallery content. All existing image objects are healthy; this is missing profile data, not broken storage.

### Coverage and repeatability

**D22 — Identity, pet and catalog details do not exercise the full editors. Medium.** No active user is email-verified or has a manager approval PIN. There is no admin persona or second-business context. Pet attributes omit species, birthday, sex and `rabies_until`; the seed's `vaccinated=true` does not drive the UI's expiry alerts. Named puppy-class attendees have no ages demonstrating that they are puppies. Product SKUs and variants are absent. Add coherent values and a small role/scenario matrix, rather than filling every field arbitrarily. Priya's hourly rate with `payee=false` should have an explicit employee-versus-contractor story; it is not automatically a commission bug.

**D23 — Several implemented demo journeys have no examples. Medium.** Fresh data has no tips, discounts, optional estimate lines, product variants, unread messages, time-off exceptions, draft intake responses, pending signatures, consent events or payment setup links. All 457 payments are succeeded: pending/processing/failed/required-action states are absent. All clients are active and threads open. Pickup only covers unfulfilled. Existing subscription states and review requests are useful, but do not compensate for these omissions. Keep infrastructure tables such as sessions, commands, device registrations and returning challenges empty when no real event should exist; lack of rows there is not automatically a defect.

**D24 — Shared tests and helper scripts change the presentation baseline. High operational impact.** Current data differs from the seed: extra client/pet/item/estimate, additional bookings and add-ons, different series, created public tokens and altered stock data. `connect_links.py` writes tokens and creates form/signature records; `web_fixtures.py` conditionally creates series, stock and a synthetic dispute. Passing walkthrough tests therefore does not certify a fresh seed. `make seed` truncates every mapped table in a committed transaction before insertion, is not a tenant-scoped reset, and can leave an emptied database after a later failure. Separate disposable test databases from presentation data; stamp demo version/as-of, provide an explicit dedicated-demo reset or restore, and run a read-only preflight before each presentation. Do not reset the shared database as an audit side effect.

**D25 — Marketing mock values drift from the actual demo. Medium.** The site uses independent values in [demo.ts](../../../frontend/apps/site/src/content/demo.ts): Bath & Tidy is $48/60 minutes there versus $45/45 minutes in the seed, Cat Groom is $64 versus $85, shampoo stock is 14 versus seeded 24, and invoice counts/dates are fixed. The same named customer can have a different service history. Use a shared approved scenario fixture or clearly separate illustrative marketing content from the live demo; validate screenshots and sales scripts against the chosen version.

**D26 — Seeded operational evidence does not describe the seeded transaction. Medium.** `seed_platform()` inserts a processed Stripe success for `pi_demo_1001` at $78.75, but `_invoice_for()` creates `pay_1001` as an $84 Interac payment with no Stripe reference. Its Twilio delivery record references `sm_demo`, while seeded messages use different references. These are illustrative fragments rather than a traceable processing history. Generate webhook and audit evidence from the same scenario events as the transaction, or omit synthetic processed records that claim an event occurred when no corresponding object exists. Keep simulated events clearly separate from a real provider replay queue.

## Recommended implementation order

| Slice | Concrete work | Acceptance before proceeding |
|---|---|---|
| 1. Define the demo contract | Business timezone/as-of, curated households, background volume, role personas, supported provider mode, required walkthroughs. Separate demo and automated-test destinations. | One explicit scenario manifest; reset cannot touch an unintended database. |
| 2. Repair scheduling and stories | Species/weight eligibility, staff/pet/resource occupancy, buffers, real recurrence/closure dates, valid transitions and customer histories. | Zero unexplained semantic violations across seven seed weekdays and host timezones; new/lapsed/quarterly stories remain true. |
| 3. Repair financial scenarios | Correct tax classes; derive headers from lines; build accepted estimates and conversions; attach stock and pickup effects; date ledger events; correct payout math; align subscriptions and entitlements. | Documents, payments, ledger, tax, stock and ownership reconcile; correct period reports and staff pickup replica; no unexplained monetary gift expiry. |
| 4. Complete documents and outreach | Valid submitted/draft forms, full signed/pending contracts, dated conversations, coherent reviews, consent-backed broadcasts and delivery outcomes. | Seeded completed records pass the same validators as real submissions; previews show meaningful audiences and content. |
| 5. Complete presentation coverage | Public profile, pet details, SKU/variant, tip/discount, unread/failed, time-off, pickup stages and role-specific examples. | Each advertised web/mobile/Connect journey has an identified start record and expected result. |
| 6. Make provider actions demonstrable | Either deterministic local adapters plus outbox, or isolated real test-mode customers/methods/charges/subscriptions. | Payment/refund/membership/PAD flows succeed in the selected mode and display coherent results across clients. |
| 7. Automate the demo gate | Promote the audit checks into maintained tests/preflight, then run browser and native walkthroughs against disposable copies. Store a verified presentation snapshot. | One documented preparation command; checks fail on semantic drift; owner and staff see the expected records after sync. |

High-confidence corrections are the arithmetic, timestamp, relationship, validation and field-contract failures above. Product decisions still needed for implementation are the curated customer stories and volume, simulation versus provider-test-mode presentation, exact notification delivery experience, and which role/payment failure scenarios must be available by default. This review makes no production-code or shared-data corrections; it records the evidence before those choices are implemented.

## Reproduction

From `backend/`, the retained local read-only audit can be rerun with:

```sh
.venv/bin/python ../.scratchpad/demo-data-review/audit.py --output ../.scratchpad/demo-data-review/current.json
.venv/bin/python ../.scratchpad/demo-data-review/audit.py --database clientbridge_demo_audit_20261008 --output ../.scratchpad/demo-data-review/fresh.json
.venv/bin/python ../.scratchpad/demo-data-review/probes.py
```

The audit takes a read-only repeatable-read snapshot and writes only local result files. It deliberately does not call `make seed`, invoke the mutating fixture/link helpers, or issue external payment/email/SMS operations. The scratch scripts are diagnostic evidence, not yet a maintained CI gate. Browser/native and provider interaction coverage must be added after repair rather than inferred from these database checks.
