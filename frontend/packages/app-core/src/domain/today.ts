import { useBusinessQuery as useQuery } from "../hooks";

import { useMemo, useState } from "react";

import { strings } from "../strings";
import type { ApiLike } from "../api";
import {
    addDays,
    combineDayAndTime,
    daysUntil,
    formatHour,
    formatMonthDay,
    formatTime,
    formatWeekday,
    parseTimestamp,
    startOfDay,
} from "../datetime";
import { firstName, formatMoney } from "../format";
import { type Load, type Remote, useAsyncAction, useRemote } from "../hooks";
import type { IconName } from "../icons";
import type { Intent } from "../ui";
import type { Viewer } from "./auth";
import { useInvoices } from "./billing";
import { utcSql } from "../datetime";
import { useCatalogItems } from "./catalog";
import { useEarnings } from "./earnings";
import { useThreads } from "./messaging";
import { canManagePayments, isRefundRow } from "./payments";
import { useReviews } from "./reviews";
import { staffName, useStaff } from "./staff";
import { useReplicaLoad } from "./sync";
import { type ShellTarget, VIEWER_STAFF_SQL } from "./navigation";

const MIN = 60_000;

interface TodaySummary {
    today_revenue_cents: number;
    awaiting_payment_cents: number;
    gst_hst_set_aside_cents: number;
    gst_hst_filing_due: string | null;
}

/** The server's money figures for Today; owners and admins only, so staff screens never call it. */
function useTodaySummary(api: ApiLike): Remote<TodaySummary> {
    return useRemote(() => api.get<TodaySummary>("/v1/dashboard/summary"));
}

interface AgendaRow {
    slot_id: string;
    starts_at: string;
    ends_at: string;
    staff_id: string;
    capacity: number;
    item_name: string;
    item_kind: string;
    item_color: string | null;
    item_price_cents: number | null;
    booking_id: string | null;
    booking_status: string | null;
    price_cents: number | null;
    client_id: string | null;
    client_name: string | null;
    client_phone: string | null;
    deposit_amount_cents: number | null;
    deposit_status: string | null;
    checked_in_at: string | null;
    staff_name: string | null;
    staff_title: string | null;
    staff_role: string | null;
    staff_color: string | null;
}

// Params: range end, range start (ISO). Canceled bookings drop out; a class slot keeps one row per seat.
export const AGENDA_SQL = `
SELECT s.id AS slot_id, s.starts_at, s.ends_at, s.staff_id, s.capacity,
       i.name AS item_name, i.kind AS item_kind, i.color AS item_color,
       i.price_cents AS item_price_cents,
       b.id AS booking_id, b.status AS booking_status, b.price_cents, b.client_id,
       c.name AS client_name, c.phone AS client_phone,
       b.deposit_amount_cents, b.deposit_status, b.checked_in_at,
       st.name AS staff_name, st.title AS staff_title, st.role AS staff_role, st.color AS staff_color
FROM slots s
JOIN items i ON i.id = s.item_id
LEFT JOIN bookings b ON b.slot_id = s.id AND b.deleted_at IS NULL AND b.status != 'canceled'
LEFT JOIN clients c ON c.id = b.client_id
LEFT JOIN staff st ON st.id = s.staff_id
WHERE s.status != 'canceled'
  AND ${utcSql("s.starts_at")} < datetime(?)
  AND ${utcSql("s.ends_at")} > datetime(?)
ORDER BY ${utcSql("s.starts_at")}, s.id`;

type AgendaState = "done" | "now" | "next" | "later" | "no_show";

export interface AgendaItem {
    id: string;
    slotId: string;
    bookingId: string | null;
    start: Date;
    end: Date;
    state: AgendaState;
    time: string;
    endTime: string;
    clientId: string | null;
    clientName: string;
    clientPhone: string | null;
    serviceName: string;
    staffId: string;
    staffName: string;
    staffColor: string | null;
    color: string | null;
    priceCents: number;
    isClass: boolean;
    depositDue: boolean;
    depositAmountCents: number;
    depositPaidCents: number;
    checkedIn: boolean;
    minutesAway: number;
}

