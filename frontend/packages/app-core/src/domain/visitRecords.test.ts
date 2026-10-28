import { describe, expect, it } from "vitest";

import { strings } from "../strings";
import { type VisitRecord, canKeepRecords, recordByline, recordVisit } from "./visitRecords";

const ZONE = "America/Vancouver";

function record(extra: Partial<VisitRecord> = {}): VisitRecord {
    return {
        id: "vr_1",
        form_id: "frm_soap",
        form_name: "SOAP note",
        client_id: "cl_1",
        booking_id: "bk_1",
        visit_at: "2026-10-07T21:00:00Z",
        service: "60 minute massage",
        written_at: "2026-10-07T22:20:00Z",
        fields: [],
        answers: {},
        author_staff_id: "st_1",
        author_name: "Amy Chen",
        amends: null,
        ...extra,
    };
}

describe("recordByline", () => {
    it("names the author and the time, and marks an amendment", () => {
        expect(recordByline(record(), ZONE)).toBe("Amy Chen · October 7, 2026 at 3:20 p.m.");
        expect(recordByline(record({ amends: "vr_0" }), ZONE)).toContain(
            strings.visitRecords.amendment,
        );
        expect(recordVisit(record(), ZONE)).toBe("60 minute massage · October 7, 2026");
    });
});

describe("canKeepRecords", () => {
    it("lets the visit's practitioner and managers keep records, and no one else", () => {
        expect(canKeepRecords({ staffId: "st_1", role: "staff" }, "st_1")).toBe(true);
        expect(canKeepRecords({ staffId: "st_2", role: "admin" }, "st_1")).toBe(true);
        expect(canKeepRecords({ staffId: "st_2", role: "staff" }, "st_1")).toBe(false);
        expect(canKeepRecords(null, "st_1")).toBe(false);
    });
});
