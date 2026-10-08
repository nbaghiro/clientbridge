import type { LineIconName } from "../art/LineIcon";
import type { GlyphName } from "../art/TradeGlyph";
import type { BrandKey } from "./brands";
import type { PhotoName } from "./photos";

interface Pill {
    tone: "ok" | "accent";
    text: string;
}

interface PhotoRef {
    name: PhotoName;
    alt: string;
    position: string;
}

interface ScheduleEvent {
    column: number;
    /** Hours after the schedule's first hour. */
    start: number;
    hours: number;
    title: string;
    detail?: string;
    variant?: "alt" | "open";
}

export interface Schedule {
    day: string;
    startHour?: number;
    columns: readonly (readonly [string, string])[];
    events: readonly ScheduleEvent[];
}

interface BookingPage {
    tag: string;
    items: readonly { name: string; detail: string; cents: number }[];
    date: string;
    times: readonly string[];
    button: string;
}

export interface Bill {
    kind: "invoice" | "estimate";
    meta: string;
    lines: readonly (readonly [string, number])[];
    /** Label and rate; each tax is rounded on the subtotal. */
    taxes: readonly (readonly [string, number, number?])[];
    deposit?: number;
    retainerPct?: number;
    status: Pill;
}

export interface ClientRecord {
    name: string;
    detail: string;
    students: readonly string[];
    plan: { name: string; used: number; total: number };
    upcoming: readonly { when: string; what: string; with: string }[];
    forms: readonly string[];
}

export interface Trade {
    slug: BrandKey;
    name: string;
    glyph: GlyphName;
    who: string;
    oneLine: string;
    h1: string;
    lede: string;
    photo: PhotoRef;
    photo2?: PhotoRef;
    heroCard: { label: string; title: string; detail: string; pill: Pill };
    bookings: { title: string; body: string; list: readonly string[] };
    schedule: Schedule;
    booking: BookingPage;
    capabilities: readonly { icon: LineIconName; title: string; body: string }[];
    pay: { title: string; body: string };
    bill?: Bill;
    record?: ClientRecord;
}

const ev = (
    column: number,
    start: number,
    hours: number,
    title: string,
    detail?: string,
    variant?: "alt" | "open",
): ScheduleEvent => ({
    column,
    start,
    hours,
    title,
    ...(detail ? { detail } : {}),
    ...(variant ? { variant } : {}),
});

