# Demo businesses

There is one seeded demo business per vertical the product serves, so each trade can be shown and tested from its own point of view. They are ordinary tenants: `make seed` replaces them locally, and staging reseeds them every night and on demand ([operations.md](operations.md#stagings-demo-seed)). The full stage tables, with seeded ids, are in [engineering.md](engineering.md#demo-businesses-by-vertical).

- **Password:** `demo1234` for every login.
- **Where:** locally, and on staging at `https://app.staging.clientbridge.ca` and in the staging mobile app.
- **Logins:** owners are `owner@<slug>.example` (Birchbark's is `hannah@`). Staff are `<firstname>@<slug>.example`.
- **Safe to use:** every email and phone is a reserved address (`.example`, 555-0100 to 0199), so demo emails and texts never leave the app.
- **Today's visits:** some demos show "checked in" and "on the way" only during their working hours. At other times those visits move to the next working day.
- **Card payments:** these need the demo linked to the Stripe sandbox ([payments.md](payments.md#local-sandbox-setup)). Without that, use cash or manual payments.

## At a glance

| Vertical | Business | Slug | Province, tax | Subject | Owner login |
| --- | --- | --- | --- | --- | --- |
| Pet grooming and daycare | Birchbark Pet Studio | `birchbark` | BC, GST + PST | pet | `hannah@birchbark.example` |
| Dog walking and pet sitting | Cedar Coast Pet Care | `cedarcoast` | BC, GST + PST | pet | `owner@cedarcoast.example` |
| Security installs (trades) | Northlight Security | `northlight` | BC, GST + PST | site | `owner@northlight.example` |
| Home cleaning | Brightwater Home Cleaning | `brightwater` | AB, GST | property | `owner@brightwater.example` |
| Hair salon | Maple and Main Hair Studio | `maplemain` | ON, HST | none | `owner@maplemain.example` |
| Personal training and fitness | Ridgeline Strength Studio | `ridgeline` | AB, GST | none | `owner@ridgeline.example` |
| Tutoring and music lessons | Lakeside Learning Studio | `lakeside` | ON, HST (tutoring exempt) | student | `owner@lakeside.example` |
| Massage and wellness clinic | Harbourside Massage and Wellness | `harbourside` | BC, GST (acupuncture exempt) | none | `owner@harbourside.example` |
| Photography | Fieldnote Photography | `fieldnote` | ON, HST | none | `owner@fieldnote.example` |
| Landscaping and lawn care | Foothills Lawn and Garden | `foothills` | AB, GST | property | `owner@foothills.example` |
| Tattoo studio | Inkwell Tattoo Collective | `inkwell` | BC, GST (+ PST on products) | none | `owner@inkwell.example` |
| Mobile car detailing | Clearcoat Mobile Detailing | `clearcoat` | QC, GST + QST | vehicle | `owner@clearcoat.example` |
| Driving school | Riverbend Driving School | `riverbend` | MB, GST (+ RST on products) | student | `owner@riverbend.example` |

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
| Treatment notes and the insurance receipt | Harbourside (Maple and Main uses notes for colour formulas) |
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
- **Note:** tests start from this business.

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

### Northlight Security (camera sales and installs, BC)
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

### Harbourside Massage and Wellness (clinic, Vancouver)
- **Team:** Leila (owner, RMT), `jun@` (RMT, commission), `wen@` (acupuncturist, hourly; the only one offered acupuncture), `teresa@` (front desk).
- **How they work:**
  - New clients fill in a health history and sign the cancellation policy.
  - Practitioners' titles carry their credential and registration number.
  - Each treatment takes one of Rooms 1 to 3, and a couples massage takes both tables in the couples room.
- **Try:**
  - the insurance receipt from a paid visit (staff from the booking, clients from their manage page);
  - SOAP treatment notes, including one amendment;
  - a 10-visit pack;
  - a weekly acupuncture series;
  - a couples massage on the two couples tables, which can't be booked twice at once;
  - a late cancellation fee.

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

## Not shown yet

- **More than one resource per visit:** a visit holds one room, table, car or piece of equipment at most, and resources have no opening hours or maintenance windows of their own. Clients can't choose the room on Connect.
- **Star reviews:** stored as review requests plus a feedback form's rating, so replies to feedback are sent by email.
- **Weather:** rain and snow days are ordinary reschedules.
