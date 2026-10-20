import { describe, expect, it } from "vitest";

import { strings } from "../strings";
import { type ClientRow, filterClients, visitPill } from "./clients";
import { zonedDate } from "../datetime";

const ZONE = "America/Vancouver";

const r = strings.clients.record;

const client = (id: string, name: string, email: string | null, phone: string | null) =>
    ({ id, name, email, phone, status: "active", lifetime_value_cents: null }) satisfies ClientRow;

const ROWS = [
    client("cl_ann", "Ann Tremblay", "ann@x.test", "+16045550001"),
    client("cl_ben", "ben", null, null),
    client("cl_cara", "Cara", "cara@studio.test", "+12505550202"),
];

describe("filterClients", () => {
    it("matches name and email without case, and phone digits as stored", () => {
        expect(filterClients(ROWS, "")).toBe(ROWS);
        expect(filterClients(ROWS, "   ")).toBe(ROWS);
        expect(filterClients(ROWS, "ANN").map((c) => c.id)).toEqual(["cl_ann"]);
        expect(filterClients(ROWS, " Ben ").map((c) => c.id)).toEqual(["cl_ben"]);
        expect(filterClients(ROWS, "studio.TEST").map((c) => c.id)).toEqual(["cl_cara"]);
        expect(filterClients(ROWS, "604555").map((c) => c.id)).toEqual(["cl_ann"]);
        expect(filterClients(ROWS, ".test").map((c) => c.id)).toEqual(["cl_ann", "cl_cara"]);
        expect(filterClients(ROWS, "zzz")).toEqual([]);
    });
});

describe("visitPill", () => {
    type Visit = Parameters<typeof visitPill>[0];
    const now = zonedDate(2026, 10, 7, 12, 0, ZONE);
    const visit = (extra: Partial<Visit>): Visit => ({
        id: "bk_1",
        status: "confirmed",
        subjectId: null,
        start: zonedDate(2026, 10, 8, 10, 0, ZONE),
        end: zonedDate(2026, 10, 8, 11, 0, ZONE),
        service: "Groom",
        color: null,
        staffName: null,
        depositCents: 0,
        depositStatus: "none",
        waitlistClosed: false,
        ...extra,
    });

    it("marks a visit under way, from the minute it starts", () => {
        const pill = { label: r.inProgress, intent: "accent" };
        expect(visitPill(visit({ start: now, depositCents: 2000 }), now)).toEqual(pill);
        expect(visitPill(visit({ start: zonedDate(2026, 10, 7, 11, 59, ZONE) }), now)).toEqual(
            pill,
        );
    });

    it("shows a coming visit's deposit as paid or due, and nothing without one", () => {
        expect(visitPill(visit({}), now)).toBeNull();
        expect(visitPill(visit({ depositCents: 2000, depositStatus: "collected" }), now)).toEqual({
            label: r.depositPaid("$20.00"),
            intent: "success",
        });
        expect(visitPill(visit({ depositCents: 2000, depositStatus: "applied" }), now)).toEqual({
            label: r.depositPaid("$20.00"),
            intent: "success",
        });
        expect(visitPill(visit({ depositCents: 1875, depositStatus: "pending" }), now)).toEqual({
            label: r.depositDue("$18.75"),
            intent: "warning",
        });
    });
});
