import { describe, expect, it } from "vitest";

import { consentFor, consentOf, smsSegments } from "./broadcasts";

describe("smsSegments", () => {
    it("bills GSM-7 text per 160 septets, then 153 per part", () => {
        expect(smsSegments("")).toEqual({ chars: 0, segments: 0 });
        expect(smsSegments("Hi")).toEqual({ chars: 2, segments: 1 });
        expect(smsSegments("a".repeat(160))).toEqual({ chars: 160, segments: 1 });
        expect(smsSegments("a".repeat(161))).toEqual({ chars: 161, segments: 2 });
        expect(smsSegments("a".repeat(306)).segments).toBe(2);
        expect(smsSegments("a".repeat(307)).segments).toBe(3);
        expect(smsSegments("line one\nline two").segments).toBe(1);
    });

    it("keeps GSM accents in GSM-7 and counts extension characters twice", () => {
        expect(smsSegments(`${"a".repeat(159)}é`).segments).toBe(1);
        expect(smsSegments(`${"a".repeat(158)}€`).segments).toBe(1);
        expect(smsSegments(`${"a".repeat(159)}€`).segments).toBe(2);
    });

    it("switches to UCS-2 at 70 units, then 67 per part, once any character needs it", () => {
        expect(smsSegments(`${"a".repeat(69)}ê`)).toEqual({ chars: 70, segments: 1 });
        expect(smsSegments(`${"a".repeat(70)}ê`)).toEqual({ chars: 71, segments: 2 });
        expect(smsSegments(`${"a".repeat(133)}ê`).segments).toBe(2);
        expect(smsSegments(`${"a".repeat(134)}ê`).segments).toBe(3);
        expect(smsSegments("Fête").segments).toBe(1);
    });
});

describe("consent", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    const row = (status: string, expires: string | null = null) => ({
        client_id: "cl_ann",
        channel: "sms",
        status,
        source: "form",
        created_at: "2026-01-01T00:00:00Z",
        expires_at: expires,
    });

    it("reads express, implied, lapsed and withdrawn consent like the server", () => {
        expect(consentOf(undefined)).toEqual({
            state: "none",
            source: null,
            at: null,
            expiresAt: null,
        });
        expect(consentOf(row("granted"), now)).toEqual({
            state: "express",
            source: "form",
            at: "2026-01-01T00:00:00Z",
            expiresAt: null,
        });
        expect(consentOf(row("withdrawn"), now).state).toBe("opted_out");
        expect(consentOf(row("implied", "2026-10-08T00:00:00Z"), now).state).toBe("implied");
        expect(consentOf(row("implied", null), now).state).toBe("implied");
        expect(consentOf(row("implied", "2026-10-07T12:00:00Z"), now).state).toBe("none");
        expect(consentOf(row("implied", "2026-10-07 11:00:00+00"), now)).toMatchObject({
            state: "none",
            source: "form",
        });
    });

    it("looks a client's channel up, reading a missing one as never asked", () => {
        const map = new Map([
            [
                "cl_ann",
                { sms: consentOf(row("granted"), now), email: consentOf(row("withdrawn"), now) },
            ],
        ]);
        expect(consentFor(map, "cl_ann", "sms").state).toBe("express");
        expect(consentFor(map, "cl_ann", "email").state).toBe("opted_out");
        expect(consentFor(map, "cl_ben", "sms")).toEqual(consentOf(undefined));
    });
});