const isClassRow = (r: AgendaRow): boolean => r.item_kind === "class" || r.capacity > 1;

/** Today's visits in time order with now/next state; a class is one row however many are booked. */
export function buildAgenda(rows: AgendaRow[], now: Date): AgendaItem[] {
    const bySlot = new Map<string, AgendaRow[]>();
    for (const r of rows) bySlot.set(r.slot_id, [...(bySlot.get(r.slot_id) ?? []), r]);
    const items: Omit<AgendaItem, "state">[] = [];
    for (const group of bySlot.values()) {
        const first = group[0];
        if (first === undefined) continue;
        const seats = group.filter((r) => r.booking_id !== null);
        const asItem = (r: AgendaRow, isClass: boolean): Omit<AgendaItem, "state"> => {
            const start = parseTimestamp(r.starts_at);
            const end = parseTimestamp(r.ends_at);
            const paid = r.deposit_status === "collected" || r.deposit_status === "applied";
            const staff = { name: r.staff_name, title: r.staff_title, role: r.staff_role ?? "" };
            return {
                id: isClass ? r.slot_id : (r.booking_id ?? r.slot_id),
                slotId: r.slot_id,
                bookingId: isClass ? null : r.booking_id,
                start,
                end,
                time: formatTime(start),
                endTime: formatTime(end),
                clientId: isClass ? null : r.client_id,
                clientName: isClass ? r.item_name : (r.client_name ?? ""),
                clientPhone: isClass ? null : r.client_phone,
                serviceName: isClass
                    ? strings.today.classBooked(seats.length, r.capacity)
                    : r.item_name,
                staffId: r.staff_id,
                staffName: staffName(staff),
                staffColor: r.staff_color,
                color: r.item_color,
                priceCents: isClass
                    ? seats.reduce((n, s) => n + (s.price_cents ?? s.item_price_cents ?? 0), 0)
                    : (r.price_cents ?? r.item_price_cents ?? 0),
                isClass,
                depositDue: !isClass && r.deposit_status === "pending",
                depositAmountCents: r.deposit_amount_cents ?? 0,
                depositPaidCents: isClass || !paid ? 0 : (r.deposit_amount_cents ?? 0),
                checkedIn: !isClass && r.checked_in_at !== null,
                minutesAway: Math.round((start.getTime() - now.getTime()) / MIN),
            };
        };
        if (isClassRow(first)) items.push(asItem(first, true));
        else for (const r of seats) items.push(asItem(r, false));
    }
    const status = new Map(rows.map((r) => [r.booking_id ?? r.slot_id, r.booking_status]));
    let nextSeen = false;
    return items
        .sort((a, b) => a.start.getTime() - b.start.getTime())
        .map((item) => {
            const booking = status.get(item.id) ?? null;
            let state: AgendaState = "later";
            if (booking === "completed" || item.end <= now) state = "done";
            else if (booking === "no_show") state = "no_show";
            else if (item.start <= now) state = "now";
            else if (!nextSeen) {
                state = "next";
                nextSeen = true;
            }
            return { ...item, state };
        });
}

function useAgendaRows(day: Date, staffId: string | null) {
    const start = startOfDay(day);
    const params = [addDays(start, 1).toISOString(), start.toISOString()];
    const result = useQuery<AgendaRow>(AGENDA_SQL, params);
    const rows = useMemo(
        () => (staffId === null ? result.data : result.data.filter((r) => r.staff_id === staffId)),
        [result.data, staffId],
    );
    return { result, rows };
}

export interface AttentionItem {
    key: string;
    intent: Intent;
    icon: IconName;
    title: string;
    detail: string;
    action: string;
    // "send" acts in place (a reminder); "open" goes to the screen that resolves it.
    act: "send" | "open";
    target: ShellTarget;
    // The record the action works on (an invoice to resend, a booking to open).
    refId: string | null;
}

export interface TeamDay {
    staffId: string;
    name: string;
    color: string | null;
    hours: string | null;
    bookings: number;
}

