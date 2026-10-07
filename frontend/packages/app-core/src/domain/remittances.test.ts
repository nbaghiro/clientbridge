import { describe, expect, it } from "vitest";

import { formatShortDay } from "../datetime";
import { strings } from "../strings";
import { type FilingPeriod, filingWhen } from "./remittances";

const r = strings.remittances;

type FiledReturn = NonNullable<FilingPeriod["federalReturn"]>;

const due = new Date(2026, 6, 31, 12);

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
        federalReturn: null,
        provincialReturn: null,
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
    it("says when a filed period was filed, federal return first", () => {
        expect(
            filingWhen(
                period({
                    status: "filed",
                    federalReturn: filed("federal", "2026-07-15"),
                    provincialReturn: filed("provincial", "2026-07-20"),
                }),
            ),
        ).toBe(r.filedOn(formatShortDay(new Date(2026, 6, 15, 12))));
        expect(
            filingWhen(
                period({ status: "filed", provincialReturn: filed("provincial", "2026-07-20") }),
            ),
        ).toBe(r.filedOn(formatShortDay(new Date(2026, 6, 20, 12))));
    });

    it("says filed, never due, for a filed period with no return row", () => {
        for (const daysToDue of [10, 0, -30]) {
            expect(filingWhen(period({ status: "filed", daysToDue }))).toBe(r.filed);
        }
    });

    it("counts down to the due date and flags a late one", () => {
        expect(filingWhen(period({ daysToDue: 10 }))).toBe(r.dueIn(10, formatShortDay(due)));
        expect(filingWhen(period({ daysToDue: 0 }))).toBe(r.dueIn(0, formatShortDay(due)));
        expect(filingWhen(period({ daysToDue: -1 }))).toBe(r.overdue(formatShortDay(due)));
        expect(filingWhen(period({ status: "open", daysToDue: 40 }))).toBe(
            r.dueOn(formatShortDay(due)),
        );
    });
});
