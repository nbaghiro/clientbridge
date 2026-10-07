import { describe, expect, it } from "vitest";

import { payCodeMatrix } from "./payCode";

const row = (m: boolean[][], r: number, from: number, to: number): boolean[] =>
    (m[r] ?? []).slice(from, to);

describe("payCodeMatrix", () => {
    const m = payCodeMatrix("https://pay.clientbridge.ca/i/tok_1");

    it("draws a square grid of the requested size", () => {
        expect(m).toHaveLength(25);
        expect(m.every((r) => r.length === 25)).toBe(true);
        const small = payCodeMatrix("x", 21);
        expect(small).toHaveLength(21);
        expect(small.every((r) => r.length === 21)).toBe(true);
    });

    it("puts a finder in three corners with a quiet separator around each", () => {
        const ring = [true, true, true, true, true, true, true];
        const hollow = [true, false, false, false, false, false, true];
        const core = [true, false, true, true, true, false, true];
        for (const [r0, c0] of [
            [0, 0],
            [0, 18],
            [18, 0],
        ] as const) {
            expect(row(m, r0, c0, c0 + 7)).toEqual(ring);
            expect(row(m, r0 + 1, c0, c0 + 7)).toEqual(hollow);
            expect(row(m, r0 + 2, c0, c0 + 7)).toEqual(core);
            expect(row(m, r0 + 4, c0, c0 + 7)).toEqual(core);
            expect(row(m, r0 + 5, c0, c0 + 7)).toEqual(hollow);
            expect(row(m, r0 + 6, c0, c0 + 7)).toEqual(ring);
        }
        expect(row(m, 7, 0, 8)).toEqual(Array<boolean>(8).fill(false));
        expect(m.slice(0, 8).map((r) => r[7])).toEqual(Array<boolean>(8).fill(false));
        expect(m.slice(0, 8).map((r) => r[17])).toEqual(Array<boolean>(8).fill(false));
    });

    it("alternates the timing row and column between the finders", () => {
        expect(row(m, 6, 8, 17)).toEqual([
            true,
            false,
            true,
            false,
            true,
            false,
            true,
            false,
            true,
        ]);
        expect(m.slice(8, 17).map((r) => r[6])).toEqual([
            true,
            false,
            true,
            false,
            true,
            false,
            true,
            false,
            true,
        ]);
    });

    it("is the same for the same value and differs for another", () => {
        expect(payCodeMatrix("https://pay.clientbridge.ca/i/tok_1")).toEqual(m);
        const other = payCodeMatrix("https://pay.clientbridge.ca/i/tok_2");
        expect(other).not.toEqual(m);
        expect(row(other, 0, 0, 7)).toEqual(row(m, 0, 0, 7));
    });
});
