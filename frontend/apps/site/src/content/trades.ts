import type { LineIconName } from "../art/LineIcon";
import type { GlyphName } from "../art/TradeGlyph";
import type { DemoSlug } from "../config";
import type { BrandKey } from "./brands";
import type { PhotoName } from "./photos";
import { strings } from "../strings";

const s = strings.trades;

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
    demo: DemoSlug;
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
    text: { title: string; detail?: string },
    column: number,
    start: number,
    hours: number,
    variant?: "alt" | "open",
): ScheduleEvent => ({
    column,
    start,
    hours,
    title: text.title,
    ...(text.detail ? { detail: text.detail } : {}),
    ...(variant ? { variant } : {}),
});

export const TRADES: readonly Trade[] = [
    {
        slug: "pet-grooming",
        demo: "birchbark",
        name: s["pet-grooming"].name,
        glyph: "paw",
        who: s["pet-grooming"].who,
        oneLine: s["pet-grooming"].oneLine,
        h1: s["pet-grooming"].h1,
        lede: s["pet-grooming"].lede,
        photo: {
            name: "grooming",
            alt: s["pet-grooming"].photo.alt,
            position: "50% 40%",
        },
        photo2: {
            name: "grooming-2",
            alt: s["pet-grooming"].photo2.alt,
            position: "50% 42%",
        },
        heroCard: {
            label: s["pet-grooming"].heroCard.label,
            title: s["pet-grooming"].heroCard.title,
            detail: s["pet-grooming"].heroCard.detail,
            pill: { tone: "ok", text: s["pet-grooming"].heroCard.pill.text },
        },
        bookings: s["pet-grooming"].bookings,
        schedule: {
            day: s["pet-grooming"].schedule.day,
            columns: s["pet-grooming"].schedule.columns,
            events: [
                ev(s["pet-grooming"].schedule.events[0], 0, 0, 1.5),
                ev(s["pet-grooming"].schedule.events[1], 0, 2, 1),
                ev(s["pet-grooming"].schedule.events[2], 0, 3.5, 0.5, "alt"),
                ev(s["pet-grooming"].schedule.events[3], 1, 0.5, 1.25),
                ev(s["pet-grooming"].schedule.events[4], 1, 2.5, 1.5, "alt"),
                ev(s["pet-grooming"].schedule.events[5], 2, 0, 5.5, "alt"),
            ],
        },
        booking: {
            tag: s["pet-grooming"].booking.tag,
            items: [
                {
                    name: s["pet-grooming"].booking.items[0].name,
                    detail: s["pet-grooming"].booking.items[0].detail,
                    cents: 8000,
                },
                {
                    name: s["pet-grooming"].booking.items[1].name,
                    detail: s["pet-grooming"].booking.items[1].detail,
                    cents: 4800,
                },
                {
                    name: s["pet-grooming"].booking.items[2].name,
                    detail: s["pet-grooming"].booking.items[2].detail,
                    cents: 1800,
                },
                {
                    name: s["pet-grooming"].booking.items[3].name,
                    detail: s["pet-grooming"].booking.items[3].detail,
                    cents: 3800,
                },
            ],
            date: s["pet-grooming"].booking.date,
            times: s["pet-grooming"].booking.times,
            button: s["pet-grooming"].booking.button,
        },
        capabilities: [
            {
                icon: "deposit",
                title: s["pet-grooming"].capabilities[0].title,
                body: s["pet-grooming"].capabilities[0].body,
            },
            {
                icon: "package",
                title: s["pet-grooming"].capabilities[1].title,
                body: s["pet-grooming"].capabilities[1].body,
            },
            {
                icon: "invoice",
                title: s["pet-grooming"].capabilities[2].title,
                body: s["pet-grooming"].capabilities[2].body,
            },
            {
                icon: "tapToPay",
                title: s["pet-grooming"].capabilities[3].title,
                body: s["pet-grooming"].capabilities[3].body,
            },
            {
                icon: "gift",
                title: s["pet-grooming"].capabilities[4].title,
                body: s["pet-grooming"].capabilities[4].body,
            },
            {
                icon: "staff",
                title: s["pet-grooming"].capabilities[5].title,
                body: s["pet-grooming"].capabilities[5].body,
            },
            {
                icon: "tax",
                title: s["pet-grooming"].capabilities[6].title,
                body: s["pet-grooming"].capabilities[6].body,
            },
            {
                icon: "reminder",
                title: s["pet-grooming"].capabilities[7].title,
                body: s["pet-grooming"].capabilities[7].body,
            },
            {
                icon: "form",
                title: s["pet-grooming"].capabilities[8].title,
                body: s["pet-grooming"].capabilities[8].body,
            },
            {
                icon: "reviews",
                title: s["pet-grooming"].capabilities[9].title,
                body: s["pet-grooming"].capabilities[9].body,
            },
            {
                icon: "shop",
                title: s["pet-grooming"].capabilities[10].title,
                body: s["pet-grooming"].capabilities[10].body,
            },
            {
                icon: "offline",
                title: s["pet-grooming"].capabilities[11].title,
                body: s["pet-grooming"].capabilities[11].body,
            },
        ],
        pay: s["pet-grooming"].pay,
        bill: {
            kind: "invoice",
            meta: s["pet-grooming"].bill.meta,
            lines: [
                [s["pet-grooming"].bill.lines[0][0], 11000],
                [s["pet-grooming"].bill.lines[1][0], 1800],
                [s["pet-grooming"].bill.lines[2][0], 2400],
            ],
            taxes: [
                [s["pet-grooming"].bill.taxes[0][0], 0.05],
                [s["pet-grooming"].bill.taxes[1][0], 0.07, 2400],
            ],
            deposit: 2750,
            status: { tone: "ok", text: s["pet-grooming"].bill.status.text },
        },
    },
    {
        slug: "salons",
        demo: "maplemain",
        name: s.salons.name,
        glyph: "scissors",
        who: s.salons.who,
        oneLine: s.salons.oneLine,
        h1: s.salons.h1,
        lede: s.salons.lede,
        photo: {
            name: "salon",
            alt: s.salons.photo.alt,
            position: "60% 50%",
        },
        photo2: {
            name: "salon-2",
            alt: s.salons.photo2.alt,
            position: "50% 45%",
        },
        heroCard: {
            label: s.salons.heroCard.label,
            title: s.salons.heroCard.title,
            detail: s.salons.heroCard.detail,
            pill: { tone: "ok", text: s.salons.heroCard.pill.text },
        },
        bookings: s.salons.bookings,
        schedule: {
            day: s.salons.schedule.day,
            columns: s.salons.schedule.columns,
            events: [
                ev(s.salons.schedule.events[0], 0, 1, 2.5, "alt"),
                ev(s.salons.schedule.events[1], 0, 4, 1),
                ev(s.salons.schedule.events[2], 1, 0, 1),
                ev(s.salons.schedule.events[3], 1, 1.25, 1.5, "alt"),
                ev(s.salons.schedule.events[4], 1, 3.5, 0.75),
                ev(s.salons.schedule.events[5], 2, 0.5, 1),
                ev(s.salons.schedule.events[6], 2, 2, 0.5),
            ],
        },
        booking: {
            tag: s.salons.booking.tag,
            items: [
                {
                    name: s.salons.booking.items[0].name,
                    detail: s.salons.booking.items[0].detail,
                    cents: 8500,
                },
                {
                    name: s.salons.booking.items[1].name,
                    detail: s.salons.booking.items[1].detail,
                    cents: 16500,
                },
                {
                    name: s.salons.booking.items[2].name,
                    detail: s.salons.booking.items[2].detail,
                    cents: 4500,
                },
                {
                    name: s.salons.booking.items[3].name,
                    detail: s.salons.booking.items[3].detail,
                    cents: 7500,
                },
            ],
            date: s.salons.booking.date,
            times: s.salons.booking.times,
            button: s.salons.booking.button,
        },
        capabilities: [
            {
                icon: "deposit",
                title: s.salons.capabilities[0].title,
                body: s.salons.capabilities[0].body,
            },
            {
                icon: "subscription",
                title: s.salons.capabilities[1].title,
                body: s.salons.capabilities[1].body,
            },
            {
                icon: "retail",
                title: s.salons.capabilities[2].title,
                body: s.salons.capabilities[2].body,
            },
            {
                icon: "tapToPay",
                title: s.salons.capabilities[3].title,
                body: s.salons.capabilities[3].body,
            },
            {
                icon: "gift",
                title: s.salons.capabilities[4].title,
                body: s.salons.capabilities[4].body,
            },
            {
                icon: "staff",
                title: s.salons.capabilities[5].title,
                body: s.salons.capabilities[5].body,
            },
            {
                icon: "tax",
                title: s.salons.capabilities[6].title,
                body: s.salons.capabilities[6].body,
            },
            {
                icon: "form",
                title: s.salons.capabilities[7].title,
                body: s.salons.capabilities[7].body,
            },
            {
                icon: "reminder",
                title: s.salons.capabilities[8].title,
                body: s.salons.capabilities[8].body,
            },
            {
                icon: "reviews",
                title: s.salons.capabilities[9].title,
                body: s.salons.capabilities[9].body,
            },
            {
                icon: "stock",
                title: s.salons.capabilities[10].title,
                body: s.salons.capabilities[10].body,
            },
            {
                icon: "offline",
                title: s.salons.capabilities[11].title,
                body: s.salons.capabilities[11].body,
            },
        ],
        pay: s.salons.pay,
        bill: {
            kind: "invoice",
            meta: s.salons.bill.meta,
            lines: [
                [s.salons.bill.lines[0][0], 8500],
                [s.salons.bill.lines[1][0], 4500],
                [s.salons.bill.lines[2][0], 3200],
            ],
            taxes: [[s.salons.bill.taxes[0][0], 0.13]],
            status: { tone: "ok", text: s.salons.bill.status.text },
        },
    },
    {
        slug: "fitness",
        demo: "ridgeline",
        name: s.fitness.name,
        glyph: "dumbbell",
        who: s.fitness.who,
        oneLine: s.fitness.oneLine,
        h1: s.fitness.h1,
        lede: s.fitness.lede,
        photo: {
            name: "fitness",
            alt: s.fitness.photo.alt,
            position: "70% 50%",
        },
        heroCard: {
            label: s.fitness.heroCard.label,
            title: s.fitness.heroCard.title,
            detail: s.fitness.heroCard.detail,
            pill: { tone: "accent", text: s.fitness.heroCard.pill.text },
        },
        bookings: s.fitness.bookings,
        schedule: {
            day: s.fitness.schedule.day,
            columns: s.fitness.schedule.columns,
            events: [
                ev(s.fitness.schedule.events[0], 0, 0, 1),
                ev(s.fitness.schedule.events[1], 0, 1.5, 1),
                ev(s.fitness.schedule.events[2], 0, 3, 1, "alt"),
                ev(s.fitness.schedule.events[3], 1, 0.5, 1),
                ev(s.fitness.schedule.events[4], 1, 2, 1),
                ev(s.fitness.schedule.events[5], 2, 0, 0.75, "alt"),
                ev(s.fitness.schedule.events[6], 2, 3, 0.75, "alt"),
            ],
        },
        booking: {
            tag: s.fitness.booking.tag,
            items: [
                {
                    name: s.fitness.booking.items[0].name,
                    detail: s.fitness.booking.items[0].detail,
                    cents: 8500,
                },
                {
                    name: s.fitness.booking.items[1].name,
                    detail: s.fitness.booking.items[1].detail,
                    cents: 2500,
                },
                {
                    name: s.fitness.booking.items[2].name,
                    detail: s.fitness.booking.items[2].detail,
                    cents: 2200,
                },
                {
                    name: s.fitness.booking.items[3].name,
                    detail: s.fitness.booking.items[3].detail,
                    cents: 6000,
                },
            ],
            date: s.fitness.booking.date,
            times: s.fitness.booking.times,
            button: s.fitness.booking.button,
        },
        capabilities: [
            {
                icon: "subscription",
                title: s.fitness.capabilities[0].title,
                body: s.fitness.capabilities[0].body,
            },
            {
                icon: "package",
                title: s.fitness.capabilities[1].title,
                body: s.fitness.capabilities[1].body,
            },
            {
                icon: "deposit",
                title: s.fitness.capabilities[2].title,
                body: s.fitness.capabilities[2].body,
            },
            {
                icon: "invoice",
                title: s.fitness.capabilities[3].title,
                body: s.fitness.capabilities[3].body,
            },
            {
                icon: "tapToPay",
                title: s.fitness.capabilities[4].title,
                body: s.fitness.capabilities[4].body,
            },
            {
                icon: "gift",
                title: s.fitness.capabilities[5].title,
                body: s.fitness.capabilities[5].body,
            },
            {
                icon: "staff",
                title: s.fitness.capabilities[6].title,
                body: s.fitness.capabilities[6].body,
            },
            {
                icon: "tax",
                title: s.fitness.capabilities[7].title,
                body: s.fitness.capabilities[7].body,
            },
            {
                icon: "form",
                title: s.fitness.capabilities[8].title,
                body: s.fitness.capabilities[8].body,
            },
            {
                icon: "reminder",
                title: s.fitness.capabilities[9].title,
                body: s.fitness.capabilities[9].body,
            },
            {
                icon: "shop",
                title: s.fitness.capabilities[10].title,
                body: s.fitness.capabilities[10].body,
            },
            {
                icon: "offline",
                title: s.fitness.capabilities[11].title,
                body: s.fitness.capabilities[11].body,
            },
        ],
        pay: s.fitness.pay,
        bill: {
            kind: "invoice",
            meta: s.fitness.bill.meta,
            lines: [[s.fitness.bill.lines[0][0], 75000]],
            taxes: [
                [s.fitness.bill.taxes[0][0], 0.05],
                [s.fitness.bill.taxes[1][0], 0.09975],
            ],
            status: { tone: "ok", text: s.fitness.bill.status.text },
        },
    },
    {
        slug: "cleaning",
        demo: "brightwater",
        name: s.cleaning.name,
        glyph: "spray",
        who: s.cleaning.who,
        oneLine: s.cleaning.oneLine,
        h1: s.cleaning.h1,
        lede: s.cleaning.lede,
        photo: {
            name: "cleaning",
            alt: s.cleaning.photo.alt,
            position: "65% 50%",
        },
        photo2: {
            name: "cleaning-2",
            alt: s.cleaning.photo2.alt,
            position: "60% 50%",
        },
        heroCard: {
            label: s.cleaning.heroCard.label,
            title: s.cleaning.heroCard.title,
            detail: s.cleaning.heroCard.detail,
            pill: { tone: "accent", text: s.cleaning.heroCard.pill.text },
        },
        bookings: s.cleaning.bookings,
        schedule: {
            day: s.cleaning.schedule.day,
            columns: s.cleaning.schedule.columns,
            events: [
                ev(s.cleaning.schedule.events[0], 0, 0, 2.5),
                ev(s.cleaning.schedule.events[1], 0, 3, 2),
                ev(s.cleaning.schedule.events[2], 1, 0, 4, "alt"),
                ev(s.cleaning.schedule.events[3], 2, 0.5, 2),
                ev(s.cleaning.schedule.events[4], 2, 3, 2.5, "alt"),
            ],
        },
        booking: {
            tag: s.cleaning.booking.tag,
            items: [
                {
                    name: s.cleaning.booking.items[0].name,
                    detail: s.cleaning.booking.items[0].detail,
                    cents: 14000,
                },
                {
                    name: s.cleaning.booking.items[1].name,
                    detail: s.cleaning.booking.items[1].detail,
                    cents: 18000,
                },
                {
                    name: s.cleaning.booking.items[2].name,
                    detail: s.cleaning.booking.items[2].detail,
                    cents: 32000,
                },
                {
                    name: s.cleaning.booking.items[3].name,
                    detail: s.cleaning.booking.items[3].detail,
                    cents: 3500,
                },
            ],
            date: s.cleaning.booking.date,
            times: s.cleaning.booking.times,
            button: s.cleaning.booking.button,
        },
        capabilities: [
            {
                icon: "deposit",
                title: s.cleaning.capabilities[0].title,
                body: s.cleaning.capabilities[0].body,
            },
            {
                icon: "subscription",
                title: s.cleaning.capabilities[1].title,
                body: s.cleaning.capabilities[1].body,
            },
            {
                icon: "invoice",
                title: s.cleaning.capabilities[2].title,
                body: s.cleaning.capabilities[2].body,
            },
            {
                icon: "payout",
                title: s.cleaning.capabilities[3].title,
                body: s.cleaning.capabilities[3].body,
            },
            {
                icon: "tapToPay",
                title: s.cleaning.capabilities[4].title,
                body: s.cleaning.capabilities[4].body,
            },
            {
                icon: "gift",
                title: s.cleaning.capabilities[5].title,
                body: s.cleaning.capabilities[5].body,
            },
            {
                icon: "staff",
                title: s.cleaning.capabilities[6].title,
                body: s.cleaning.capabilities[6].body,
            },
            {
                icon: "tax",
                title: s.cleaning.capabilities[7].title,
                body: s.cleaning.capabilities[7].body,
            },
            {
                icon: "reminder",
                title: s.cleaning.capabilities[8].title,
                body: s.cleaning.capabilities[8].body,
            },
            {
                icon: "reviews",
                title: s.cleaning.capabilities[9].title,
                body: s.cleaning.capabilities[9].body,
            },
            {
                icon: "booking",
                title: s.cleaning.capabilities[10].title,
                body: s.cleaning.capabilities[10].body,
            },
            {
                icon: "offline",
                title: s.cleaning.capabilities[11].title,
                body: s.cleaning.capabilities[11].body,
            },
        ],
        pay: s.cleaning.pay,
        bill: {
            kind: "invoice",
            meta: s.cleaning.bill.meta,
            lines: [
                [s.cleaning.bill.lines[0][0], 18000],
                [s.cleaning.bill.lines[1][0], 3500],
            ],
            taxes: [[s.cleaning.bill.taxes[0][0], 0.13]],
            status: { tone: "ok", text: s.cleaning.bill.status.text },
        },
    },
    {
        slug: "tutoring",
        demo: "lakeside",
        name: s.tutoring.name,
        glyph: "book",
        who: s.tutoring.who,
        oneLine: s.tutoring.oneLine,
        h1: s.tutoring.h1,
        lede: s.tutoring.lede,
        photo: {
            name: "tutoring",
            alt: s.tutoring.photo.alt,
            position: "45% 50%",
        },
        photo2: {
            name: "tutoring-2",
            alt: s.tutoring.photo2.alt,
            position: "50% 60%",
        },
        heroCard: {
            label: s.tutoring.heroCard.label,
            title: s.tutoring.heroCard.title,
            detail: s.tutoring.heroCard.detail,
            pill: { tone: "accent", text: s.tutoring.heroCard.pill.text },
        },
        bookings: s.tutoring.bookings,
        schedule: {
            day: s.tutoring.schedule.day,
            startHour: 13,
            columns: s.tutoring.schedule.columns,
            events: [
                ev(s.tutoring.schedule.events[0], 0, 2.5, 1),
                ev(s.tutoring.schedule.events[1], 0, 3.5, 1),
                ev(s.tutoring.schedule.events[2], 1, 2, 0.5),
                ev(s.tutoring.schedule.events[3], 1, 3.5, 0.75, "alt"),
                ev(s.tutoring.schedule.events[4], 1, 4.5, 0.5),
                ev(s.tutoring.schedule.events[5], 2, 3, 1.5, "alt"),
            ],
        },
        booking: {
            tag: s.tutoring.booking.tag,
            items: [
                {
                    name: s.tutoring.booking.items[0].name,
                    detail: s.tutoring.booking.items[0].detail,
                    cents: 6500,
                },
                {
                    name: s.tutoring.booking.items[1].name,
                    detail: s.tutoring.booking.items[1].detail,
                    cents: 3800,
                },
                {
                    name: s.tutoring.booking.items[2].name,
                    detail: s.tutoring.booking.items[2].detail,
                    cents: 5200,
                },
                {
                    name: s.tutoring.booking.items[3].name,
                    detail: s.tutoring.booking.items[3].detail,
                    cents: 4500,
                },
            ],
            date: s.tutoring.booking.date,
            times: s.tutoring.booking.times,
            button: s.tutoring.booking.button,
        },
        capabilities: [
            {
                icon: "package",
                title: s.tutoring.capabilities[0].title,
                body: s.tutoring.capabilities[0].body,
            },
            {
                icon: "subscription",
                title: s.tutoring.capabilities[1].title,
                body: s.tutoring.capabilities[1].body,
            },
            {
                icon: "invoice",
                title: s.tutoring.capabilities[2].title,
                body: s.tutoring.capabilities[2].body,
            },
            {
                icon: "deposit",
                title: s.tutoring.capabilities[3].title,
                body: s.tutoring.capabilities[3].body,
            },
            {
                icon: "gift",
                title: s.tutoring.capabilities[4].title,
                body: s.tutoring.capabilities[4].body,
            },
            {
                icon: "staff",
                title: s.tutoring.capabilities[5].title,
                body: s.tutoring.capabilities[5].body,
            },
            {
                icon: "tax",
                title: s.tutoring.capabilities[6].title,
                body: s.tutoring.capabilities[6].body,
            },
            {
                icon: "form",
                title: s.tutoring.capabilities[7].title,
                body: s.tutoring.capabilities[7].body,
            },
            {
                icon: "reminder",
                title: s.tutoring.capabilities[8].title,
                body: s.tutoring.capabilities[8].body,
            },
            {
                icon: "reviews",
                title: s.tutoring.capabilities[9].title,
                body: s.tutoring.capabilities[9].body,
            },
            {
                icon: "booking",
                title: s.tutoring.capabilities[10].title,
                body: s.tutoring.capabilities[10].body,
            },
            {
                icon: "offline",
                title: s.tutoring.capabilities[11].title,
                body: s.tutoring.capabilities[11].body,
            },
        ],
        pay: s.tutoring.pay,
        record: {
            name: s.tutoring.record.name,
            detail: s.tutoring.record.detail,
            students: s.tutoring.record.students,
            plan: { name: s.tutoring.record.plan.name, used: 6, total: 10 },
            upcoming: [
                s.tutoring.record.upcoming[0],
                s.tutoring.record.upcoming[1],
                s.tutoring.record.upcoming[2],
            ],
            forms: s.tutoring.record.forms,
        },
    },
    {
        slug: "wellness",
        demo: "harbourside",
        name: s.wellness.name,
        glyph: "stones",
        who: s.wellness.who,
        oneLine: s.wellness.oneLine,
        h1: s.wellness.h1,
        lede: s.wellness.lede,
        photo: {
            name: "wellness-2",
            alt: s.wellness.photo.alt,
            position: "50% 45%",
        },
        photo2: {
            name: "wellness",
            alt: s.wellness.photo2.alt,
            position: "50% 60%",
        },
        heroCard: {
            label: s.wellness.heroCard.label,
            title: s.wellness.heroCard.title,
            detail: s.wellness.heroCard.detail,
            pill: { tone: "ok", text: s.wellness.heroCard.pill.text },
        },
        bookings: s.wellness.bookings,
        schedule: {
            day: s.wellness.schedule.day,
            columns: s.wellness.schedule.columns,
            events: [
                ev(s.wellness.schedule.events[0], 0, 0, 1.5),
                ev(s.wellness.schedule.events[1], 0, 2, 1),
                ev(s.wellness.schedule.events[2], 1, 2, 1, "alt"),
                ev(s.wellness.schedule.events[3], 1, 3.5, 1),
                ev(s.wellness.schedule.events[4], 2, 0.5, 0.5, "alt"),
                ev(s.wellness.schedule.events[5], 2, 3, 1.5),
            ],
        },
        booking: {
            tag: s.wellness.booking.tag,
            items: [
                {
                    name: s.wellness.booking.items[0].name,
                    detail: s.wellness.booking.items[0].detail,
                    cents: 6500,
                },
                {
                    name: s.wellness.booking.items[1].name,
                    detail: s.wellness.booking.items[1].detail,
                    cents: 11000,
                },
                {
                    name: s.wellness.booking.items[2].name,
                    detail: s.wellness.booking.items[2].detail,
                    cents: 15500,
                },
                {
                    name: s.wellness.booking.items[3].name,
                    detail: s.wellness.booking.items[3].detail,
                    cents: 50000,
                },
            ],
            date: s.wellness.booking.date,
            times: s.wellness.booking.times,
            button: s.wellness.booking.button,
        },
        capabilities: [
            {
                icon: "form",
                title: s.wellness.capabilities[0].title,
                body: s.wellness.capabilities[0].body,
            },
            {
                icon: "package",
                title: s.wellness.capabilities[1].title,
                body: s.wellness.capabilities[1].body,
            },
            {
                icon: "subscription",
                title: s.wellness.capabilities[2].title,
                body: s.wellness.capabilities[2].body,
            },
            {
                icon: "deposit",
                title: s.wellness.capabilities[3].title,
                body: s.wellness.capabilities[3].body,
            },
            {
                icon: "invoice",
                title: s.wellness.capabilities[4].title,
                body: s.wellness.capabilities[4].body,
            },
            {
                icon: "tapToPay",
                title: s.wellness.capabilities[5].title,
                body: s.wellness.capabilities[5].body,
            },
            {
                icon: "gift",
                title: s.wellness.capabilities[6].title,
                body: s.wellness.capabilities[6].body,
            },
            {
                icon: "staff",
                title: s.wellness.capabilities[7].title,
                body: s.wellness.capabilities[7].body,
            },
            {
                icon: "tax",
                title: s.wellness.capabilities[8].title,
                body: s.wellness.capabilities[8].body,
            },
            {
                icon: "reminder",
                title: s.wellness.capabilities[9].title,
                body: s.wellness.capabilities[9].body,
            },
            {
                icon: "reviews",
                title: s.wellness.capabilities[10].title,
                body: s.wellness.capabilities[10].body,
            },
            {
                icon: "addon",
                title: s.wellness.capabilities[11].title,
                body: s.wellness.capabilities[11].body,
            },
        ],
        pay: s.wellness.pay,
        record: {
            name: s.wellness.record.name,
            detail: s.wellness.record.detail,
            students: [],
            plan: { name: s.wellness.record.plan.name, used: 1, total: 5 },
            upcoming: [s.wellness.record.upcoming[0], s.wellness.record.upcoming[1]],
            forms: s.wellness.record.forms,
        },
    },
    {
        slug: "photography",
        demo: "fieldnote",
        name: s.photography.name,
        glyph: "camera",
        who: s.photography.who,
        oneLine: s.photography.oneLine,
        h1: s.photography.h1,
        lede: s.photography.lede,
        photo: {
            name: "photography",
            alt: s.photography.photo.alt,
            position: "65% 50%",
        },
        photo2: {
            name: "photography-2",
            alt: s.photography.photo2.alt,
            position: "60% 40%",
        },
        heroCard: {
            label: s.photography.heroCard.label,
            title: s.photography.heroCard.title,
            detail: s.photography.heroCard.detail,
            pill: { tone: "ok", text: s.photography.heroCard.pill.text },
        },
        bookings: s.photography.bookings,
        schedule: {
            day: s.photography.schedule.day,
            columns: s.photography.schedule.columns,
            events: [
                ev(s.photography.schedule.events[0], 0, 0, 0.5),
                ev(s.photography.schedule.events[1], 0, 0.5, 0.5),
                ev(s.photography.schedule.events[2], 0, 1, 0.5),
                ev(s.photography.schedule.events[3], 0, 1.5, 0.5, "open"),
                ev(s.photography.schedule.events[4], 1, 2.5, 1.5, "alt"),
                ev(s.photography.schedule.events[5], 2, 2.5, 1.5),
            ],
        },
        booking: {
            tag: s.photography.booking.tag,
            items: [
                {
                    name: s.photography.booking.items[0].name,
                    detail: s.photography.booking.items[0].detail,
                    cents: 22500,
                },
                {
                    name: s.photography.booking.items[1].name,
                    detail: s.photography.booking.items[1].detail,
                    cents: 45000,
                },
                {
                    name: s.photography.booking.items[2].name,
                    detail: s.photography.booking.items[2].detail,
                    cents: 27500,
                },
            ],
            date: s.photography.booking.date,
            times: s.photography.booking.times,
            button: s.photography.booking.button,
        },
        capabilities: [
            {
                icon: "invoice",
                title: s.photography.capabilities[0].title,
                body: s.photography.capabilities[0].body,
            },
            {
                icon: "form",
                title: s.photography.capabilities[1].title,
                body: s.photography.capabilities[1].body,
            },
            {
                icon: "deposit",
                title: s.photography.capabilities[2].title,
                body: s.photography.capabilities[2].body,
            },
            {
                icon: "invoice",
                title: s.photography.capabilities[3].title,
                body: s.photography.capabilities[3].body,
            },
            {
                icon: "payout",
                title: s.photography.capabilities[4].title,
                body: s.photography.capabilities[4].body,
            },
            {
                icon: "gift",
                title: s.photography.capabilities[5].title,
                body: s.photography.capabilities[5].body,
            },
            {
                icon: "staff",
                title: s.photography.capabilities[6].title,
                body: s.photography.capabilities[6].body,
            },
            {
                icon: "tax",
                title: s.photography.capabilities[7].title,
                body: s.photography.capabilities[7].body,
            },
            {
                icon: "messaging",
                title: s.photography.capabilities[8].title,
                body: s.photography.capabilities[8].body,
            },
            {
                icon: "reviews",
                title: s.photography.capabilities[9].title,
                body: s.photography.capabilities[9].body,
            },
            {
                icon: "booking",
                title: s.photography.capabilities[10].title,
                body: s.photography.capabilities[10].body,
            },
            {
                icon: "offline",
                title: s.photography.capabilities[11].title,
                body: s.photography.capabilities[11].body,
            },
        ],
        pay: s.photography.pay,
        bill: {
            kind: "estimate",
            meta: s.photography.bill.meta,
            lines: [
                [s.photography.bill.lines[0][0], 45000],
                [s.photography.bill.lines[1][0], 10000],
            ],
            taxes: [[s.photography.bill.taxes[0][0], 0.13]],
            retainerPct: 0.3,
            status: { tone: "ok", text: s.photography.bill.status.text },
        },
    },
    {
        slug: "trades",
        demo: "northlight",
        name: s.trades.name,
        glyph: "wrench",
        who: s.trades.who,
        oneLine: s.trades.oneLine,
        h1: s.trades.h1,
        lede: s.trades.lede,
        photo: {
            name: "trades",
            alt: s.trades.photo.alt,
            position: "65% 40%",
        },
        photo2: {
            name: "trades-2",
            alt: s.trades.photo2.alt,
            position: "60% 30%",
        },
        heroCard: {
            label: s.trades.heroCard.label,
            title: s.trades.heroCard.title,
            detail: s.trades.heroCard.detail,
            pill: { tone: "ok", text: s.trades.heroCard.pill.text },
        },
        bookings: s.trades.bookings,
        schedule: {
            day: s.trades.schedule.day,
            startHour: 8,
            columns: s.trades.schedule.columns,
            events: [
                ev(s.trades.schedule.events[0], 0, 0, 3.5),
                ev(s.trades.schedule.events[1], 0, 4, 1.5),
                ev(s.trades.schedule.events[2], 1, 0.5, 2),
                ev(s.trades.schedule.events[3], 1, 3, 2, "alt"),
                ev(s.trades.schedule.events[4], 2, 4, 0.75, "alt"),
            ],
        },
        booking: {
            tag: s.trades.booking.tag,
            items: [
                {
                    name: s.trades.booking.items[0].name,
                    detail: s.trades.booking.items[0].detail,
                    cents: 9500,
                },
                {
                    name: s.trades.booking.items[1].name,
                    detail: s.trades.booking.items[1].detail,
                    cents: 6000,
                },
                {
                    name: s.trades.booking.items[2].name,
                    detail: s.trades.booking.items[2].detail,
                    cents: 22000,
                },
            ],
            date: s.trades.booking.date,
            times: s.trades.booking.times,
            button: s.trades.booking.button,
        },
        capabilities: [
            {
                icon: "invoice",
                title: s.trades.capabilities[0].title,
                body: s.trades.capabilities[0].body,
            },
            {
                icon: "deposit",
                title: s.trades.capabilities[1].title,
                body: s.trades.capabilities[1].body,
            },
            {
                icon: "invoice",
                title: s.trades.capabilities[2].title,
                body: s.trades.capabilities[2].body,
            },
            {
                icon: "tapToPay",
                title: s.trades.capabilities[3].title,
                body: s.trades.capabilities[3].body,
            },
            {
                icon: "payout",
                title: s.trades.capabilities[4].title,
                body: s.trades.capabilities[4].body,
            },
            {
                icon: "gift",
                title: s.trades.capabilities[5].title,
                body: s.trades.capabilities[5].body,
            },
            {
                icon: "staff",
                title: s.trades.capabilities[6].title,
                body: s.trades.capabilities[6].body,
            },
            {
                icon: "tax",
                title: s.trades.capabilities[7].title,
                body: s.trades.capabilities[7].body,
            },
            {
                icon: "reminder",
                title: s.trades.capabilities[8].title,
                body: s.trades.capabilities[8].body,
            },
            {
                icon: "reviews",
                title: s.trades.capabilities[9].title,
                body: s.trades.capabilities[9].body,
            },
            {
                icon: "booking",
                title: s.trades.capabilities[10].title,
                body: s.trades.capabilities[10].body,
            },
            {
                icon: "offline",
                title: s.trades.capabilities[11].title,
                body: s.trades.capabilities[11].body,
            },
        ],
        pay: s.trades.pay,
        bill: {
            kind: "invoice",
            meta: s.trades.bill.meta,
            lines: [
                [s.trades.bill.lines[0][0], 33250],
                [s.trades.bill.lines[1][0], 14820],
            ],
            taxes: [[s.trades.bill.taxes[0][0], 0.05]],
            deposit: 10000,
            status: { tone: "ok", text: s.trades.bill.status.text },
        },
    },
];

export const solutionPath = (slug: string): string => `/solutions/${slug}`;
