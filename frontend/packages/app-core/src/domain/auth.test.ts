import { describe, expect, it } from "vitest";

import type { Flow, FlowNode } from "../api";
import { passwordSaveOutcome, reauthMethods } from "./auth";

const node = (group: string, name: string, value: unknown = ""): FlowNode => ({
    group,
    name,
    kind: "input",
    value,
    messages: [],
});

const flow = (nodes: FlowNode[], state: string | null = null): Flow => ({
    kind: "settings",
    id: "flow-1",
    state,
    nodes,
    messages: [],
});

describe("passwordSaveOutcome", () => {
    it("counts only a finished flow as saved", () => {
        expect(passwordSaveOutcome({ kind: "flow", flow: flow([], "success") })).toBe("saved");
        expect(passwordSaveOutcome({ kind: "done" })).toBe("saved");
    });

    it("shows a refused password again", () => {
        expect(passwordSaveOutcome({ kind: "flow", flow: flow([], "show_form") })).toBe("retry");
    });

    it("starts over when the recovery session lapsed, never signing in unchanged", () => {
        expect(passwordSaveOutcome({ kind: "reauth" })).toBe("restart");
        expect(passwordSaveOutcome({ kind: "restart" })).toBe("restart");
        expect(passwordSaveOutcome({ kind: "redirect", url: "https://auth/x" })).toBe("restart");
    });
});

describe("reauthMethods", () => {
    const password = node("password", "password");
    const google = node("oidc", "provider", "google");

    it("offers what the refresh flow contains", () => {
        expect(reauthMethods(flow([password]), true)).toEqual({ password: true, google: false });
        expect(reauthMethods(flow([google]), true)).toEqual({ password: false, google: true });
    });

    it("offers Google only where the app can open it", () => {
        expect(reauthMethods(flow([password, google]), false)).toEqual({
            password: true,
            google: false,
        });
    });
});
