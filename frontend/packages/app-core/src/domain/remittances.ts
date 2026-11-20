import { useMemo, useRef, useState } from "react";

import { type Load, useAsyncAction, useLoad, useRemote } from "../hooks";
import { strings } from "../strings";
import { type ApiLike, type Attempt, attemptKey, failedCode, failureMessage } from "../api";
import {
    addDays,
    dateKey,
    daysUntil,
    formatDate,
    formatShortDay,
    formatShortMonthYear,
    parseDateKey,
    useBusinessZone,
} from "../datetime";
import { formatList, parseCents, BUSINESS_CURRENCY } from "../format";
import type { Intent } from "../ui";
import { taxName } from "./printing";

export type TaxFamily = "federal" | "provincial";

interface FiledReturn {
    id: string;
    family: TaxFamily | null;
    period_start: string;
    period_end: string;
    by_code: Record<string, number>;
    itc_cents: number;
    paid_cents: number;
    confirmation: string | null;
    filed_on: string;
}

interface FilingPeriodRow {
    start: string;
    end: string;
    due: string;
    federal_cents: number;
    provincial_cents: number;
    taxable_cents: number;
    provincial_taxable_cents: number;
    federal_status: "open" | "due" | "filed";
    provincial_status: "open" | "due" | "filed" | "none";
    returns: FiledReturn[];
}

interface TaxFilingsData {
    frequency: string;
    registered: boolean;
    federal_code: string | null;
    provincial_code: string | null;
    provincial_rate_bps: number | null;
    gst_hst_number: string | null;
    qst_number: string | null;
    federal_set_aside_cents: number;
    provincial_set_aside_cents: number;
    next_due: string | null;
    periods: FilingPeriodRow[];
}

type FilingStatus = "open" | "due" | "filed";

export interface FilingPeriod {
    key: string;
    start: string;
    end: string;
    title: string;
    span: string;
    due: Date;
    daysToDue: number;
    status: FilingStatus;
    federalCents: number;
    provincialCents: number;
    taxableCents: number;
    provincialTaxableCents: number;
    federalStatus: FilingStatus;
    provincialStatus: FilingStatus | "none";
    // the days each return still has to cover, which is the whole period until one is filed
    federalSpan: string;
    provincialSpan: string;
}

interface FiledRow {
    key: string;
    title: string;
    // the days its returns cover, which is the whole period once every return is in
    span: string;
    when: string;
    // a return covering both taxes counts as federal
    federalPaidCents: number;
    provincialPaidCents: number;
    hasProvincial: boolean;
    federalConfirmations: string[];
    provincialConfirmations: string[];
}

const day = (key: string, zone: string): Date => parseDateKey(key, zone) ?? new Date(NaN);

function filingDay(key: string, zone: string): string {
    return formatShortDay(day(key, zone), zone);
}

const shiftKey = (key: string, days: number, zone: string): string =>
    dateKey(addDays(day(key, zone), days, zone), zone);

function spanOf(start: string, end: string, zone: string): string {
    return strings.remittances.span(filingDay(start, zone), formatDate(day(end, zone), zone));
}

/** A month, quarter or year by its name, any other run of days by its dates. */
function titleOf(start: string, end: string, zone: string): string {
    const [year = 0, month = 1, first = 1] = start.split("-").map(Number);
    const [toYear = 0, toMonth = 1, next = 1] = shiftKey(end, 1, zone).split("-").map(Number);
    const months = (toYear - year) * 12 + toMonth - month;
    if (first === 1 && next === 1) {
        if (months === 1) return formatShortMonthYear(day(start, zone), zone);
        if (months === 3 && (month - 1) % 3 === 0)
            return strings.remittances.quarter((month - 1) / 3 + 1, year);
        if (months === 12 && month === 1) return String(year);
    }
    return spanOf(start, end, zone);
}

type Days = [string, string];

