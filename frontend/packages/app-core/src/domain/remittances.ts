import { useMemo, useRef, useState } from "react";

import { type Load, useAsyncAction, useLoad, useRemote } from "../hooks";
import { strings } from "../strings";
import { type ApiLike, newIdempotencyKey } from "../api";
import { addDays, dateKey, daysUntil, formatShortDay } from "../datetime";
import { parseCents } from "../format";
import type { Intent } from "../ui";

export type TaxFamily = "federal" | "provincial";

export interface FiledReturn {
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

export type FilingStatus = "open" | "due" | "filed";

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
    federalReturn: FiledReturn | null;
    provincialReturn: FiledReturn | null;
}

const day = (key: string): Date => new Date(`${key}T12:00:00`);

function filingDay(key: string): string {
    return formatShortDay(day(key));
}

function periodTitle(row: FilingPeriodRow, frequency: string): string {
    const start = day(row.start);
    if (frequency === "annual") return String(start.getFullYear());
    if (frequency === "monthly")
        return start.toLocaleDateString("en-CA", { month: "short", year: "numeric" });
    return strings.remittances.quarter(Math.floor(start.getMonth() / 3) + 1, start.getFullYear());
}

function toPeriod(row: FilingPeriodRow, frequency: string, now: Date): FilingPeriod {
    const due = day(row.due);
    const provincialDone = row.provincial_status === "none" || row.provincial_status === "filed";
    const status: FilingStatus =
        row.federal_status === "filed" && provincialDone
            ? "filed"
            : day(row.end) < now
              ? "due"
              : "open";
    const find = (family: TaxFamily): FiledReturn | null =>
        row.returns.find((r) => r.family === family) ??
        row.returns.find((r) => r.family === null) ??
        null;
    return {
        key: row.start,
        start: row.start,
        end: row.end,
        title: periodTitle(row, frequency),
        span: strings.remittances.span(
            filingDay(row.start),
            `${filingDay(row.end)}, ${row.end.slice(0, 4)}`,
        ),
        due,
        daysToDue: daysUntil(due, now),
        status,
        federalCents: row.federal_cents,
        provincialCents: row.provincial_cents,
        taxableCents: row.taxable_cents,
        provincialTaxableCents: row.provincial_taxable_cents,
        federalStatus: row.federal_status,
        provincialStatus: row.provincial_status,
        federalReturn: row.federal_status === "filed" ? find("federal") : null,
        provincialReturn: row.provincial_status === "filed" ? find("provincial") : null,
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

/** When a period is due, or was filed. */
export function filingWhen(p: FilingPeriod): string {
    const filedOn = p.federalReturn?.filed_on ?? p.provincialReturn?.filed_on;
    if (p.status === "filed" && filedOn !== undefined)
        return strings.remittances.filedOn(filingDay(filedOn));
    if (p.status === "due" && p.daysToDue < 0)
        return strings.remittances.overdue(formatShortDay(p.due));
    if (p.status === "open") return strings.remittances.dueOn(formatShortDay(p.due));
    return strings.remittances.dueIn(p.daysToDue, formatShortDay(p.due));
}

export interface TaxFilings {
    load: Load;
    periods: FilingPeriod[];
    unfiled: FilingPeriod[];
    filed: FilingPeriod[];
    federalSetAsideCents: number;
    provincialSetAsideCents: number;
    nextDue: FilingPeriod | null;
    reminderOn: Date | null;
    federalLabel: string;
    provincialLabel: string | null;
    provincialRate: string;
    registered: boolean;
    gstNumber: string | null;
    refresh: () => void;
}

/** Tax collected and not yet filed, by period, with the next deadline: the figure Today shows. */
export function useTaxFilings(api: ApiLike): TaxFilings {
    const remote = useRemote(() => api.get<TaxFilingsData>("/v1/payments/remittances"));
    const [now] = useState(() => new Date());
    const data = remote.data;
    const periods = useMemo(
        () => (data === null ? [] : data.periods.map((p) => toPeriod(p, data.frequency, now))),
        [data, now],
    );
    const nextDue =
        data?.next_due === null || data === null
            ? null
            : ([...periods].reverse().find((p) => p.status === "due") ??
              periods.find((p) => dateKey(p.due) === data.next_due) ??
              null);
    const reminder = nextDue === null ? null : addDays(nextDue.due, -7);
    const load = useLoad([remote], data !== null && periods.length === 0);
    return {
        load,
        periods,
        unfiled: periods.filter((p) => p.status !== "filed"),
        filed: periods.filter((p) => p.status === "filed"),
        federalSetAsideCents: data?.federal_set_aside_cents ?? 0,
        provincialSetAsideCents: data?.provincial_set_aside_cents ?? 0,
        nextDue,
        reminderOn: reminder !== null && reminder > now ? reminder : null,
        federalLabel:
            data?.federal_code === "HST" ? strings.remittances.hst : strings.remittances.gstHst,
        provincialLabel: data?.provincial_code ?? null,
        provincialRate:
            data?.provincial_rate_bps === null || data === null
                ? ""
                : `${String(data.provincial_rate_bps / 100)}%`,
        registered: data?.registered ?? false,
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
    const [filedOn, setFiledOnState] = useState(() => dateKey(new Date()));
    const key = useRef<string | null>(null);
    const { busy, error, setError, run } = useAsyncAction();
    const edit =
        <T>(set: (v: T) => void) =>
        (v: T): void => {
            key.current = null;
            setError(null);
            set(v);
        };
    const itcCents = family === "federal" ? (parseCents(itc) ?? 0) : 0;
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
                itc.trim() !== "" && (parseCents(itc) ?? -1) < 0
                    ? r.itcInvalid
                    : itcCents > owedCents
                      ? r.itcTooHigh
                      : confirmation.trim() === ""
                        ? family === "federal"
                            ? r.needConfirmation
                            : r.needPstConfirmation
                        : filedOn === "" || filedOn > dateKey(new Date())
                          ? r.filedOn
                          : null;
            if (problem !== null) {
                setError(problem);
                return;
            }
            key.current ??= newIdempotencyKey();
            const idempotencyKey = key.current;
            run(
                () =>
                    api.post(
                        "/v1/payments/remittances",
                        {
                            period_start: period.start,
                            period_end: period.end,
                            family,
                            itc_cents: itcCents,
                            confirmation: confirmation.trim(),
                            filed_on: filedOn,
                        },
                        { idempotencyKey },
                    ),
                {
                    onSuccess: () => {
                        key.current = null;
                        setItcState("");
                        setConfirmationState("");
                        onDone(family);
                    },
                    errorMessage: r.filingFailed,
                },
            );
        },
    };
}
