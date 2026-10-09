import { useBusinessQuery as useQuery } from "../hooks";

import { useMemo, useState } from "react";

import type { ApiLike } from "../api";
import { addDays, parseTimestamp, relativeDayTime, stampLabel, startOfDay } from "../datetime";
import { formatMoney } from "../format";
import type { Load } from "../hooks";
import type { IconName } from "../icons";
import { strings } from "../strings";
import type { Intent } from "../ui";
import type { Viewer } from "./auth";
import { invoiceStatusSql } from "./ledger";
import type { ShellTarget } from "./navigation";
import { canManagePayments } from "./payments";
import { useDeviceList, useDevicePref, useReplicaLoad } from "./sync";

export type DevicePlatform = "ios" | "android" | "web";

export function registerDevice(
    api: ApiLike,
    token: string,
    platform: DevicePlatform,
): Promise<unknown> {
    return api.post("/v1/devices/register", { token, platform });
}

type NotificationKind =
    | "payment"
    | "deposit"
    | "refund"
    | "booking_new"
    | "booking_canceled"
    | "message"
    | "review"
    | "invoice_overdue";

interface FeedRow {
    id: string;
    kind: NotificationKind;
    at: string;
    client_id: string | null;
    client_name: string | null;
    amount_cents: number | null;
    item_name: string | null;
    rating: number | null;
    number: number | null;
    body: string | null;
    ref_id: string;
    starts_at: string | null;
}

const since = (column: string): string =>
    `datetime(CASE WHEN ${column} LIKE '%+__' THEN ${column} || ':00' ELSE ${column} END) >= datetime(?)`;

// Derived from synced rows, so each member only sees what their sync bucket holds. Six `since` params.
export const NOTIFICATION_FEED_SQL = `
SELECT 'pay-' || p.id AS id,
       CASE p.kind WHEN 'refund' THEN 'refund' WHEN 'deposit' THEN 'deposit' ELSE 'payment' END AS kind,
       COALESCE(p.paid_at, p.created_at) AS at, p.client_id, c.name AS client_name,
       p.amount_cents, NULL AS item_name, NULL AS rating, NULL AS number, NULL AS body,
       p.id AS ref_id, NULL AS starts_at
FROM payments p LEFT JOIN clients c ON c.id = p.client_id
WHERE p.status = 'succeeded' AND ${since("COALESCE(p.paid_at, p.created_at)")}
UNION ALL
SELECT 'bk-' || b.id, 'booking_new', b.created_at, b.client_id, c.name, NULL, i.name, NULL, NULL,
       NULL, b.id, s.starts_at
FROM bookings b JOIN slots s ON s.id = b.slot_id JOIN items i ON i.id = s.item_id
LEFT JOIN clients c ON c.id = b.client_id
WHERE b.source = 'online' AND b.deleted_at IS NULL AND ${since("b.created_at")}
UNION ALL
SELECT 'bkc-' || b.id, 'booking_canceled', b.canceled_at, b.client_id, c.name, NULL, i.name, NULL,
       NULL, NULL, b.id, s.starts_at
FROM bookings b JOIN slots s ON s.id = b.slot_id JOIN items i ON i.id = s.item_id
LEFT JOIN clients c ON c.id = b.client_id
WHERE b.status = 'canceled' AND b.canceled_at IS NOT NULL AND ${since("b.canceled_at")}
UNION ALL
SELECT 'msg-' || m.id, 'message', m.created_at, t.client_id, c.name, NULL, NULL, NULL, NULL, m.body,
       m.thread_id, NULL
FROM messages m JOIN threads t ON t.id = m.thread_id LEFT JOIN clients c ON c.id = t.client_id
WHERE m.direction = 'in' AND ${since("m.created_at")}
UNION ALL
SELECT 'rv-' || r.id, 'review', COALESCE(r.submitted_at, r.created_at), r.client_id, c.name, NULL,
       NULL, r.rating, NULL, r.body, r.id, NULL
FROM reviews r LEFT JOIN clients c ON c.id = r.client_id
WHERE r.status IN ('submitted', 'published', 'hidden')
  AND ${since("COALESCE(r.submitted_at, r.created_at)")}
UNION ALL
SELECT 'inv-' || i.id, 'invoice_overdue', i.overdue_notified_at, i.client_id, c.name, NULL, NULL,
       NULL, i.number, NULL, i.id, NULL
FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
WHERE i.overdue_notified_at IS NOT NULL AND ${invoiceStatusSql("i")} = 'overdue'
  AND ${since("i.overdue_notified_at")}`;

export const MY_CLIENTS_SQL =
    "SELECT DISTINCT client_id FROM bookings WHERE staff_id = ? AND deleted_at IS NULL";

type NotificationCategory = "bookings" | "payments" | "messages" | "reviews";

const META: Record<
    NotificationKind,
    { category: NotificationCategory; icon: IconName; intent: Intent; link: ShellTarget }
