import { useBusinessQuery as useQuery } from "../hooks";

import { useMemo, useState } from "react";

import { formatTime, parseTimestamp, sameDay, startOfDay, weekdayDay } from "../datetime";
import { formatMoney, formatPhone, phoneDigits } from "../format";
import type { Load } from "../hooks";
import type { IconName } from "../icons";
import { strings } from "../strings";
import type { Intent } from "../ui";
import type { Viewer } from "./auth";
import { invoiceStatusSql } from "./ledger";
import { utcSql } from "../datetime";
import { type CreateAction, type ShellTarget, createActionsFor } from "./navigation";
import { canManagePayments } from "./payments";
import { staffName } from "./staff";
import { useDeviceList, useReplicaLoad } from "./sync";

export type SearchKind = "actions" | "clients" | "bookings" | "invoices" | "items";

export interface SearchHit {
    id: string;
    kind: SearchKind;
    title: string;
    detail: string;
    icon: IconName;
    // The service or item colour the row shows, when it has one.
    color: string | null;
    meta: string | null;
    metaIntent: Intent | null;
    target: ShellTarget;
    // The record to open (a client, booking, invoice or item); null for a screen.
    refId: string | null;
}

interface SearchGroup {
    kind: SearchKind;
    label: string;
    hits: SearchHit[];
    total: number;
}

export const SEARCH_CLIENTS_SQL =
    "SELECT id, name, email, phone, status FROM clients WHERE status = 'active' ORDER BY name COLLATE NOCASE";

// Param: the start of today (ISO); earlier visits are found through the client.
export const SEARCH_BOOKINGS_SQL = `
SELECT b.id, s.starts_at, i.name AS item_name, i.color AS item_color, c.name AS client_name,
       st.name AS staff_name, st.title AS staff_title, st.role AS staff_role
FROM bookings b JOIN slots s ON s.id = b.slot_id JOIN items i ON i.id = s.item_id
LEFT JOIN clients c ON c.id = b.client_id LEFT JOIN staff st ON st.id = b.staff_id
WHERE b.deleted_at IS NULL AND b.status != 'canceled' AND ${utcSql("s.starts_at")} >= datetime(?)
ORDER BY ${utcSql("s.starts_at")} LIMIT 300`;

export const SEARCH_INVOICES_SQL = `
SELECT i.id, i.number, ${invoiceStatusSql("i")} AS status, i.total_cents, c.name AS client_name
FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
ORDER BY COALESCE(i.issued_at, i.created_at) DESC`;

export const SEARCH_ITEMS_SQL = `
SELECT id, kind, name, category, sku, duration_min, price_cents, color FROM items
WHERE active = 1 ORDER BY name COLLATE NOCASE`;

interface ClientHitRow {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    status: string;
}

interface BookingHitRow {
    id: string;
    starts_at: string;
    item_name: string;
    item_color: string | null;
    client_name: string | null;
    staff_name: string | null;
    staff_title: string | null;
    staff_role: string | null;
}

interface InvoiceHitRow {
    id: string;
    number: number | null;
    status: string;
    total_cents: number | null;
    client_name: string | null;
}

interface ItemHitRow {
    id: string;
    kind: string;
    name: string;
    category: string | null;
    sku: string | null;
    duration_min: number | null;
    price_cents: number | null;
    color: string | null;
}

const has = (q: string, ...values: (string | null | undefined)[]): boolean =>
    values.some((v) => v?.toLowerCase().includes(q) ?? false);

const INVOICE_INTENT: Record<string, Intent> = {
    paid: "success",
    overdue: "danger",
    partial: "warning",
    sent: "warning",
};

const SEARCH_ORDER: SearchKind[] = ["actions", "clients", "bookings", "invoices", "items"];

