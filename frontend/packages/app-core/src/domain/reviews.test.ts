import { describe, expect, it } from "vitest";

import { formatAverageRating, roundedRating } from "./reviews";

describe("average rating", () => {
    it("shows one decimal, zero when there are no reviews", () => {
        expect(formatAverageRating(null)).toBe("0.0");
        expect(formatAverageRating(5)).toBe("5.0");
        expect(formatAverageRating(4.66)).toBe("4.7");
        expect(formatAverageRating(4.04)).toBe("4.0");
    });

    it("rounds to whole stars, half up", () => {
        expect(roundedRating(null)).toBe(0);
        expect(roundedRating(4.49)).toBe(4);
        expect(roundedRating(4.5)).toBe(5);
        expect(roundedRating(1.2)).toBe(1);
    });
});
