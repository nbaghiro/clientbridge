import { demoSnapshot } from "./demo-snapshot";

// The demo business as the app mocks show it; the laptop and phone read the same rows.

export const demoBusiness = {
    name: "Birchbark Pet Studio",
    tag: "Book a visit",
};

export const today = demoSnapshot.today;

export const appNav = {
    items: ["Today", "Schedule", "Clients", "Payments", "Inbox"] as const,
    setup: "Setup",
};

export interface InvoiceRow {
    number: string;
    client: string;
    total: string;
    paid: boolean;
}

export const invoices: readonly InvoiceRow[] = demoSnapshot.invoices;

export const invoiceTable = {
    columns: { number: "#", client: "Client", status: "Status", total: "Total" },
    paid: "Paid",
    draft: "Draft",
};

export const phonePayments = {
    time: "10:31",
    title: "Payments",
    tabs: ["Invoices", "Sales", "Gift cards", "Staff pay", "Reports"],
    count: `${String(demoSnapshot.invoiceCount)} invoices · ${String(demoSnapshot.estimateCount)} estimates`,
    newLabel: "+ New",
    segments: ["Invoices", "Estimates"],
    search: "Search invoices…",
    tabBar: ["Today", "Schedule", "Clients", "Payments"],
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
    ...demoSnapshot.calendar,
    events: demoSnapshot.calendar.events satisfies readonly CalendarEvent[],
};

export const tapToPay = demoSnapshot.tapToPay;

export const bookingPage = {
    services: demoSnapshot.services,
    ...demoSnapshot.bookingPage,
};

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
    title: "Services & products",
    filters: ["All", "Low stock", "Archived"],
    activeFilter: 0,
    rows: demoSnapshot.stockRows satisfies readonly StockRow[],
    restock: "Restock",
};

export const shop = {
    title: "Shop",
    business: "Birchbark Pet Studio",
    items: demoSnapshot.shop.items,
    subtotalLabel: "Subtotal",
    subtotal: demoSnapshot.shop.subtotal,
    pickup: "Pick up at Birchbark Pet Studio",
    pay: "Pay by card",
    minus: "−",
};