export interface TodayView {
    greeting: string;
    dateLabel: string;
    nowLabel: string;
    agenda: AgendaItem[];
    current: AgendaItem | null;
    next: AgendaItem | null;
    done: number;
    remaining: number;
    expectedCents: number;
    attention: AttentionItem[];
    team: TeamDay[];
}

export function greeting(hour: number, name: string): string {
    const part =
        hour < 12
            ? strings.today.goodMorning
            : hour < 17
              ? strings.today.goodAfternoon
              : strings.today.goodEvening;
    return name.length > 0 ? strings.today.greetingNamed(part, firstName(name)) : part;
}

export const TODAY_HOURS_SQL = `
SELECT staff_id, start_time, end_time, available FROM hours
WHERE basis = 'recurring' AND weekday = ?`;

interface HoursRow {
    staff_id: string;
    start_time: string | null;
    end_time: string | null;
    available: number;
}

/** Monday 0 … Sunday 6, the server's weekday numbering. */
const isoWeekday = (d: Date): number => (d.getDay() + 6) % 7;

function clock(hhmm: string, day: Date): Date {
    const [h = 0, m = 0] = hhmm.split(":").map(Number);
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
}

const shortClock = (d: Date): string =>
    d.getMinutes() === 0 ? formatHour(d.getHours()) : formatTime(d);

function hoursLabel(row: HoursRow | undefined, day: Date): string | null {
    if (row?.available !== 1 || row.start_time === null || row.end_time === null) return null;
    return strings.today.hoursValue(
        shortClock(clock(row.start_time, day)),
        shortClock(clock(row.end_time, day)),
    );
}

function useTodayHours(day: Date) {
    const result = useQuery<HoursRow>(TODAY_HOURS_SQL, [isoWeekday(day)]);
    return result;
}

const OPEN_INVOICE = new Set(["sent", "partial", "overdue"]);

