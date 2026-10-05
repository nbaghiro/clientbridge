import { strings } from "../strings";
import { canManagePayments } from "./payments";

export type DestinationKey = "today" | "schedule" | "clients" | "payments" | "inbox";

/** The five top-level destinations, in order. Each app maps `key` to its own route + icon. */
export const DESTINATIONS: { key: DestinationKey; label: string }[] = [
    { key: "today", label: strings.nav.today },
    { key: "schedule", label: strings.nav.schedule },
    { key: "clients", label: strings.nav.clients },
    { key: "payments", label: strings.nav.payments },
    { key: "inbox", label: strings.nav.inbox },
];

export type PaymentsTabKey = "invoices" | "sales" | "giftCards" | "staffPay" | "reports";

export const PAYMENTS_TABS: { key: PaymentsTabKey; label: string; managersOnly: boolean }[] = [
    { key: "invoices", label: strings.nav.paymentsTabs.invoices, managersOnly: true },
    { key: "sales", label: strings.nav.paymentsTabs.sales, managersOnly: false },
    { key: "giftCards", label: strings.nav.paymentsTabs.giftCards, managersOnly: true },
    { key: "staffPay", label: strings.nav.paymentsTabs.staffPay, managersOnly: true },
    { key: "reports", label: strings.nav.paymentsTabs.reports, managersOnly: true },
];

export function visiblePaymentsTabs(role: string | null): typeof PAYMENTS_TABS {
    return PAYMENTS_TABS.filter((t) => !t.managersOnly || canManagePayments(role));
}

export function canSeePaymentsTab(role: string | null, key: PaymentsTabKey): boolean {
    return visiblePaymentsTabs(role).some((t) => t.key === key);
}

export type InboxSegmentKey = "messages" | "reviews";

export const INBOX_SEGMENTS: { key: InboxSegmentKey; label: string; managersOnly: boolean }[] = [
    { key: "messages", label: strings.nav.inboxSegments.messages, managersOnly: false },
    { key: "reviews", label: strings.nav.inboxSegments.reviews, managersOnly: true },
];

export function visibleInboxSegments(role: string | null): typeof INBOX_SEGMENTS {
    return INBOX_SEGMENTS.filter((s) => !s.managersOnly || canManagePayments(role));
}

export type SetupSectionKey = "business" | "services" | "team" | "gettingPaid" | "onlineBooking";

export const SETUP_SECTIONS: {
    key: SetupSectionKey;
    label: string;
    webOnly: boolean;
    managersOnly: boolean;
}[] = [
    {
        key: "business",
        label: strings.nav.setupSections.business,
        webOnly: false,
        managersOnly: true,
    },
    {
        key: "services",
        label: strings.nav.setupSections.services,
        webOnly: false,
        managersOnly: true,
    },
    { key: "team", label: strings.nav.setupSections.team, webOnly: false, managersOnly: false },
    {
        key: "gettingPaid",
        label: strings.nav.setupSections.gettingPaid,
        webOnly: false,
        managersOnly: true,
    },
    {
        key: "onlineBooking",
        label: strings.nav.setupSections.onlineBooking,
        webOnly: true,
        managersOnly: true,
    },
];

export function setupSectionsFor(
    platform: "web" | "mobile",
    role: string | null,
): typeof SETUP_SECTIONS {
    return SETUP_SECTIONS.filter(
        (s) => (platform === "web" || !s.webOnly) && (!s.managersOnly || canManagePayments(role)),
    );
}
