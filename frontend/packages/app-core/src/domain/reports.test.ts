// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { BusinessZoneContext, zonedDate } from "../datetime";
import { periodSpan, spanLabel, useMoneyReports, useReportFile } from "./reports";

afterEach(cleanup);

const ZONE = "America/Vancouver";

const now = zonedDate(2026, 10, 6, 12, 0, ZONE);

describe("periodSpan", () => {
    it("covers this month up to today", () => {
        expect(periodSpan("thisMonth", ZONE, now)).toEqual({
            start: "2026-10-01",
            end: "2026-10-06",
        });
    });

    it("covers the whole of last month", () => {
        expect(periodSpan("lastMonth", ZONE, now)).toEqual({
            start: "2026-09-01",
            end: "2026-09-30",
        });
        expect(periodSpan("lastMonth", ZONE, zonedDate(2026, 1, 15, 0, 0, ZONE))).toEqual({
            start: "2025-12-01",
            end: "2025-12-31",
        });
    });

    it("covers the last full quarter, across a year end", () => {
        expect(periodSpan("lastQuarter", ZONE, now)).toEqual({
            start: "2026-07-01",
            end: "2026-09-30",
        });
        expect(periodSpan("lastQuarter", ZONE, zonedDate(2026, 2, 2, 0, 0, ZONE))).toEqual({
            start: "2025-10-01",
            end: "2025-12-31",
        });
    });

    it("covers the year so far", () => {
        expect(periodSpan("ytd", ZONE, now)).toEqual({ start: "2026-01-01", end: "2026-10-06" });
    });

    it("names a span in words", () => {
        expect(spanLabel({ start: "2026-07-01", end: "2026-09-30" })).toBe("Jul 1 to Sep 30, 2026");
    });
});

const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(BusinessZoneContext.Provider, { value: ZONE }, children);

function summary(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        start: "2026-03-01",
        end: "2026-03-31",
        income: {
            sales_cents: 0,
            refunds_cents: 0,
            net_cents: 0,
            tax_by_code: {},
            tips_cents: 0,
            received_cents: 0,
            by_method: {},
        },
        sales_by_item: [],
        gst_hst: { tax_collected_cents: 0, taxable_sales_cents: 0, gst_hst_number: null },
        provincial: {
            code: "PST",
            rate_bps: 700,
            taxable_cents: 0,
            collected_cents: 0,
            number: null,
        },
        t4a_year: 2026,
        t4a: [],
        months: [],
        payouts: [],
        staff_pay: 0,
        rates: [],
        ...extra,
    };
}

function api(body: Record<string, unknown>, csv = ""): ApiLike & { paths: string[] } {
    const paths: string[] = [];
    return {
        paths,
        get: <T>(path: string) => {
            paths.push(path);
            return Promise.resolve(body as T);
        },
        getText: (path: string) => {
            paths.push(path);
            return Promise.resolve(csv);
        },
        post: () => Promise.reject(new Error("unused")),
        patch: () => Promise.reject(new Error("unused")),
        delete: () => Promise.reject(new Error("unused")),
    };
}

async function loaded(body: Record<string, unknown>) {
    const { result } = renderHook(() => useMoneyReports(api(body), "lastMonth"), { wrapper });
    await waitFor(() => {
        expect(result.current.load.state).not.toBe("loading");
    });
    return result.current;
}

const payee = { staff_id: "st_1", name: "Ana", payments: 1, total_cents: 25000, tips_cents: 0 };

describe("useMoneyReports", () => {
    it("reads a period with nothing in it as empty though the year has T4A payees", async () => {
        expect((await loaded(summary({ t4a: [payee] }))).load.state).toBe("empty");
    });

    it("still shows the year's T4A in a quiet period, and nothing else", async () => {
        const quiet = await loaded(summary({ t4a: [payee] }));
        expect(quiet.shows("t4a")).toBe(true);
        expect(quiet.shows("income")).toBe(false);
        expect((await loaded(summary())).shows("t4a")).toBe(false);
    });

    it("keeps a period whose only activity is money given back exportable", async () => {
        const income = {
            sales_cents: 0,
            refunds_cents: 5000,
            net_cents: -5000,
            tax_by_code: { GST: -250, PST: -350 },
            tips_cents: 0,
            received_cents: 0,
            by_method: {},
        };
        const lost = await loaded(summary({ income }));
        expect(lost.load.state).toBe("ready");
        expect(lost.shows("income")).toBe(true);
    });

    it("keeps a period whose only activity is a payout or staff pay exportable", async () => {
        expect((await loaded(summary({ payouts: [{ id: "jrn_1" }] }))).load.state).toBe("ready");
        expect((await loaded(summary({ staff_pay: 1, t4a: [payee] }))).load.state).toBe("ready");
    });

    it("counts every income CSV row the pack will hold", async () => {
        const income = {
            sales_cents: 11000,
            refunds_cents: 2000,
            net_cents: 9000,
            tax_by_code: { GST: 450, PST: 280 },
            tips_cents: 0,
            received_cents: 9730,
            by_method: { cash: 9730 },
        };
        const view = (await loaded(summary({ income }))).view;
        // sales, refunds, net, two taxes, sales with tax, tips, received and one method
        expect(view?.rows.income).toBe(9);
        expect(view?.salesWithTaxCents).toBe(9730);
    });
});

describe("useReportFile", () => {
    it("names the T4A for its calendar year and every other report for the period", async () => {
        const fake = api(summary(), "csv");
        const save = vi.fn();
        const span = { start: "2026-11-01", end: "2026-11-14" };
        const { result } = renderHook(() => useReportFile(fake, span, save));
        act(() => {
            result.current.download("t4a");
        });
        await waitFor(() => {
            expect(save).toHaveBeenCalledWith("csv", "t4a-2026.csv");
        });
        act(() => {
            result.current.download("salesByItem");
        });
        await waitFor(() => {
            expect(save).toHaveBeenCalledWith("csv", "sales-by-item-2026-11-01-to-2026-11-14.csv");
        });
        expect(fake.paths).toEqual([
            "/v1/reports/t4a.csv?year=2026",
            "/v1/reports/sales-by-item.csv?start=2026-11-01&end=2026-11-14",
        ]);
    });
});