function merged(ranges: Days[], zone: string): Days[] {
    const out: Days[] = [];
    for (const [first, last] of [...ranges].sort(([a], [b]) => a.localeCompare(b))) {
        const prev = out.at(-1);
        if (prev !== undefined && first <= shiftKey(prev[1], 1, zone)) {
            if (last > prev[1]) prev[1] = last;
        } else out.push([first, last]);
    }
    return out;
}

function unfiledSpan(row: FilingPeriodRow, family: TaxFamily, zone: string): string {
    const covered = merged(
        row.returns
            .filter(
                (r) =>
                    (r.family === family || r.family === null) &&
                    r.period_start <= row.end &&
                    row.start <= r.period_end,
            )
            .map((r): Days => [
                r.period_start < row.start ? row.start : r.period_start,
                r.period_end > row.end ? row.end : r.period_end,
            ]),
        zone,
    );
    const gaps: string[] = [];
    let cursor = row.start;
    for (const [first, last] of covered) {
        if (first > cursor) gaps.push(spanOf(cursor, shiftKey(first, -1, zone), zone));
        cursor = shiftKey(last, 1, zone);
    }
    if (cursor <= row.end) gaps.push(spanOf(cursor, row.end, zone));
    return gaps.length === 0 ? spanOf(row.start, row.end, zone) : formatList(gaps);
}

const paid = (returns: FiledReturn[]): number => returns.reduce((n, r) => n + r.paid_cents, 0);

const confirmations = (returns: FiledReturn[]): string[] => [
    ...new Set(returns.flatMap((r) => (r.confirmation === null ? [] : [r.confirmation]))),
];

/** Every return once, under the period it falls in, or on its own when it runs past one. */
function history(rows: FilingPeriodRow[], zone: string): FiledRow[] {
    const groups = new Map<
        string,
        { start: string; end: string; first: FiledReturn; returns: FiledReturn[] }
    >();
    const seen = new Set<string>();
    for (const r of rows.flatMap((row) => row.returns)) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        const home = rows.find((row) => row.start <= r.period_start && r.period_end <= row.end);
        const start = home?.start ?? r.period_start;
        const end = home?.end ?? r.period_end;
        const key = `${start}:${end}`;
        const group = groups.get(key) ?? { start, end, first: r, returns: [] };
        group.returns.push(r);
        groups.set(key, group);
    }
    return [...groups]
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([key, g]) => {
            const federal = g.returns.filter((r) => r.family !== "provincial");
            const provincial = g.returns.filter((r) => r.family === "provincial");
            const first = federal[0] ?? g.first;
            return {
                key,
                title: titleOf(g.start, g.end, zone),
                span: formatList(
                    merged(
                        g.returns.map((r): Days => [r.period_start, r.period_end]),
                        zone,
                    ).map(([a, b]) => spanOf(a, b, zone)),
                ),
                when: strings.remittances.filedOn(filingDay(first.filed_on, zone)),
                federalPaidCents: paid(federal),
                provincialPaidCents: paid(provincial),
                hasProvincial: provincial.length > 0,
                federalConfirmations: confirmations(federal),
                provincialConfirmations: confirmations(provincial),
            };
        });
}

function toPeriod(row: FilingPeriodRow, now: Date, zone: string): FilingPeriod {
    const due = day(row.due, zone);
    const provincialDone = row.provincial_status === "none" || row.provincial_status === "filed";
    // the server decides when a period has ended, in the business's zone
    const status: FilingStatus =
        row.federal_status === "filed" && provincialDone
            ? "filed"
            : row.federal_status === "due" || row.provincial_status === "due"
              ? "due"
              : "open";
    return {
        key: row.start,
        start: row.start,
        end: row.end,
        title: titleOf(row.start, row.end, zone),
        span: spanOf(row.start, row.end, zone),
        due,
        daysToDue: daysUntil(due, zone, now),
        status,
        federalCents: row.federal_cents,
        provincialCents: row.provincial_cents,
        taxableCents: row.taxable_cents,
        provincialTaxableCents: row.provincial_taxable_cents,
        federalStatus: row.federal_status,
        provincialStatus: row.provincial_status,
        federalSpan: unfiledSpan(row, "federal", zone),
        provincialSpan: unfiledSpan(row, "provincial", zone),
    };
}

