// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { formatDateTime } from "../datetime";
import { strings } from "../strings";
import {
    AUDIENCE_CLIENTS_SQL,
    LATEST_CONSENTS_SQL,
    TEXTS_STOPPED_SQL,
    broadcastHasResults,
    consentFor,
    consentOf,
    smsSegments,
    useBroadcastDraft,
} from "./broadcasts";

const b = strings.broadcasts;

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
        { id: "cl_a", name: "Al", phone: "+16045550003", tags: null },
        { id: "cl_c", name: "Cy", phone: "+16045550002", tags: null },
        { id: "cl_d", name: "Dee", phone: "+16045550004", tags: null },
    ],
    [LATEST_CONSENTS_SQL]: [
        ...["cl_a", "cl_b", "cl_c"].map(granted),
        { ...granted("cl_d"), status: "withdrawn", source: "in_person" },
    ],
    [TEXTS_STOPPED_SQL]: [{ client_id: "cl_b", created_at: "2026-02-01T00:00:00Z" }],
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

const sending = { status: "sending", scheduled_at: null };
const fakeApi = (result: { status: string; scheduled_at: string | null } = sending) => ({
    get: vi.fn(),
    getText: vi.fn(),
    post: vi.fn().mockResolvedValue(result),
    patch: vi.fn(),
    delete: vi.fn(),
});

describe("broadcast audience", () => {
    it("leaves out a client whose number replied STOP and one who said no to offers", () => {
        const { result } = renderHook(() => useBroadcastDraft(fakeApi() as ApiLike));
        const { recipients, excluded } = result.current.audience;
        expect(recipients.map((r) => r.id)).toEqual(["cl_a", "cl_c"]);
        expect(excluded.map((x) => [x.id, x.reason, x.detail])).toEqual([
            ["cl_b", "opted_out", b.consentSource(b.sources.reply, "Jan 31, 2026")],
            ["cl_d", "opted_out", b.consentSource(b.sources.in_person, "Dec 31, 2025")],
        ]);
    });
});

describe("broadcast confirmation", () => {
    const zone = "America/Toronto";
    const submit = async (api: ReturnType<typeof fakeApi>, sendAt?: string) => {
        const { result } = renderHook(() => useBroadcastDraft(api as ApiLike));
        act(() => {
            result.current.setName("Spring");
            result.current.setBody("Book now");
            if (sendAt !== undefined) {
                result.current.setSchedule("later");
                result.current.setSendAt(sendAt);
            }
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(result.current.sent).not.toBeNull();
        });
        return result.current.sent;
    };

    it("says a broadcast sent now goes out to its recipients", async () => {
        expect(await submit(fakeApi())).toEqual({
            scheduled: false,
            title: b.sentTitle,
            body: b.sentBody(2),
        });
    });

    it("gives the time a scheduled broadcast goes out", async () => {
        const at = "2030-01-15T15:00:00Z";
        const api = fakeApi({ status: "scheduled", scheduled_at: at });
        expect(await submit(api, "2030-01-15T10:00")).toEqual({
            scheduled: true,
            title: b.scheduledTitle,
            body: b.scheduledBody(formatDateTime(new Date(at), zone), 2),
        });
        expect(api.post.mock.calls[0]?.[1]).toMatchObject({
            scheduled_at: new Date(at).toISOString(),
        });
    });

    it("says when quiet hours moved a picked time to the morning", async () => {
        const morning = "2030-01-16T14:00:00Z";
        const api = fakeApi({ status: "scheduled", scheduled_at: morning });
        expect(await submit(api, "2030-01-15T22:30")).toEqual({
            scheduled: true,
            title: b.scheduledTitle,
            body: b.movedBody(formatDateTime(new Date(morning), zone), 2),
        });
    });

    it("says a send-now in quiet hours is queued for the morning", async () => {
        const morning = "2030-01-16T14:00:00Z";
        const api = fakeApi({ status: "scheduled", scheduled_at: morning });
        expect(await submit(api)).toEqual({
            scheduled: true,
            title: b.queuedTitle,
            body: b.queuedBody(formatDateTime(new Date(morning), zone), 2),
        });
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

describe("broadcast results", () => {
    it("shows counts once a broadcast starts going out, even while quiet hours pause it", () => {
        expect(
            ["draft", "scheduled", "sending", "sent", "canceled"].filter(broadcastHasResults),
        ).toEqual(["sending", "sent"]);
    });
});
