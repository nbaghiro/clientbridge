import { useBusinessQuery as useQuery } from "../hooks";

import { useMemo, useState } from "react";

import { strings } from "../strings";
import type { ApiLike } from "../api";
import {
    addDays,
    combineDayAndTime,
    daysUntil,
    formatClock,
    formatFullDate,
    formatHour,
    formatMonthDay,
    formatTime,
    formatWeekdayMonthDay,
    parseTimestamp,
    startOfDay,
    wallTime,
    useBusinessZone,
} from "../datetime";
import { firstName, formatList, formatMoney, BUSINESS_CURRENCY } from "../format";
import { type Load, type Remote, useAsyncAction, useRemote } from "../hooks";
import type { IconName } from "../icons";
import type { Intent } from "../ui";
import type { Viewer } from "./auth";
import { useInvoices } from "./billing";
import { slotBookingsJoin, slotOverlapSql } from "./bookings";
import { isPlace } from "./publicBooking";
import type { SubjectKind } from "./subjects";
import { utcSql } from "../datetime";
import { useCatalogItems } from "./catalog";
import { useEarnings } from "./earnings";
import { useThreads } from "./messaging";
import { type usePaymentNotices, useAccountNotices } from "./gettingPaid";
import { canManagePayments, isRefundRow } from "./payments";
import { staffName, staffNameSql, useStaff } from "./staff";
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
    departed_at: string | null;
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
       b.deposit_amount_cents, b.deposit_status, b.departed_at, b.checked_in_at,
       ${staffNameSql("st")} AS staff_name, st.title AS staff_title, st.role AS staff_role, st.color AS staff_color
FROM slots s
JOIN items i ON i.id = s.item_id
${slotBookingsJoin("AND x.deleted_at IS NULL AND x.status != 'canceled'")}
LEFT JOIN clients c ON c.id = b.client_id
LEFT JOIN staff st ON st.id = s.staff_id
WHERE s.status != 'canceled' AND ${slotOverlapSql("?2", "?1")}
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
    departed: boolean;
    checkedIn: boolean;
    minutesAway: number;
    startsIn: string;
}

const isClassRow = (r: AgendaRow): boolean => r.item_kind === "class" || r.capacity > 1;

