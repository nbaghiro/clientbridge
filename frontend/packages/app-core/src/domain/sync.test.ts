import { describe, expect, it } from "vitest";

import { pendingLabel, syncProblem } from "./sync";

describe("pendingLabel", () => {
    it("names a waiting change in words, from the upload queue's table and op", () => {
        expect(pendingLabel("hours", "PUT")).toBe("Working hours changed");
        expect(pendingLabel("hours", "DELETE")).toBe("Working hours removed");
        expect(pendingLabel("something_new", "PATCH")).toBe("A record changed");
    });
});

describe("sync health", () => {
    it("reports failed uploads even while downloads are healthy", () => {
        expect(syncProblem(false, true, false)).toBe("upload");
    });
    it("reports unreadable local work ahead of transport failures", () => {
        expect(syncProblem(true, true, true)).toBe("storage");
    });
    it("reports download failures separately and clears after recovery", () => {
        expect(syncProblem(false, false, true)).toBe("download");
        expect(syncProblem(false, false, false)).toBeNull();
    });
});