function ownerAttention(input: {
    agenda: AgendaItem[];
    invoices: ReturnType<typeof useInvoices>;
    threads: ReturnType<typeof useThreads>;
    reviews: ReturnType<typeof useReviews>;
    items: ReturnType<typeof useCatalogItems>;
    pendingEarnings: { count: number; cents: number };
    filingDue: Date | null;
    filingCents: number;
    now: Date;
}): AttentionItem[] {
    const a = strings.today.attention;
    const out: AttentionItem[] = [];
    for (const item of input.agenda) {
        if (!item.depositDue || item.state === "done" || item.state === "no_show") continue;
        out.push({
            key: `dep-${item.id}`,
            intent: "warning",
            icon: "dollar",
            title: a.depositTitle,
            detail: a.depositDetail(
                item.clientName,
                formatMoney(item.depositAmountCents),
                item.time,
            ),
            action: a.depositAction,
            act: "open",
            target: "schedule",
            refId: item.bookingId,
        });
    }
    for (const inv of input.invoices.filter((i) => i.status === "overdue")) {
        const late = inv.due_at === null ? 0 : -daysUntil(parseTimestamp(inv.due_at), input.now);
        out.push({
            key: `inv-${inv.id}`,
            intent: "danger",
            icon: "receipt",
            title: a.overdueTitle(inv.number ?? 0),
            detail: a.overdueDetail(
                inv.client_name ?? "",
                formatMoney(inv.balance_cents),
                Math.max(late, 0),
            ),
            action: a.overdueAction,
            act: "send",
            target: "invoice",
            refId: inv.id,
        });
    }
    const unread = input.threads.filter((t) => t.unread_count > 0);
    if (unread.length > 0) {
        out.push({
            key: "unread",
            intent: "accent",
            icon: "inbox",
            title: a.unreadTitle(unread.reduce((n, t) => n + t.unread_count, 0)),
            detail: a.unreadDetail(unread.map((t) => firstName(t.client_name ?? "")).slice(0, 3)),
            action: a.unreadAction,
            act: "open",
            target: "inbox",
            refId: null,
        });
    }
    for (const r of input.reviews.filter((rv) => rv.response === null && rv.rating <= 3)) {
        out.push({
            key: `rv-${r.id}`,
            intent: "warning",
            icon: "star",
            title: a.reviewTitle(r.rating),
            detail: r.client_name ?? "",
            action: a.reviewAction,
            act: "open",
            target: "reviews",
            refId: r.id,
        });
    }
    const low = input.items.filter(
        (i) =>
            i.active === 1 &&
            i.track_stock === 1 &&
            i.low_stock_at !== null &&
            (i.stock_on_hand ?? 0) <= i.low_stock_at,
    );
    const [l1, l2] = low;
    if (l1 !== undefined) {
        out.push({
            key: "stock",
            intent: "neutral",
            icon: "box",
            title: l2 === undefined ? a.stockTitle(l1.name) : a.stockManyTitle(low.length),
            detail:
                l2 === undefined
                    ? a.stockDetail(l1.stock_on_hand ?? 0, l1.low_stock_at ?? 0)
                    : a.stockManyDetail(l1.name, l2.name, low.length - 2),
            action: a.stockAction,
            act: "open",
            target: "stock",
            refId: null,
        });
    }
    if (input.filingDue !== null && daysUntil(input.filingDue, input.now) <= 30) {
        out.push({
            key: "filing",
            intent: daysUntil(input.filingDue, input.now) <= 14 ? "warning" : "neutral",
            icon: "building",
            title: a.filingTitle,
            detail: a.filingDetail(formatMoney(input.filingCents), formatMonthDay(input.filingDue)),
            action: a.filingAction,
            act: "open",
            target: "taxReturns",
            refId: null,
        });
    }
    if (input.pendingEarnings.count > 0) {
        out.push({
            key: "earnings",
            intent: "accent",
            icon: "user",
            title: a.earningsTitle,
            detail: a.earningsDetail(
                input.pendingEarnings.count,
                formatMoney(input.pendingEarnings.cents),
            ),
            action: a.earningsAction,
            act: "open",
            target: "staffPay",
            refId: null,
        });
    }
    for (const inv of input.invoices.filter((i) => i.status === "draft")) {
        out.push({
            key: `drf-${inv.id}`,
            intent: "neutral",
            icon: "edit",
            title: a.draftTitle,
            detail: a.draftDetail(inv.client_name ?? "", formatMoney(inv.total_cents)),
            action: a.draftAction,
            act: "open",
            target: "invoice",
            refId: inv.id,
        });
    }
    return out;
}

function staffAttention(
    agenda: AgendaItem[],
    threads: ReturnType<typeof useThreads>,
): AttentionItem[] {
    const mine = new Set(agenda.map((a) => a.clientId).filter((id) => id !== null));
    const unread = threads.filter((t) => t.unread_count > 0 && mine.has(t.client_id));
    if (unread.length === 0) return [];
    const a = strings.today.attention;
    return [
        {
            key: "unread",
            intent: "accent",
            icon: "inbox",
            title: a.unreadTitle(unread.reduce((n, t) => n + t.unread_count, 0)),
            detail: a.unreadDetail(unread.map((t) => firstName(t.client_name ?? "")).slice(0, 3)),
            action: a.unreadAction,
            act: "open",
            target: "inbox",
            refId: null,
        },
    ];
}

interface TodayMoney {
    collectedCents: number;
    paymentCount: number;
    awaitingCents: number;
    awaitingCount: number;
    setAsideCents: number;
    filingDue: Date | null;
    filingDays: number | null;
}

export const TODAY_PAYMENTS_SQL = `
SELECT id, kind FROM payments
WHERE status = 'succeeded' AND ${utcSql("COALESCE(paid_at, created_at)")} >= datetime(?)`;

export interface OwnerToday {
    load: Load;
    view: TodayView;
    money: TodayMoney;
    // The server figures load on their own, so a failed call leaves the schedule usable.
    moneyLoad: Load;
}

function useTodayNow(): Date {
    const [now] = useState(() => new Date());
    return now;
}

