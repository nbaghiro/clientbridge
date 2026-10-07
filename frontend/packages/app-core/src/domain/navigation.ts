import { useQuery } from "@powersync/react";

import type { IconName } from "../icons";
import { strings } from "../strings";
import type { Viewer } from "./auth";
import { utcSql } from "./bookings";
import { type SetupProgress, useSetupProgress } from "./business";
import { invoiceStatusSql } from "./ledger";
import { canManagePayments } from "./payments";
import { staffName } from "./staff";

export type DestinationKey = "today" | "schedule" | "clients" | "payments" | "inbox";

/** The five top-level destinations, in order. Each app maps `key` to its own route + icon. */
export const DESTINATIONS: { key: DestinationKey; label: string }[] = [
    { key: "today", label: strings.navigation.today },
    { key: "schedule", label: strings.navigation.schedule },
    { key: "clients", label: strings.navigation.clients },
    { key: "payments", label: strings.navigation.payments },
    { key: "inbox", label: strings.navigation.inbox },
];

export type PaymentsTabKey =
    | "invoices"
    | "sales"
    | "giftCards"
    | "refunds"
    | "staffPay"
    | "taxReturns"
    | "payouts"
    | "reports";

export const PAYMENTS_TABS: { key: PaymentsTabKey; label: string; managersOnly: boolean }[] = [
    { key: "invoices", label: strings.navigation.paymentsTabs.invoices, managersOnly: true },
    { key: "sales", label: strings.navigation.paymentsTabs.sales, managersOnly: false },
    { key: "giftCards", label: strings.navigation.paymentsTabs.giftCards, managersOnly: true },
    { key: "refunds", label: strings.navigation.paymentsTabs.refunds, managersOnly: true },
    { key: "staffPay", label: strings.navigation.paymentsTabs.staffPay, managersOnly: true },
    { key: "taxReturns", label: strings.navigation.paymentsTabs.taxReturns, managersOnly: true },
    { key: "payouts", label: strings.navigation.paymentsTabs.payouts, managersOnly: true },
    { key: "reports", label: strings.navigation.paymentsTabs.reports, managersOnly: true },
];

export function visiblePaymentsTabs(role: string | null): typeof PAYMENTS_TABS {
    return PAYMENTS_TABS.filter((t) => !t.managersOnly || canManagePayments(role));
}

export type InboxSegmentKey = "messages" | "reviews";

