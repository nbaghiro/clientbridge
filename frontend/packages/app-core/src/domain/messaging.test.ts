import { describe, expect, it } from "vitest";
import { resolveInboxTarget } from "./messaging";

const threads = [
    { id: "sms-1", client_id: "client-1" },
    { id: "email-1", client_id: "client-1" },
];

describe("inbox navigation", () => {
    it("opens the notification's exact thread when a client has multiple channels", () => {
        expect(resolveInboxTarget(threads, { threadId: "email-1", clientId: "client-1" })).toEqual({
            threadId: "email-1",
            clientId: null,
        });
    });
    it("opens the client's most recent conversation", () => {
        expect(resolveInboxTarget(threads, { clientId: "client-1" })).toEqual({
            threadId: "sms-1",
            clientId: null,
        });
    });
    it("prefills a new draft only after no existing client conversation is found", () => {
        expect(resolveInboxTarget(threads, { clientId: "client-2" })).toEqual({
            threadId: null,
            clientId: "client-2",
        });
        expect(resolveInboxTarget([], { clientId: "client-2" })).toEqual({
            threadId: null,
            clientId: "client-2",
        });
    });
    it("does not turn a missing notification thread into a draft or unrelated conversation", () => {
        expect(resolveInboxTarget(threads, { threadId: "missing", clientId: "client-1" })).toEqual({
            threadId: null,
            clientId: null,
        });
        expect(resolveInboxTarget(threads, {})).toEqual({ threadId: null, clientId: null });
    });
});