function useTodayView(viewer: Viewer | null, now: Date) {
    const me = useQuery<{ name: string | null; title: string | null; role: string }>(
        VIEWER_STAFF_SQL,
        [viewer?.staffId ?? ""],
    ).data[0];
    const viewerName = me?.name ?? "";
    const manager = canManagePayments(viewer?.role ?? null);
    const scopeTo = manager ? null : (viewer?.staffId ?? "");
    const { result, rows } = useAgendaRows(now, scopeTo);
    const hours = useTodayHours(now);
    const staff = useStaff();
    const agenda = useMemo(() => buildAgenda(rows, now), [rows, now]);
    const team = useMemo<TeamDay[]>(
        () =>
            staff.map((s) => ({
                staffId: s.id,
                name: staffName(s),
                color: s.color,
                hours: hoursLabel(
                    hours.data.find((h) => h.staff_id === s.id),
                    now,
                ),
                bookings: agenda.filter((a) => a.staffId === s.id).length,
            })),
        [staff, hours.data, agenda, now],
    );
    const upcoming = agenda.filter(
        (a) => a.state === "now" || a.state === "next" || a.state === "later",
    );
    return {
        result,
        agenda,
        team,
        base: {
            greeting: greeting(now.getHours(), viewerName),
            dateLabel: `${now.toLocaleDateString("en-CA", { weekday: "long" })}, ${formatMonthDay(now)}`,
            nowLabel: formatTime(now),
            agenda,
            current: agenda.find((a) => a.state === "now") ?? null,
            next: agenda.find((a) => a.state === "next") ?? null,
            done: agenda.filter((a) => a.state === "done").length,
            remaining: upcoming.length,
            expectedCents: upcoming.reduce((n, a) => n + a.priceCents - a.depositPaidCents, 0),
            team,
        },
    };
}

/** The owner's Today: the agenda, what needs them and the money figures, from one hook. */
export function useOwnerToday(api: ApiLike, viewer: Viewer | null): OwnerToday {
    const now = useTodayNow();
    const { result, agenda, base } = useTodayView(viewer, now);
    const invoices = useInvoices();
    const threads = useThreads();
    const reviews = useReviews();
    const items = useCatalogItems();
    const earnings = useEarnings();
    const summary = useTodaySummary(api);
    const payments = useQuery<{ id: string; kind: string }>(TODAY_PAYMENTS_SQL, [
        startOfDay(now).toISOString(),
    ]);
    const s = summary.data;
    const filingDue = s?.gst_hst_filing_due
        ? combineDayAndTime(s.gst_hst_filing_due, "00:00")
        : null;
    const open = invoices.filter((i) => OPEN_INVOICE.has(i.status) && (i.balance_cents ?? 0) > 0);
    const pending = earnings.filter((e) => e.status === "pending");
    const attention = ownerAttention({
        agenda,
        invoices,
        threads,
        reviews,
        items,
        pendingEarnings: {
            count: pending.length,
            cents: pending.reduce((n, e) => n + e.amount_cents, 0),
        },
        filingDue,
        filingCents: s?.gst_hst_set_aside_cents ?? 0,
        now,
    });
    const load = useReplicaLoad([result], agenda.length === 0 && attention.length === 0);
    const moneyLoad = useReplicaLoad([summary], false);
    return {
        load,
        moneyLoad,
        view: { ...base, attention },
        money: {
            collectedCents: s?.today_revenue_cents ?? 0,
            paymentCount: payments.data.filter((p) => !isRefundRow(p)).length,
            awaitingCents: s?.awaiting_payment_cents ?? 0,
            awaitingCount: open.length,
            setAsideCents: s?.gst_hst_set_aside_cents ?? 0,
            filingDue,
            filingDays: filingDue === null ? null : daysUntil(filingDue, now),
        },
    };
}

export interface StaffToday {
    load: Load;
    view: TodayView;
    day: StaffDay;
}

interface StaffDay {
    hours: string | null;
    endsAt: string | null;
    earnedCents: number;
    gaps: { after: string; from: string; to: string }[];
    tomorrow: number;
    lastVisit: string | null;
}

export const CLIENT_LAST_VISIT_SQL = `
SELECT s.starts_at FROM bookings b JOIN slots s ON s.id = b.slot_id
WHERE b.client_id = ? AND b.status = 'completed' AND b.deleted_at IS NULL
  AND ${utcSql("s.starts_at")} < datetime(?)
ORDER BY ${utcSql("s.starts_at")} DESC LIMIT 1`;

