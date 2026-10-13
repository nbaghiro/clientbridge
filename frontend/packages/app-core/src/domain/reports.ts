import { useMemo, useState } from "react";

import { type Load, useAsyncAction, useLoad, useRemote } from "../hooks";
import { strings } from "../strings";
import type { ApiLike } from "../api";
import {
    CALENDAR,
    dateKey,
    dayKey,
    formatDate,
    formatShortDay,
    parseDateKey,
    wallTime,
    useBusinessZone,
} from "../datetime";
import { taxName, ratePct } from "./printing";

interface IncomeSummary {
    sales_cents: number;
    refunds_cents: number;
    net_cents: number;
    tax_by_code: Record<string, number>;
    tips_cents: number;
    received_cents: number;
    by_method: Record<string, number>;
}

interface SalesByItemRow {
    item_id: string;
    name: string;
    kind: string;
    quantity: number;
    sales_cents: number;
    tax_cents: number;
    refunded_cents: number;
}

interface ReportSummary {
    start: string;
    end: string;
    income: IncomeSummary;
    sales_by_item: SalesByItemRow[];
    gst_hst: {
        tax_collected_cents: number;
        taxable_sales_cents: number;
        gst_hst_number: string | null;
    };
    provincial: {
        code: string | null;
        rate_bps: number | null;
        taxable_cents: number;
        collected_cents: number;
        number: string | null;
    };
    t4a_year: number;
    t4a: { staff_id: string; name: string; payments: number; total_cents: number }[];
    months: { month: string; net_cents: number }[];
    payouts: { id: string }[];
    rates: { code: string; rate_bps: number }[];
}

export type ReportPeriodKey = "thisMonth" | "lastMonth" | "lastQuarter" | "ytd";

export const REPORT_PERIODS: readonly ReportPeriodKey[] = [
    "thisMonth",
    "lastMonth",
    "lastQuarter",
    "ytd",
];

interface ReportSpan {
    start: string;
    end: string;
}

/** The days a period covers, both ends included, up to today. */
export function periodSpan(key: ReportPeriodKey, zone: string, now: Date = new Date()): ReportSpan {
    const { year, month } = wallTime(now, zone);
    const today = dateKey(now, zone);
    switch (key) {
        case "thisMonth":
            return { start: dayKey(year, month, 1), end: today };
        case "lastMonth":
            return { start: dayKey(year, month - 1, 1), end: dayKey(year, month, 0) };
        case "lastQuarter": {
            const quarter = Math.floor((month - 1) / 3);
            return {
                start: dayKey(year, quarter * 3 - 2, 1),
                end: dayKey(year, quarter * 3 + 1, 0),
            };
        }
        case "ytd":
            return { start: dayKey(year, 1, 1), end: today };
    }
}

export function spanLabel(span: ReportSpan): string {
    const day = (key: string): Date => parseDateKey(key, CALENDAR) ?? new Date(NaN);
    return strings.reports.range(
        formatShortDay(day(span.start), CALENDAR),
        formatDate(day(span.end), CALENDAR),
    );
}

export type ReportKey = "income" | "salesByItem" | "gstHst" | "pst" | "t4a";
export type ExportKind = ReportKey | "payouts";

export const EXPORT_KINDS: readonly ExportKind[] = [
    "income",
    "salesByItem",
    "gstHst",
    "pst",
    "t4a",
    "payouts",
];

const SERVER_KIND: Record<ExportKind, string> = {
    income: "income",
    salesByItem: "sales-by-item",
    gstHst: "gst-hst",
    pst: "pst",
    t4a: "t4a",
    payouts: "payouts",
};

interface TaxLine {
    code: string;
    label: string;
    rate: string;
    cents: number;
}

interface MethodShare {
    method: string;
    label: string;
    cents: number;
    share: number;
}

interface ItemSales {
    id: string;
    name: string;
    kind: string;
    quantity: string;
    salesCents: number;
    refundedCents: number;
    netCents: number;
}

interface MonthBar {
    key: string;
    label: string;
    netCents: number;
    partial: boolean;
    inSpan: boolean;
}

