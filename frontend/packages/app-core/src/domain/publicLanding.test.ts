import { describe, expect, it } from "vitest";

import { landingSections } from "./publicLanding";

const bare = {
    services: [],
    staff: [],
    policy: null,
    hours: [],
    address: null,
    phone: null,
    email: null,
    website: null,
};

describe("landingSections", () => {
    it("shows nothing optional for a business with nothing set up", () => {
        expect(landingSections(bare)).toEqual({
            booking: false,
            team: false,
            contact: false,
            visit: false,
            policies: false,
        });
    });

    it("shows booking policies only alongside services", () => {
        const policy = { self_service: true };
        expect(landingSections({ ...bare, policy }).policies).toBe(false);
        expect(landingSections({ ...bare, policy, services: [{}] })).toMatchObject({
            booking: true,
            policies: true,
        });
    });

    it("plans a visit from hours alone, and counts contact only from contact details", () => {
        expect(landingSections({ ...bare, hours: [{}] })).toMatchObject({
            contact: false,
            visit: true,
        });
        expect(landingSections({ ...bare, phone: "250-555-0100" })).toMatchObject({
            contact: true,
            visit: true,
        });
    });
});
