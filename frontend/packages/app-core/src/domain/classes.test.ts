import { describe, expect, it } from "vitest";

import { rosterStatus, seatKey, seatMatches, sessionCounts } from "./classes";

type RosterRow = Parameters<typeof rosterStatus>[0];

const seat = (status: string, checkedIn: string | null = null): RosterRow => ({
    booking_id: "bk_1",
    slot_id: "ss_1",
    client_id: "cl_ann",
    subject_id: null,
    client_name: "Ann",
    client_phone: null,
    client_email: null,
    subject_name: null,
    subject_attributes: null,
    status,
    checked_in_at: checkedIn,
    deposit_status: "none",
    deposit_amount_cents: null,
});

describe("rosterStatus", () => {
    it("puts each seat in the waitlist, no-show, here or booked column", () => {
        expect(rosterStatus(seat("waitlisted"))).toBe("waitlist");
        expect(rosterStatus(seat("waitlisted", "2026-10-07T17:00:00Z"))).toBe("waitlist");
        expect(rosterStatus(seat("no_show", "2026-10-07T17:00:00Z"))).toBe("no_show");
        expect(rosterStatus(seat("confirmed", "2026-10-07T17:00:00Z"))).toBe("checked_in");
        expect(rosterStatus(seat("completed", "2026-10-07T17:00:00Z"))).toBe("checked_in");
        expect(rosterStatus(seat("confirmed"))).toBe("confirmed");
        expect(rosterStatus(seat("pending"))).toBe("confirmed");
    });
});

describe("sessionCounts", () => {
    it("counts arrivals on a session that has ended as well as one under way", () => {
        const at = "2026-10-07T17:00:00Z";
        expect(
            sessionCounts([
                seat("completed", at),
                seat("confirmed", at),
                seat("completed"),
                seat("no_show"),
                seat("waitlisted"),
                seat("waitlisted", at),
            ]),
        ).toEqual({ booked: 4, waitlist: 2, checkedIn: 2 });
        expect(sessionCounts([])).toEqual({ booked: 0, waitlist: 0, checkedIn: 0 });
    });
});

describe("seatMatches", () => {
    const family = [
        { id: "cl_tran", name: "Thu Tran", subject_id: "sj_minh", subject_name: "Minh" },
        { id: "cl_tran", name: "Thu Tran", subject_id: "sj_an", subject_name: "An" },
        { id: "cl_ann", name: "Ann Lee", subject_id: null, subject_name: null },
    ];

    it("offers each sibling a seat of their own", () => {
        const found = seatMatches(family, "tran", new Set(), true);
        expect(found.map((m) => m.subjectName)).toEqual(["Minh", "An"]);
    });

    it("leaves out whoever already holds a seat", () => {
        const seated = new Set([seatKey("cl_tran", "sj_minh")]);
        expect(seatMatches(family, "tran", seated, true).map((m) => m.subjectId)).toEqual([
            "sj_an",
        ]);
    });

    it("matches a client once when the business books only clients", () => {
        const found = seatMatches(family, "tran", new Set(), false);
        expect(found).toEqual([
            {
                key: "cl_tran:",
                clientId: "cl_tran",
                subjectId: null,
                name: "Thu Tran",
                subjectName: "",
            },
        ]);
    });

    it("finds no one for an empty search", () => {
        expect(seatMatches(family, " ", new Set(), true)).toEqual([]);
    });
});
