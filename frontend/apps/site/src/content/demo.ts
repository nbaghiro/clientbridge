// The demo business as the app mocks show it; the laptop and phone read the same rows.

export const demoBusiness = {
    name: "Birchbark Pet Studio",
    tag: "Book a visit",
};

export const today = {
    title: "Today",
    subtitle: "Your money at a glance.",
    stats: [
        { label: "Today's revenue", value: "$221.76 CAD", caption: "received today", good: true },
        {
            label: "Awaiting payment",
            value: "$356.16 CAD",
            caption: "outstanding invoices",
            good: false,
        },
        {
            label: "GST/HST set aside",
            value: "$3,099.00 CAD",
            caption: "remit to CRA",
            good: false,
        },
    ],
    activityTitle: "Recent activity",
    activity: [
        { what: "Card payment", who: "Amélie Tremblay", amount: "$67.20 CAD", when: "3h" },
        { what: "Interac received", who: "Noah Schmidt", amount: "$84.00 CAD", when: "3h" },
        { what: "Card payment", who: "Sophie Nguyen", amount: "$20.16 CAD", when: "3h" },
        { what: "Deposit received", who: "Marcus Bennett", amount: "$20.00 CAD", when: "4h" },
        { what: "Interac received", who: "Yuki Tanaka", amount: "$84.00 CAD", when: "1d" },
    ],
};

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

export const invoices: readonly InvoiceRow[] = [
    { number: "1097", client: "Ethan Wright", total: "$53.76", paid: false },
    { number: "1537", client: "Sophie Nguyen", total: "$20.16", paid: true },
    { number: "1536", client: "Amélie Tremblay", total: "$67.20", paid: true },
    { number: "1535", client: "Noah Schmidt", total: "$84.00", paid: true },
    { number: "1534", client: "Amélie Tremblay", total: "$50.40", paid: true },
    { number: "1533", client: "Liam O'Connor", total: "$95.20", paid: true },
];

export const invoiceTable = {
    columns: { number: "#", client: "Client", status: "Status", total: "Total" },
    paid: "Paid",
    draft: "Draft",
};

export const phonePayments = {
    time: "10:31",
    title: "Payments",
    tabs: ["Invoices", "Sales", "Gift cards", "Staff pay", "Reports"],
    count: "453 invoices · 4 estimates",
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
    days: [
        { label: "MON", date: "28" },
        { label: "TUE", date: "29" },
        { label: "WED", date: "30" },
        { label: "THU", date: "1" },
        { label: "FRI", date: "2", today: true },
    ],
    hours: ["9 a.m.", "10 a.m.", "11 a.m.", "12 p.m.", "1 p.m.", "2 p.m."],
    events: [
        {
            day: 0,
            client: "Ethan Wright",
            detail: "11:00 · Bath & Tidy",
            top: 88,
            height: 42,
            accent: false,
        },
        {
            day: 1,
            client: "Sophie Nguyen",
            detail: "9:00 · Full Groom",
            top: 4,
            height: 62,
            accent: false,
        },
        {
            day: 1,
            client: "Marcus Bennett",
            detail: "10:30 · Cat Groom",
            top: 70,
            height: 62,
            accent: false,
        },
        {
            day: 2,
            client: "Priscilla Adeyemi",
            detail: "9:00 · Full Groom",
            top: 4,
            height: 62,
            accent: false,
        },
        {
            day: 2,
            client: "David Okafor",
            detail: "1:00 · De-shedding",
            top: 180,
            height: 52,
            accent: true,
        },
        {
            day: 3,
            client: "Yuki Tanaka",
            detail: "10:00 · Nail trim",
            top: 48,
            height: 62,
            accent: true,
        },
        {
            day: 3,
            client: "Liam O'Connor",
            detail: "12:00 · Puppy intro",
            top: 136,
            height: 40,
            accent: false,
        },
        {
            day: 4,
            client: "Noah Schmidt",
            detail: "9:00 · Full Groom",
            top: 4,
            height: 62,
            accent: false,
        },
        {
            day: 4,
            client: "Amélie Tremblay",
            detail: "12:00 · Daycare",
            top: 136,
            height: 84,
            accent: true,
        },
    ] satisfies CalendarEvent[],
};

export const tapToPay = {
    charge: "Charge Noah Schmidt",
    amount: "$84.00",
    tax: "includes GST $3.75 and PST $5.25",
    prompt: "Hold card near the phone",
    caption: "Tap to Pay on iPhone and Android",
};

export const bookingPage = {
    services: [
        {
            image: "/images/demo/it_groom_lg.png",
            name: "Full Groom",
            length: "90 min",
            price: "$80.00",
        },
        {
            image: "/images/demo/it_bath.png",
            name: "Bath & Tidy",
            length: "60 min",
            price: "$48.00",
        },
        { image: "/images/demo/it_cat.png", name: "Cat Groom", length: "75 min", price: "$64.00" },
        {
            image: "/images/demo/it_nails.png",
            name: "Nail trim",
            length: "15 min",
            price: "$18.00",
        },
    ],
    date: "Friday, October 2",
    times: ["9:00", "10:30", "1:00", "2:30"],
    selectedTime: 1,
    cta: "Book and pay $20 deposit",
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
    rows: [
        {
            image: "/images/demo/it_shampoo.png",
            name: "Oatmeal shampoo",
            sku: "BB-SHMP-500",
            stock: "14 in stock",
            tone: "ok",
            price: "$24.00",
        },
        {
            image: "/images/demo/it_brush.png",
            name: "Slicker brush",
            sku: "BB-BRSH-01",
            stock: "Low: 2 left",
            tone: "warn",
            price: "$29.00",
            restock: true,
        },
        {
            image: "/images/demo/it_nails.png",
            name: "Nail trim",
            sku: "Service",
            stock: "Not tracked",
            tone: "muted",
            price: "$18.00",
        },
    ] satisfies StockRow[],
    restock: "Restock",
};

export const shop = {
    title: "Shop",
    business: "Birchbark Pet Studio",
    items: [
        {
            image: "/images/demo/it_shampoo.png",
            name: "Oatmeal shampoo",
            detail: "500 ml",
            price: "$24.00",
            qty: 1,
        },
        {
            image: "/images/demo/it_brush.png",
            name: "Slicker brush",
            detail: "Only 2 left",
            price: "$29.00",
            qty: 1,
        },
    ],
    subtotalLabel: "Subtotal",
    subtotal: "$53.00",
    pickup: "Pick up at Birchbark Pet Studio",
    pay: "Pay by card",
    minus: "−",
};
