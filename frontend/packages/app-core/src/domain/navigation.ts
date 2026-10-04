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
    { key: "invoices", label: strings.paymentsTabs.invoices, managersOnly: true },
    { key: "sales", label: strings.paymentsTabs.sales, managersOnly: false },
    { key: "giftCards", label: strings.paymentsTabs.giftCards, managersOnly: true },
    { key: "staffPay", label: strings.paymentsTabs.staffPay, managersOnly: true },
    { key: "reports", label: strings.paymentsTabs.reports, managersOnly: true },
];

export function visiblePaymentsTabs(role: string | null): typeof PAYMENTS_TABS {
    return PAYMENTS_TABS.filter((t) => !t.managersOnly || canManagePayments(role));
}

export function canSeePaymentsTab(role: string | null, key: PaymentsTabKey): boolean {
    return visiblePaymentsTabs(role).some((t) => t.key === key);
}

export type InboxSegmentKey = "messages" | "reviews";

export const INBOX_SEGMENTS: { key: InboxSegmentKey; label: string; managersOnly: boolean }[] = [
    { key: "messages", label: strings.inboxSegments.messages, managersOnly: false },
    { key: "reviews", label: strings.inboxSegments.reviews, managersOnly: true },
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
    { key: "business", label: strings.setupSections.business, webOnly: false, managersOnly: true },
    { key: "services", label: strings.setupSections.services, webOnly: false, managersOnly: true },
    { key: "team", label: strings.setupSections.team, webOnly: false, managersOnly: false },
    {
        key: "gettingPaid",
        label: strings.setupSections.gettingPaid,
        webOnly: false,
        managersOnly: true,
    },
    {
        key: "onlineBooking",
        label: strings.setupSections.onlineBooking,
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