export function searchHits(
    raw: string,
    data: {
        clients: ClientHitRow[];
        bookings: BookingHitRow[];
        invoices: InvoiceHitRow[];
        items: ItemHitRow[];
        actions: CreateAction[];
    },
    now: Date,
): Record<SearchKind, SearchHit[]> {
    const s = strings.search;
    const q = raw.trim().toLowerCase().replace(/^#/, "");
    const out: Record<SearchKind, SearchHit[]> = {
        actions: [],
        clients: [],
        bookings: [],
        invoices: [],
        items: [],
    };
    if (q.length === 0) return out;
    const digits = q.replace(/\D/g, "");
    const clients = data.clients.filter(
        (c) =>
            has(q, c.name, c.email) ||
            (digits.length >= 3 && phoneDigits(c.phone).includes(digits)),
    );
    out.clients = clients.map((c) => ({
        id: c.id,
        kind: "clients",
        icon: "user",
        color: null,
        target: "client",
        refId: c.id,
        title: c.name,
        detail: [formatPhone(c.phone), c.email].filter((v) => v !== null && v !== "").join(" · "),
        meta: c.status === "active" ? null : c.status,
        metaIntent: c.status === "active" ? null : "neutral",
    }));
    out.bookings = data.bookings
        .filter((b) => has(q, b.client_name, b.item_name, b.staff_name, b.staff_title))
        .map((b) => {
            const at = parseTimestamp(b.starts_at);
            const who = staffName({
                name: b.staff_name,
                title: b.staff_title,
                role: b.staff_role ?? "",
            });
            return {
                id: b.id,
                kind: "bookings",
                icon: "calendar",
                color: b.item_color,
                target: "booking",
                refId: b.id,
                title: b.client_name ?? b.item_name,
                detail: s.bookingLine(b.item_name, `${weekdayDay(at)}, ${formatTime(at)}`, who),
                meta: sameDay(at, now) ? strings.common.today : null,
                metaIntent: "accent",
            };
        });
    out.invoices = data.invoices
        .filter((i) => has(q, i.number === null ? null : String(i.number), i.client_name))
        .map((i) => ({
            id: i.id,
            kind: "invoices",
            icon: "invoices",
            color: null,
            target: "invoice",
            refId: i.id,
            title: i.number === null ? s.draftInvoice : s.invoiceNumber(i.number),
            detail: s.invoiceLine(i.client_name ?? "", formatMoney(i.total_cents)),
            meta: i.status,
            metaIntent: INVOICE_INTENT[i.status] ?? "neutral",
        }));
    out.items = data.items
        .filter((i) => has(q, i.name, i.sku, i.category))
        .map((i) => ({
            id: i.id,
            kind: "items",
            icon: i.kind === "product" ? "box" : i.kind === "class" ? "clients" : "tag",
            color: i.color,
            target: "catalog",
            refId: i.id,
            title: i.name,
            detail: [i.category, i.duration_min ? s.minutes(i.duration_min) : null, i.sku]
                .filter((v) => v !== null && v !== "")
                .join(" · "),
            meta: formatMoney(i.price_cents),
            metaIntent: null,
        }));
    const top = clients[0];
    const can = (key: string): boolean => data.actions.some((a) => a.key === key);
    if (top !== undefined) {
        if (can("booking"))
            out.actions.push({
                id: `book-${top.id}`,
                kind: "actions",
                icon: "calendar",
                color: null,
                target: "booking",
                refId: null,
                title: s.bookFor(top.name),
                detail: strings.navigation.createActions.booking.hint,
                meta: "B",
                metaIntent: null,
            });
        if (can("message"))
            out.actions.push({
                id: `msg-${top.id}`,
                kind: "actions",
                icon: "send",
                color: null,
                target: "message",
                refId: top.id,
                title: s.messageTo(top.name),
                detail: strings.navigation.createActions.message.hint,
                meta: "M",
                metaIntent: null,
            });
    } else if (
        q.length >= 2 &&
        /^[a-z\s'-]+$/.test(q) &&
        SEARCH_ORDER.every((k) => out[k].length === 0)
    ) {
        out.actions.push({
            id: "add-client",
            kind: "actions",
            icon: "plus",
            color: null,
            target: "client",
            refId: null,
            title: s.addClientNamed(raw.trim()),
            detail: strings.navigation.createActions.client.hint,
            meta: null,
            metaIntent: null,
        });
    }
    return out;
}

/** Splits text around the first case-insensitive match so a row can bold it. */
export function highlight(text: string, q: string): { text: string; match: boolean }[] {
    const t = q.trim().replace(/^#/, "");
    const i = t ? text.toLowerCase().indexOf(t.toLowerCase()) : -1;
    if (i < 0) return [{ text, match: false }];
    return [
        { text: text.slice(0, i), match: false },
        { text: text.slice(i, i + t.length), match: true },
        { text: text.slice(i + t.length), match: false },
    ].filter((p) => p.text.length > 0);
}

interface GlobalSearch {
    load: Load;
    q: string;
    setQ: (q: string) => void;
    scope: SearchKind | "all";
    setScope: (k: SearchKind | "all") => void;
    scopes: { key: SearchKind | "all"; label: string; count: number | null }[];
    groups: SearchGroup[];
    flat: SearchHit[];
    total: number;
    recent: string[];
    remember: (q: string) => void;
    clearRecent: () => void;
    active: number;
    move: (delta: number) => void;
    setActive: (i: number) => void;
    actions: CreateAction[];
}

const KIND_LABEL: Record<SearchKind, string> = {
    actions: strings.search.actions,
    clients: strings.search.clients,
    bookings: strings.search.bookings,
    invoices: strings.search.invoices,
    items: strings.search.items,
};

/** One search box over this device's replica, so it works offline. Invoices are managers only. */
export function useGlobalSearch(viewer: Viewer | null, perGroup = 4): GlobalSearch {
    const [now] = useState(() => new Date());
    const [q, setQRaw] = useState("");
    const [scope, setScopeRaw] = useState<SearchKind | "all">("all");
    const [active, setActive] = useState(0);
    const [recent, setRecent] = useDeviceList("search.recent", 6);
    const manager = canManagePayments(viewer?.role ?? null);
    const clients = useQuery<ClientHitRow>(SEARCH_CLIENTS_SQL);
    const bookings = useQuery<BookingHitRow>(SEARCH_BOOKINGS_SQL, [startOfDay(now).toISOString()]);
    const invoices = useQuery<InvoiceHitRow>(SEARCH_INVOICES_SQL);
    const items = useQuery<ItemHitRow>(SEARCH_ITEMS_SQL);
    const actions = useMemo(() => createActionsFor(viewer?.role ?? null), [viewer]);
    const all = useMemo(
        () =>
            searchHits(
                q,
                {
                    clients: clients.data,
                    bookings: bookings.data,
                    invoices: manager ? invoices.data : [],
                    items: items.data,
                    actions,
                },
                now,
            ),
        [q, clients.data, bookings.data, invoices.data, items.data, manager, actions, now],
    );
    const kinds = SEARCH_ORDER.filter((k) => k !== "invoices" || manager);
    const groups = kinds
        .filter((k) => scope === "all" || k === scope)
        .map((k) => ({
            kind: k,
            label: KIND_LABEL[k],
            hits: scope === "all" ? all[k].slice(0, perGroup) : all[k],
            total: all[k].length,
        }))
        .filter((g) => g.hits.length > 0);
    const flat = groups.flatMap((g) => g.hits);
    const searchable = kinds.filter((k) => k !== "actions");
    const empty =
        clients.data.length === 0 && bookings.data.length === 0 && items.data.length === 0;
    const load = useReplicaLoad([clients, bookings, invoices, items], empty);
    return {
        load,
        q,
        setQ: (v) => {
            setQRaw(v);
            setActive(0);
        },
        scope,
        setScope: (k) => {
            setScopeRaw(k);
            setActive(0);
        },
        scopes: [
            { key: "all" as const, label: strings.search.all, count: null },
            ...searchable.map((k) => ({
                key: k,
                label: KIND_LABEL[k],
                count: q.trim() ? all[k].length : null,
            })),
        ],
        groups,
        flat,
        total: searchable.reduce((n, k) => n + all[k].length, 0),
        recent,
        remember: (term) => {
            const t = term.trim();
            if (t.length > 0) setRecent([t, ...recent.filter((r) => r !== t)]);
        },
        clearRecent: () => {
            setRecent([]);
        },
        active: Math.min(active, Math.max(0, flat.length - 1)),
        move: (d) => {
            setActive((i) => (flat.length ? (i + d + flat.length) % flat.length : 0));
        },
        setActive,
        actions,
    };
}