/** A staff member's Today: their own visits, the next client, free gaps and what they've earned. */
export function useStaffToday(viewer: Viewer | null): StaffToday {
    const now = useTodayNow();
    const { result, agenda, base } = useTodayView(viewer, now);
    const threads = useThreads();
    const hours = useTodayHours(now);
    const tomorrow = useAgendaRows(addDays(now, 1), viewer?.staffId ?? "");
    const earnings = useEarnings();
    const next = base.current ?? base.next;
    const last = useQuery<{ starts_at: string }>(CLIENT_LAST_VISIT_SQL, [
        next?.clientId ?? "",
        startOfDay(now).toISOString(),
    ]).data[0];
    const attention = useMemo(() => staffAttention(agenda, threads), [agenda, threads]);
    const mine = hours.data.find((h) => h.staff_id === viewer?.staffId);
    const gaps: StaffDay["gaps"] = [];
    for (let i = 0; i < agenda.length - 1; i++) {
        const a = agenda[i];
        const b = agenda[i + 1];
        if (a && b && b.start.getTime() - a.end.getTime() >= 60 * MIN) {
            gaps.push({ after: a.id, from: formatTime(a.end), to: formatTime(b.start) });
        }
    }
    const lastAt = last === undefined ? null : parseTimestamp(last.starts_at);
    const load = useReplicaLoad([result], agenda.length === 0 && attention.length === 0);
    return {
        load,
        view: { ...base, attention },
        day: {
            hours: hoursLabel(mine, now),
            endsAt:
                mine?.available === 1 && mine.end_time !== null
                    ? formatTime(clock(mine.end_time, now))
                    : null,
            earnedCents: earnings
                .filter(
                    (e) =>
                        e.staff_id === viewer?.staffId &&
                        (e.status === "pending" || e.status === "approved"),
                )
                .reduce((n, e) => n + e.amount_cents, 0),
            gaps,
            tomorrow: new Set(tomorrow.rows.map((r) => r.slot_id)).size,
            lastVisit:
                lastAt === null ? null : `${formatWeekday(lastAt)} ${formatMonthDay(lastAt)}`,
        },
    };
}

export interface TodayActions {
    sent: ReadonlySet<string>;
    busyKey: string | null;
    error: string | null;
    checkIn: (bookingId: string) => void;
    // Sends the reminder an attention item offers (an overdue invoice is sent again).
    send: (item: AttentionItem) => void;
}

function checkInBooking(api: ApiLike, bookingId: string): Promise<unknown> {
    return api.post(`/v1/bookings/${bookingId}/check-in`, {});
}

export function useTodayActions(api: ApiLike): TodayActions {
    const [sent, setSent] = useState<ReadonlySet<string>>(new Set());
    const [busyKey, setBusyKey] = useState<string | null>(null);
    const { busy, error, run } = useAsyncAction();
    const go = (key: string, call: () => Promise<unknown>, done?: () => void): void => {
        setBusyKey(key);
        run(call, {
            onSuccess: done ?? (() => undefined),
            errorMessage: strings.today.actionError,
        });
    };
    return {
        sent,
        busyKey: busy ? busyKey : null,
        error,
        checkIn: (bookingId) => {
            go(bookingId, () => checkInBooking(api, bookingId));
        },
        send: (item) => {
            if (item.refId === null || sent.has(item.key)) return;
            const id = item.refId;
            go(
                item.key,
                () => api.post(`/v1/invoices/${id}/send`, {}),
                () => {
                    setSent((c) => new Set(c).add(item.key));
                },
            );
        },
    };
}

/** The one action a visit offers: check in before it starts, then checkout; nothing once done. */
export function visitAction(item: AgendaItem): "checkIn" | "checkout" | null {
    if (item.state === "done" || item.state === "no_show" || item.isClass) return null;
    return item.state === "now" || item.checkedIn ? "checkout" : "checkIn";
}
