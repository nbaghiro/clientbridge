import { describe, expect, it } from "vitest";

import { formatShortDay, zonedDate } from "../datetime";
import { strings } from "../strings";
import { type FilingPeriod, filingWhen } from "./remittances";

const ZONE = "America/Vancouver";

const r = strings.remittances;

type FiledReturn = NonNullable<FilingPeriod["federalReturn"]>;

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
                ZONE,
            ),
        ).toBe(r.filedOn(formatShortDay(zonedDate(2026, 7, 15, 12, 0, ZONE), ZONE)));
        expect(
            filingWhen(
                period({ status: "filed", provincialReturn: filed("provincial", "2026-07-20") }),
                ZONE,
            ),
        ).toBe(r.filedOn(formatShortDay(zonedDate(2026, 7, 20, 12, 0, ZONE), ZONE)));
    });

    it("says filed, never due, for a filed period with no return row", () => {
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
