import { useBusinessQuery as useQuery } from "../hooks";

import type { IconName } from "../icons";
import { strings } from "../strings";
import type { Viewer } from "./auth";
import { type SetupProgress, useSetupProgress } from "./business";
import { invoiceStatusSql } from "./ledger";
import { canManagePayments } from "./payments";
import { staffName, staffNameSql } from "./staff";

export type DestinationKey = "today" | "schedule" | "clients" | "payments" | "inbox";

/** The five top-level destinations, in order. Each app maps `key` to its own route + icon. */
export const DESTINATIONS: { key: DestinationKey; label: string }[] = [
    {
        key: "today",
        get label() {
            return strings.navigation.today;
        },
    },
    {
        key: "inbox",
        get label() {
            return strings.navigation.inbox;
        },
    },
    {
        key: "schedule",
        get label() {
            return strings.navigation.schedule;
        },
    },
    {
        key: "clients",
        get label() {
            return strings.navigation.clients;
        },
    },
    {
        key: "payments",
        get label() {
            return strings.navigation.payments;
        },
    },
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

const PAYMENTS_TABS: { key: PaymentsTabKey; label: string; managersOnly: boolean }[] = [
    {
        key: "invoices",
        get label() {
            return strings.navigation.paymentsTabs.invoices;
        },
        managersOnly: true,
    },
    {
        key: "sales",
        get label() {
            return strings.navigation.paymentsTabs.sales;
        },
        managersOnly: false,
    },
    {
        key: "giftCards",
        get label() {
            return strings.navigation.paymentsTabs.giftCards;
        },
        managersOnly: true,
    },
    {
        key: "refunds",
        get label() {
            return strings.navigation.paymentsTabs.refunds;
        },
        managersOnly: true,
    },
    {
        key: "staffPay",
        get label() {
            return strings.navigation.paymentsTabs.staffPay;
        },
        managersOnly: true,
    },
    {
        key: "taxReturns",
        get label() {
            return strings.navigation.paymentsTabs.taxReturns;
        },
        managersOnly: true,
    },
    {
        key: "payouts",
        get label() {
            return strings.navigation.paymentsTabs.payouts;
        },
        managersOnly: true,
    },
    {
        key: "reports",
        get label() {
            return strings.navigation.paymentsTabs.reports;
        },
        managersOnly: true,
    },
];

export function visiblePaymentsTabs(role: string | null): typeof PAYMENTS_TABS {
    return PAYMENTS_TABS.filter((t) => !t.managersOnly || canManagePayments(role));
}

export type InboxSegmentKey = "messages" | "reviews" | "broadcasts" | "forms" | "contracts";

const INBOX_SEGMENTS: { key: InboxSegmentKey; label: string; managersOnly: boolean }[] = [
    {
        key: "messages",
        get label() {
            return strings.navigation.inboxSegments.messages;
        },
        managersOnly: false,
    },
    {
        key: "reviews",
        get label() {
            return strings.navigation.inboxSegments.reviews;
        },
        managersOnly: true,
    },
    {
        key: "broadcasts",
        get label() {
            return strings.navigation.inboxSegments.broadcasts;
        },
        managersOnly: true,
    },
    {
        key: "forms",
        get label() {
            return strings.navigation.inboxSegments.forms;
        },
        managersOnly: true,
    },
    {
        key: "contracts",
        get label() {
            return strings.navigation.inboxSegments.contracts;
        },
        managersOnly: true,
    },
];

export function visibleInboxSegments(role: string | null): typeof INBOX_SEGMENTS {
    return INBOX_SEGMENTS.filter((s) => !s.managersOnly || canManagePayments(role));
}

export type SetupSectionKey =
    | "start"
    | "business"
    | "services"
    | "team"
    | "gettingPaid"
    | "plan"
    | "taxes"
    | "onlineBooking"
    | "reminders"
    | "security";

const SETUP_SECTIONS: {
    key: SetupSectionKey;
    label: string;
    webOnly: boolean;
    managersOnly: boolean;
    ownerOnly?: boolean;
}[] = [
    {
        key: "start",
        get label() {
            return strings.navigation.setupSections.start;
        },
        webOnly: false,
        managersOnly: true,
    },
    {
        key: "business",
        get label() {
            return strings.navigation.setupSections.business;
        },
        webOnly: false,
        managersOnly: true,
    },
    {
        key: "services",
        get label() {
            return strings.navigation.setupSections.services;
        },
        webOnly: false,
        managersOnly: true,
    },
    {
        key: "team",
        get label() {
            return strings.navigation.setupSections.team;
        },
        webOnly: false,
        managersOnly: false,
    },
    {
        key: "gettingPaid",
        get label() {
            return strings.navigation.setupSections.gettingPaid;
        },
        webOnly: false,
        managersOnly: true,
    },
    {
        key: "plan",
        get label() {
            return strings.navigation.setupSections.plan;
        },
        webOnly: false,
        managersOnly: true,
        ownerOnly: true,
    },
    {
        key: "taxes",
        get label() {
            return strings.navigation.setupSections.taxes;
        },
        webOnly: false,
        managersOnly: true,
    },
    {
        key: "onlineBooking",
        get label() {
            return strings.navigation.setupSections.onlineBooking;
        },
        webOnly: false,
        managersOnly: true,
    },
    {
        key: "reminders",
        get label() {
            return strings.navigation.setupSections.reminders;
        },
        webOnly: false,
        managersOnly: true,
    },
    {
        key: "security",
        get label() {
            return strings.navigation.setupSections.security;
        },
        webOnly: false,
        managersOnly: false,
    },
];

export function setupSectionsFor(
    platform: "web" | "mobile",
    role: string | null,
): typeof SETUP_SECTIONS {
    return SETUP_SECTIONS.filter(
        (s) =>
            (platform === "web" || !s.webOnly) &&
            (!s.managersOnly || canManagePayments(role)) &&
            (s.ownerOnly !== true || role === "owner"),
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
    | "setup"
    | "taxes"
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

// The phone fan keeps the everyday few; Clients and Inbox have their own add.
const QUICK_CREATE: readonly CreateKey[] = ["booking", "sale", "invoice", "timeOff"];

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

export const VIEWER_STAFF_SQL = `SELECT ${staffNameSql("staff")} AS name, title, role, color FROM staff WHERE id = ?`;

export const UNREAD_MESSAGES_SQL =
    "SELECT COUNT(*) AS n FROM messages WHERE direction = 'in' AND status != 'read'";

export const OVERDUE_INVOICES_SQL = `SELECT COUNT(*) AS n FROM invoices i WHERE ${invoiceStatusSql("i")} = 'overdue'`;

interface ShellNav {
    name: string;
    color: string | null;
    brandColor: string | null;
    roleLabel: string;
    badges: Partial<Record<DestinationKey, number>>;
    create: CreateAction[];
    quickCreate: CreateAction[];
    setup: SetupProgress;
    // Staff don't see setup progress: most steps are the owner's.
    showSetup: boolean;
}

/** Everything the sidebar or tab bar shows beside the destinations, for the signed-in member. */
export function useShellNav(viewer: Viewer | null): ShellNav {
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
    const setup = useSetupProgress();
    return {
        name: me === undefined ? "" : staffName(me),
        color: me?.color ?? null,
        brandColor: setup.brandColor,
        roleLabel: roleLabel(role),
        badges: { inbox: unread, ...(manager ? { payments: overdue } : {}) },
        create: createActionsFor(role),
        quickCreate: createActionsFor(role).filter((a) => QUICK_CREATE.includes(a.key)),
        setup,
        showSetup: manager && !setup.complete && !setup.dismissed,
    };
}