> = {
    payment: { category: "payments", icon: "dollar", intent: "success", link: "payments" },
    deposit: { category: "payments", icon: "dollar", intent: "success", link: "schedule" },
    refund: { category: "payments", icon: "refresh", intent: "neutral", link: "payments" },
    booking_new: { category: "bookings", icon: "calendar", intent: "accent", link: "schedule" },
    booking_canceled: {
        category: "bookings",
        icon: "calendar",
        intent: "neutral",
        link: "schedule",
    },
    message: { category: "messages", icon: "inbox", intent: "accent", link: "inbox" },
    review: { category: "reviews", icon: "star", intent: "warning", link: "reviews" },
    invoice_overdue: { category: "payments", icon: "receipt", intent: "danger", link: "invoice" },
};

interface NotificationItem {
    id: string;
    kind: NotificationKind;
    category: NotificationCategory;
    icon: IconName;
    intent: Intent;
    title: string;
    body: string;
    when: string;
    at: Date;
    read: boolean;
    link: ShellTarget;
    refId: string;
}

interface NotificationGroup {
    key: "today" | "yesterday" | "earlier";
    label: string;
    items: NotificationItem[];
}

function describeRow(row: FeedRow): { title: string; body: string } {
    const n = strings.notifications.kinds;
    const client = row.client_name ?? strings.notifications.someone;
    const amount = formatMoney(row.amount_cents);
    const when = row.starts_at === null ? "" : relativeDayTime(parseTimestamp(row.starts_at));
    switch (row.kind) {
        case "payment":
            return { title: n.payment, body: n.paymentBody(client, amount) };
        case "deposit":
            return { title: n.deposit, body: n.depositBody(client, amount) };
        case "refund":
            return { title: n.refund, body: n.refundBody(client, amount) };
        case "booking_new":
            return { title: n.bookingNew, body: n.bookingBody(client, row.item_name ?? "", when) };
        case "booking_canceled":
            return {
                title: n.bookingCanceled,
                body: n.bookingBody(client, row.item_name ?? "", when),
            };
        case "message":
            return { title: n.message(client), body: row.body ?? "" };
        case "review":
            return {
                title: n.review(row.rating ?? 0),
                body: row.body ? n.reviewBody(client, row.body) : client,
            };
        default:
            return { title: n.overdue(row.number ?? 0), body: n.overdueBody(client) };
    }
}

function notificationItems(
    rows: FeedRow[],
    read: ReadonlySet<string>,
    seenAt: Date | null,
    now: Date,
): NotificationItem[] {
    return rows
        .map((row) => {
            const at = parseTimestamp(row.at);
            const meta = META[row.kind];
            return {
                id: row.id,
                kind: row.kind,
                ...meta,
                ...describeRow(row),
                when: stampLabel(at, now),
                at,
                read: read.has(row.id) || (seenAt !== null && at <= seenAt),
                refId: row.ref_id,
            };
        })
        .filter((n) => n.at <= now)
        .sort((a, b) => b.at.getTime() - a.at.getTime());
}

export interface NotificationsView {
    load: Load;
    groups: NotificationGroup[];
    unread: number;
    filter: "all" | "unread";
    setFilter: (f: "all" | "unread") => void;
    markRead: (id: string) => void;
    markAllRead: () => void;
}

const FEED_DAYS = 7;

/** The bell: what happened in the last week, from this member's synced rows, read state per device. */
export function useNotifications(viewer: Viewer | null): NotificationsView {
    const [now] = useState(() => new Date());
    const from = startOfDay(addDays(now, -FEED_DAYS)).toISOString();
    const feed = useQuery<FeedRow>(NOTIFICATION_FEED_SQL, [from, from, from, from, from, from]);
    const manager = canManagePayments(viewer?.role ?? null);
    const mine = useQuery<{ client_id: string }>(MY_CLIENTS_SQL, [viewer?.staffId ?? ""]).data;
    const [readIds, setReadIds] = useDeviceList("notifications.read", 200);
    const [seenRaw, setSeen] = useDevicePref("notifications.seenAt");
    const [filter, setFilter] = useState<"all" | "unread">("all");
    const items = useMemo(() => {
        const clients = new Set(mine.map((r) => r.client_id));
        const rows = manager
            ? feed.data
            : feed.data.filter((r) => r.kind !== "message" || clients.has(r.client_id ?? ""));
        // Before the first "mark all read" on this device, only the last day counts as new.
        const seen = seenRaw === null ? addDays(now, -1) : new Date(seenRaw);
        return notificationItems(rows, new Set(readIds), seen, now);
    }, [feed.data, mine, manager, readIds, seenRaw, now]);
    const shown = filter === "all" ? items : items.filter((n) => !n.read);
    const today = startOfDay(now).getTime();
    const yesterday = startOfDay(addDays(now, -1)).getTime();
    const bucket = (n: NotificationItem): NotificationGroup["key"] =>
        n.at.getTime() >= today ? "today" : n.at.getTime() >= yesterday ? "yesterday" : "earlier";
    const groups = (["today", "yesterday", "earlier"] as const)
        .map((key) => ({
            key,
            label: strings.notifications.groups[key],
            items: shown.filter((n) => bucket(n) === key),
        }))
        .filter((g) => g.items.length > 0);
    const load = useReplicaLoad([feed], items.length === 0);
    return {
        load,
        groups,
        unread: items.filter((n) => !n.read).length,
        filter,
        setFilter,
        markRead: (id) => {
            if (!readIds.includes(id)) setReadIds([id, ...readIds]);
        },
        markAllRead: () => {
            setSeen(new Date().toISOString());
            setReadIds([]);
        },
    };
}