export function filingStatusIntent(status: FilingStatus): Intent {
    switch (status) {
        case "filed":
            return "success";
        case "due":
            return "warning";
        default:
            return "neutral";
    }
}

/** When a period is due, or that it was filed. */
export function filingWhen(p: FilingPeriod, zone: string): string {
    if (p.status === "filed") return strings.remittances.filed;
    if (p.status === "due" && p.daysToDue < 0)
        return strings.remittances.overdue(formatShortDay(p.due, zone));
    if (p.status === "open") return strings.remittances.dueOn(formatShortDay(p.due, zone));
    return strings.remittances.dueIn(p.daysToDue, formatShortDay(p.due, zone));
}

export interface TaxFilings {
    load: Load;
    periods: FilingPeriod[];
    federalUnfiled: FilingPeriod[];
    history: FiledRow[];
    federalSetAsideCents: number;
    provincialSetAsideCents: number;
    nextDue: FilingPeriod | null;
    reminderOn: Date | null;
    federalLabel: string;
    provincialLabel: string | null;
    provincialRate: string;
    registered: boolean;
    // Sales tax is off and nothing was ever collected or filed, so there is no return to show.
    taxOff: boolean;
    gstNumber: string | null;
    refresh: () => void;
}

/** Tax collected and not yet filed, by period, with the next deadline: the figure Today shows. */
export function useTaxFilings(api: ApiLike): TaxFilings {
    const remote = useRemote(() => api.get<TaxFilingsData>("/v1/payments/remittances"));
    const [now] = useState(() => new Date());
    const zone = useBusinessZone();
    const data = remote.data;
    const periods = useMemo(
        () => (data === null ? [] : data.periods.map((p) => toPeriod(p, now, zone))),
        [data, now, zone],
    );
    const returns = useMemo(() => (data === null ? [] : history(data.periods, zone)), [data, zone]);
    const nextDue =
        data?.next_due === null || data === null
            ? null
            : ([...periods].reverse().find((p) => p.status === "due") ??
              periods.find((p) => dateKey(p.due, zone) === data.next_due) ??
              null);
    const reminder = nextDue === null ? null : addDays(nextDue.due, -7, zone);
    // a refresh, or a failed one, keeps the page and any return form open on it on screen
    const shown = {
        ...remote,
        isLoading: remote.isLoading && data === null,
        error: data === null ? remote.error : null,
    };
    const load = useLoad([shown], data !== null && periods.length === 0);
    return {
        load,
        periods,
        federalUnfiled: periods.filter((p) => p.federalStatus !== "filed"),
        history: returns,
        federalSetAsideCents: data?.federal_set_aside_cents ?? 0,
        provincialSetAsideCents: data?.provincial_set_aside_cents ?? 0,
        nextDue,
        reminderOn: reminder !== null && reminder > now ? reminder : null,
        federalLabel:
            data?.federal_code === "HST" ? strings.remittances.hst : strings.remittances.gstHst,
        provincialLabel: data?.provincial_code == null ? null : taxName(data.provincial_code),
        provincialRate:
            data?.provincial_rate_bps === null || data === null
                ? ""
                : `${String(data.provincial_rate_bps / 100)}%`,
        registered: data?.registered ?? false,
        taxOff:
            data !== null &&
            !data.registered &&
            data.federal_set_aside_cents + data.provincial_set_aside_cents === 0 &&
            periods.every((p) => p.status !== "filed"),
        gstNumber: data?.gst_hst_number ?? null,
        refresh: () => {
            remote.refresh().catch(() => undefined);
        },
    };
}

