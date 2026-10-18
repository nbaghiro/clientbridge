import { useMemo, useRef, useState } from "react";

import { type Load, useAsyncAction, useLoad, useRemote } from "../hooks";
import { strings } from "../strings";
import { type ApiLike, type Attempt, attemptKey } from "../api";
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
import { parseCents, BUSINESS_CURRENCY } from "../format";
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
    federalReturn: FiledReturn | null;
    provincialReturn: FiledReturn | null;
}

const day = (key: string, zone: string): Date => parseDateKey(key, zone) ?? new Date(NaN);

function filingDay(key: string, zone: string): string {
    return formatShortDay(day(key, zone), zone);
}

function periodTitle(row: FilingPeriodRow, frequency: string, zone: string): string {
    const [year = 0, month = 1] = row.start.split("-").map(Number);
    if (frequency === "annual") return String(year);
    if (frequency === "monthly") return formatShortMonthYear(day(row.start, zone), zone);
    return strings.remittances.quarter(Math.floor((month - 1) / 3) + 1, year);
}

function toPeriod(row: FilingPeriodRow, frequency: string, now: Date, zone: string): FilingPeriod {
    const due = day(row.due, zone);
    const provincialDone = row.provincial_status === "none" || row.provincial_status === "filed";
    const status: FilingStatus =
        row.federal_status === "filed" && provincialDone
            ? "filed"
            : day(row.end, zone) < now
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
        title: periodTitle(row, frequency, zone),
        span: strings.remittances.span(
            filingDay(row.start, zone),
            formatDate(day(row.end, zone), zone),
        ),
        due,
        daysToDue: daysUntil(due, zone, now),
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
export function filingWhen(p: FilingPeriod, zone: string): string {
    const filedOn = p.federalReturn?.filed_on ?? p.provincialReturn?.filed_on;
    if (p.status === "filed") {
        // filed per the server, but with no return row to date it (e.g. recorded before returns)
        return filedOn === undefined
            ? strings.remittances.filed
            : strings.remittances.filedOn(filingDay(filedOn, zone));
    }
    if (p.status === "due" && p.daysToDue < 0)
        return strings.remittances.overdue(formatShortDay(p.due, zone));
    if (p.status === "open") return strings.remittances.dueOn(formatShortDay(p.due, zone));
    return strings.remittances.dueIn(p.daysToDue, formatShortDay(p.due, zone));
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
        () =>
            data === null ? [] : data.periods.map((p) => toPeriod(p, data.frequency, now, zone)),
        [data, now, zone],
    );
    const nextDue =
        data?.next_due === null || data === null
            ? null
            : ([...periods].reverse().find((p) => p.status === "due") ??
              periods.find((p) => dateKey(p.due, zone) === data.next_due) ??
              null);
    const reminder = nextDue === null ? null : addDays(nextDue.due, -7, zone);
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
                    : itcCents > owedCents
                      ? r.itcTooHigh
                      : confirmation.trim() === ""
                        ? family === "federal"
                            ? r.needConfirmation
                            : r.needPstConfirmation
                        : filedOn === "" || filedOn > dateKey(new Date(), zone)
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
            };
            const idempotencyKey = attemptKey(key, body);
            run(() => api.post("/v1/payments/remittances", body, { idempotencyKey }), {
                onSuccess: () => {
                    key.current = null;
                    setItcState("");
                    setConfirmationState("");
                    onDone(family);
                },
                errorMessage: r.filingFailed,
            });
        },
    };
}
