import { describe, expect, it } from "vitest";

import { pushThread } from "./notifications";

describe("pushThread", () => {
    it("opens the thread of a message push", () => {
        expect(pushThread({ type: "message", thread_id: "th_1", client_id: "cl_1" })).toBe("th_1");
    });

    it("ignores other pushes and malformed data", () => {
        expect(pushThread({ type: "payment", payment_id: "pay_1" })).toBeNull();
        expect(pushThread({ type: "message", thread_id: "" })).toBeNull();
        expect(pushThread({ type: "message", thread_id: 7 })).toBeNull();
        expect(pushThread(null)).toBeNull();
        expect(pushThread("message")).toBeNull();
    });
});
