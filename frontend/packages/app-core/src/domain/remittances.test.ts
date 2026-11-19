// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { BusinessZoneContext, formatDate, formatShortDay, zonedDate } from "../datetime";
import { formatList } from "../format";
import { strings } from "../strings";
import { type FilingPeriod, filingWhen, useFilingForm, useTaxFilings } from "./remittances";

afterEach(cleanup);

const ZONE = "America/Vancouver";

const r = strings.remittances;

interface FiledReturn {
    id: string;
    family: "federal" | "provincial" | null;
    period_start: string;
    period_end: string;
    by_code: Record<string, number>;
    itc_cents: number;
    paid_cents: number;
    confirmation: string | null;
    filed_on: string;
}

const due = zonedDate(2026, 7, 31, 12, 0, ZONE);

function period(extra: Partial<FilingPeriod>): FilingPeriod {
    return {
        key: "2026-04-01",
        start: "2026-04-01",
        end: "2026-06-30",
        title: "Q2 2026",
        span: "",
        due,
        daysToDue: 10,
        status: "due",
        federalCents: 0,
        provincialCents: 0,
        taxableCents: 0,
        provincialTaxableCents: 0,
        federalStatus: "due",
        provincialStatus: "none",
        federalSpan: "",
        provincialSpan: "",
        ...extra,
    };
}

const filed = (family: FiledReturn["family"], on: string): FiledReturn => ({
    id: `rt_${on}`,
    family,
    period_start: "2026-04-01",
    period_end: "2026-06-30",
    by_code: {},
    itc_cents: 0,
    paid_cents: 0,
    confirmation: null,
    filed_on: on,
});

describe("filingWhen", () => {
    it("says filed, never due, for a filed period", () => {
        for (const daysToDue of [10, 0, -30]) {
            expect(filingWhen(period({ status: "filed", daysToDue }), ZONE)).toBe(r.filed);
        }
    });

    it("counts down to the due date and flags a late one", () => {
        expect(filingWhen(period({ daysToDue: 10 }), ZONE)).toBe(
            r.dueIn(10, formatShortDay(due, ZONE)),
        );
        expect(filingWhen(period({ daysToDue: 0 }), ZONE)).toBe(
            r.dueIn(0, formatShortDay(due, ZONE)),
        );
        expect(filingWhen(period({ daysToDue: -1 }), ZONE)).toBe(
            r.overdue(formatShortDay(due, ZONE)),
        );
        expect(filingWhen(period({ status: "open", daysToDue: 40 }), ZONE)).toBe(
            r.dueOn(formatShortDay(due, ZONE)),
        );
    });
});

const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(BusinessZoneContext.Provider, { value: ZONE }, children);

function api(get: ApiLike["get"], post: ApiLike["post"] = vi.fn()): ApiLike {
    return { get, getText: vi.fn(), post, patch: vi.fn(), delete: vi.fn() };
}

const row = (
    start: string,
    end: string,
    federal: string,
    provincial: string,
): {
    start: string;
    end: string;
    due: string;
    federal_cents: number;
    provincial_cents: number;
    taxable_cents: number;
    provincial_taxable_cents: number;
    federal_status: string;
    provincial_status: string;
    returns: FiledReturn[];
} => ({
    start,
    end,
    due: "2027-01-31",
    federal_cents: 1000,
    provincial_cents: 700,
    taxable_cents: 20000,
    provincial_taxable_cents: 10000,
    federal_status: federal,
    provincial_status: provincial,
    returns: [],
});

const filings = (periods: ReturnType<typeof row>[]) => ({
    frequency: "quarterly",
    registered: true,
    federal_code: "GST",
    provincial_code: "PST",
    provincial_rate_bps: 700,
    gst_hst_number: null,
    qst_number: null,
    federal_set_aside_cents: 1000,
    provincial_set_aside_cents: 1400,
    next_due: "2026-10-31",
    periods,
});