export interface ReportsView {
    salesCents: number;
    refundsCents: number;
    netCents: number;
    taxLines: TaxLine[];
    salesWithTaxCents: number;
    tipsCents: number;
    receivedCents: number;
    methods: MethodShare[];
    items: ItemSales[];
    unitsSold: number;
    gst: { taxableCents: number; collectedCents: number; number: string | null; label: string };
    provincial: {
        label: string;
        rate: string;
        taxableCents: number;
        collectedCents: number;
        number: string | null;
    } | null;
    t4aYear: number;
    t4a: { staffId: string; name: string; payments: number; totalCents: number }[];
    t4aTotalCents: number;
    bars: MonthBar[];
    rows: Record<ExportKind, number>;
}

const rateText = (code: string, bps: number | null | undefined): string =>
    bps === null || bps === undefined ? "" : ratePct(code, bps);

const PROVINCIAL = ["PST", "QST", "RST"];

function buildView(r: ReportSummary, span: ReportSpan, now: Date, zone: string): ReportsView {
    const rate = new Map(r.rates.map((x) => [x.code, x.rate_bps]));
    const taxLines = Object.entries(r.income.tax_by_code)
        .sort(([a], [b]) => (PROVINCIAL.includes(a) ? 1 : PROVINCIAL.includes(b) ? -1 : 0))
        .map(([code, cents]) => ({
            code,
            label: strings.reports.taxCollected(taxName(code)),
            rate: rateText(code, rate.get(code)),
            cents,
        }));
    const received = Object.values(r.income.by_method).reduce((n, c) => n + c, 0);
    const methods = Object.entries(r.income.by_method)
        .filter(([, cents]) => cents !== 0)
        .sort(([, a], [, b]) => b - a)
        .map(([method, cents]) => ({
            method,
            label: strings.reports.method[method] ?? method,
            cents,
            share: received > 0 ? cents / received : 0,
        }));
    const thisMonth = dateKey(now, zone).slice(0, 7);
    const federal = r.rates.find((x) => x.code === "GST" || x.code === "HST");
    const provincialCode = r.provincial.code;
    return {
        salesCents: r.income.sales_cents,
        refundsCents: r.income.refunds_cents,
        netCents: r.income.net_cents,
        taxLines,
        salesWithTaxCents: r.income.net_cents + taxLines.reduce((n, t) => n + t.cents, 0),
        tipsCents: r.income.tips_cents,
        receivedCents: r.income.received_cents,
        methods,
        items: r.sales_by_item.map((i) => ({
            id: i.item_id,
            name: i.name,
            kind: strings.reports.kind[i.kind] ?? i.kind,
            quantity: strings.reports.qty(i.quantity),
            salesCents: i.sales_cents,
            refundedCents: i.refunded_cents,
            netCents: i.sales_cents - i.refunded_cents,
        })),
        unitsSold: r.sales_by_item.reduce((n, i) => n + i.quantity, 0),
        gst: {
            taxableCents: r.gst_hst.taxable_sales_cents,
            collectedCents: r.gst_hst.tax_collected_cents,
            number: r.gst_hst.gst_hst_number,
            label: federal === undefined ? strings.reports.gstHst : taxName(federal.code),
        },
        provincial:
            provincialCode === null
                ? null
                : {
                      label: taxName(provincialCode),
                      rate: rateText(provincialCode, r.provincial.rate_bps),
                      taxableCents: r.provincial.taxable_cents,
                      collectedCents: r.provincial.collected_cents,
                      number: r.provincial.number,
                  },
        t4aYear: r.t4a_year,
        t4a: r.t4a.map((t) => ({
            staffId: t.staff_id,
            name: t.name,
            payments: t.payments,
            totalCents: t.total_cents,
        })),
        t4aTotalCents: r.t4a.reduce((n, t) => n + t.total_cents, 0),
        bars: r.months.map((m) => ({
            key: m.month,
            label: strings.reports.months[Number(m.month.slice(5)) - 1] ?? m.month,
            netCents: m.net_cents,
            partial: m.month === thisMonth,
            inSpan: m.month >= span.start.slice(0, 7) && m.month <= span.end.slice(0, 7),
        })),
        rows: {
            income: 3 + Object.keys(r.income.by_method).length,
            salesByItem: r.sales_by_item.length,
            gstHst: 1,
            pst: provincialCode === null ? 0 : 1,
            t4a: r.t4a.length,
            payouts: r.payouts.length,
        },
    };
}

