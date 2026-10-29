// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import {
    AUDIENCE_CLIENTS_SQL,
    LATEST_CONSENTS_SQL,
    consentFor,
    consentOf,
    smsSegments,
    useBroadcastDraft,
} from "./broadcasts";

const granted = (client_id: string) => ({
    client_id,
    status: "granted",
    source: "form",
    created_at: "2026-01-01T00:00:00Z",
    expires_at: null,
});

const replica: Record<string, unknown[]> = {
    [AUDIENCE_CLIENTS_SQL]: [
        { id: "cl_b", name: "Bea", phone: "+16045550001", tags: null },
        { id: "cl_a", name: "Al", phone: "+16045550001", tags: null },
        { id: "cl_c", name: "Cy", phone: "+16045550002", tags: null },
    ],
    [LATEST_CONSENTS_SQL]: ["cl_a", "cl_b", "cl_c"].map(granted),
};

vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: (sql: string) => ({ data: replica[sql] ?? [], isLoading: false }),
}));

vi.mock("../datetime", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../datetime")>()),
    useBusinessZone: () => "America/Toronto",
}));

vi.mock("./business", () => ({ useBusinessName: () => "Birchbark" }));

vi.mock("./sync", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./sync")>()),
    useReplicaLoad: () => ({ state: "ready" }),
}));

describe("broadcast audience", () => {
    it("sends a shared number one copy, to the client first by id, as the server does", () => {
        const api = {
            get: vi.fn(),
            getText: vi.fn(),
            post: vi.fn(),
            patch: vi.fn(),
            delete: vi.fn(),
        };
        const { result } = renderHook(() => useBroadcastDraft(api as ApiLike));
        const { recipients, excluded } = result.current.audience;
        expect(recipients.map((r) => r.id)).toEqual(["cl_a", "cl_c"]);
        expect(excluded).toEqual([
            {
                id: "cl_b",
                name: "Bea",
                reason: "shared_number",
                detail: "Al",
            },
        ]);
    });
});

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

    it("looks up SMS consent, reading a missing client as never asked", () => {
        const map = new Map([["cl_ann", consentOf(row("granted"), now)]]);
        expect(consentFor(map, "cl_ann").state).toBe("express");
        expect(consentFor(map, "cl_ben")).toEqual(consentOf(undefined));
    });
});
