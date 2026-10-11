import {
    combineDayAndTime,
    formatDayNumber,
    formatFullDate,
    formatHour,
    formatList,
    formatMoney,
    formatMoneyWithCurrency,
    formatParts,
    formatShortDay,
    formatTimeOfPeriod,
    formatWeekday,
    minutesInto,
    parseTimestamp,
    readDate,
    taxName,
} from "@clientbridge/app-core/public";

import type { IconName } from "../art/Icon";
import { demoSnapshot } from "./demo-snapshot";
import { strings } from "../strings";

const s = strings.demo;
const { currency, timezone: zone } = demoSnapshot;
const money = (cents: number): string => formatMoney(cents, currency);
const inStock = (onHand: number | null): string => s.stock.inStock(onHand ?? 0);

// The demo business as the app mocks show it; the laptop and phone read the same rows.

export const demoBusiness = s.demoBusiness;

const t = demoSnapshot.today;

export const today = {
    title: s.today.title,
    subtitle: s.today.subtitle,
    stats: [
        { label: s.today.sales, cents: t.salesCents, caption: s.today.salesCaption, good: true },
        {
            label: s.today.awaiting,
            cents: t.awaitingCents,
            caption: s.today.awaitingCaption,
            good: false,
        },
        { label: s.today.taxes, cents: t.taxCents, caption: s.today.taxesCaption, good: false },
    ].map(({ cents, ...stat }) => ({ ...stat, value: formatMoneyWithCurrency(cents, currency) })),
    activityTitle: s.today.activityTitle,
    activity: t.activity.map((a) => ({
        paymentId: a.paymentId,
        amountCents: a.amountCents,
        what: s.today.payment(a.method),
        who: a.who,
        amount: formatMoneyWithCurrency(a.amountCents, currency),
        when: formatShortDay(parseTimestamp(a.paidAt), zone),
    })),
};

export const appNav = {
    items: [
        { icon: "today", label: s.appNav.items.today },
        { icon: "calendar", label: s.appNav.items.schedule },
        { icon: "clients", label: s.appNav.items.clients },
        { icon: "invoice", label: s.appNav.items.payments },
        { icon: "inbox", label: s.appNav.items.inbox },
    ] satisfies { icon: IconName; label: string }[],
    setup: s.appNav.setup,
};

export interface InvoiceRow {
    number: string;
    client: string;
    total: string;
    paid: boolean;
}

export const invoices: readonly InvoiceRow[] = demoSnapshot.invoices.map((i) => ({
    number: i.number,
    client: i.client,
    total: money(i.totalCents),
    paid: i.paid,
}));

export const invoiceTable = s.invoiceTable;

export const phonePayments = {
    time: s.phonePayments.time,
    title: s.phonePayments.title,
    tabs: s.phonePayments.tabs,
    count: s.phonePayments.count(demoSnapshot.invoiceCount, demoSnapshot.estimateCount),
    newLabel: s.phonePayments.newLabel,
    segments: s.phonePayments.segments,
    search: s.phonePayments.search,
    tabBar: s.phonePayments.tabBar,
};

export interface CalendarEvent {
    day: number;
    client: string;
    detail: string;
    top: number;
    height: number;
    accent: boolean;
}

export const calendar = {
    days: demoSnapshot.calendar.days.map((d) => ({
        ...d,
        label: formatWeekday(readDate(d.iso, zone), zone),
        date: formatDayNumber(readDate(d.iso, zone), zone),
    })),
    hours: demoSnapshot.calendar.hours.map(formatHour),
    events: demoSnapshot.calendar.events.map((e) => ({
        ...e,
        detail: formatParts([
            formatTimeOfPeriod(minutesInto(readDate(e.date, zone), e.startMinute, zone), zone),
            e.service,
        ]),
    })) satisfies readonly CalendarEvent[],
};

const tap = demoSnapshot.tapToPay;

export const tapToPay = {
    ...tap,
    charge: s.tapToPay.charge(tap.client),
    amount: money(tap.totalCents),
    tax: s.tapToPay.includes(
        formatList(
            tap.taxes.map((x) => s.tapToPay.tax(taxName(x.code), money(x.cents))),
            "unit",
        ),
    ),
    prompt: s.tapToPay.prompt,
    caption: s.tapToPay.caption,
};

const booking: {
    date: string;
    times: readonly string[];
    selectedTime: number;
    depositCents: number;
} = demoSnapshot.bookingPage;

export const bookingPage = {
    services: demoSnapshot.services.map((x) => ({
        image: x.image,
        name: x.name,
        length: s.minutes(x.minutes),
        price: money(x.priceCents),
    })),
    date: formatFullDate(readDate(booking.date, zone), zone),
    times: booking.times.map((hhmm) =>
        formatTimeOfPeriod(combineDayAndTime(booking.date, hhmm, zone), zone),
    ),
    selectedTime: booking.selectedTime,
    cta:
        booking.depositCents > 0
            ? s.bookingPage.payDeposit(money(booking.depositCents))
            : s.bookingPage.book,
};

interface SnapshotStock {
    image: string;
    name: string;
    sku: string | null;
    priceCents: number;
    tracked: boolean;
    onHand: number | null;
    low: boolean;
}

interface StockRow {
    image: string;
    name: string;
    sku: string;
    stock: string;
    tone: "ok" | "warn" | "muted";
    price: string;
    restock?: boolean;
}

export const stockList = {
    title: s.stockList.title,
    filters: s.stockList.filters,
    activeFilter: 0,
    rows: demoSnapshot.stockRows.map((r: SnapshotStock): StockRow => ({
        image: r.image,
        name: r.name,
        sku: r.sku ?? s.stock.service,
        price: money(r.priceCents),
        stock: !r.tracked
            ? s.stock.untracked
            : r.low
              ? s.stock.low(r.onHand ?? 0)
              : inStock(r.onHand),
        tone: r.low ? "warn" : r.tracked ? "ok" : "muted",
        restock: r.low,
    })),
    restock: s.stockList.restock,
};

export const shop = {
    title: s.shop.title,
    business: s.shop.business,
    items: demoSnapshot.shop.items.map((i) => ({
        image: i.image,
        name: i.name,
        detail: inStock(i.onHand),
        price: money(i.priceCents),
        qty: i.qty,
    })),
    subtotalLabel: s.shop.subtotalLabel,
    subtotal: money(demoSnapshot.shop.items.reduce((sum, i) => sum + i.priceCents * i.qty, 0)),
    pickup: s.shop.pickup,
    pay: s.shop.pay,
    minus: s.shop.minus,
};
