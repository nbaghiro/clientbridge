import { describe, expect, it } from "vitest";

import { readerConnected } from "./terminal";

describe("a Tap to Pay sheet opening again", () => {
    it("uses the reader the SDK still holds, so it doesn't discover one while connected", () => {
        expect(readerConnected({ reader: { serialNumber: "simulated" } }, null)).toBe(true);
    });

    it("uses the reader the hook already knows", () => {
        expect(readerConnected({}, { serialNumber: "simulated" })).toBe(true);
    });

    it("discovers a reader when neither holds one", () => {
        expect(readerConnected({}, null)).toBe(false);
    });
});