interface MoneyReports {
    period: ReportPeriodKey;
    setPeriod: (key: ReportPeriodKey) => void;
    span: ReportSpan;
    load: Load;
    view: ReportsView | null;
}

/** Every report for one period from one server read, so the figures always share the dates. */
export function useMoneyReports(
    api: ApiLike,
    initial: ReportPeriodKey = "lastQuarter",
): MoneyReports {
    const [period, setPeriod] = useState<ReportPeriodKey>(initial);
    const [now] = useState(() => new Date());
    const zone = useBusinessZone();
    const span = useMemo(() => periodSpan(period, zone, now), [period, zone, now]);
    const remote = useRemote(
        () => api.get<ReportSummary>(`/v1/reports/summary?start=${span.start}&end=${span.end}`),
        `${span.start}:${span.end}`,
    );
    const view = useMemo(
        () => (remote.data === null ? null : buildView(remote.data, span, now, zone)),
        [remote.data, span, now, zone],
    );
    const empty =
        view !== null &&
        view.salesCents === 0 &&
        view.receivedCents === 0 &&
        view.items.length === 0 &&
        view.t4a.length === 0;
    const load = useLoad([remote], empty);
    return { period, setPeriod, span, load, view };
}

function fileName(kind: ExportKind, span: ReportSpan): string {
    return `${SERVER_KIND[kind]}-${span.start}-to-${span.end}.csv`;
}

function csvPath(kind: ExportKind, span: ReportSpan): string {
    if (kind === "t4a") return `/v1/reports/t4a.csv?year=${span.end.slice(0, 4)}`;
    return `/v1/reports/${SERVER_KIND[kind]}.csv?start=${span.start}&end=${span.end}`;
}

interface ReportFile {
    busyKind: ExportKind | null;
    done: string | null;
    error: string | null;
    download: (kind: ExportKind) => void;
}

/** One report as a CSV; the platform `save` seam is a Blob download on web and Share on mobile. */
export function useReportFile(
    api: ApiLike,
    span: ReportSpan,
    save: (csv: string, filename: string) => void | Promise<void>,
): ReportFile {
    const { busy, error, run } = useAsyncAction();
    const [busyKind, setBusyKind] = useState<ExportKind | null>(null);
    const [done, setDone] = useState<string | null>(null);
    return {
        busyKind: busy ? busyKind : null,
        done,
        error,
        download: (kind) => {
            setBusyKind(kind);
            setDone(null);
            const name = fileName(kind, span);
            run(
                async () => {
                    await save(await api.getText(csvPath(kind, span)), name);
                },
                {
                    onSuccess: () => {
                        setDone(strings.reports.downloaded(name));
                    },
                    errorMessage: strings.reports.downloadFailed,
                },
            );
        },
    };
}

export interface PackRequest {
    kinds: string[];
    start: string;
    end: string;
}

interface BookkeeperPack {
    chosen: readonly ExportKind[];
    toggle: (kind: ExportKind) => void;
    busy: boolean;
    error: string | null;
    done: boolean;
    download: () => void;
}

/** The platform callback saves or shares the generated ZIP. */
export function useBookkeeperPack(
    span: ReportSpan,
    downloadZip: (request: PackRequest, filename: string) => Promise<void>,
): BookkeeperPack {
    const [chosen, setChosen] = useState<ExportKind[]>(["income", "salesByItem", "gstHst", "pst"]);
    const [done, setDone] = useState(false);
    const { busy, error, setError, run } = useAsyncAction();
    return {
        chosen,
        toggle: (kind) => {
            setDone(false);
            setChosen((c) => (c.includes(kind) ? c.filter((k) => k !== kind) : [...c, kind]));
        },
        busy,
        error,
        done,
        download: () => {
            if (chosen.length === 0) {
                setError(strings.reports.pickReport);
                return;
            }
            const kinds = EXPORT_KINDS.filter((k) => chosen.includes(k)).map((k) => SERVER_KIND[k]);
            run(
                () =>
                    downloadZip(
                        { kinds, start: span.start, end: span.end },
                        `bookkeeper-${span.start}-to-${span.end}.zip`,
                    ),
                {
                    onSuccess: () => {
                        setDone(true);
                    },
                    errorMessage: strings.reports.packFailed,
                },
            );
        },
    };
}
