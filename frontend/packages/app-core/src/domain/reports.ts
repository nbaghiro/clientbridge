import { useEffect, useState } from "react";

import { useAsyncAction } from "../hooks/useAsyncAction";
import { strings } from "../strings";
import type { ApiLike } from "../util/api";

export interface IncomeReport {
    gross_cents: number;
    refunds_cents: number;
    net_cents: number;
    by_method: Record<string, number>;
}

export interface GstHstReport {
    tax_collected_cents: number; // federal GST/HST only
    pst_cents: number; // provincial PST (BC/SK/MB), filed separately
    qst_cents: number; // QST, filed with Revenu Québec
    taxable_sales_cents: number;
    gst_hst_number: string | null;
}

export interface T4ARow {
    staff_id: string;
    name: string;
    total_cents: number;
}

export interface ReportRange {
    start: string; // income/GST window start (YYYY-MM-DD)
    end: string; // income/GST window end (YYYY-MM-DD)
    year: number; // T4A calendar year
}

export type ReportCsvKind = "income" | "gst-hst" | "t4a";

export interface ReportsView {
    income: IncomeReport | null;
    gstHst: GstHstReport | null;
    t4a: T4ARow[] | null;
    loading: boolean;
    error: boolean;
}

/** The financial report period for a calendar year (income/GST span the year; T4A keys off it).
 *  The current year ends today so partial-year totals match the dashboard. */
export function reportRangeForYear(year: number, now: Date = new Date()): ReportRange {
    const pad = (n: number): string => `${n}`.padStart(2, "0");
    const end =
        year === now.getFullYear()
            ? `${year}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
            : `${year}-12-31`;
    return { start: `${year}-01-01`, end, year };
}

export function defaultReportRange(now: Date = new Date()): ReportRange {
    return reportRangeForYear(now.getFullYear(), now);
}

/** Owner/admin money reports (REST). All three load together; `error` covers a 403 for staff. */
export function useReports(api: ApiLike, range: ReportRange): ReportsView {
    const [income, setIncome] = useState<IncomeReport | null>(null);
    const [gstHst, setGstHst] = useState<GstHstReport | null>(null);
    const [t4a, setT4a] = useState<T4ARow[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    const { start, end, year } = range;
    useEffect(() => {
        let active = true;
        setLoading(true);
        setError(false);
        const window = `start=${start}&end=${end}`;
        Promise.all([
            api.get<IncomeReport>(`/v1/reports/income?${window}`),
            api.get<GstHstReport>(`/v1/reports/gst-hst?${window}`),
            api.get<T4ARow[]>(`/v1/reports/t4a?year=${year}`),
        ])
            .then(([inc, gst, rows]) => {
                if (!active) return;
                setIncome(inc);
                setGstHst(gst);
                setT4a(rows);
            })
            .catch(() => {
                if (active) setError(true);
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [api, start, end, year]);

    return { income, gstHst, t4a, loading, error };
}

export function reportCsvPath(kind: ReportCsvKind, range: ReportRange): string {
    if (kind === "t4a") return `/v1/reports/t4a.csv?year=${range.year}`;
    return `/v1/reports/${kind}.csv?start=${range.start}&end=${range.end}`;
}

export function reportCsvFilename(kind: ReportCsvKind): string {
    return `${kind}.csv`;
}

/** Fetch a report's CSV body. The URL/params are shared here; each platform saves or shares the
 *  returned text (web: Blob download; mobile: Share). */
export function downloadReportCsv(
    api: ApiLike,
    kind: ReportCsvKind,
    range: ReportRange,
): Promise<string> {
    return api.getText(reportCsvPath(kind, range));
}

export interface ReportDownload {
    error: string | null;
    /** Whether `kind` is the report currently being fetched. */
    isDownloading: (kind: ReportCsvKind) => boolean;
    download: (kind: ReportCsvKind) => void;
}

/** Shared CSV-export view-model: tracks which report is downloading + the error, fetches the CSV
 *  body, and hands it (with a filename) to the platform `save` seam — the only difference between
 *  web (Blob/anchor) and mobile (Share). */
export function useReportDownload(
    api: ApiLike,
    range: ReportRange,
    save: (csv: string, filename: string) => void | Promise<void>,
): ReportDownload {
    const { busy, error, run } = useAsyncAction();
    const [downloading, setDownloading] = useState<ReportCsvKind | null>(null);

    const download = (kind: ReportCsvKind): void => {
        setDownloading(kind);
        run(
            async () => {
                const csv = await downloadReportCsv(api, kind, range);
                await save(csv, reportCsvFilename(kind));
            },
            { errorMessage: strings.reports.exportError },
        );
    };

    return { error, isDownloading: (kind) => busy && downloading === kind, download };
}
