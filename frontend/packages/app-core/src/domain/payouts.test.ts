import { describe, expect, it } from "vitest";

import { CALENDAR, formatShortDay } from "../datetime";
import { strings } from "../strings";
import { payoutWhen } from "./payouts";

describe("payoutWhen", () => {
    const row = {
        id: "jrn_one",
        amount_cents: 1890,
        occurred_at: "2026-10-27 18:00:00+00",
    };

    it("shows Stripe's arrival day in a zone where its midnight UTC is still the day before", () => {
        const when = payoutWhen(
            { ...row, arrival_at: "2026-10-28 00:00:00+00", status: "paid" },
            "America/Vancouver",
        );
        expect(when).toBe(
            strings.payouts.arrived(formatShortDay(new Date(Date.UTC(2026, 9, 28)), CALENDAR)),
        );
    });

    it("shows a payout without an arrival on the business's own day", () => {
        const when = payoutWhen(
            { ...row, occurred_at: "2026-10-28 02:00:00+00", arrival_at: null, status: "pending" },
            "America/Vancouver",
        );
        expect(when).toBe(
            strings.payouts.expected(formatShortDay(new Date(Date.UTC(2026, 9, 27)), CALENDAR)),
        );
    });
});
