import { describe, expect, it } from "vitest";

import { pendingLabel } from "./sync";

describe("pendingLabel", () => {
    it("names a waiting change in words, from the upload queue's table and op", () => {
        expect(pendingLabel("hours", "PUT")).toBe("Working hours changed");
        expect(pendingLabel("contracts", "DELETE")).toBe("A contract removed");
        expect(pendingLabel("something_new", "PATCH")).toBe("A record changed");
    });
});