const INBOX_SEGMENTS: { key: InboxSegmentKey; label: string; managersOnly: boolean }[] = [
    { key: "messages", label: strings.navigation.inboxSegments.messages, managersOnly: false },
    { key: "reviews", label: strings.navigation.inboxSegments.reviews, managersOnly: true },
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
        label: strings.navigation.setupSections.business,
        webOnly: false,
        managersOnly: true,
    },
    {
        key: "services",
        label: strings.navigation.setupSections.services,
        webOnly: false,
        managersOnly: true,
    },
    {
        key: "team",
        label: strings.navigation.setupSections.team,
        webOnly: false,
        managersOnly: false,
    },
    {
        key: "gettingPaid",
        label: strings.navigation.setupSections.gettingPaid,
        webOnly: false,
        managersOnly: true,
    },
    {
        key: "onlineBooking",
        label: strings.navigation.setupSections.onlineBooking,
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

// Where a shell control leads; each app maps these to its own routes or navigator screens.
export type ShellTarget =
    | "today"
    | "schedule"
    | "booking"
    | "hours"
    | "sale"
    | "checkout"
    | "orders"
    | "invoices"
    | "invoice"
    | "estimate"
    | "payments"
    | "giftCards"
    | "refunds"
    | "clients"
    | "client"
    | "inbox"
    | "message"
    | "reviews"
    | "stock"
    | "catalog"
    | "reports"
    | "staffPay"
    | "taxReturns"
    | "payouts"
    | "business"
    | "team"
    | "gettingPaid"
    | "onlineBooking"
    | "search"
    | "notifications";

export const DESTINATION_TARGET: Record<DestinationKey, ShellTarget> = {
    today: "today",
    schedule: "schedule",
    clients: "clients",
    payments: "payments",
    inbox: "inbox",
};

type CreateKey = "booking" | "sale" | "invoice" | "estimate" | "client" | "message" | "timeOff";

export interface CreateAction {
    key: CreateKey;
    label: string;
    hint: string;
    icon: IconName;
    shortcut: string;
    target: ShellTarget;
}

const c = strings.navigation.createActions;

const CREATE_ACTIONS: (CreateAction & { managersOnly: boolean })[] = [
    {
        key: "booking",
        target: "booking",
        ...c.booking,
        icon: "calendar",
        shortcut: "B",
        managersOnly: false,
    },
    { key: "sale", target: "sale", ...c.sale, icon: "pos", shortcut: "S", managersOnly: false },
    {
        key: "invoice",
        target: "invoice",
        ...c.invoice,
        icon: "invoices",
        shortcut: "I",
        managersOnly: true,
    },
    {
        key: "estimate",
        target: "estimate",
        ...c.estimate,
        icon: "receipt",
        shortcut: "E",
        managersOnly: true,
    },
    {
        key: "client",
        target: "client",
        ...c.client,
        icon: "user",
        shortcut: "C",
        managersOnly: false,
    },
    {
        key: "message",
        target: "message",
        ...c.message,
        icon: "send",
        shortcut: "M",
        managersOnly: false,
    },
    {
        key: "timeOff",
        target: "hours",
        ...c.timeOff,
        icon: "clock",
        shortcut: "T",
        managersOnly: false,
    },
];

/** The Create menu for a role: staff can't invoice or quote, as on the server. */
export function createActionsFor(role: string | null): CreateAction[] {
    return CREATE_ACTIONS.filter((a) => !a.managersOnly || canManagePayments(role));
}

export function roleLabel(role: string | null): string {
    switch (role) {
        case "owner":
            return strings.staff.roleOwner;
        case "admin":
            return strings.staff.roleAdmin;
        case "contractor":
            return strings.staff.roleContractor;
        default:
            return strings.staff.roleStaff;
    }
}

export const VIEWER_STAFF_SQL = "SELECT name, title, role, color FROM staff WHERE id = ?";

export const UNREAD_MESSAGES_SQL =
    "SELECT COUNT(*) AS n FROM messages WHERE direction = 'in' AND status != 'read'";

export const OVERDUE_INVOICES_SQL = `SELECT COUNT(*) AS n FROM invoices i WHERE ${invoiceStatusSql("i")} = 'overdue'`;

export const RECENT_CLIENTS_SQL = `
SELECT c.id, c.name FROM bookings b
JOIN slots s ON s.id = b.slot_id JOIN clients c ON c.id = b.client_id
WHERE b.deleted_at IS NULL AND b.status != 'canceled' AND c.status = 'active'
GROUP BY c.id, c.name ORDER BY MAX(${utcSql("s.starts_at")}) DESC LIMIT 6`;

interface ShellNav {
    name: string;
    color: string | null;
    brandColor: string | null;
    roleLabel: string;
    badges: Partial<Record<DestinationKey, number>>;
    create: CreateAction[];
    recentClients: { id: string; name: string }[];
    setup: SetupProgress;
    // Staff don't see setup progress: most steps are the owner's.
    showSetup: boolean;
}

/** Everything the sidebar or tab bar shows beside the destinations, for the signed-in member. */
export function useShellNav(viewer: Viewer | null, bookBase: string): ShellNav {
    const role = viewer?.role ?? null;
    const manager = canManagePayments(role);
    const me = useQuery<{
        name: string | null;
        title: string | null;
        role: string;
        color: string | null;
    }>(VIEWER_STAFF_SQL, [viewer?.staffId ?? ""]).data[0];
    const unread = useQuery<{ n: number }>(UNREAD_MESSAGES_SQL).data[0]?.n ?? 0;
    const overdue = useQuery<{ n: number }>(OVERDUE_INVOICES_SQL).data[0]?.n ?? 0;
    const recent = useQuery<{ id: string; name: string }>(RECENT_CLIENTS_SQL).data;
    const setup = useSetupProgress(bookBase);
    return {
        name: me === undefined ? "" : staffName(me),
        color: me?.color ?? null,
        brandColor: setup.brandColor,
        roleLabel: roleLabel(role),
        badges: { inbox: unread, ...(manager ? { payments: overdue } : {}) },
        create: createActionsFor(role),
        recentClients: recent.slice(0, 4),
        setup,
        showSetup: manager && !setup.complete,
    };
}
