import { describe, expect, it } from "vitest";

import { dateKey, parseTimestamp } from "./datetime";

describe("parseTimestamp", () => {
    it("parses PowerSync's bare-offset timestamptz as UTC", () => {
        // "2026-06-26 10:00:00+00" is the exact stored form the calendar filtering depends on.
        const d = parseTimestamp("2026-06-26 10:00:00+00");
        expect(d.getUTCFullYear()).toBe(2026);
        expect(d.getUTCMonth()).toBe(5); // June (0-indexed)
        expect(d.getUTCHours()).toBe(10);
        expect(d.getUTCMinutes()).toBe(0);
    });

    it("parses the ISO Z form to the same instant", () => {
        expect(parseTimestamp("2026-06-26T10:00:00Z").getTime()).toBe(
            parseTimestamp("2026-06-26 10:00:00+00").getTime(),
        );
    });

    it("treats an offset-less value as UTC", () => {
        expect(parseTimestamp("2026-06-26 10:00:00").getUTCHours()).toBe(10);
    });
});

describe("dateKey", () => {
    it("formats a local date as YYYY-MM-DD", () => {
        expect(dateKey(new Date(2026, 5, 9))).toBe("2026-06-09");
    });
});
