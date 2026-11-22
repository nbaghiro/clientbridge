// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { strings } from "../strings";
import { BusinessZoneContext, zonedDate } from "../datetime";
import {
    type ExportKind,
    periodSpan,
    spanLabel,
    useBookkeeperPack,
    useMoneyReports,
    useReportFile,
} from "./reports";

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

    it("lists federal taxes first, then provincial, each by code", async () => {
        const income = {
            sales_cents: 10000,
            refunds_cents: 0,
            net_cents: 10000,
            tax_by_code: { PST: 700, HST: 300, GST: 200 },
            tips_cents: 0,
            received_cents: 0,
            by_method: {},
        };
        const view = (await loaded(summary({ income }))).view;
        expect(view?.taxLines.map((t) => t.code)).toEqual(["GST", "HST", "PST"]);
    });
});

describe("useReportFile", () => {
    it("names the T4A for its calendar year and every other report for the period", async () => {
        const fake = api(summary(), "csv");
        const save = vi.fn();
        const span = { start: "2026-11-01", end: "2026-11-14" };
        const { result } = renderHook(() => useReportFile(fake, span, null, save));
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

describe("useReportFile notices", () => {
    const november = { start: "2026-11-01", end: "2026-11-14" };
    const october = { start: "2026-10-01", end: "2026-10-31" };

    function render(fake: ApiLike) {
        return renderHook(
            ({ span, shown }: { span: typeof november; shown: ExportKind }) =>
                useReportFile(fake, span, shown, () => undefined),
            { initialProps: { span: november, shown: "income" } },
        );
    }

    it("shows the download notice only on its own report and period", async () => {
        const { result, rerender } = render(api(summary(), "csv"));
        act(() => {
            result.current.download("income");
        });
        await waitFor(() => {
            expect(result.current.done).toBe(
                strings.reports.downloaded("income-2026-11-01-to-2026-11-14.csv"),
            );
        });
        rerender({ span: november, shown: "salesByItem" });
        expect(result.current.done).toBeNull();
        rerender({ span: october, shown: "income" });
        expect(result.current.done).toBeNull();
        rerender({ span: november, shown: "income" });
        expect(result.current.done).not.toBeNull();
    });

    it("keeps a failed download's error on the report that failed", async () => {
        const failing = {
            ...api(summary()),
            getText: () => Promise.reject(new TypeError("offline")),
        };
        const { result, rerender } = render(failing);
        act(() => {
            result.current.download("income");
        });
        await waitFor(() => {
            expect(result.current.error).toBe(strings.reports.downloadFailed);
        });
        rerender({ span: october, shown: "income" });
        expect(result.current.error).toBeNull();
    });

    it("ignores another report's download while one is running", async () => {
        let finish: (csv: string) => void = () => undefined;
        const fake = api(summary());
        const slow = {
            ...fake,
            getText: (path: string) => {
                fake.paths.push(path);
                return new Promise<string>((resolve) => {
                    finish = resolve;
                });
            },
        };
        const { result, rerender } = render(slow);
        act(() => {
            result.current.download("income");
        });
        await waitFor(() => {
            expect(result.current.busyKind).toBe("income");
        });
        rerender({ span: november, shown: "salesByItem" });
        act(() => {
            result.current.download("salesByItem");
        });
        expect(result.current.busyKind).toBe("income");
        act(() => {
            finish("csv");
        });
        await waitFor(() => {
            expect(result.current.busyKind).toBeNull();
        });
        expect(fake.paths).toEqual(["/v1/reports/income.csv?start=2026-11-01&end=2026-11-14"]);
        expect(result.current.done).toBeNull();
        rerender({ span: november, shown: "income" });
        expect(result.current.done).toBe(
            strings.reports.downloaded("income-2026-11-01-to-2026-11-14.csv"),
        );
    });
});

describe("useBookkeeperPack", () => {
    const november = { start: "2026-11-01", end: "2026-11-14" };
    const october = { start: "2026-10-01", end: "2026-10-31" };

    function render(bytes: Uint8Array<ArrayBuffer>) {
        const posted: unknown[] = [];
        const save = vi.fn();
        const fake = {
            postBytes: (path: string, body: unknown) => {
                posted.push([path, body]);
                return Promise.resolve(bytes);
            },
        };
        const hook = renderHook(({ span }) => useBookkeeperPack(fake, span, save), {
            initialProps: { span: november },
        });
        return { ...hook, posted, save };
    }

    it("posts the chosen reports and saves the ZIP under the period's name", async () => {
        const zip = new Uint8Array([0x50, 0x4b, 3, 4]);
        const { result, posted, save } = render(zip);
        act(() => {
            result.current.download();
        });
        await waitFor(() => {
            expect(result.current.done).toBe(true);
        });
        expect(posted).toEqual([
            [
                "/v1/reports/export",
                {
                    kinds: ["income", "sales-by-item", "gst-hst", "pst"],
                    start: "2026-11-01",
                    end: "2026-11-14",
                },
            ],
        ]);
        expect(save).toHaveBeenCalledWith(zip, "bookkeeper-2026-11-01-to-2026-11-14.zip");
    });

    it("refuses an empty ZIP instead of saving it", async () => {
        const { result, save } = render(new Uint8Array());
        act(() => {
            result.current.download();
        });
        await waitFor(() => {
            expect(result.current.error).toBe(strings.reports.packFailed);
        });
        expect(result.current.done).toBe(false);
        expect(save).not.toHaveBeenCalled();
    });

    it("drops the outcome once the period changes", async () => {
        const { result, rerender } = render(new Uint8Array([1]));
        act(() => {
            result.current.download();
        });
        await waitFor(() => {
            expect(result.current.done).toBe(true);
        });
        rerender({ span: october });
        expect(result.current.done).toBe(false);
    });
});