describe("useTaxFilings", () => {
    it("takes a period's state from the server and lists only GST/HST still to file", async () => {
        const get = vi.fn(() =>
            Promise.resolve(
                filings([
                    row("2026-10-01", "2026-12-31", "open", "open"),
                    row("2026-07-01", "2026-09-30", "filed", "due"),
                ]),
            ),
        );
        const { result } = renderHook(() => useTaxFilings(api(get as ApiLike["get"])), {
            wrapper,
        });
        await waitFor(() => {
            expect(result.current.periods).toHaveLength(2);
        });
        const [open, partly] = result.current.periods;
        expect(open?.status).toBe("open");
        expect(partly?.status).toBe("due");
        expect(result.current.federalUnfiled.map((p) => p.start)).toEqual(["2026-10-01"]);
        expect(result.current.nextDue?.start).toBe("2026-07-01");
    });

    it("shows a return that covers both taxes once, as the federal one", async () => {
        const both = { ...filed(null, "2026-10-20"), period_start: "2026-07-01" };
        const get = vi.fn(() =>
            Promise.resolve(
                filings([
                    { ...row("2026-07-01", "2026-09-30", "filed", "filed"), returns: [both] },
                ]),
            ),
        );
        const { result } = renderHook(() => useTaxFilings(api(get as ApiLike["get"])), {
            wrapper,
        });
        await waitFor(() => {
            expect(result.current.history).toHaveLength(1);
        });
        const [shown] = result.current.history;
        expect([shown?.federalPaidCents, shown?.hasProvincial]).toEqual([both.paid_cents, false]);
    });

    it("adds up a tax filed in parts, and lists a period once one of its returns is in", async () => {
        const ret = (
            family: FiledReturn["family"],
            start: string,
            end: string,
            paid: number,
            confirmation: string,
        ): FiledReturn => ({
            ...filed(family, "2026-10-05"),
            id: `rt_${confirmation}`,
            period_start: start,
            period_end: end,
            paid_cents: paid,
            confirmation,
        });
        const get = vi.fn(() =>
            Promise.resolve(
                filings([
                    {
                        ...row("2026-07-01", "2026-09-30", "filed", "filed"),
                        returns: [
                            ret("federal", "2026-07-01", "2026-09-30", 900, "CRA-1"),
                            ret("provincial", "2026-07-01", "2026-07-31", 300, "BC-1"),
                            ret("provincial", "2026-08-01", "2026-09-30", 400, "BC-2"),
                        ],
                    },
                    {
                        ...row("2026-04-01", "2026-06-30", "filed", "due"),
                        returns: [ret("federal", "2026-04-01", "2026-06-30", 500, "CRA-0")],
                    },
                    {
                        ...row("2026-01-01", "2026-03-31", "due", "due"),
                        returns: [ret("provincial", "2026-02-01", "2026-02-28", 100, "BC-0")],
                    },
                ]),
            ),
        );
        const { result } = renderHook(() => useTaxFilings(api(get as ApiLike["get"])), {
            wrapper,
        });
        await waitFor(() => {
            expect(result.current.history).toHaveLength(3);
        });
        const [whole, gstOnly, partlyFiled] = result.current.history;
        expect([whole?.federalPaidCents, whole?.provincialPaidCents]).toEqual([900, 700]);
        expect([whole?.federalConfirmations, whole?.provincialConfirmations]).toEqual([
            ["CRA-1"],
            ["BC-1", "BC-2"],
        ]);
        const day = (y: number, m: number, d: number, full = false) => {
            const at = zonedDate(y, m, d, 12, 0, ZONE);
            return full ? formatDate(at, ZONE) : formatShortDay(at, ZONE);
        };
        expect(whole?.span).toBe(r.span(day(2026, 7, 1), day(2026, 9, 30, true)));
        expect([gstOnly?.hasProvincial, gstOnly?.federalPaidCents]).toEqual([false, 500]);
        expect([partlyFiled?.title, partlyFiled?.span]).toEqual([
            r.quarter(1, 2026),
            r.span(day(2026, 2, 1), day(2026, 2, 28, true)),
        ]);
        const partly = result.current.periods[2];
        expect(partly?.federalSpan).toBe(partly?.span);
        expect(partly?.provincialSpan).toBe(
            formatList([
                r.span(day(2026, 1, 1), day(2026, 1, 31, true)),
                r.span(day(2026, 3, 1), day(2026, 3, 31, true)),
            ]),
        );
    });

    it("lists each return once under its own dates after the filing frequency changes", async () => {
        const quarter = {
            ...filed("federal", "2026-10-10"),
            id: "rt_q3",
            period_start: "2026-07-01",
            period_end: "2026-09-30",
            paid_cents: 900,
        };
        const october = {
            ...filed("federal", "2026-11-10"),
            id: "rt_oct",
            period_start: "2026-10-01",
            period_end: "2026-10-31",
            paid_cents: 300,
        };
        const month = (start: string, end: string, status: string) => ({
            ...row(start, end, status, "none"),
            returns: start < "2026-10-01" ? [quarter] : [october],
        });
        const get = vi.fn(() =>
            Promise.resolve({
                ...filings([
                    month("2026-10-01", "2026-10-31", "filed"),
                    month("2026-09-01", "2026-09-30", "filed"),
                    month("2026-08-01", "2026-08-31", "filed"),
                    month("2026-07-01", "2026-07-31", "filed"),
                ]),
                frequency: "monthly",
            }),
        );
        const { result } = renderHook(() => useTaxFilings(api(get as ApiLike["get"])), {
            wrapper,
        });
        await waitFor(() => {
            expect(result.current.history).toHaveLength(2);
        });
        const day = (m: number, d: number, full = false) => {
            const at = zonedDate(2026, m, d, 12, 0, ZONE);
            return full ? formatDate(at, ZONE) : formatShortDay(at, ZONE);
        };
        expect(result.current.history.map((h) => [h.span, h.federalPaidCents])).toEqual([
            [r.span(day(10, 1), day(10, 31, true)), 300],
            [r.span(day(7, 1), day(9, 30, true)), 900],
        ]);
        expect(result.current.history[1]?.title).toBe(r.quarter(3, 2026));

        get.mockResolvedValue(
            filings([
                {
                    ...row("2026-10-01", "2026-12-31", "open", "none"),
                    returns: [october],
                },
            ]),
        );
        act(() => {
            result.current.refresh();
        });
        await waitFor(() => {
            expect(result.current.history[0]?.title).toBe(r.quarter(4, 2026));
        });
        expect(result.current.history[0]?.span).toBe(r.span(day(10, 1), day(10, 31, true)));
    });

    it("stays on screen while it refreshes, so an open form keeps its answer", async () => {
        const first = filings([row("2026-07-01", "2026-09-30", "due", "due")]);
        const get = vi.fn(() => Promise.resolve(first));
        const { result } = renderHook(() => useTaxFilings(api(get as ApiLike["get"])), {
            wrapper,
        });
        await waitFor(() => {
            expect(result.current.load.state).toBe("ready");
        });
        get.mockReturnValueOnce(new Promise(() => undefined));
        act(() => {
            result.current.refresh();
        });
        expect(get).toHaveBeenCalledTimes(2);
        expect(result.current.load.state).toBe("ready");
    });

    it("stays on screen when a refresh fails", async () => {
        const get = vi.fn(() =>
            Promise.resolve(filings([row("2026-07-01", "2026-09-30", "due", "due")])),
        );
        const { result } = renderHook(() => useTaxFilings(api(get as ApiLike["get"])), {
            wrapper,
        });
        await waitFor(() => {
            expect(result.current.load.state).toBe("ready");
        });
        get.mockReturnValueOnce(Promise.reject(new Error("offline")));
        act(() => {
            result.current.refresh();
        });
        await waitFor(() => {
            expect(get).toHaveBeenCalledTimes(2);
        });
        await act(() => Promise.resolve());
        expect(result.current.load.state).toBe("ready");
        expect(result.current.periods).toHaveLength(1);
    });
});

