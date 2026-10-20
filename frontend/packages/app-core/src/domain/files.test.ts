import { describe, expect, it } from "vitest";

import { canEditPhoto, personMedia, photoIndex } from "./files";

describe("photoIndex", () => {
    it("keeps each person's newest photo, keyed by client, user and staff id", () => {
        const index = photoIndex([
            { id: "fl_old", parent_type: "client", parent_id: "cl_a", staff_id: null },
            { id: "fl_dana", parent_type: "user", parent_id: "us_dana", staff_id: "st_dana" },
            { id: "fl_new", parent_type: "client", parent_id: "cl_a", staff_id: null },
            { id: "fl_b", parent_type: "client", parent_id: "cl_b", staff_id: null },
        ]);
        expect([...index.clients]).toEqual([
            ["cl_a", "fl_new"],
            ["cl_b", "fl_b"],
        ]);
        expect([...index.users]).toEqual([["us_dana", "fl_dana"]]);
        expect([...index.staff]).toEqual([["st_dana", "fl_dana"]]);
    });

    it("gives a user without a staff row on this business no staff photo", () => {
        const index = photoIndex([
            { id: "fl_u", parent_type: "user", parent_id: "us_gone", staff_id: null },
        ]);
        expect(index.users.get("us_gone")).toBe("fl_u");
        expect(index.staff.size).toBe(0);
    });

    it("ignores files that belong to anything else", () => {
        const index = photoIndex([
            { id: "fl_pet", parent_type: "subject", parent_id: "sj_a", staff_id: null },
            { id: "fl_visit", parent_type: "booking", parent_id: "bk_a", staff_id: null },
        ]);
        expect(index.clients.size + index.users.size + index.staff.size).toBe(0);
    });
});

describe("canEditPhoto", () => {
    const client = { kind: "client", id: "cl_a" } as const;
    const self = { kind: "user", id: "us_me" } as const;
    const colleague = { kind: "user", id: "us_other" } as const;

    it("lets any member change a client's photo", () => {
        for (const role of ["owner", "admin", "staff", "contractor"]) {
            expect(canEditPhoto(client, { userId: "us_me", role })).toBe(true);
        }
    });

    it("lets a member change their own photo and a manager change anyone's", () => {
        expect(canEditPhoto(self, { userId: "us_me", role: "staff" })).toBe(true);
        expect(canEditPhoto(colleague, { userId: "us_me", role: "staff" })).toBe(false);
        expect(canEditPhoto(colleague, { userId: "us_me", role: "contractor" })).toBe(false);
        expect(canEditPhoto(colleague, { userId: "us_me", role: "admin" })).toBe(true);
        expect(canEditPhoto(colleague, { userId: "us_me", role: "owner" })).toBe(true);
    });

    it("lets nobody edit before the viewer's membership is known", () => {
        expect(canEditPhoto(client, { userId: "us_me", role: null })).toBe(false);
        expect(canEditPhoto(self, { userId: "us_me", role: null })).toBe(false);
    });
});

describe("personMedia", () => {
    it("carries a photo when there is one", () => {
        expect(personMedia("Dana Lee", "#336699", "https://files.test/a")).toEqual({
            kind: "person",
            name: "Dana Lee",
            color: "#336699",
            src: "https://files.test/a",
        });
        expect(personMedia("Dana Lee").src).toBeNull();
    });
});