export const TRADES: readonly Trade[] = [
    {
        slug: "pet-grooming",
        name: "Pet grooming and daycare",
        glyph: "paw",
        who: "groomers",
        oneLine: "Grooms, add-ons and daycare days, with each pet's notes on the booking.",
        h1: "Grooming and daycare bookings, with the pet on every one.",
        lede: "Each client record holds their pets, with breed, coat, temperament and notes from the last groom. Owners book a groom or a daycare day online, pay a deposit, and get a reminder the day before.",
        photo: {
            name: "grooming",
            alt: "A groomer scissoring a Shih Tzu on a grooming table, with a poodle waiting behind",
            position: "50% 40%",
        },
        photo2: {
            name: "grooming-2",
            alt: "A groomer brushing a Cocker Spaniel",
            position: "50% 42%",
        },
        heroCard: {
            label: "Booked online",
            title: "Luna, Goldendoodle",
            detail: "Full Groom · Thu 9:00 with Jess",
            pill: { tone: "ok", text: "Deposit $20.00 paid" },
        },
        bookings: {
            title: "A groom takes as long as the dog needs, and the calendar knows it.",
            body: "Each service has its own length and a buffer after it, so a full groom on a doodle blocks enough time for drying and clean-up before the next dog. Daycare runs as a session with a capacity, so you take a set number of dogs per day and the booking page stops offering the day when it is full.",
            list: [
                "Pets stored on the client, with breed, weight and notes",
                "Add-ons such as a nail grind or teeth brushing on the same booking",
                "Daycare days with a daily capacity",
                "Repeat grooms every four, six or eight weeks",
            ],
        },
        schedule: {
            day: "Thursday, October 8",
            columns: [
                ["Jess", "Groomer"],
                ["Marco", "Groomer"],
                ["Daycare", "9 of 12 spots"],
            ],
            events: [
                ev(0, 0, 1.5, "Luna · Doodle", "Full Groom"),
                ev(0, 2, 1, "Cooper · Beagle", "Bath & Tidy"),
                ev(0, 3.5, 0.5, "Miso · Cat", "Nail trim", "alt"),
                ev(1, 0.5, 1.25, "Pepper · Schnauzer", "Full Groom"),
                ev(1, 2.5, 1.5, "Bear · Newfoundland", "De-shedding", "alt"),
                ev(2, 0, 5.5, "Daycare", "9 dogs checked in", "alt"),
            ],
        },
        booking: {
            tag: "Book a visit",
            items: [
                { name: "Full Groom", detail: "90 min", cents: 8000 },
                { name: "Bath & Tidy", detail: "60 min", cents: 4800 },
                { name: "Nail trim", detail: "15 min", cents: 1800 },
                { name: "Daycare day", detail: "8 a.m. to 6 p.m.", cents: 3800 },
            ],
            date: "Thursday, October 8",
            times: ["9:00", "10:30", "1:00", "2:30"],
            button: "Book and pay $20 deposit",
        },
        capabilities: [
            {
                icon: "deposit",
                title: "Deposits that come off the bill",
                body: "Take a fixed amount or a percentage when an owner books online. The deposit is applied to the invoice at pickup, so they only pay the balance.",
            },
            {
                icon: "package",
                title: "Daycare packs and memberships",
                body: "Sell a pack of ten daycare days that counts down as the dog attends, or a monthly membership charged to a saved card.",
            },
            {
                icon: "invoice",
                title: "Invoices at pickup",
                body: "The invoice is built from the booking and its add-ons. Send it by text or email, or take payment at the counter when the owner arrives.",
            },
            {
                icon: "tapToPay",
                title: "Tap to Pay, card or e-Transfer",
                body: "Charge a card with your phone at pickup, or send a payment link. Interac e-Transfers are matched to the invoice by their reference code.",
            },
            {
                icon: "gift",
                title: "Gift cards",
                body: "Sell gift cards on your booking page or at the counter, and redeem them against any groom, daycare day or retail item.",
            },
            {
                icon: "staff",
                title: "Groomers and their pay",
                body: "Each groomer has their own hours and services. Completed grooms are recorded as earnings, so pay records are ready at the end of the period.",
            },
            {
                icon: "tax",
                title: "Sales tax for your province",
                body: "GST, HST, PST or QST is worked out from your province on every line, retail shampoo included, and the period total is ready for your return.",
            },
            {
                icon: "reminder",
                title: "Reminders and pickup messages",
                body: "Reminders go out by text and email before each appointment, and you can tell the owner their dog is ready from the same inbox.",
            },
            {
                icon: "form",
                title: "Vaccination and consent forms",
                body: "Ask for vaccination dates and a signed grooming consent when a new client books, and keep both on their record.",
            },
            {
                icon: "reviews",
                title: "Reviews after each visit",
                body: "A review request goes out after pickup. You choose which reviews appear on your page, and clients can share theirs to Google.",
            },
            {
                icon: "shop",
                title: "Retail, stock and an online shop",
                body: "Sell shampoo and brushes at the counter or from your shop page for pickup. Owners can add one when they book, and stock counts drop as you sell.",
            },
            {
                icon: "offline",
                title: "Works in the back room",
                body: "The schedule and pet notes stay on your phone or tablet when the Wi-Fi drops, and changes sync when you reconnect.",
            },
        ],
        pay: {
            title: "A groom, a nail grind and a shampoo, paid at pickup.",
            body: "The owner paid a $27.50 deposit and added a bottle of shampoo when they booked online. At pickup the invoice includes the shampoo, applies the deposit, adds the tax, and the owner taps their card on your phone for the balance.",
        },
        bill: {
            kind: "invoice",
            meta: "Invoice 1541 · Noah Schmidt",
            lines: [
                ["Full Groom - Large Dog (Cooper)", 11000],
                ["Nail grind (Cooper)", 1800],
                ["Oatmeal shampoo, 500 ml (add-on)", 2400],
            ],
            taxes: [
                ["GST 5%", 0.05],
                ["PST 7% (retail only)", 0.07, 2400],
            ],
            deposit: 2750,
            status: { tone: "ok", text: "Paid by Tap to Pay" },
        },
    },
    {
        slug: "salons",
        name: "Hair and beauty salons",
        glyph: "scissors",
        who: "salons",
        oneLine: "Booking by stylist, long colour appointments, and retail on the same ticket.",
        h1: "Stylists, colour appointments and retail, run from one schedule.",
        lede: "Clients book with the stylist they want, long colour appointments hold the chair for the right amount of time, and retail products are rung up on the same ticket as the cut.",
        photo: {
            name: "salon",
            alt: "A stylist trimming a client's hair beside a sunlit window",
            position: "60% 50%",
        },
        photo2: {
            name: "salon-2",
            alt: "A stylist with a client in a small salon",
            position: "50% 45%",
        },
        heroCard: {
            label: "Booked online",
            title: "Priya Raman",
            detail: "Full colour and blow-dry · Sat 10:00 with Dana",
            pill: { tone: "ok", text: "Deposit $40.00 paid" },
        },
        bookings: {
            title: "Each stylist has their own column, hours and services.",
            body: "Clients choose a stylist on your booking page, or take the first one available. Each service carries its own length and clean-up time, so a full colour followed by a blow-dry fills the chair for exactly as long as it takes, and the next client is not squeezed.",
            list: [
                "Hours, days off and services for each stylist",
                "Deposits on long colour appointments",
                "Rooms for lashes, brows or waxing booked as a resource",
                "Book the next visit before the client leaves",
            ],
        },
        schedule: {
            day: "Saturday, October 10",
            columns: [
                ["Dana", "Senior stylist"],
                ["Kai", "Stylist"],
                ["Room 2", "Lashes and brows"],
            ],
            events: [
                ev(0, 1, 2.5, "Priya Raman", "Full colour, blow-dry", "alt"),
                ev(0, 4, 1, "Hannah Lee", "Cut and finish"),
                ev(1, 0, 1, "Omar Haddad", "Men's cut"),
                ev(1, 1.25, 1.5, "Chloe Martin", "Balayage touch-up", "alt"),
                ev(1, 3.5, 0.75, "Ava Wilson", "Blow-dry"),
                ev(2, 0.5, 1, "Mei Chen", "Lash lift"),
                ev(2, 2, 0.5, "Sara Costa", "Brow shape"),
            ],
        },
        booking: {
            tag: "Book an appointment",
            items: [
                { name: "Cut and blow-dry", detail: "60 min", cents: 8500 },
                { name: "Full colour", detail: "2 h 30 min", cents: 16500 },
                { name: "Gloss", detail: "45 min", cents: 4500 },
                { name: "Lash lift", detail: "60 min", cents: 7500 },
            ],
            date: "Saturday, October 10",
            times: ["9:30", "11:00", "2:15", "3:45"],
            button: "Book with Dana",
        },
        capabilities: [
            {
                icon: "deposit",
                title: "Deposits on long appointments",
                body: "Ask for a deposit on the services where a no-show costs you most. It is taken when the client books and applied to the final bill.",
            },
            {
                icon: "subscription",
                title: "Memberships and series",
                body: "Run a monthly blow-dry membership charged to a saved card, or sell a series of treatments that counts down with each visit.",
            },
            {
                icon: "retail",
                title: "Retail on the same ticket",
                body: "Add shampoo, styling products or tools to the client's ticket at checkout, with tax on every line and the sale recorded against the client.",
            },
            {
                icon: "tapToPay",
                title: "Tap to Pay at the front desk",
                body: "Take a card with an iPhone or Android phone at the desk, or send the client a link to pay by card or Interac e-Transfer.",
            },
            {
                icon: "gift",
                title: "Gift cards",
                body: "Sell gift cards at the front desk and on your booking page, and redeem them against any service or product.",
            },
            {
                icon: "staff",
                title: "Stylists and their pay",
                body: "Each stylist's completed services are recorded as earnings, so commission and pay records are ready at the end of the period.",
            },
            {
                icon: "tax",
                title: "HST in Ontario",
                body: "Services and retail in Ontario carry 13% HST. It is added to each line and tracked by period, ready for your return.",
            },
            {
                icon: "form",
                title: "Consultation and patch-test forms",
                body: "Send a consultation or patch-test form before a first colour appointment, and keep the signed copy on the client's record.",
            },
            {
                icon: "reminder",
                title: "Reminders and messages",
                body: "Reminders go out by text and email before each appointment. Replies and questions come back to one inbox per client.",
            },
            {
                icon: "reviews",
                title: "Reviews after each visit",
                body: "A review request goes out after the appointment. You choose which reviews appear on your page, and clients can share theirs to Google.",
            },
            {
                icon: "stock",
                title: "Stock and retail commission",
                body: "Track stock on the products you sell, see what is running low and restock. Each sale records a commission for the stylist who made it.",
            },
            {
                icon: "offline",
                title: "Works when the Wi-Fi does not",
                body: "The day's schedule and client notes stay on the front desk tablet and your phone, and sync when the connection comes back.",
            },
        ],
        pay: {
            title: "A cut, a gloss and a bottle of conditioner on one ticket.",
            body: "Services and retail go on the same invoice, and Ontario HST is added to every line. The client pays by card at the desk, and the sale and the stylist's earnings are recorded together.",
        },
        bill: {
            kind: "invoice",
            meta: "Invoice 2208 · Hannah Lee",
            lines: [
                ["Cut and blow-dry", 8500],
                ["Gloss", 4500],
                ["Leave-in conditioner, 150 ml", 3200],
            ],
            taxes: [["HST 13%", 0.13]],
            status: { tone: "ok", text: "Paid by card" },
        },
    },
    {
        slug: "fitness",
        name: "Personal training and fitness studios",
        glyph: "dumbbell",
        who: "trainers",
        oneLine: "One-on-one sessions, classes with a set number of spots, packs and memberships.",
        h1: "Sessions, classes and memberships, with the billing handled.",
        lede: "One-on-one sessions, small group classes with a set number of spots, and monthly memberships run from the same calendar, and the card on file is charged on schedule.",
        photo: {
            name: "fitness",
            alt: "A personal trainer and a client reviewing a plan on a tablet in a small gym",
            position: "70% 50%",
        },
        heroCard: {
            label: "Class",
            title: "Strength 45, Tuesday 12:00 p.m.",
            detail: "With Mathieu · Studio A",
            pill: { tone: "accent", text: "10 of 12 spots booked" },
        },
        bookings: {
            title: "One-on-one or a class of twelve, on the same calendar.",
            body: "A personal training session books one client with one trainer. A class is a session with a capacity, so clients book spots until it is full and the booking page stops offering it. Clients who train at the same time each week are booked once and the session repeats.",
            list: [
                "Classes with a capacity and a live spot count",
                "Weekly recurring sessions",
                "Session packs that count down as they are used",
                "Hours and services for each trainer",
            ],
        },
        schedule: {
            day: "Tuesday, October 6",
            columns: [
                ["Mathieu", "Trainer"],
                ["Elise", "Trainer"],
                ["Studio A", "Classes"],
            ],
            events: [
                ev(0, 0, 1, "Julien Roy", "Personal training"),
                ev(0, 1.5, 1, "Nadia Bouchard", "Personal training"),
                ev(0, 3, 1, "Tom Becker", "Assessment", "alt"),
                ev(1, 0.5, 1, "Laura Gagnon", "Personal training"),
                ev(1, 2, 1, "Sam Ortiz", "Pack session 4 of 10"),
                ev(2, 0, 0.75, "Mobility", "8 of 10 spots", "alt"),
                ev(2, 3, 0.75, "Strength 45", "10 of 12 spots", "alt"),
            ],
        },
        booking: {
            tag: "Book a session",
            items: [
                { name: "Personal training", detail: "60 min", cents: 8500 },
                { name: "Strength 45 class", detail: "45 min · 2 spots left", cents: 2500 },
                { name: "Mobility class", detail: "45 min", cents: 2200 },
                { name: "Assessment", detail: "60 min", cents: 6000 },
            ],
            date: "Tuesday, October 6",
            times: ["7:00", "8:30", "12:00", "5:30"],
            button: "Book with Mathieu",
        },
        capabilities: [
            {
                icon: "subscription",
                title: "Monthly memberships",
                body: "Charge a membership each month to a saved card or by pre-authorized debit. Memberships with a failed payment are flagged so you can follow up.",
            },
            {
                icon: "package",
                title: "Session packs with an expiry",
                body: "Sell a pack of ten sessions that counts down as they are booked, with an expiry date if you use one.",
            },
            {
                icon: "deposit",
                title: "Deposits for first sessions",
                body: "Take a deposit when a new client books an assessment, and it comes off the invoice for that session.",
            },
            {
                icon: "invoice",
                title: "Invoices and receipts",
                body: "Every pack, membership charge and drop-in class has an invoice and a receipt the client can find in their email.",
            },
            {
                icon: "tapToPay",
                title: "Tap to Pay on the gym floor",
                body: "Sell a pack or a drop-in class with Tap to Pay on your phone, or send a payment link by text.",
            },
            {
                icon: "gift",
                title: "Gift cards",
                body: "Sell gift cards for sessions or classes online, and redeem them at checkout or against a pack.",
            },
            {
                icon: "staff",
                title: "Trainers and their pay",
                body: "Each trainer sets their hours and the sessions they run. Completed sessions are recorded as earnings for their pay.",
            },
            {
                icon: "tax",
                title: "GST and QST in Quebec",
                body: "In Quebec, training sessions and memberships carry GST and QST. Both are calculated on every line and tracked for your returns.",
            },
            {
                icon: "form",
                title: "Waivers and health questionnaires",
                body: "Send a waiver and a health questionnaire before the first session, and keep the signed copies with the client.",
            },
            {
                icon: "reminder",
                title: "Reminders and messages",
                body: "Clients get a reminder before each session and class. Replies, cancellations and questions arrive in one inbox.",
            },
            {
                icon: "shop",
                title: "Supplements and gear",
                body: "Sell protein, bands and water bottles at the desk or from your shop page for pickup, with stock counts that drop as you sell.",
            },
            {
                icon: "offline",
                title: "Web, iPhone and Android",
                body: "Run the studio from a laptop at the desk and your phone on the floor. The schedule stays on the device when the signal is weak.",
            },
        ],
        pay: {
            title: "A ten-session pack, with GST and QST worked out.",
            body: "The pack is sold once and counts down with each session. The invoice shows GST and QST on separate lines, and both amounts are tracked by period for your federal and Quebec returns.",
        },
        bill: {
            kind: "invoice",
            meta: "Invoice 0388 · Sam Ortiz",
            lines: [["Personal training, pack of 10", 75000]],
            taxes: [
                ["GST 5%", 0.05],
                ["QST 9.975%", 0.09975],
            ],
            status: { tone: "ok", text: "Paid by card" },
        },
    },
    {
        slug: "cleaning",
        name: "Home cleaning",
        glyph: "spray",
        who: "cleaners",
        oneLine: "Recurring cleans, each home's entry notes, and the invoice when the job is done.",
        h1: "Recurring cleans, the right address, and the invoice after each visit.",
        lede: "Clients book a one-off or a regular clean online, the home and its entry notes are on every booking, and the invoice goes out when the job is marked done.",
        photo: {
            name: "cleaning",
            alt: "A cleaner wiping a white counter in a bright home",
            position: "65% 50%",
        },
        photo2: {
            name: "cleaning-2",
            alt: "A cleaner in rubber gloves wiping a table",
            position: "60% 50%",
        },
        heroCard: {
            label: "Every two weeks",
            title: "Rachel Moore, 3 bedrooms",
            detail: "Standard clean · Wed 9:00 with Ana",
            pill: { tone: "accent", text: "Next visit Oct 21" },
        },
        bookings: {
            title: "Weekly, every two weeks, or once before a move.",
            body: "Each home is stored on the client as a property, with the address, the number of rooms, pets in the house and how to get in. Recurring cleans repeat on their own, and each visit lands on the right cleaner's schedule with time for travel after it.",
            list: [
                "Properties with address and entry instructions",
                "Recurring cleans weekly, every two weeks or monthly",
                "Add-ons such as the inside of the oven or fridge",
                "Buffers between jobs for travel time",
            ],
        },
        schedule: {
            day: "Wednesday, October 7",
            columns: [
                ["Ana", "Cleaner"],
                ["Tomas", "Cleaner"],
                ["Grace", "Cleaner"],
            ],
            events: [
                ev(0, 0, 2.5, "Rachel Moore", "Standard clean · every 2 weeks"),
                ev(0, 3, 2, "Ben Clarke", "Standard clean"),
                ev(1, 0, 4, "Lopez residence", "Move-out clean", "alt"),
                ev(2, 0.5, 2, "Ines Ferreira", "Standard clean · weekly"),
                ev(2, 3, 2.5, "Owen Price", "Deep clean", "alt"),
            ],
        },
        booking: {
            tag: "Book a clean",
            items: [
                { name: "Standard clean, 2 bedrooms", detail: "2 h", cents: 14000 },
                { name: "Standard clean, 3 bedrooms", detail: "2 h 30 min", cents: 18000 },
                { name: "Deep clean", detail: "4 h", cents: 32000 },
                { name: "Inside oven", detail: "add-on", cents: 3500 },
            ],
            date: "Wednesday, October 7",
            times: ["8:30", "9:00", "12:30", "1:00"],
            button: "Book every two weeks",
        },
        capabilities: [
            {
                icon: "deposit",
                title: "Deposits for larger jobs",
                body: "Take a deposit when a client books a deep clean or a move-out, and it is applied to the invoice when the job is done.",
            },
            {
                icon: "subscription",
                title: "Cleaning plans",
                body: "Bill a regular clean as a monthly plan charged to a saved card, or invoice each visit, whichever suits the client.",
            },
            {
                icon: "invoice",
                title: "Estimates that become invoices",
                body: "Send an estimate for a deep clean or a move-out. When the client accepts it, it becomes an invoice with the same lines.",
            },
            {
                icon: "interac",
                title: "Card or Interac e-Transfer",
                body: "Clients pay from the invoice link by card or Interac e-Transfer, and each e-Transfer is matched to its invoice by reference code.",
            },
            {
                icon: "tapToPay",
                title: "Tap to Pay at the door",
                body: "If a client wants to pay in person, charge their card on your phone when you finish, without a separate card reader.",
            },
            {
                icon: "gift",
                title: "Gift cards",
                body: "Sell cleaning gift cards online, for example for new parents or a housewarming, and redeem them against any visit.",
            },
            {
                icon: "staff",
                title: "Cleaners and their pay",
                body: "Assign each job to a cleaner. Completed jobs are recorded as earnings, so pay records are ready at the end of the period.",
            },
            {
                icon: "tax",
                title: "HST in Ontario",
                body: "Cleaning services in Ontario carry 13% HST. It is added to every line and tracked by period, ready for your return.",
            },
            {
                icon: "reminder",
                title: "Reminders and on-the-way texts",
                body: "Clients get a reminder before each clean, and you can text them from the app when you are on the way.",
            },
            {
                icon: "reviews",
                title: "Reviews",
                body: "A review request goes out after each clean. Good reviews can be shown on your booking page and shared to Google.",
            },
            {
                icon: "booking",
                title: "Booking on your own website",
                body: "Add the booking page to your website with a short snippet, so new clients can choose a clean and a time without a phone call.",
            },
            {
                icon: "offline",
                title: "Works without signal",
                body: "The day's jobs, addresses and entry notes are stored on your phone, so they are there in a basement or a building with poor reception.",
            },
        ],
        pay: {
            title: "A three-bedroom clean with an add-on, invoiced when it is done.",
            body: "When the cleaner marks the job done, the invoice goes to the client with Ontario HST added. The client pays by Interac e-Transfer with the reference code, and the payment is matched to the invoice when it arrives.",
        },
        bill: {
            kind: "invoice",
            meta: "Invoice 0912 · Rachel Moore",
            lines: [
                ["Standard clean, 3 bedrooms", 18000],
                ["Inside oven", 3500],
            ],
            taxes: [["HST 13%", 0.13]],
            status: { tone: "ok", text: "Interac matched · Ref CB-8T3W" },
        },
    },
    {
        slug: "tutoring",
        name: "Tutoring and lessons",
        glyph: "book",
        who: "tutors and teachers",
        oneLine: "Weekly lessons, students under a parent's account, and term packages.",
        h1: "Lessons, terms and families, organised around each student.",
        lede: "A parent's account holds each of their children, lessons repeat weekly through the term, and packages or monthly plans are billed to the card on file.",
        photo: {
            name: "tutoring",
            alt: "A teacher guiding a young student through a keyboard lesson",
            position: "45% 50%",
        },
        photo2: {
            name: "tutoring-2",
            alt: "A music teacher seated beside a student at a keyboard",
            position: "50% 60%",
        },
        heroCard: {
            label: "Weekly until Dec 17",
            title: "Daniel Okafor, Math 11",
            detail: "Thursdays 4:30 with Ms. Aziz",
            pill: { tone: "accent", text: "Package: 6 of 10 used" },
        },
        bookings: {
            title: "The same time every week, until the term ends.",
            body: "Book a weekly lesson once and it repeats until the date you set. Each lesson is tied to the student, so a parent with two children sees both schedules on one account and pays one bill. Small group classes take bookings up to the number of seats you set.",
            list: [
                "Students stored under the parent's account",
                "Weekly lessons with an end date",
                "Group classes with a seat limit",
                "Notes on each lesson for the next tutor",
            ],
        },
        schedule: {
            day: "Thursday, October 8",
            startHour: 13,
            columns: [
                ["Ms. Aziz", "Math and science"],
                ["Mr. Lewis", "Piano"],
                ["Room 1", "Group classes"],
            ],
            events: [
                ev(0, 2.5, 1, "Ruth Okafor", "Science 9"),
                ev(0, 3.5, 1, "Daniel Okafor", "Math 11 · weekly"),
                ev(1, 2, 0.5, "Lily Tran", "Piano, 30 min"),
                ev(1, 3.5, 0.75, "Ruth Okafor", "Piano, 45 min", "alt"),
                ev(1, 4.5, 0.5, "Ethan Ross", "Piano, 30 min"),
                ev(2, 3, 1.5, "Exam prep, Grade 12", "5 of 6 seats", "alt"),
            ],
        },
        booking: {
            tag: "Book a lesson",
            items: [
                { name: "Math tutoring", detail: "60 min", cents: 6500 },
                { name: "Piano lesson", detail: "30 min", cents: 3800 },
                { name: "Piano lesson", detail: "45 min", cents: 5200 },
                { name: "Exam prep class", detail: "90 min · 1 seat left", cents: 4500 },
            ],
            date: "Thursday, October 8",
            times: ["3:30", "4:30", "5:30", "6:30"],
            button: "Book weekly until Dec 17",
        },
        capabilities: [
            {
                icon: "package",
                title: "Term packages",
                body: "Sell a term of ten lessons up front. Each lesson counts against the package, and you can see how many are left on the student's record.",
            },
            {
                icon: "subscription",
                title: "Monthly plans",
                body: "Charge a monthly lesson plan to a saved card or by pre-authorized debit, and pause it over the summer.",
            },
            {
                icon: "invoice",
                title: "Invoices to the parent",
                body: "Lessons for every child on the account are invoiced to the parent, who pays by card or Interac e-Transfer.",
            },
            {
                icon: "deposit",
                title: "Registration deposits",
                body: "Hold a seat in a class or a regular weekly time with a deposit, which is applied to the first invoice.",
            },
            {
                icon: "gift",
                title: "Gift cards",
                body: "Sell gift cards for lessons, for example as a birthday present from a grandparent, and redeem them against any lesson or package.",
            },
            {
                icon: "staff",
                title: "Tutors and their pay",
                body: "Each tutor has their own subjects, hours and students. Completed lessons are recorded as earnings, and T4A reports are ready at year end.",
            },
            {
                icon: "tax",
                title: "Taxable and exempt lessons",
                body: "Some tutoring is exempt from GST/HST and some lessons are not. Each invoice line can be marked as taxable or not, so you can follow your accountant's advice.",
            },
            {
                icon: "form",
                title: "Registration and consent forms",
                body: "Collect contact details, allergies and photo consent at registration, signed online and kept with the student.",
            },
            {
                icon: "reminder",
                title: "Reminders to parents",
                body: "Reminders go to the parent by text or email before each lesson, and cancellations come back to one inbox.",
            },
            {
                icon: "reviews",
                title: "Reviews from families",
                body: "A review request goes to the parent after the first few lessons, and you choose which reviews appear on your page.",
            },
            {
                icon: "booking",
                title: "Booking on your own website",
                body: "Add the booking page to your website so families can pick a subject, a tutor and a weekly time.",
            },
            {
                icon: "offline",
                title: "Web, iPhone and Android",
                body: "Check the afternoon's lessons on your phone between students. The schedule is stored on the device and syncs when you are online.",
            },
        ],
        pay: {
            title: "One family, two students, one account.",
            body: "Daniel and Ruth are both on their mother's account. Each lesson is booked for the right child, the term package counts down as lessons are taught, and the parent receives one invoice for both.",
        },
        record: {
            name: "Grace Okafor",
            detail: "Parent · 2 students · card on file",
            students: ["Daniel · Math 11", "Ruth · Science 9, Piano"],
            plan: { name: "Math 11, fall term", used: 6, total: 10 },
            upcoming: [
                { when: "Thu Oct 8, 3:30", what: "Ruth · Science 9", with: "Ms. Aziz" },
                { when: "Thu Oct 8, 4:30", what: "Ruth · Piano, 45 min", with: "Mr. Lewis" },
                { when: "Thu Oct 8, 4:30", what: "Daniel · Math 11", with: "Ms. Aziz" },
            ],
            forms: ["Registration form", "Photo consent"],
        },
    },
    {
        slug: "wellness",
        name: "Massage and wellness",
        glyph: "stones",
        who: "therapists and practitioners",
        oneLine: "Practitioners, treatment rooms, intake forms and treatment packages.",
        h1: "Treatments, rooms and intake forms, booked together.",
        lede: "Each booking shows the practitioner and the treatment room, new clients fill in their intake form before the first visit, and every paid visit ends with a receipt by email.",
        photo: {
            name: "wellness-2",
            alt: "A massage therapist working on a client's shoulder beside a large window",
            position: "50% 45%",
        },
        photo2: {
            name: "wellness",
            alt: "Two therapists working in a bright treatment room",
            position: "50% 60%",
        },
        heroCard: {
            label: "New client",
            title: "Helen Brooks",
            detail: "Massage, 60 min · Mon 11:00 · Room 2",
            pill: { tone: "ok", text: "Intake form signed" },
        },
        bookings: {
            title: "Each treatment on the schedule, with its room.",
            body: "Set up your treatment rooms as resources, and each booking shows which room it is in alongside the practitioner. Treatments of different lengths are separate services with their own price, and a buffer after each one leaves time to turn the room over.",
            list: [
                "Treatments of 30, 60 or 90 minutes",
                "Turnover time after each treatment",
                "Rooms shown on the schedule",
                "Repeat visits for regular clients",
            ],
        },
        schedule: {
            day: "Monday, October 5",
            columns: [
                ["Room 1", "Leah"],
                ["Room 2", "Jonah"],
                ["Room 3", "Leah, Priya"],
            ],
            events: [
                ev(0, 0, 1.5, "Marie Dubois", "Massage, 90 min"),
                ev(0, 2, 1, "Kevin Walsh", "Massage, 60 min"),
                ev(1, 2, 1, "Helen Brooks", "Massage, 60 min · new", "alt"),
                ev(1, 3.5, 1, "Arjun Patel", "Massage, 60 min"),
                ev(2, 0.5, 0.5, "Tess Murray", "Consultation", "alt"),
                ev(2, 3, 1.5, "Rosa Silva", "Massage, 90 min"),
            ],
        },
        booking: {
            tag: "Book a treatment",
            items: [
                { name: "Massage", detail: "30 min", cents: 6500 },
                { name: "Massage", detail: "60 min", cents: 11000 },
                { name: "Massage", detail: "90 min", cents: 15500 },
                { name: "Package of 5, 60 min", detail: "valid 6 months", cents: 50000 },
            ],
            date: "Monday, October 5",
            times: ["9:00", "11:00", "1:30", "4:00"],
            button: "Book with Jonah",
        },
        capabilities: [
            {
                icon: "form",
                title: "Intake and consent forms",
                body: "Send the health intake form when a new client books. It is signed online and kept on their record for the next visit.",
            },
            {
                icon: "package",
                title: "Treatment packages",
                body: "Sell a package of five or ten treatments that counts down as they are used, with an expiry date if you set one.",
            },
            {
                icon: "subscription",
                title: "Wellness memberships",
                body: "Charge a monthly membership that includes a treatment to a saved card or by pre-authorized debit.",
            },
            {
                icon: "deposit",
                title: "Deposits for first visits",
                body: "Take a deposit when a new client books, and it is applied to the invoice for that treatment.",
            },
            {
                icon: "invoice",
                title: "Receipts by email",
                body: "Every paid visit sends a receipt with the treatment, the date and the amount, so clients have it for their records.",
            },
            {
                icon: "tapToPay",
                title: "Tap to Pay, card or e-Transfer",
                body: "Take payment in the treatment room with Tap to Pay, or let the client pay from the link in their invoice.",
            },
            {
                icon: "gift",
                title: "Gift cards",
                body: "Gift cards are sold online and at the front desk, and redeemed against any treatment or package.",
            },
            {
                icon: "staff",
                title: "Practitioners and their pay",
                body: "Each practitioner has their own hours and treatments. Completed treatments are recorded as earnings for their pay.",
            },
            {
                icon: "tax",
                title: "Sales tax by province",
                body: "GST, HST, PST or QST is worked out from your province, and a line can be marked as not taxable where a service is exempt. Your accountant can tell you which apply.",
            },
            {
                icon: "reminder",
                title: "Reminders and messages",
                body: "Clients get a reminder before each visit, and messages come back to one inbox, separate from your personal phone.",
            },
            {
                icon: "reviews",
                title: "Reviews",
                body: "A review request goes out after the visit. You choose which reviews appear on your booking page.",
            },
            {
                icon: "addon",
                title: "Products for home care",
                body: "Sell massage oils and heat packs at checkout, or let clients add one when they book so it is on the visit's invoice.",
            },
        ],
        pay: {
            title: "A new client's first visit, from intake form to receipt.",
            body: "Helen booked online and received the intake form with her confirmation. She signed it before the visit, and her record now holds the form, the package she bought and her next appointment.",
        },
        record: {
            name: "Helen Brooks",
            detail: "Client since October · card on file",
            students: [],
            plan: { name: "Package of 5, 60 min", used: 1, total: 5 },
            upcoming: [
                { when: "Mon Oct 5, 11:00", what: "Massage, 60 min · Room 2", with: "Jonah" },
                { when: "Mon Oct 19, 11:00", what: "Massage, 60 min · Room 2", with: "Jonah" },
            ],
            forms: ["Health intake form", "Treatment consent"],
        },
    },
    {
        slug: "photography",
        name: "Photography",
        glyph: "camera",
        who: "photographers",
        oneLine: "Estimates, signed contracts, retainers and bookable mini sessions.",
        h1: "Enquiries become estimates, contracts and booked sessions.",
        lede: "Send an estimate for a session or an event, have the client sign your contract and pay a retainer online, and invoice the balance before delivery.",
        photo: {
            name: "photography",
            alt: "A photographer checking his camera in a daylight studio",
            position: "65% 50%",
        },
        photo2: {
            name: "photography-2",
            alt: "A photographer taking a portrait in a daylight studio",
            position: "60% 40%",
        },
        heroCard: {
            label: "Estimate 0412",
            title: "Family session, 90 min",
            detail: "Sat Oct 24 · High Park",
            pill: { tone: "ok", text: "Accepted · retainer paid" },
        },
        bookings: {
            title: "Mini sessions on the booking page, larger work by estimate.",
            body: "Short portrait or mini sessions are booked straight from your booking page in fixed time slots, with a deposit to hold the slot. Weddings, events and commercial work start as an estimate, and the date is booked once the client accepts and pays the retainer.",
            list: [
                "Mini-session days with fixed slots",
                "Contracts signed online",
                "Retainers as a fixed amount or a percentage",
                "Buffers before and after on-location shoots",
            ],
        },
        schedule: {
            day: "Saturday, October 24",
            columns: [
                ["Mini sessions", "Studio"],
                ["On location", "You"],
                ["Second shooter", "Jordan"],
            ],
            events: [
                ev(0, 0, 0.5, "Kim family", "Mini session"),
                ev(0, 0.5, 0.5, "Ahmed family", "Mini session"),
                ev(0, 1, 0.5, "Lucas Moreau", "Mini session"),
                ev(0, 1.5, 0.5, "Open slot", "", "open"),
                ev(1, 2.5, 1.5, "Nguyen family", "Family session · High Park", "alt"),
                ev(2, 2.5, 1.5, "Nguyen family", "Assisting"),
            ],
        },
        booking: {
            tag: "Fall mini sessions",
            items: [
                { name: "Mini session", detail: "20 min · 10 images", cents: 22500 },
                { name: "Family session", detail: "90 min", cents: 45000 },
                { name: "Headshots", detail: "45 min", cents: 27500 },
            ],
            date: "Saturday, October 24",
            times: ["9:00", "9:30", "10:30", "11:00"],
            button: "Book and pay $75 deposit",
        },
        capabilities: [
            {
                icon: "invoice",
                title: "Estimates that become invoices",
                body: "Send an estimate with the coverage, hours and prints listed. When the client accepts it, it becomes an invoice with the same lines.",
            },
            {
                icon: "form",
                title: "Contracts signed online",
                body: "Attach your contract to the booking. The client signs it online, and the signed copy is kept on their record.",
            },
            {
                icon: "deposit",
                title: "Retainers and deposits",
                body: "Take a retainer as a fixed amount or a percentage when the client accepts. It is applied to the final invoice.",
            },
            {
                icon: "invoice",
                title: "Balance invoices",
                body: "Invoice the balance before delivery or on the event date, and see at a glance which invoices are still outstanding.",
            },
            {
                icon: "interac",
                title: "Card or Interac e-Transfer",
                body: "Clients pay from the invoice link by card or Interac e-Transfer, and each payment is matched to its invoice.",
            },
            {
                icon: "gift",
                title: "Session gift cards",
                body: "Sell gift cards for a family or portrait session, and redeem them when the session is booked.",
            },
            {
                icon: "staff",
                title: "Second shooters and assistants",
                body: "Add second shooters and assistants as staff, with their own hours and earnings for each job.",
            },
            {
                icon: "tax",
                title: "HST in Ontario",
                body: "Photography services and prints in Ontario carry 13% HST, calculated on every line and tracked for your return.",
            },
            {
                icon: "messaging",
                title: "Messages with clients",
                body: "Keep timings, locations and questions in one message thread per client, by text and email.",
            },
            {
                icon: "reviews",
                title: "Reviews",
                body: "A review request goes out after delivery. You choose which reviews appear on your booking page, and clients can share theirs to Google.",
            },
            {
                icon: "booking",
                title: "Booking on your own website",
                body: "Embed your mini-session page on your portfolio site, so clients can pick a slot and pay the deposit there.",
            },
            {
                icon: "offline",
                title: "On location without signal",
                body: "Your day's sessions, addresses and client notes stay on your phone at locations with no reception.",
            },
        ],
        pay: {
            title: "An accepted estimate with a retainer paid.",
            body: "The client accepted the estimate and paid a 30% retainer online when they signed the contract. The balance is invoiced before the gallery is delivered, with Ontario HST on every line.",
        },
        bill: {
            kind: "estimate",
            meta: "Estimate 0412 · Linh Nguyen",
            lines: [
                ["Family session, 90 minutes", 45000],
                ["Print credit", 10000],
            ],
            taxes: [["HST 13%", 0.13]],
            retainerPct: 0.3,
            status: { tone: "ok", text: "Accepted · contract signed Oct 3" },
        },
    },
    {
        slug: "trades",
        name: "Home services and trades",
        glyph: "wrench",
        who: "handypeople and trades",
        oneLine: "On-site estimates, scheduled jobs, and Tap to Pay when the work is done.",
        h1: "Estimates on site, jobs on the calendar, and payment at the door.",
        lede: "Quote the job from your phone, book it when the client accepts, and take payment with Tap to Pay when the work is done. The property and its notes are on every job.",
        photo: {
            name: "trades",
            alt: "A tradesperson in a paint-spattered apron restoring a window frame on trestles",
            position: "65% 40%",
        },
        photo2: {
            name: "trades-2",
            alt: "A tradesperson fitting a window frame with a cordless drill",
            position: "60% 30%",
        },
        heroCard: {
            label: "Job done",
            title: "Kitchen faucet replacement",
            detail: "Mike Turner · 3.5 h labour plus parts",
            pill: { tone: "ok", text: "Paid by Tap to Pay" },
        },
        bookings: {
            title: "Service calls online, larger jobs by estimate.",
            body: "Clients book a fixed-length service call or an assessment visit online. Larger jobs start as an estimate with labour and materials on separate lines, and the job is scheduled once the client accepts.",
            list: [
                "Service calls with a fixed length",
                "Properties with the address and access notes",
                "Buffers for travel between jobs",
                "Repeat maintenance visits, such as every six months",
            ],
        },
        schedule: {
            day: "Friday, October 9",
            startHour: 8,
            columns: [
                ["You", "Owner"],
                ["Dev", "Helper"],
                ["Estimates", "Site visits"],
            ],
            events: [
                ev(0, 0, 3.5, "Mike Turner", "Faucet replacement"),
                ev(0, 4, 1.5, "Ella Grant", "Service call"),
                ev(1, 0.5, 2, "Turner residence", "Drywall patch"),
                ev(1, 3, 2, "Chris Young", "Deck repair", "alt"),
                ev(2, 4, 0.75, "Nora Fischer", "Bathroom estimate", "alt"),
            ],
        },
        booking: {
            tag: "Book a visit",
            items: [
                { name: "Service call", detail: "1 h", cents: 9500 },
                { name: "Assessment visit", detail: "45 min", cents: 6000 },
                { name: "Gutter cleaning", detail: "2 h", cents: 22000 },
            ],
            date: "Friday, October 9",
            times: ["8:00", "10:30", "1:00", "3:30"],
            button: "Book a service call",
        },
        capabilities: [
            {
                icon: "invoice",
                title: "Estimates from your phone",
                body: "Write the estimate on site with labour and materials on separate lines. When the client accepts it, it becomes the invoice.",
            },
            {
                icon: "deposit",
                title: "Deposits for materials",
                body: "Take a deposit before you order materials, and it comes off the final invoice.",
            },
            {
                icon: "invoice",
                title: "Labour and materials on one invoice",
                body: "Hours, parts and materials each have their own line, and GST is added for your province.",
            },
            {
                icon: "tapToPay",
                title: "Tap to Pay at the door",
                body: "Charge a card on your iPhone or Android phone when the job is done, without carrying a separate card reader.",
            },
            {
                icon: "interac",
                title: "Interac e-Transfer matched for you",
                body: "Clients who pay by e-Transfer use the reference code on the invoice, and the payment is matched to it when it arrives.",
            },
            {
                icon: "gift",
                title: "Gift cards",
                body: "Sell gift cards for a service call or a set amount, and redeem them against any job.",
            },
            {
                icon: "staff",
                title: "Helpers and their pay",
                body: "Assign jobs to your helpers. Their completed work is recorded as earnings, and T4A reports are ready at year end.",
            },
            {
                icon: "tax",
                title: "GST in Alberta",
                body: "Alberta has no provincial sales tax, so services carry 5% GST, calculated on every line and tracked by period for your return.",
            },
            {
                icon: "reminder",
                title: "On-the-way texts",
                body: "Clients get a reminder the day before, and you can text them from the app when you are on the way.",
            },
            {
                icon: "reviews",
                title: "Reviews for the next job",
                body: "A review request goes out when the job is paid. Good reviews appear on your booking page and can be shared to Google.",
            },
            {
                icon: "booking",
                title: "Booking on your own website",
                body: "Add the booking page to your website so new clients can book a service call without phoning.",
            },
            {
                icon: "offline",
                title: "Works without signal",
                body: "Job notes and the day's addresses stay on your phone in basements and crawl spaces, and sync when you are back online.",
            },
        ],
        pay: {
            title: "Labour and parts, paid when the job is done.",
            body: "The client paid a deposit when they accepted the estimate. When the work is done, the invoice applies it, adds GST, and the client taps their card on your phone for the balance.",
        },
        bill: {
            kind: "invoice",
            meta: "Invoice 0627 · Mike Turner",
            lines: [
                ["Labour, 3.5 h at $95.00", 33250],
                ["Kitchen faucet and supply lines", 14820],
            ],
            taxes: [["GST 5%", 0.05]],
            deposit: 10000,
            status: { tone: "ok", text: "Paid by Tap to Pay" },
        },
    },
];

export const solutionPath = (slug: string): string => `/solutions/${slug}`;