const DUE = period({ federalCents: 1000, federalStatus: "due", end: "2026-09-30" });

function form(post: ApiLike["post"], onStale = vi.fn()) {
    return renderHook(() => useFilingForm(api(vi.fn(), post), DUE, vi.fn(), onStale), {
        wrapper,
    });
}

describe("useFilingForm", () => {
    it("refuses a filing day inside the period without sending it", () => {
        const post = vi.fn();
        const { result } = form(post as ApiLike["post"]);
        act(() => {
            result.current.setConfirmation("CRA-1");
        });
        act(() => {
            result.current.setFiledOn("2026-09-30");
        });
        act(() => {
            result.current.submit();
        });
        expect(result.current.error).toBe(r.errors.filedOn);
        expect(post).not.toHaveBeenCalled();
    });

    it("clears the answers when it moves to the other return", () => {
        const both = period({ ...DUE, provincialCents: 700, provincialStatus: "due" });
        const { result } = renderHook(
            () => useFilingForm(api(vi.fn(), vi.fn()), both, vi.fn(), vi.fn()),
            { wrapper },
        );
        act(() => {
            result.current.setItc("1.00");
        });
        act(() => {
            result.current.setConfirmation("CRA-1");
        });
        act(() => {
            result.current.setFamily("provincial");
        });
        expect([result.current.family, result.current.itc, result.current.confirmation]).toEqual([
            "provincial",
            "",
            "",
        ]);
    });

    it("sends the tax it showed, so a return that changed since is refused", () => {
        const post = vi.fn(() => Promise.resolve({}));
        const { result } = form(post as ApiLike["post"]);
        act(() => {
            result.current.setConfirmation("CRA-1");
        });
        act(() => {
            result.current.submit();
        });
        expect(post).toHaveBeenCalledWith(
            "/v1/payments/remittances",
            expect.objectContaining({ family: "federal", tax_cents: 1000 }),
            expect.anything(),
        );
    });

    it.each([
        ["return_filed", strings.api.returnFiled, 1],
        ["return_changed", strings.api.returnChanged, 1],
        ["period_open", strings.api.periodOpen, 0],
        ["invalid_filed_on", r.errors.filedOn, 0],
        ["invalid_itc", r.errors.itcTooHigh, 0],
        [null, r.errors.filingFailed, 0],
    ])("says why the server refused %s", async (code, message, stale) => {
        const refused = Object.assign(new Error("POST → 4xx"), { status: 409, code });
        const post = vi.fn(() => Promise.reject(refused));
        const onStale = vi.fn();
        const { result } = form(post, onStale);
        act(() => {
            result.current.setConfirmation("CRA-1");
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(result.current.error).toBe(message);
        });
        expect(onStale).toHaveBeenCalledTimes(stale);
    });

    it("records a period with more refunded than collected, with no credits to claim", () => {
        const post = vi.fn(() => Promise.resolve({}));
        const refund = period({ ...DUE, federalCents: -300 });
        const { result } = renderHook(
            () => useFilingForm(api(vi.fn(), post as ApiLike["post"]), refund, vi.fn(), vi.fn()),
            { wrapper },
        );
        act(() => {
            result.current.setConfirmation("CRA-1");
        });
        act(() => {
            result.current.submit();
        });
        expect(result.current.error).toBeNull();
        expect(result.current.netCents).toBe(-300);
        expect(post).toHaveBeenCalledTimes(1);
    });
});