export interface FilingForm {
    family: TaxFamily;
    setFamily: (family: TaxFamily) => void;
    families: TaxFamily[];
    itc: string;
    setItc: (v: string) => void;
    itcCents: number;
    confirmation: string;
    setConfirmation: (v: string) => void;
    filedOn: string;
    setFiledOn: (v: string) => void;
    owedCents: number;
    netCents: number;
    busy: boolean;
    error: string | null;
    submit: () => void;
}

/** Records one return, GST/HST or PST, for a period: what was paid, the credits and the number. */
export function useFilingForm(
    api: ApiLike,
    period: FilingPeriod | null,
    onDone: (family: TaxFamily) => void,
    onStale: () => void,
): FilingForm {
    const families: TaxFamily[] =
        period === null
            ? []
            : [
                  ...(period.federalStatus !== "filed" ? (["federal"] as const) : []),
                  ...(period.provincialStatus === "due" || period.provincialStatus === "open"
                      ? (["provincial"] as const)
                      : []),
              ];
    const [chosen, setChosen] = useState<TaxFamily>("federal");
    const family = families.includes(chosen) ? chosen : (families[0] ?? "federal");
    const [itc, setItcState] = useState("");
    const [confirmation, setConfirmationState] = useState("");
    // answers typed for one return never carry over to the other, whoever switches it
    const [answering, setAnswering] = useState(family);
    if (answering !== family) {
        setAnswering(family);
        setItcState("");
        setConfirmationState("");
    }
    const zone = useBusinessZone();
    const [filedOn, setFiledOnState] = useState(() => dateKey(new Date(), zone));
    const key = useRef<Attempt | null>(null);
    const { busy, error, setError, run } = useAsyncAction();
    const edit =
        <T>(set: (v: T) => void) =>
        (v: T): void => {
            key.current = null;
            setError(null);
            set(v);
        };
    const itcCents = family === "federal" ? (parseCents(itc, BUSINESS_CURRENCY) ?? 0) : 0;
    const owedCents =
        period === null ? 0 : family === "federal" ? period.federalCents : period.provincialCents;
    return {
        family,
        setFamily: edit(setChosen),
        families,
        itc,
        setItc: edit(setItcState),
        itcCents,
        confirmation,
        setConfirmation: edit(setConfirmationState),
        filedOn,
        setFiledOn: edit(setFiledOnState),
        owedCents,
        netCents: owedCents - itcCents,
        busy,
        error,
        submit: () => {
            if (period === null) return;
            const r = strings.remittances.errors;
            const problem =
                itc.trim() !== "" && (parseCents(itc, BUSINESS_CURRENCY) ?? -1) < 0
                    ? r.itcInvalid
                    : itcCents > Math.max(owedCents, 0)
                      ? r.itcTooHigh
                      : confirmation.trim() === ""
                        ? family === "federal"
                            ? r.needConfirmation
                            : r.needPstConfirmation
                        : filedOn === "" ||
                            filedOn <= period.end ||
                            filedOn > dateKey(new Date(), zone)
                          ? r.filedOn
                          : null;
            if (problem !== null) {
                setError(problem);
                return;
            }
            const body = {
                period_start: period.start,
                period_end: period.end,
                family,
                itc_cents: itcCents,
                confirmation: confirmation.trim(),
                filed_on: filedOn,
                tax_cents: owedCents,
            };
            const idempotencyKey = attemptKey(key, body);
            run(
                async () => {
                    try {
                        await api.post("/v1/payments/remittances", body, { idempotencyKey });
                    } catch (e) {
                        const code = failedCode(e);
                        if (code === "return_filed" || code === "return_changed") onStale();
                        throw e;
                    }
                },
                {
                    onSuccess: () => {
                        key.current = null;
                        setItcState("");
                        setConfirmationState("");
                        onDone(family);
                    },
                    errorMessage: (e) =>
                        failedCode(e) === "invalid_filed_on"
                            ? r.filedOn
                            : failedCode(e) === "invalid_itc"
                              ? r.itcTooHigh
                              : failureMessage(e, r.filingFailed),
                },
            );
        },
    };
}