/** Today's visits in time order with now/next state; a class is one row however many are booked. */
export function buildAgenda(rows: AgendaRow[], now: Date, zone: string): AgendaItem[] {
    const bySlot = new Map<string, AgendaRow[]>();
    for (const r of rows) bySlot.set(r.slot_id, [...(bySlot.get(r.slot_id) ?? []), r]);
    const items: Omit<AgendaItem, "state">[] = [];
    for (const group of bySlot.values()) {
        const first = group[0];
        if (first === undefined) continue;
        const seats = group.filter(
            (r) => r.booking_id !== null && r.booking_status !== "waitlisted",
        );
        const asItem = (r: AgendaRow, isClass: boolean): Omit<AgendaItem, "state"> => {
            const start = parseTimestamp(r.starts_at);
            const end = parseTimestamp(r.ends_at);
            const away = Math.round((start.getTime() - now.getTime()) / MIN);
            const paid = r.deposit_status === "collected" || r.deposit_status === "applied";
            const staff = { name: r.staff_name, title: r.staff_title, role: r.staff_role ?? "" };
            return {
                id: isClass ? r.slot_id : (r.booking_id ?? r.slot_id),
                slotId: r.slot_id,
                bookingId: isClass ? null : r.booking_id,
                start,
                end,
                time: formatTime(start, zone),
                endTime: formatTime(end, zone),
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
                departed: !isClass && r.departed_at !== null,
                checkedIn: !isClass && r.checked_in_at !== null,
                minutesAway: away,
                startsIn: strings.today.inMinutes(Math.floor(away / 60), away % 60),
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

function useAgendaRows(day: Date, staffId: string | null, zone: string) {
    const start = startOfDay(day, zone);
    const params = [addDays(start, 1, zone).toISOString(), start.toISOString()];
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
const isoWeekday = (d: Date, zone: string): number => (wallTime(d, zone).weekday + 6) % 7;

const shortClock = (hhmm: string): string =>
    hhmm.slice(3, 5) === "00" ? formatHour(Number(hhmm.slice(0, 2))) : formatClock(hhmm);

function hoursLabel(row: HoursRow | undefined): string | null {
    if (row?.available !== 1 || row.start_time === null || row.end_time === null) return null;
    return strings.today.hoursValue(shortClock(row.start_time), shortClock(row.end_time));
}

function useTodayHours(day: Date, zone: string) {
    const result = useQuery<HoursRow>(TODAY_HOURS_SQL, [isoWeekday(day, zone)]);
    return result;
}

const OPEN_INVOICE = new Set(["sent", "partial", "overdue"]);

function ownerAttention(input: {
    agenda: AgendaItem[];
    invoices: ReturnType<typeof useInvoices>;
    threads: ReturnType<typeof useThreads>;
    items: ReturnType<typeof useCatalogItems>;
    pendingEarnings: { count: number; cents: number };
    filingDue: Date | null;
    filingCents: number;
    now: Date;
    zone: string;
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
                formatMoney(item.depositAmountCents, BUSINESS_CURRENCY),
                item.time,
            ),
            action: a.depositAction,
            act: "open",
            target: "schedule",
            refId: item.bookingId,
        });
    }
    for (const inv of input.invoices.filter((i) => i.status === "overdue")) {
        const late =
            inv.due_at === null ? 0 : -daysUntil(parseTimestamp(inv.due_at), input.zone, input.now);
        out.push({
            key: `inv-${inv.id}`,
            intent: "danger",
            icon: "receipt",
            title: a.overdueTitle(inv.number ?? 0),
            detail: a.overdueDetail(
                inv.client_name ?? "",
                formatMoney(inv.balance_cents, BUSINESS_CURRENCY),
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
            detail: a.unreadDetail(
                formatList(unread.map((t) => firstName(t.client_name ?? "")).slice(0, 3)),
            ),
            action: a.unreadAction,
            act: "open",
            target: "inbox",
            refId: null,
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
    const filingDays =
        input.filingDue === null ? null : daysUntil(input.filingDue, input.zone, input.now);
    if (input.filingDue !== null && filingDays !== null && filingDays <= 30) {
        out.push({
            key: "filing",
            intent: filingDays <= 14 ? "warning" : "neutral",
            icon: "building",
            title: a.filingTitle,
            detail: a.filingDetail(
                formatMoney(input.filingCents, BUSINESS_CURRENCY),
                formatMonthDay(input.filingDue, input.zone),
            ),
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
                formatMoney(input.pendingEarnings.cents, BUSINESS_CURRENCY),
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
            detail: a.draftDetail(
                inv.client_name ?? "",
                formatMoney(inv.total_cents, BUSINESS_CURRENCY),
            ),
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
            detail: a.unreadDetail(
                formatList(unread.map((t) => firstName(t.client_name ?? "")).slice(0, 3)),
            ),
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

/** A new account's Today: the setup guide leads, and the money figures wait for the first sale. */
export function firstRunLayout(
    agendaCount: number,
    money: TodayMoney | null,
    setup: { complete: boolean },
): { guide: boolean; money: boolean } {
    // A business with money moving keeps its usual Today, even with setup left to finish.
    const quiet =
        money !== null &&
        money.collectedCents === 0 &&
        money.paymentCount === 0 &&
        money.awaitingCount === 0;
    const guide = agendaCount === 0 && !setup.complete && quiet;
    return { guide, money: !guide };
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
    notices: ReturnType<typeof usePaymentNotices>;
}

function useTodayNow(): Date {
    const [now] = useState(() => new Date());
    return now;
}

function useTodayView(viewer: Viewer | null, now: Date, zone: string) {
    const me = useQuery<{ name: string | null; title: string | null; role: string }>(
        VIEWER_STAFF_SQL,
        [viewer?.staffId ?? ""],
    ).data[0];
    const viewerName = me?.name ?? "";
    const manager = canManagePayments(viewer?.role ?? null);
    const scopeTo = manager ? null : (viewer?.staffId ?? "");
    const { result, rows } = useAgendaRows(now, scopeTo, zone);
    const hours = useTodayHours(now, zone);
    const staff = useStaff();
    const agenda = useMemo(() => buildAgenda(rows, now, zone), [rows, now, zone]);
    const team = useMemo<TeamDay[]>(
        () =>
            staff.map((s) => ({
                staffId: s.id,
                name: staffName(s),
                color: s.color,
                hours: hoursLabel(hours.data.find((h) => h.staff_id === s.id)),
                bookings: agenda.filter((a) => a.staffId === s.id).length,
            })),
        [staff, hours.data, agenda],
    );
    const upcoming = agenda.filter(
        (a) => a.state === "now" || a.state === "next" || a.state === "later",
    );
    return {
        result,
        agenda,
        team,
        base: {
            greeting: greeting(wallTime(now, zone).hour, viewerName),
            dateLabel: formatFullDate(now, zone),
            nowLabel: formatTime(now, zone),
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
    const zone = useBusinessZone();
    const { result, agenda, base } = useTodayView(viewer, now, zone);
    const invoices = useInvoices();
    const threads = useThreads();
    const items = useCatalogItems();
    const earnings = useEarnings();
    const summary = useTodaySummary(api);
    const payments = useQuery<{ id: string; kind: string }>(TODAY_PAYMENTS_SQL, [
        startOfDay(now, zone).toISOString(),
    ]);
    const s = summary.data;
    const filingDue = s?.gst_hst_filing_due
        ? combineDayAndTime(s.gst_hst_filing_due, "00:00", zone)
        : null;
    const open = invoices.filter((i) => OPEN_INVOICE.has(i.status) && (i.balance_cents ?? 0) > 0);
    const pending = earnings.filter((e) => e.status === "pending");
    const attention = ownerAttention({
        agenda,
        invoices,
        threads,
        items,
        pendingEarnings: {
            count: pending.length,
            cents: pending.reduce((n, e) => n + e.amount_cents, 0),
        },
        filingDue,
        filingCents: s?.gst_hst_set_aside_cents ?? 0,
        now,
        zone,
    });
    const load = useReplicaLoad([result], agenda.length === 0 && attention.length === 0);
    const moneyLoad = useReplicaLoad([summary], false);
    const notices = useAccountNotices(api, viewer?.role ?? null);
    return {
        load,
        moneyLoad,
        notices,
        view: { ...base, attention },
        money: {
            collectedCents: s?.today_revenue_cents ?? 0,
            paymentCount: payments.data.filter((p) => !isRefundRow(p)).length,
            awaitingCents: s?.awaiting_payment_cents ?? 0,
            awaitingCount: open.length,
            setAsideCents: s?.gst_hst_set_aside_cents ?? 0,
            filingDue,
            filingDays: filingDue === null ? null : daysUntil(filingDue, zone, now),
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
    const zone = useBusinessZone();
    const { result, agenda, base } = useTodayView(viewer, now, zone);
    const threads = useThreads();
    const hours = useTodayHours(now, zone);
    const tomorrow = useAgendaRows(addDays(now, 1, zone), viewer?.staffId ?? "", zone);
    const earnings = useEarnings();
    const next = base.current ?? base.next;
    const last = useQuery<{ starts_at: string }>(CLIENT_LAST_VISIT_SQL, [
        next?.clientId ?? "",
        startOfDay(now, zone).toISOString(),
    ]).data[0];
    const attention = useMemo(() => staffAttention(agenda, threads), [agenda, threads]);
    const mine = hours.data.find((h) => h.staff_id === viewer?.staffId);
    const gaps: StaffDay["gaps"] = [];
    for (let i = 0; i < agenda.length - 1; i++) {
        const a = agenda[i];
        const b = agenda[i + 1];
        if (a && b && b.start.getTime() - a.end.getTime() >= 60 * MIN) {
            gaps.push({
                after: a.id,
                from: formatTime(a.end, zone),
                to: formatTime(b.start, zone),
            });
        }
    }
    const lastAt = last === undefined ? null : parseTimestamp(last.starts_at);
    const load = useReplicaLoad([result], agenda.length === 0 && attention.length === 0);
    return {
        load,
        view: { ...base, attention },
        day: {
            hours: hoursLabel(mine),
            endsAt:
                mine?.available === 1 && mine.end_time !== null ? formatClock(mine.end_time) : null,
            earnedCents: earnings
                .filter(
                    (e) =>
                        e.staff_id === viewer?.staffId &&
                        (e.status === "pending" || e.status === "approved"),
                )
                .reduce((n, e) => n + e.amount_cents, 0),
            gaps,
            tomorrow: new Set(tomorrow.rows.map((r) => r.slot_id)).size,
            lastVisit: lastAt === null ? null : formatWeekdayMonthDay(lastAt, zone),
        },
    };
}

export interface TodayActions {
    sent: ReadonlySet<string>;
    busyKey: string | null;
    error: string | null;
    checkIn: (bookingId: string) => void;
    depart: (bookingId: string) => void;
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
        depart: (bookingId) => {
            go(bookingId, () => api.post(`/v1/bookings/${bookingId}/depart`, {}));
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

/** A visit's one action: on my way (place businesses), check in, then checkout; none once done. */
export function visitAction(
    item: AgendaItem,
    kind: SubjectKind | null = null,
): "depart" | "checkIn" | "checkout" | null {
    if (item.state === "done" || item.state === "no_show" || item.isClass) return null;
    if (item.checkedIn) return "checkout";
    if (isPlace(kind) && !item.departed) return "depart";
    return item.state === "now" && !isPlace(kind) ? "checkout" : "checkIn";
}

/** Check-in names the client arriving, or for a site business the installer arriving on site. */
export function arrivalWords(kind: SubjectKind | null): { action: string; done: string } {
    return kind === "site"
        ? { action: strings.today.arrive, done: strings.today.onSite }
        : { action: strings.today.checkIn, done: strings.today.checkedIn };
}

/** The button label for a visit's action. */
export function visitActionLabel(
    action: "depart" | "checkIn" | "checkout",
    kind: SubjectKind | null,
): string {
    if (action === "checkout") return strings.today.checkout;
    return action === "depart" ? strings.today.depart : arrivalWords(kind).action;
}
