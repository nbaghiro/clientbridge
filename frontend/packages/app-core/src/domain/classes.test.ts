import { describe, expect, it } from "vitest";

import { rosterStatus } from "./classes";

type RosterRow = Parameters<typeof rosterStatus>[0];

const seat = (status: string, checkedIn: string | null = null): RosterRow => ({
    booking_id: "bk_1",
    slot_id: "ss_1",
    client_id: "cl_ann",
    client_name: "Ann",
    client_phone: null,
    client_email: null,
    pet_name: null,
    pet_attributes: null,
    status,
    checked_in_at: checkedIn,
    deposit_status: "none",
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
