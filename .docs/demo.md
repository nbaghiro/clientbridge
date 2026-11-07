# Demo businesses

There is one seeded demo business per vertical the product serves, so each trade can be shown and tested from its own point of view. They are ordinary tenants: `make seed` replaces them locally, and staging reseeds them every night and on demand ([operations.md](operations.md#stagings-demo-seed)). Each business's walkthrough below lists its stages with the seeded ids to open. How the seed builds and writes them is in [engineering.md](engineering.md#the-demo-seed).

- **Password:** `demo1234` for every login.
- **Where:** locally, and on staging at `https://app.staging.clientbridge.ca` and in the staging mobile app.
- **Logins:** owners are `owner@<slug>.example` (Birchbark's is `hannah@`). Staff are `<firstname>@<slug>.example`, listed under each business's team. Office and front desk staff (Northlight's `office@`, Maple and Main's `amara@`, Fieldnote's `ivy@`, Harbourside's `teresa@`, Inkwell's `harleen@` and Riverbend's `paul@`) are administrators who can't be booked.
- **Core businesses:** Birchbark, Cedar Coast and Northlight are marked `core=True` in `DEMO_BUSINESSES` (`backend/scripts/demo_context.py`). Tests and CI seed only these three (`make seed-core`), while `make seed` and staging's seed write all 13.
- **Safe to use:** every login email is a reserved address (`.example`) and every client phone is a reserved number (555-0100 to 0199), so demo mail and texts never leave the app. Clients have no email address; the demos reach them by text only. On staging a text to a demo client shows as sent without going to Twilio, and locally texts and email land in Mailpit; production refuses reserved addresses ([operations.md](operations.md#delivery-recovery)).
- **Today's visits:** some demos show "checked in" and "on the way" only during their working hours. At other times those visits move to the next working day.
- **Card payments:** these need the demo linked to the Stripe sandbox ([payments.md](payments.md#local-sandbox-setup)). Without that, use cash or manual payments.
- **Staging smoke lane:** `make test-staging-smoke` signs in with these logins by default. `SMOKE_PASSWORD` and `SMOKE_OWNERS` (comma-separated emails) override them, and `SMOKE_DOMAIN` or the `SMOKE_*_URL` variables point it at another environment. It only reads, so it leaves the demo data as it was.

## At a glance

| Vertical | Business | Slug | Province, tax | Subject | Owner login | Site trade page |
| --- | --- | --- | --- | --- | --- | --- |
| Pet grooming and daycare | Birchbark Pet Studio | `birchbark` | BC, GST + PST | pet | `hannah@birchbark.example` | `/solutions/pet-grooming` |
| Dog walking and pet sitting | Cedar Coast Pet Care | `cedarcoast` | BC, GST + PST | pet | `owner@cedarcoast.example` | none |
| Security installs (trades) | Northlight Security | `northlight` | BC, GST + PST | site | `owner@northlight.example` | `/solutions/trades` |
| Home cleaning | Brightwater Home Cleaning | `brightwater` | AB, GST | property | `owner@brightwater.example` | `/solutions/cleaning` |
| Hair salon | Maple and Main Hair Studio | `maplemain` | ON, HST | none | `owner@maplemain.example` | `/solutions/salons` |
| Personal training and fitness | Ridgeline Strength Studio | `ridgeline` | AB, GST | none | `owner@ridgeline.example` | `/solutions/fitness` |
| Tutoring and music lessons | Lakeside Learning Studio | `lakeside` | ON, HST (tutoring exempt) | student | `owner@lakeside.example` | `/solutions/tutoring` |
| Massage and wellness clinic | Harbourside Massage and Wellness | `harbourside` | BC, GST (acupuncture exempt) | none | `owner@harbourside.example` | `/solutions/wellness` |
| Photography | Fieldnote Photography | `fieldnote` | ON, HST | none | `owner@fieldnote.example` | `/solutions/photography` |
| Landscaping and lawn care | Foothills Lawn and Garden | `foothills` | AB, GST | property | `owner@foothills.example` | none |
| Tattoo studio | Inkwell Tattoo Collective | `inkwell` | BC, GST (+ PST on products) | none | `owner@inkwell.example` | none |
| Mobile car detailing | Clearcoat Mobile Detailing | `clearcoat` | QC, GST + QST | vehicle | `owner@clearcoat.example` | none |
| Driving school | Riverbend Driving School | `riverbend` | MB, GST (+ RST on products) | student | `owner@riverbend.example` | none |

Provinces are mixed so the demos show GST, PST, QST, Manitoba's RST and HST. Each business page is `<slug>.D` on the environment's base domain. A marketing site trade page's demo link opens its business; a vertical without one is reached by its owner login.

Every business seeds the same baseline:
- online booking with an intake form;
- a signed agreement;
- a deposit;
- today's visits with a check-in;
- a Tap to Pay sale;
- an overdue invoice;
- a refund;
- a no-show or late cancellation;
- feedback and a review request;
- a message thread and a broadcast;
- photos.

The sections below cover what each business adds.

## Which demo shows what

| To try | Use |
| --- | --- |
| Estimates, accepting and booking the job | Northlight, Brightwater, Foothills, Fieldnote, Clearcoat |
| On my way and arriving at a client's place | Northlight, Brightwater, Foothills, Clearcoat |
| Add-ons that lengthen a visit | Brightwater, Northlight, Clearcoat |
| A crew of two on one job | Northlight, Brightwater, Foothills, Fieldnote, Clearcoat |
| Staff who offer only some services | Maple and Main, Harbourside, Inkwell, Cedar, Ridgeline, Fieldnote, Clearcoat, Riverbend |
| Shared rooms, tables and cars | Riverbend, Harbourside, Ridgeline, Lakeside |
| Repeating series | Birchbark, Cedar, Brightwater, Lakeside, Maple and Main, Foothills, Harbourside, Inkwell |
| Packs, including a pack for one pet, student or vehicle | Birchbark, Cedar, Ridgeline, Lakeside, Maple and Main, Fieldnote, Harbourside, Foothills, Clearcoat, Riverbend |
| Memberships and plans | Birchbark, Cedar, Ridgeline, Lakeside, Foothills, Clearcoat |
| Classes with a waitlist | Birchbark, Cedar, Ridgeline, Lakeside |
| Programs and camps (enrol in every day at once) | Lakeside, Ridgeline, Riverbend |
| Pickup permissions | Lakeside |
| Visit records and the insurance receipt | Harbourside (Maple and Main uses visit records for colour formulas) |
| Gift cards | most demos; Brightwater and Clearcoat show one bought for a parent |
| A trial plan | Cedar |

## The businesses

### Birchbark Pet Studio (pet grooming and daycare, Victoria)
- **Team:** Hannah (owner, groomer), `admin@` Alex (administrator), `diego@` (groomer, commission), `priya@` (bather and front desk).
- **How they work:**
  - Clients book grooms online and wait for approval.
  - Each dog is a pet record.
  - Daycare regulars are on a monthly membership, and bath regulars buy a 5-bath pack for one pet.
- **Try:**
  - the puppy class with deposits and a waitlist;
  - today's bath checked in, and a groomer on the way to a house call;
  - a Tap to Pay sale with a tip;
  - estimates;
  - a paused and a past-due membership;
  - a chargeback.
- **Note:** the web, Connect and end-to-end fixtures use this business.

#### Walkthrough

Birchbark is built by hand in `scripts/seed_demo.py` rather than on the demo engine, so its ids carry no business prefix. Hannah and Diego groom from Tuesday to Saturday, and clients sign the grooming services agreement and waiver. Grooming and baths carry GST only, retail products GST and PST, and gift cards none.

| Stage                                                | Where to look                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| New clients booked online, waiting for approval      | Nadia (`bk_welcome_0`) and Tom (`bk_welcome_1`)                                                  |
| Intake form answered and agreement signed            | Amélie (`fr_intake_0`, `sig_0`); Fatima's is pending (`sig_pending`), Olivia's declined          |
| Regulars on repeating series                         | Bella (`sch_bella`), Rex (`sch_rex`), Miso (`sch_miso`) and eight more                           |
| Puppy class with deposits and a waitlist             | `sch_puppy`, deposits such as `pay_dep_bk_puppy_<date>_<n>`, Ada waitlisted (`bk_class_extra_3`) |
| Today's bath checked in, groomer off to a house call | Cooper (`bk_today_cooper`) and Miso (`bk_today_miso`, with the house-call note)                  |
| Paid by Tap to Pay with a tip                        | Willow (`bk_tap_willow`, `ord_tap`): a bath and treats, with Diego's tip                         |
| 5-bath pack for one pet                              | Rex (`pkg_marcus`), two baths used                                                               |
| Overdue invoices                                     | Marcus (`inv_1002`, `inv_1003`) and Liam (`inv_1005`)                                            |
| Refunds                                              | Olivia (`pay_refr`) and Noah's goodwill credit on a sale (`pay_demo_partial_refund`)             |
| No-show                                              | Grace (`bk_011`)                                                                                 |
| Daycare membership, paused and past due              | David (`sub_david`), Priscilla (`sub_priscilla`) and Ethan (`sub_pastdue`)                       |
| Estimates sent, accepted and declined                | Priscilla (`est_1001`), Liam (`est_1002`), Yuki (`est_1003`)                                     |
| Gift cards bought and used                           | Liam (`gc_liam`); David's card paid part of an invoice (`gc_used`)                               |
| Feedback and review requests                         | Amélie (`fr_satisfaction_0`) and Marcus (`fr_satisfaction_1`), with ten review requests          |
| Broadcasts                                           | `bro_deshed`, `bro_holiday` and `bro_winback`                                                    |
| Card chargeback waiting for a response               | `pay_1006`                                                                                       |

Cooper's bath with Priya is under way and checked in when the seed runs between about 9:00 and 16:30 Vancouver time from Tuesday to Saturday. Miso's house call starts within the hour, with Hannah or Diego on the way, when one of them is free then. At other times those two visits aren't seeded. A house call is an ordinary booking with a note giving the address, because a pet has no place of its own.

### Cedar Coast Pet Care (dog walking and pet sitting, Vancouver)
- **Team:** Rowan (owner), `amrit@` (walker, commission), `tessa@` (walker, hourly), `leila@` (overnight sitter, the only one offered overnights).
- **How they work:**
  - New clients book a free meet and greet with no approval step, then sign the key-holding agreement.
  - Regular walks run on weekday series, invoiced weekly.
- **Try:**
  - a full group walk with a dog on the waitlist;
  - an overnight stay with a deposit;
  - a holiday sitting quote;
  - Wen's 10-walk pack for one dog;
  - the monthly walking plan;
  - the plan page on a trial.

#### Walkthrough

New clients book with no approval step on purpose, so one demo shows booking without approval. Services carry GST only and shop products GST and PST. The business stays on a 14-day trial so the plan page shows that state. Ids follow `bk_cc_<key>`, `cl_cc_<key>` and `sch_cc_<key>`.

| Stage                                                  | Where to look                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------ |
| New client's meet and greet booked online, intake sent | Daniel (`bk_cc_daniel_meet`, `fr_cc_meet_daniel`)                  |
| Regular on a weekday walk series, invoiced weekly      | Morgan (`sch_cc_morgan`)                                           |
| Partway through a 10-walk pack for one dog             | Wen (`pkg_cc_ten_wen`), for Mochi                                  |
| Today's walks, checked in and on the way               | Sanjay (`bk_cc_sanjay_today`) and Chloé (`bk_cc_chloe_today`)      |
| Overnight stay this weekend, deposit paid              | Nasrin (`bk_cc_nasrin_stay`)                                       |
| Holiday sitting request, quote sent                    | Ben (`est_cc_ben_holiday`)                                         |
| Cat drop-ins while the owner is away                   | Aiko (`bk_cc_aiko_trip_0`)                                         |
| Late cancellation, half the walk charged               | Ryan (`bk_cc_ryan_late`, `inv_cc_ryan_late`)                       |
| Missed walk charged in full, invoice overdue           | Derek (`bk_cc_derek_missed`, `inv_cc_derek_missed`)                |
| Five-star and four-star feedback, with a reply         | Isabel (`fr_cc_feedback_isabel`), Callum (`fr_cc_feedback_callum`) |
| Monthly walking plan and puppy visits                  | Elena (`sub_cc_plan_elena`), Simran (`sch_cc_simran`)              |
| Group walk full, with a dog on the waitlist            | Natasha (`bk_cc_tasha_wait`)                                       |
| Walk and collar light paid by Tap to Pay               | Hugo (`ord_cc_hugo`)                                               |
| Stay cut short, one night refunded                     | María José (`bk_cc_maria_stay`)                                    |

The scenario works around what the product does not do yet. A booking can't cross midnight inside a member's hours, so Leila has no hours from Friday to Sunday and every stay starts on one of those evenings; it is one long booking priced per night, and she takes no other visits while it runs. Home access lives in a pinned client note and the intake answers, since pet subjects have no access field. There is no late-cancellation fee, so Ryan's fee is a separate invoice line, and Derek's missed walk is invoiced by hand and left overdue. Reviews are the feedback form's rating and comments plus review requests, because the product stores no star reviews or public replies; Callum's reply is a text message. Plan walks are booked at no charge alongside the monthly subscription, and package and plan walks earn the walker nothing. Today's walks show one walker checked in and one on the way when the seed runs during working hours on a weekday; at other times they move to the next working day without those states.

### Northlight Security (camera sales and installs, Victoria)
- **Team:** Erik (owner), `office@` Naomi (office administrator), `liam@` (installer, commission on labour), `ava@` (installer, hourly).
- **How they work:**
  1. Survey booked online.
  2. Estimate with optional lines.
  3. Signed and paid deposit.
  4. Install booked from the estimate.
  5. On my way, check-in on site, photos and a signed handover form.
- **Try:**
  - a second camera mount that adds 30 minutes;
  - a two-person install, where the helper is blocked on their calendar and the pay is split;
  - a commercial client with two sites;
  - a warranty call;
  - a refund.

#### Walkthrough

Products carry GST and PST and labour GST only. Ids follow `bk_nl_<key>`, `est_nl_<key>` and `cl_nl_<key>`.

| Stage                                          | Where to look                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| New lead, pending survey with a survey form    | Harper (`bk_nl_harper_survey`)                                                       |
| Estimate sent with optional lines              | Rajesh (`est_nl_rajesh`)                                                             |
| Accepted estimate ready for Book the install   | Ruth (`est_nl_ruth`)                                                                 |
| Install booked from its estimate, deposit paid | Claire (`bk_nl_claire`)                                                              |
| Add-on that lengthens the install              | Claire and Simon (`bk_nl_simon`): a second camera mount adds 30 min                  |
| Two-person install                             | Claire, with Ava helping; Harbourline Bikes (`bk_nl_harbourbikes`)                   |
| Today's installs, on site and on the way       | Owen (`bk_nl_owen`) and Mei Lin (`bk_nl_meilin`)                                     |
| Installed and paid by Tap to Pay               | Sarah (`bk_nl_sarah`): photos, handover form, equipment, plan, review                |
| Commercial client with two sites, overdue      | Island Storage (`cl_nl_islandstorage`)                                               |
| Unused part refunded after the install         | Nora (`inv_nl_nora`): one junction box with GST and PST                              |
| Five-star and four-star install feedback       | Sarah (`fr_nl_feedback_sarah`) and Marco on a visible cable (`fr_nl_feedback_marco`) |
| Warranty call on a camera nearing its end date | Fiona (`bk_nl_fiona_warranty`)                                                       |
| Declined estimate, cancelled survey            | Gordon (`est_nl_gordon`), Natalie (`bk_nl_natalie_survey`)                           |

Owen's and Mei Lin's installs show one installer on site and one on the way when the seed runs between about 9:00 and 12:15 Vancouver time on a working day; at other times they move to the next working day without those states.

The scenario works around what the product does not do yet. A two-day install is shown as separate bookings, and the handover form stands in for a checklist; there is no time tracking. On a two-person install the helper's calendar shows a block for the job, and Liam's share of the Harbourline Bikes labour is half the line at his own rate. Sarah's install is checked out on a Tap to Pay sale, which pays Liam his commission on the visit's line as an invoice would, and the payment reads as an ordinary card sale. The on-my-way text goes through the delivery job and does not appear in the inbox.

### Brightwater Home Cleaning (Calgary)
- **Team:** Leah (owner), `joy@` and `harpreet@` (cleaners, hourly), `tomasz@` (cleaner, commission).
- **How they work:**
  - Each home is a property record with its entry, alarm and pet notes.
  - First cleans are booked online.
  - Move-outs are quoted with a 25% deposit.
- **Try:**
  - oven, fridge, window and laundry add-ons that lengthen the clean;
  - a two-cleaner move-out;
  - weekly and every-two-weeks regulars;
  - a property manager with four units;
  - a late cancellation fee;
  - a re-clean after three-star feedback.

#### Walkthrough

Brightwater is built on the demo engine in `scripts/demo_brightwater.py`. Regulars are on weekly or every-two-weeks series, and the three cleaners work from the mobile app. Alberta charges GST only, so cleans, add-ons and supplies carry 5% and gift cards none. Ids follow `bk_bw_<key>`, `est_bw_<key>` and `cl_bw_<key>`.

| Stage                                                  | Where to look                                                                            |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| New lead, first clean waiting for approval             | Sofia (`bk_bw_sofia`): home details form, agreement not yet signed                       |
| Move-out quote sent with optional lines                | Daniel (`est_bw_daniel`): kitchen and bathroom photos on his home details                |
| Move-out quote accepted and booked, deposit paid       | Wei (`est_bw_wei`, `bk_bw_wei`), Harpreet with Tomasz as crew (`av_bw_crew_wei`)         |
| Regular every two weeks on a series                    | Margaret (`sch_bw_margaret`); Anjali (`sch_bw_anjali`) is weekly on Saturdays            |
| Today's cleans: checked in, on the way and later today | Linh (`bk_bw_linh`), Chidi (`bk_bw_chidi`) and Kateryna (`bk_bw_kateryna`)               |
| Cleaned and paid by Tap to Pay with a tip              | Amara (`bk_bw_amara`, `ord_bw_amara`)                                                    |
| Property manager with four units, one invoice overdue  | Prairie Lane (`cl_bw_prairielane`, `inv_bw_prairielane_sunnyside`)                       |
| Cancelled late, with a late cancellation fee           | Brandon (`bk_bw_brandon_late`, `inv_bw_brandon_late`)                                    |
| Five-star feedback and a review request                | Fatima (`fr_bw_feedback_fatima`)                                                         |
| Three-star feedback about a missed spot, re-clean done | Kevin (`fr_bw_feedback_kevin`, `bk_bw_kevin_reclean`) and the owner's reply in the inbox |
| Gift card bought for a mother's clean                  | Jasmine (`gc_bw_mom`) and her mother Teresita (`bk_bw_teresita_gift`)                    |

Add-ons lengthen the clean they ride on: inside the oven by 45 minutes, the fridge by 30, windows by 60 and each load of laundry by 20. Wei's move-out has Tomasz as crew alongside Harpreet, blocked on his calendar for the whole job. Rachel's deep clean (`bk_bw_rachel`) has a partial refund for an add-on that wasn't done, and `bk_bw_home_20_lockout` is a no-show where the cleaner couldn't get in. The three cleans today show Joy checked in, Harpreet on the way and Tomasz later in the day when the seed runs between about 9:00 and 12:30 Calgary time on a weekday; at other times they move to the next working day without those states.

The scenario works around what the product does not do yet. There is no late cancellation fee in the product: the cancellation cutoff only limits online changes, so Brandon's fee is an invoice line added by hand, and the lockout is a no-show with no fee. Ratings come from the Clean feedback form; the product records review requests but not the reviews themselves, so the owner's reply to Kevin is a text. A gift card can pay toward a checkout sale but not toward an invoice, and the demo redeems it on its own: Teresita's clean is booked at no charge and the card is redeemed for its price with GST. Amara's clean is checked out on a Tap to Pay sale, which pays Joy for the clean as an invoice would, and the tip is recorded on the payment. Entry, alarm and pet notes are free text on the property, visible to every team member.

### Maple and Main Hair Studio (Toronto)
- **Team:** Leila (owner, senior stylist), `marcus@` (senior stylist), `tessa@` (stylist), `gabriela@` (colourist), `amara@` (front desk). The stylists earn commission on services and retail.
- **How they work:**
  - Clients book themselves, with no subject record.
  - Colour services take a deposit.
  - The senior cut is offered by Leila and Marcus only, the stylist cut by Tessa, and colour by Leila and Gabriela.
- **Try:**
  - a consultation form with photos;
  - a six-week rebooking series;
  - a balayage in progress today;
  - a no-show who forfeits the deposit;
  - a bridal party;
  - colour formula notes written on the visit.

#### Walkthrough

Maple and Main is a four-chair salon on the Danforth. Everything carries Ontario's 13% HST except gift cards. The book covers 30 weeks of history and 5 weeks ahead, visits are paid at the desk with tips on most card payments, and partial highlights, full highlights and balayage take a deposit. Ids follow `bk_mm_<key>` and `cl_mm_<key>`.

| Stage                                                  | Where to look                                                                                |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| First-time client with the consultation form submitted | Farah (`bk_mm_farah_consult`, `fr_mm_consult_farah`): pending online booking, photos         |
| Regular rebooked every six weeks with a series         | Grace (`sch_mm_grace`): root colour with Gabriela, colour formula in her notes               |
| Colour formula noted on each visit                     | Grace (`vr_mm_formula_grace_0` to `_4`); Natasha's came out warmer (`vr_mm_formula_natasha`) |
| Today's book, with a balayage in progress              | Olivia (`bk_mm_olivia`) and every stylist's `bk_mm_today_<member>_<n>`                       |
| No-show with a forfeited deposit                       | Tamara (`bk_mm_tamara`), rebooked as `bk_mm_tamara_rebook`                                   |
| Visit invoice overdue                                  | Roya (`bk_mm_roya_highlights`, `inv_mm_roya_highlights`)                                     |
| Bridal party booked after the trial                    | Sofia (`bk_mm_sofia_trial`, `bk_mm_sofia_bride`, `bk_mm_sofia_party_<n>`)                    |
| Retail sold at checkout with a cut                     | Elena (`bk_mm_elena`, `ord_mm_elena`)                                                        |
| Gift card bought and redeemed                          | David (`gc_mm_david`) and Priyanka (`bk_mm_priyanka_gift`)                                   |
| Three-blowout package, two used                        | Chloé (`pkg_mm_blowouts_chloe`)                                                              |
| Five-star and four-star feedback                       | Amira (`fr_mm_feedback_amira`) and Robert (`fr_mm_feedback_robert`), with a reply            |

Today's book shows Olivia's balayage in progress, with morning visits paid and the rest of the day ahead, when the seed runs from about 75 minutes after Gabriela starts until three and a half hours before she finishes, on a day all four stylists work (11:15 to 15:45 Toronto time on a Tuesday or Friday). At other times the same book moves to the next day all four work, without those states.

The scenario works around what the product does not do yet. A price can't vary by stylist, so the two cut prices are two services, each offered only by its own stylists: the senior cut by Leila and Marcus and the stylist cut by Tessa. A visit holds the chair for its whole length, with no processing time in which the stylist can take another client, and one booking carries one service, so a cut and colour would be two bookings. Elena's cut and the other desk checkouts go through a sale, which pays the stylist's service commission on the visit and retail commission on the products; the other visits are invoiced, which pays service commission and no retail commission. A gift card can pay toward a checkout sale but not toward an invoice, and the demo redeems Priyanka's on its own, so her visit is booked at no charge with a note and Marcus earns no commission on it. Star ratings live with external reviews, so the feedback form's rating field stands in for them, and Leila's reply is a text. Gabriela records each colour visit in the Colour formula form, a visit record (`vr_mm_formula_<key>`) that only she and the managers can read; Grace's and Olivia's standing formulas also stay in their client notes. The front desk is paid outside the app, and the brand has no cover photo because it takes a URL rather than an uploaded file.

### Ridgeline Strength Studio (Edmonton)
- **Team:** Jenna (owner, head coach), `mateo@` (trainer, commission), `simran@` (coach, hourly; the only one who teaches Strong seniors).
- **How they work:**
  - A free intro with the PAR-Q and the waiver.
  - Then one-to-one training, a 10-session pack, or a monthly class membership.
  - Classes run in the Studio and bootcamp on the Turf, so two studio classes can't overlap.
- **Try:**
  - a full class whose waitlist fills a cancelled seat;
  - a member whose card failed;
  - a 10-class seniors pass;
  - the 6-week "Strength foundations" program, with every evening in the Studio.

#### Walkthrough

Members book classes at no charge from a weekly timetable of eleven sessions, and drop-ins are invoiced per class. Strong seniors has regulars on a 10-class pass. Mateo runs Strength foundations, a six-week program on Thursday evenings that a student joins as a whole: enrolling books all six evenings, takes a $50 deposit and issues the invoice, due on the first evening. Alberta charges GST only, so every line carries GST except gift cards. Ids follow `bk_rl_<key>`, `sub_rl_<plan>_<key>` and `cl_rl_<key>`.

| Stage                                                         | Where to look                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| New lead, free intro booked online with a PAR-Q               | Hailey (`bk_rl_hailey_intro`, pending approval; waiver still unsigned)          |
| Member on the unlimited plan                                  | Ben (`sub_rl_unlimited_ben`)                                                    |
| Member whose card failed, past due                            | Kyle (`sub_rl_eight_kyle`), with the text about the declined card               |
| Halfway through a 10-session pack                             | Grace (`pkg_rl_pt10_grace`): five used, the sixth booked (`bk_rl_grace_pack_5`) |
| Full class, waitlist seat given after a cancellation          | `ses_rl_full_class`: Lucy cancelled, Farah got the seat, Devon still waits      |
| Today's training and class with check-ins                     | Omar (`bk_rl_omar_today`), `ses_rl_today_class`, Linh later today               |
| Cancelled membership                                          | Carmen (`sub_rl_unlimited_carmen`), moving to Calgary                           |
| Strong seniors on a 10-class pass                             | Elaine (`pkg_rl_seniors_elaine`)                                                |
| Six-week program halfway through, deposits paid               | Jake (`sch_rl_foundations`, `bk_rl_foundations_jake_0`)                         |
| Program balance overdue after its first evening               | Isaac (`inv_rl_foundations_isaac`)                                              |
| Next program enrolling, invoiced and due on its first evening | Brianna (`sch_rl_foundations_next`, `inv_rl_foundations_next_brianna`)          |
| Five-star and four-star feedback                              | Walter (`fr_rl_feedback_walter`), Anita on parking (`fr_rl_feedback_anita`)     |
| Paid by Tap to Pay with a retail add-on                       | Jordan (`ord_rl_jordan`): a session and a set of bands                          |

The scenario works around what the product does not do yet. The product stores no star reviews, so session feedback is a form with a rating field, and the owner's reply to Anita is a text in her thread. A membership's eight classes a month and its 10% retail discount are shown on the plan but not enforced: members' class bookings are priced at zero by hand and the seed keeps 8-class members to eight. A membership cannot be paused from the app, so the stage shows a cancellation. A failed renewal leaves no failed payment row, only the past due plan. Omar's session and today's class are in progress only when the seed runs inside a coach's hours; at other times they move to the next working day without check-ins.

### Lakeside Learning Studio (tutoring and music, Ottawa)
- **Team:** Nadia (owner), `julien@` (English and French, commission), `samuel@` (science and SAT, hourly), `sofia@` (piano and guitar, commission).
- **How they work:**
  - Parents are the clients and their children are student records.
  - A new family books an assessment, then lessons run weekly through a term.
  - Families pay per lesson, by term pack (one per child) or on a monthly plan paid by pre-authorized debit.
  - Piano lessons take the Piano room.
- **Try:**
  - the Fall Coding Camp: families enrol in every day at once, with one invoice and siblings each holding a seat, and Monday is one seat short of full;
  - who may pick each child up, and a "must not collect" alert;
  - the SAT class nearly full;
  - an exam review with a waitlist.

#### Walkthrough

Each student has a grade, school, birthday and allergies where they have one, and lesson notes on the student. Curriculum tutoring and music lessons are exempt from HST, while SAT prep and books and supplies carry HST at 13%. Ids follow `cl_ls_<family>`, `sj_ls_<family>` for the first child and `sch_ls_<key>` for a weekly series, whose visits are `bk_ls_<key>_<n>`.

| Stage                                                     | Where to look                                                                                                                                                                                         |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New family booked an assessment, registration submitted   | Amara Nwosu (`bk_ls_nwosu_assessment`, waiting for approval; policies not yet signed)                                                                                                                 |
| Two children on different weekly series, sibling discount | Thu Tran (`sch_ls_tran_minh`, `sch_ls_tran_an`, 10% off An's invoices)                                                                                                                                |
| Partway through a 10-lesson term package                  | Isabelle Fontaine (`pkg_ls_term10_fontaine`, `sch_ls_fontaine`)                                                                                                                                       |
| A term package for each child and one to share            | Chen (`pkg_ls_term10fr_chen_olivia`, `pkg_ls_term12_chen_ethan`, `pkg_ls_term12_chen_shared`)                                                                                                         |
| Missed lesson, rescheduled as a make-up                   | Yusuf Ahmed (cancelled `bk_ls_ahmed_5`, make-up `bk_ls_ahmed_makeup`, text thread)                                                                                                                    |
| SAT prep class nearly full                                | Marta Kowalski (`ses_ls_sat_3`, seven of eight seats, each on a course package)                                                                                                                       |
| Exam review class full, with a waitlist                   | Marc Leblanc (`bk_ls_review_next_leblanc` on `ses_ls_review_next`)                                                                                                                                    |
| Coding camp week with siblings, pickups and deposits      | `sch_ls_coding_camp`: Monday to Friday next week, nine students, each with a $100 deposit paid, Monday one seat short of full, Thu Tran's two children, Lucas Wong and Nora Murphy away two days each |
| Today's lessons for each tutor                            | The calendar today: two to three lessons each from `sch_ls_dhillon`, `sch_ls_gagne`, `sch_ls_rahimi`, `sch_ls_li` and others                                                                          |
| Monthly plan paid by pre-authorized debit                 | Yaw Mensah (`sub_ls_plan_mensah`, bank account `pm_ls_mensah`, signed plan agreement)                                                                                                                 |
| Five-star feedback from a parent                          | Laura Bianchi (`fr_ls_feedback_bianchi`), with a review request and a thank-you thread                                                                                                                |
| Term-end thread and next term registration                | Nadège Desrosiers (`th_ls_desrosiers`, `fr_ls_reregister_desrosiers`)                                                                                                                                 |
| Overdue invoice, no-show, three-star feedback             | Brendan Sullivan (`inv_ls_sullivan_overdue`), Daniel Park (`bk_ls_park_extra`), Navdeep Gill (`fr_ls_feedback_gill`, owner reply by text)                                                            |
| Paid by Tap to Pay with a book                            | Jun Li (`ord_ls_li_book`)                                                                                                                                                                             |

Weekly series are placed by working day from the seed date, so today's lessons always fall on the day the seed runs, or on Monday when it runs on a Sunday. At the frozen test time they are all still ahead, in the afternoon; lessons that have begun when the seed runs are checked in, so a seed from about 15:30 Ottawa time shows check-ins, and one in the evening finds them completed. The scenario works around what the product does not do yet. Reviews are stored only as review requests, so ratings live in a feedback form and the owner's reply is a text. A plan's lessons are booked at no charge with a note, because a subscription does not cover bookings the way a package does. The sibling discount is a 10% discount on each invoice rather than a rule. Clients cannot buy packages or gift cards online, so the studio sells them in person, and Ontario's point-of-sale rebate on printed books is not modelled, so the workbooks carry the full 13% HST. A registration form is answered once per family for the first child, and each student's learning needs are a note on the student. The coding camp is a program: Samuel teaches it from 9 to 3 on date hours added for that week, each student holds a booking per day with the price on Monday's, and each enrolment takes a $100 deposit and is invoiced when it is made, with the deposit taken off and the rest due on the camp's first day.

### Harbourside Massage and Wellness (clinic, Vancouver)
- **Team:** Leila (owner, RMT), `jun@` (RMT, commission), `wen@` (acupuncturist, hourly; the only one offered acupuncture), `teresa@` (front desk).
- **How they work:**
  - New clients fill in a health history and sign the cancellation policy.
  - Practitioners' titles carry their credential and registration number.
  - Each treatment takes one of Rooms 1 to 3, and a couples massage takes both tables in the couples room.
- **Try:**
  - the insurance receipt from a paid visit (staff from the booking, clients from their manage page);
  - SOAP notes kept as visit records, including one amendment;
  - a 10-visit pack;
  - a weekly acupuncture series;
  - a couples massage on the two couples tables, which can't be booked twice at once;
  - a late cancellation fee.

#### Walkthrough

Massage therapy carries GST only: it isn't on the federal list of GST-exempt health services, and BC charges no PST on it. Acupuncture by a registered acupuncturist is GST-exempt, gift cards carry no tax when sold, the massage oil carries GST and PST, and the herbal heat compress carries GST only because BC exempts hot and cold packs from PST. Each practitioner's title carries their credential and registration number, such as Leila's "Owner · RMT · Reg. 10482", and the visit's receipt prints it for extended health claims, so invoice notes name only the service. Ids follow `bk_hs_<key>`, `pkg_hs_<pack>_<key>` and `cl_hs_<key>`.

| Stage                                                | Where to look                                                                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| New client, health history in before the first visit | Ananya (`bk_hs_ananya_first`, `fr_hs_intake_ananya`); Chloe's form is still unanswered                                  |
| Regular partway through a 10-pack                    | Kenji (`pkg_hs_pack10_kenji`): six used, the seventh booked (`bk_hs_kenji_6`)                                           |
| Today's treatments, one checked in                   | Sofia with Leila (`bk_hs_sofia_today`), Ethan with Jun, Rosa with Wen                                                   |
| Late cancellation inside 24 hours, fee charged       | Brendan (`bk_hs_brendan_late`, `inv_hs_brendan_late`), rebooked for next week                                           |
| Missed visit, fee invoice overdue                    | Tyler (`bk_hs_tyler_missed`, `inv_hs_tyler_missed`)                                                                     |
| December gift card, redeemed in the new year         | Margaret bought `gc_hs_lucas`; Lucas used it (`bk_hs_lucas_gift`)                                                       |
| Couples massage with both therapists                 | Leah and Aaron (`bk_hs_couples_leah`, `bk_hs_couples_aaron`), and last Valentine's                                      |
| Weekly acupuncture series                            | Harjit (`sch_hs_harjit`), after his initial visit (`bk_hs_harjit_initial`)                                              |
| Visit records, one amended                           | Fatemeh (`vr_hs_soap_fatemeh`), Hiroshi (`vr_hs_soap_hiroshi`, `vr_hs_soap_hiroshi_amended`) and Raj (`vr_hs_soap_raj`) |
| Visit receipt with the practitioner's registration   | Hiroshi's massage with Jun (`inv_hs_hiroshi_recent`)                                                                    |
| Five-star and four-star feedback                     | Fatemeh (`fr_hs_feedback_fatemeh`), Gwen on the cold room (`fr_hs_feedback_gwen`)                                       |

The scenario works around what the product does not do yet. A booking has one practitioner, so a couples massage is two bookings at the same time that the front desk makes. A visit paid by invoice or sale has a receipt that prints the practitioner's title with their registration, but a package's visits have no receipt of their own, and nothing bills insurers directly. A late cancellation doesn't charge a fee by itself (a deposit is kept only on a no-show), so Brendan's fee is its own invoice. A gift card can pay toward a checkout sale but not toward an invoice, and the demo redeems Lucas's on its own, so his visit has no invoice and the redemption isn't linked to it. Practitioners earn on paid invoices and sales, so package and gift card visits, which have neither, pay them nothing. The product stores no star reviews, so feedback is a form with a rating field, and Leila's reply to Gwen is a text in her thread. Sofia is checked in only when the seed runs inside Leila's hours; otherwise whoever is working has the checked-in client, and outside everyone's hours the three visits move to the next working day without one. The brand has no cover photo, because a cover is a URL and the demo's images aren't served from a fixed address.

### Fieldnote Photography (portraits and weddings, Hamilton)
- **Team:** Amara (owner, lead photographer; the only one offered weddings), `julian@` (second shooter, commission), `ivy@` (studio manager).
- **How they work:**
  1. A wedding inquiry gets an estimate.
  2. The couple signs the agreement and pays a 30% retainer.
  3. The planning form collects the day's details.
  4. The balance is invoiced after the wedding.
- **Try:**
  - Julian as crew on a wedding;
  - a mini-session day of twelve 20-minute slots;
  - a print order paid by Tap to Pay;
  - an overdue balance;
  - team headshots on a package;
  - a no-show.

#### Walkthrough

Families book sessions with a $100 deposit, and the wedding is booked for Amara with Julian on it as crew. Ontario charges HST at 13% on every line except gift cards. Ids follow `bk_fn_<key>`, `est_fn_<key>`, `inv_fn_<key>` and `cl_fn_<key>`.

| Stage                                               | Where to look                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------- |
| Wedding inquiry with an estimate sent               | Olivia (`est_fn_olivia`, optional lines; agreement unsigned, `sig_fn_olivia`)   |
| Estimate accepted, agreement signed, retainer paid  | Sanjay (`bk_fn_sanjay`, `sig_fn_sanjay`, planning form `fr_fn_planning_sanjay`) |
| Wedding done, balance invoiced before delivery      | Emma (`inv_fn_emma`), open and due within two weeks                             |
| Balance invoice overdue, partly paid                | Kristen (`inv_fn_kristen`), with the payment plan agreed by text                |
| No-show who forfeited the deposit                   | Ryan (`bk_fn_ryan_noshow`)                                                      |
| Past wedding fully paid, with a five-star review    | Aaliyah (`inv_fn_aaliyah`, `fr_fn_feedback_aaliyah`)                            |
| Headshot session today                              | James (`bk_fn_james_today`), with his questionnaire                             |
| Headshot session under way, checked in              | Hyun-woo (`bk_fn_hyunwoo_today`)                                                |
| Family mini-session day, most slots booked          | `ses_fn_fall_mini_00` to `_11`: ten booked, two open; Chloé has the first       |
| Newborn session booked around the due date          | Fatima (`bk_fn_fatima_newborn`), a placeholder date to be moved after the birth |
| Print order sold at the ordering appointment        | Wei Ling (`bk_fn_wei_ordering`, `ord_fn_wei`): prints, a canvas and a USB       |
| Four-star review about delivery time, with a reply  | Rohan (`fr_fn_feedback_rohan`, `th_fn_rohan`)                                   |
| Team headshots on a 5-session package               | Barton & Hess (`pkg_fn_team_bartonhess`): three used, one booked                |
| Corporate event paid, and a declined event estimate | Ferrovia (`bk_fn_ferrovia`), Corktown Design (`est_fn_corktown`)                |

As crew, Julian's calendar is blocked for the wedding's whole window, and the coverage line is split evenly between Amara and him, so he earns his 40% on half of it; the second-shooter line on the balance invoice is a charge with no member. Hyun-woo's headshot is under way and checked in when the seed runs inside Amara's or Julian's hours, and Ryan didn't come to his family session and forfeited the $100 deposit.

The scenario works around what the product does not do yet. A booking has no place, so the venue addresses live in the planning form and a client note. A booking can't be marked as date to be confirmed, so the newborn session holds a placeholder date with a note. Multi-day events would need one booking per day, travel fees would be a manual line, and there is no gallery or photo delivery: the sneak peek and gallery are mentioned in messages and invoice notes only. The retainer is 30% of the coverage item, not of the whole estimate, because a deposit is set per item. There are no star reviews, so feedback is a form with a rating field and the reply to Rohan is a text. James's session is later today only when the seed runs inside Amara's hours; at other times it moves to her next working day.

### Foothills Lawn and Garden (Calgary)
- **Team:** Ravi (owner), `megan@` (crew lead), `tyler@` and `jonah@` (seasonal crew), all hourly.
- **How they work:**
  - Each yard is a property record with gate codes, sprinklers and dogs.
  - Weekly mowing runs May to October.
  - Projects and cleanups are quoted.
  - Snow plans are sold for the winter.
- **Try:**
  - crews on projects and cleanups;
  - a project with before, progress and after photos;
  - today's route, with one crew on site and one on the way;
  - a rain delay;
  - a condo board client.

#### Walkthrough

Each yard holds its address, gate code and sprinkler notes in access and its dogs in pets, with the lot size and sprinklers as extra attributes. Jonah runs the mowing series, Megan and Tyler do cleanups, hedges, beds and projects, and Ravi quotes projects and clears snow in winter. Everything carries GST only, as in Alberta. The history runs from February, when only snow clearing is booked, through a busy summer to fall cleanups in October and November. Ids follow `bk_fh_<key>`, `est_fh_<key>`, `sch_fh_<key>` and `cl_fh_<key>`.

| Stage                                               | Where to look                                                                           |
| --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Weekly mowing series that ends with the season      | Helen (`sch_fh_helen`), with her fall cleanup booked after the final cut                |
| Fall cleanup quotes sent, one accepted and booked   | Lucy (`est_fh_lucy`) and Kwame (`est_fh_kwame`); Amir (`est_fh_amir`, `bk_fh_amir`)     |
| Project accepted, deposit paid, done with photos    | Mariana (`bk_fh_mariana`): before, progress and after photos, signed sign-off           |
| Project accepted and booked, deposit paid           | Graham (`est_fh_graham`, `bk_fh_graham`)                                                |
| Sod estimate sent with optional lines               | Farah (`est_fh_farah`), with the project agreement waiting to be signed                 |
| Today's route: on site, on the way, later today     | Megan at Bernadette's (`bk_fh_bernadette`), Tyler on the way to Chloe's (`bk_fh_chloe`) |
| Snow plan sign-ups for the winter                   | Linda (`sub_fh_snow_linda`), Patrick and Adebayo; last winter's plans renewed           |
| Condo board on a weekly series, one invoice overdue | Silver Ridge Court (`sch_fh_silverridge`, `inv_fh_silverridge_hedges`)                  |
| Rain-delayed visit moved to the next dry day        | Nina (`bk_fh_nina`): note, text thread and a reschedule audit                           |
| No-show for a consultation, rebooked                | Ian (`bk_fh_home_23_missed`), rebooked as `bk_fh_home_23_consult`, with the text thread |
| Five-star feedback and a review request             | Harjit (`fr_fh_feedback_harjit`)                                                        |
| Three-star feedback about a gate left open          | Carol (`fr_fh_feedback_carol`), the owner's reply and a note on her yard                |
| Hedge trim paid by Tap to Pay                       | Marco (`ord_fh_marco`)                                                                  |
| Declined retaining wall estimate                    | Doug (`est_fh_doug`)                                                                    |

Megan's projects and Amir's fall cleanup have a second crew member, Tyler in season and Ravi while the crew is laid off, whose calendar is blocked for the visit (`av_fh_crew_<key>`); the spring cleanups get one where someone is free. Megan and Tyler show the on-site and on-the-way states when the seed runs between about 8:00 and 14:30 Calgary time on a weekday; at other times the route moves to the next working day without those states. The mowing series run from the first week of May to October 31 of the latest season to have started, and the seasonal crew is laid off from November to May, when Ravi takes Tyler's place on the route. The storyline is written for mid-October; seeded at another time of year it still builds and validates, but stages such as the fall quotes and the final cut no longer match the date.

The scenario works around what the product does not do yet. There is no route order or travel time beyond the buffer after each visit. Nothing in scheduling knows about weather: the rain delay is an ordinary reschedule, and snow visits are booked by hand after each snowfall rather than triggered by it. The snow plan is a yearly subscription that bills the season in October; the visits it covers are separate bookings at no charge, and nothing counts or limits them. The property kind has no lot size or sprinkler fields, so those sit in the yard's attributes, where the app doesn't show them, and in its access notes. Materials sold by the cubic yard use whole units, mowing series bill one invoice per visit rather than a monthly statement, and the seasonal crew's layoff is a long time-off entry. The portrait check in `demo_validate` counts only payments made on an invoice, not an applied deposit, so Mariana, whose project invoice is settled by her deposit and an e-Transfer, has no portrait.

### Inkwell Tattoo Collective (Vancouver)
- **Team:** Sasha (owner, custom work), `mei@` (fine-line; the only one offered piercing), `kieran@` (traditional colour), `harleen@` (front desk).
- **How they work:**
  - Custom work starts with a consultation and a design brief.
  - Sessions of 2, 4 or 6 hours take a non-refundable deposit.
  - A consent form is signed before every tattoo.
- **Try:**
  - a sleeve partway through its sessions;
  - a flash day;
  - aftercare sold on the invoice;
  - a free touch-up;
  - a no-show who forfeits the deposit.

#### Walkthrough

Custom sessions of two, four and six hours take a $100, $150 or $200 deposit at booking, which comes off the final session, and most card payments carry a tip for the artist. Tattooing and piercing are personal services, which BC's PST doesn't apply to (PST Bulletin 138), so services carry GST only. The aftercare balm and wash carry GST and PST, the healing film is treated as a dressing under the PST exemption for first-aid supplies and carries GST only, and gift cards carry no tax. The book covers 30 weeks of history and 5 weeks ahead, with a quieter July and August because a new tattoo has to stay out of the sun and water. Ids follow `bk_iw_<key>` and `cl_iw_<key>`.

| Stage                                                           | Where to look                                                                                                              |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| New client after a consultation, design brief and references in | Noor (`bk_iw_noor_consult`, `fr_iw_brief_noor`): two reference images, consult note                                        |
| Custom piece booked, deposit paid                               | Tomás (`bk_iw_tomas`): moved once by text, consent form waiting                                                            |
| No-show who forfeited the deposit                               | Brady (`bk_iw_brady`)                                                                                                      |
| Balance left to pay after the session, overdue                  | Mateo (`bk_iw_mateo_balance`, `inv_iw_mateo_balance`)                                                                      |
| Sleeve partway through its sessions                             | Anika (`sch_iw_anika`): three of six full days done, deposit held on the last, project agreement, progress photo           |
| Today's sessions, one checked in                                | Kenji (`bk_iw_kenji`) and each artist's `bk_iw_today_<artist>_<n>`                                                         |
| Flash day with short walk-in slots                              | Jordan (`bk_iw_flashday_jordan`) and `bk_iw_flashday_<artist>_<n>`, three weeks back, with the broadcast that announced it |
| Aftercare sold with the session                                 | Lucía (`bk_iw_lucia`, `inv_iw_lucia`): balm, wash and film on the session invoice, with a tip                              |
| Free touch-up booked                                            | Hana (`bk_iw_hana_touchup`), seven weeks after her session (`bk_iw_hana`)                                                  |
| Five-star and four-star feedback                                | Oluwaseun (`fr_iw_feedback_olu`) and Graham (`fr_iw_feedback_graham`, about the wait), with Sasha's reply                  |

Kenji's four-hour session is under way, checked in 75 minutes ago, when the seed runs between about 12:15 and 15:45 Vancouver time on a day Kieran, Sasha or Mei works and is free then; the earlier sessions that day are paid and the later ones are ahead. At other times the same book moves to the next day at least two artists work, without those states. The rest of the history includes a gift card bought and redeemed (`gc_iw_amelia`, `bk_iw_ronan_gift`), a refunded healing film (`bk_iw_cole_flash`), piercings every week, consent forms signed before every tattoo and piercing of the last ten weeks, and aftercare acknowledgements after the custom sessions.

The scenario works around what the product does not do yet. A deposit belongs to one booking, so a sleeve's deposit is taken on its last session and the earlier sessions show none. A price can't vary with the time a session actually takes, so the three session lengths are three services, and a session that runs short or long keeps its booked price. Nothing checks the three-month window for a free touch-up: the touch-up is booked at no charge by hand. The consent form records the photo ID and date of birth, but nothing enforces the age of 18. A flash day has no walk-in queue or open slots to publish, so the desk books each walk-in as it arrives. A gift card can pay toward a checkout sale but not toward an invoice, and the demo redeems Ronan's on its own, so his piece is booked at no charge with a note. Star ratings live with external reviews, so the feedback form's rating stands in for them, and Sasha's reply is a text. Artists who rent a chair rather than take commission can't be set up, and the front desk is paid outside the app. The brand has no cover photo because it takes a URL rather than an uploaded file.

### Clearcoat Mobile Detailing (Montreal)
- **Team:** Mathieu (owner), `daniela@` (paint correction and coatings, commission), `olivier@` (detailer and fleet lead, hourly), `anh@` (interior, hourly).
- **How they work:**
  - Each vehicle is a record with its plate, size and the address where it's parked.
  - Coatings are quoted from photos with a deposit.
  - Detailers fill in a signed walkaround before larger jobs.
  - Paint correction and coatings are offered by Mathieu and Daniela only.
- **Try:**
  - pet hair, engine bay and odour add-ons that lengthen the visit;
  - a monthly wash club;
  - a three-wash pack for one of a client's two cars;
  - a fleet visit with a crew of two;
  - a rain-day reschedule.

#### Walkthrough

Clearcoat is built on the demo engine in `scripts/demo_clearcoat.py`. Each vehicle holds its year, make, model, colour, plate, size and the address where it's parked, with parking notes such as a garage level and visitor fob. Quebec charges GST at 5% and QST at 9.975%, so every service, add-on and product carries both, and gift cards carry neither. Ids follow `bk_ct_<key>`, `est_ct_<key>` and `cl_ct_<key>`.

| Stage                                                         | Where to look                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| New client booked online, waiting for approval                | Émilie (`bk_ct_emilie`): pet hair add-on, vehicle form with a photo, agreement not yet signed    |
| Ceramic coating quote sent with optional lines                | Raj (`est_ct_raj`): paint photo on his vehicle form, correction and engine bay optional          |
| Paint correction accepted and booked, deposit paid            | Nadia (`est_ct_nadia`, `bk_ct_nadia`), with the engine bay add-on, in her condo garage           |
| Today's visits: checked in, on the way and later today        | Julie (`bk_ct_julie`), Thomas (`bk_ct_thomas`) and Samira (`bk_ct_samira`)                       |
| Monthly wash club member                                      | Marie-Claude (`sub_ct_club_marieclaude`); Jean-François (`sub_ct_club_jf`) joined two months ago |
| Three-wash pack for one of two cars                           | David (`pkg_ct_three_david`): the Forester's pack, two used; Rachel's Mazda paid per visit       |
| Fleet visit with a crew of two, one invoice overdue           | Plomberie Rosemont (`cl_ct_rosemont`, `av_ct_crew_rosemont_3`, `inv_ct_rosemont_3`)              |
| Walkaround signed, detailed and paid by Tap to Pay with a tip | Lucas (`fr_ct_walkaround_lucas`, `ord_ct_lucas`): a full detail and a spray detailer             |
| Cancelled late, with a late cancellation fee                  | Jason (`bk_ct_jason_late`, `inv_ct_jason_late`)                                                  |
| Rain day, wash moved to the next dry day                      | Isabelle (`bk_ct_isabelle`): note, text thread and a reschedule audit                            |
| Odour treatment refunded                                      | Simon (`inv_ct_simon`), with the owner's text about the headliner                                |
| Five-star feedback and a review request                       | Fatou (`fr_ct_feedback_fatou`)                                                                   |
| Four-star feedback about a late arrival                       | Mei (`fr_ct_feedback_mei`), with the owner's reply                                               |
| Gift card bought for a father's detail                        | Sophie (`gc_ct_dad`) and her father Gilles (`bk_ct_gilles_gift`)                                 |

Add-ons lengthen the visit they ride on: pet hair removal and the large vehicle charge by 30 minutes, the engine bay and headlight restoration by 45, and the odour treatment by an hour. Each detailer has 30 minutes after a visit to drive to the next one. Plomberie Rosemont's four vans are washed once a month by Olivier with Anh as crew, blocked on Anh's calendar for the whole visit, and the invoice is due in 14 days. `bk_ct_car_21_missed` is a no-show where the car wasn't parked where the client said. Julie's interior detail is checked in, Olivier is on the way to Thomas and Samira's wash is later in the day when the seed runs between about 9:00 and 13:00 Montreal time from Tuesday to Friday; at other times the three visits move to the next working day without those states, and Julie's walkaround isn't seeded.

The scenario works around what the product does not do yet. A booking holds one vehicle, so a fleet visit is booked on Rosemont's first van and names all four in its note. A price can't vary with the vehicle's size, so the large vehicle charge is an add-on the client or detailer picks. Nothing in scheduling knows about weather: the rain day is an ordinary reschedule. Wash club washes are booked at no charge alongside the monthly subscription, nothing counts them against the plan's one wash a month, and they earn the detailer nothing. There is no late cancellation fee in the product, so Jason's fee is an invoice line added by hand. A gift card can pay toward a checkout sale but not toward an invoice, and the demo redeems Gilles's on its own, so his detail is booked at no charge with a note. Star ratings live with external reviews, so the feedback form's rating stands in for them, and the replies are texts.

### Riverbend Driving School (Winnipeg)
- **Team:** Linda (owner, instructor), `marcus@` (instructor, commission), `jasmine@` (manual instructor, hourly), `arjun@` (instructor, hourly), `paul@` (office manager).
- **How they work:**
  - Teens are students booked by a parent, and adults are their own client.
  - Manual lessons are offered by Jasmine only; automatic and highway lessons by Linda, Marcus and Arjun.
  - The school shares three cars: the Corolla and the Civic for automatic lessons and the Golf for manual ones, so a lesson needs a free car as well as a free instructor.
- **Try:**
  - a 10-lesson pack for one student on a weekly series, including two siblings each with their own pack;
  - today's lessons, with one student in the car and an instructor on the way;
  - a road test with a deposit, then passed with five-star feedback;
  - the four-evening classroom course run as a program;
  - a missed lesson charged in full;
  - a grandparent's gift card;
  - an afternoon hour when Linda and Marcus have both automatics out, so Arjun can't be booked then even though he's free.

#### Walkthrough

Riverbend is built on the demo engine in `scripts/demo_riverbend.py`. Instructors pick students up at home, school or work, with the pickup in the booking's note, and the road test package holds its date with a $50 deposit. Lessons, packages and the course carry GST only, the student driver magnet carries GST and Manitoba's 7% RST, and gift cards carry neither. Ids follow `bk_rb_<key>`, `pkg_rb_<pack>_<key>` and `cl_rb_<household>`.

| Stage                                                                 | Where to look                                                                                                           |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| New teen student booked online, registration in, waiting for approval | Angela for Bianca (`bk_rb_ramos`, `fr_rb_registration_ramos`), agreement not yet signed                                 |
| Partway through a 10-lesson pack on a weekly series                   | Karen for Noah (`pkg_rb_ten_auto_bergen`, `sch_rb_bergen`): six used on Saturdays with Marcus                           |
| Two siblings, each with their own pack                                | Hiroshi for Aiko, manual with Jasmine (`pkg_rb_ten_manual_aiko`), and Ken, automatic with Arjun (`pkg_rb_ten_auto_ken`) |
| Today's lessons: in the car, instructor on the way, later today       | Lena with Marcus (`bk_rb_lena`), Linda on the way to Navjot (`bk_rb_navjot`) and Emma with Jasmine (`bk_rb_emma`)       |
| Both automatics out, so Arjun's free hour can't be booked             | Ethan with Linda (`bk_rb_both_cars_linda`) and Gabriel with Marcus (`bk_rb_both_cars_marcus`), the same afternoon hour  |
| Road test package booked, deposit paid                                | Meera for Rohan (`bk_rb_rohan_roadtest`), with the confirmation text                                                    |
| Road test passed, five-star feedback and a review request             | Sophie (`bk_rb_sophie_roadtest`, `fr_rb_feedback_sophie`)                                                               |
| Classroom course halfway through, one balance overdue                 | `sch_rb_course`: six students; Ricardo for Mateo still owes (`inv_rb_course_alvarez`)                                   |
| Next classroom course enrolling                                       | `sch_rb_course_next`: Nicole for Zoé, Tanya for Caleb and one more                                                      |
| Newcomer's refresher assessment, paid by Tap to Pay                   | Dmytro (`ord_rb_dmytro`), with a highway lesson booked                                                                  |
| Missed lesson charged in full, invoice overdue                        | Shawn for Brayden (`bk_rb_brayden_missed`, `inv_rb_brayden_missed`)                                                     |
| Lesson cut short, half refunded                                       | Amir (`inv_rb_amir_highway`): a flat tire 40 minutes into a highway lesson                                              |
| Four-star feedback about a late pickup                                | Tanya for Caleb (`fr_rb_feedback_caleb`), with the owner's reply                                                        |
| Gift card from a grandparent, used for a highway lesson               | Donald (`gc_rb_noah`) and Noah's lesson (`bk_rb_noah_gift`)                                                             |

Each lesson has 15 minutes after it for the drive to the next pickup, and the car is held for that time too. For the hour of `bk_rb_both_cars_linda`, which starts at 15:00, 15:30 or 16:00 on a Monday, Wednesday or Friday a few days ahead, Linda and Marcus each have one of the automatics, so Connect offers no automatic lesson at that hour even though Arjun is working and free. Enrolling in the classroom course books all four evenings at once and issues the invoice, due on the first evening. Lena is in the car and checked in, Linda is on the way to Navjot and Emma's manual lesson is later in the day when the seed runs between about 11:30 and 15:00 Winnipeg time from Tuesday to Friday; at other times the three lessons move to the next working day without those states.

The scenario works around what the product does not do yet. A visit holds one car, so a lesson can't need a car and a second piece of equipment at once, and a car has no maintenance windows of its own. A booking has no place of its own, so the pickup address is in the booking's note and the registration form. A student's licence stage, such as a learner's licence since February, is a note on the student, because the student kind has no licence field, and nothing checks a licence before a lesson. The road test itself is booked with the testing office, outside the app, and its time is in the booking's note. There is no late cancellation or missed-lesson fee in the product, so Brayden's charge is an invoice added by hand. A gift card can pay toward a checkout sale but not toward an invoice, and the demo redeems Noah's on its own, so his lesson is booked at no charge with a note. Star ratings live with external reviews, so the feedback form's rating stands in for them, and the reply is a text.

## Not shown yet

- **More than one resource per visit:** a visit holds one room, table, car or piece of equipment at most, and resources have no opening hours or maintenance windows of their own. Clients can't choose the room on Connect.
- **Star reviews:** stored as review requests plus a feedback form's rating, so replies to feedback are sent by text.
- **Weather:** rain and snow days are ordinary reschedules.
