// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { BusinessZoneContext } from "../datetime";
import { strings } from "../strings";
import {
    CLIENT_BULK_MAX,
    CLIENT_FOOTPRINT_SQL,
    type ClientListRow,
    LIVE_MEMBERS_SQL,
    useClientMerge,
    useClientSelection,
} from "./clients";

const replica = vi.hoisted(() => {
    const rows: (sql: string, params: readonly unknown[]) => unknown[] = () => [];
    return { rows };
});

vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: (sql: string, params: readonly unknown[] = []) => ({
        data: replica.rows(sql, params),
    }),
}));

afterEach(() => {
    replica.rows = () => [];
});

const s = strings.clients.tidy;

function apiPosting(post: ApiLike["post"]): ApiLike {
    return {
        get: <T>() => Promise.resolve({} as T),
        getText: () => Promise.resolve(""),
        post,
        patch: <T>() => Promise.resolve({} as T),
        delete: <T>() => Promise.resolve({} as T),
    };
}

function client(id: string, name: string, phone: string | null): ClientListRow {
    return {
        id,
        name,
        phone,
        phoneLabel: "",
        archived: false,
        archivedAt: null,
        tags: [],
        subjectNames: [],
        subjects: "",
        next: null,
        balanceCents: 0,
        lifetimeCents: null,
        since: new Date("2026-01-01T00:00:00Z"),
    };
}

const refusal = (code: string, status = 409) => Object.assign(new Error(code), { status, code });

const kept = client("cl_kept", "Quinn Pendleton", "+17785550162");
const other = client("cl_other", "Quinn Pendleton", "+17785550163");

const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(BusinessZoneContext.Provider, { value: "America/Vancouver" }, children);

function footprint(money: number) {
    replica.rows = (sql) =>
        sql === CLIENT_FOOTPRINT_SQL
            ? [kept, other].map((c) => ({
                  id: c.id,
                  bookings: 0,
                  subject_names: null,
                  subject_count: 0,
                  messages: 0,
                  notes: 0,
                  money: c.id === other.id ? money : 0,
                  methods: 0,
              }))
            : [];
}

it("tells two records with the same name apart by their phone numbers", () => {
    footprint(0);
    const { result } = renderHook(
        () =>
            useClientMerge(
                apiPosting(() => Promise.resolve({} as never)),
                kept,
                other,
                vi.fn(),
            ),
        { wrapper },
    );
    expect(result.current.sides.a.hint).toContain("(778) 555-0162");
    expect(result.current.sides.b.hint).toContain("(778) 555-0163");
    expect(result.current.sides.a.hint).not.toBe(result.current.sides.b.hint);
});

it("blocks merging away a record whose payment the device knows about", () => {
    footprint(1);
    const { result } = renderHook(
        () =>
            useClientMerge(
                apiPosting(() => Promise.resolve({} as never)),
                kept,
                other,
                vi.fn(),
            ),
        { wrapper },
    );
    expect(result.current.blocked).toBe(s.blockedMoney);
});

it("gives the server's reason when it refuses a merge the device couldn't foresee", async () => {
    footprint(0);
    const merged = vi.fn();
    const post = vi.fn(() => Promise.reject(new Error("refused")));
    post.mockRejectedValueOnce(refusal("merge_has_payments"));
    const { result } = renderHook(() => useClientMerge(apiPosting(post), kept, other, merged), {
        wrapper,
    });
    expect(result.current.blocked).toBeNull();
    act(() => {
        result.current.submit();
    });
    await waitFor(() => {
        expect(result.current.error).toBe(s.blockedMoney);
    });
    expect(merged).not.toHaveBeenCalled();
    act(() => {
        result.current.submit();
    });
    await waitFor(() => {
        expect(result.current.error).toBe(s.mergeError);
    });
    act(() => {
        result.current.setKeep("b");
    });
    expect(result.current.error).toBeNull();
});

it("shows a refusal once, as the notice, when the device catches up with the payment", async () => {
    footprint(0);
    const post = vi.fn(() => Promise.reject(refusal("merge_has_payments")));
    const { result, rerender } = renderHook(
        () => useClientMerge(apiPosting(post), kept, other, vi.fn()),
        { wrapper },
    );
    act(() => {
        result.current.submit();
    });
    await waitFor(() => {
        expect(result.current.error).toBe(s.blockedMoney);
    });
    footprint(1);
    rerender();
    expect(result.current.blocked).toBe(s.blockedMoney);
    expect(result.current.error).toBeNull();
});

it("closes the tag editor once the tags are saved, as the selection empties", async () => {
    const post = vi.fn(() => Promise.resolve({ count: 2 } as never));
    const rows = [kept, other];
    const { result } = renderHook(() => useClientSelection(apiPosting(post), rows));
    act(() => {
        result.current.setAll([kept.id, other.id]);
    });
    act(() => {
        result.current.addTag("  Winter   Promo ");
    });
    const applied = vi.fn();
    act(() => {
        result.current.apply(applied);
    });
    await waitFor(() => {
        expect(applied).toHaveBeenCalledOnce();
    });
    expect(post).toHaveBeenCalledWith(
        "/v1/clients/tags",
        { client_ids: [kept.id, other.id], set: { "winter promo": true } },
        expect.objectContaining({ idempotencyKey: expect.any(String) as string }),
    );
    expect(result.current.selected).toEqual([]);
    expect(result.current.done).toBe(s.tagsUpdated(2));
});

it("keeps the tag editor open with the error when a client went away on another device", async () => {
    const post = vi.fn(() => Promise.reject(refusal("not_found", 404)));
    const rows = [kept];
    const { result } = renderHook(() => useClientSelection(apiPosting(post), rows));
    act(() => {
        result.current.setAll([kept.id]);
    });
    act(() => {
        result.current.addTag("vip");
    });
    const applied = vi.fn();
    act(() => {
        result.current.apply(applied);
    });
    await waitFor(() => {
        expect(result.current.error).toBe(s.tagError);
    });
    expect(applied).not.toHaveBeenCalled();
    expect(result.current.selected).toEqual([kept.id]);
});

it("asks for a narrower list before a bulk write the API would refuse as too large", () => {
    const post = vi.fn(() => Promise.resolve({ count: 0 } as never));
    const rows = Array.from({ length: CLIENT_BULK_MAX + 1 }, (_, n) =>
        client(`cl_${String(n)}`, `Client ${String(n)}`, null),
    );
    const { result } = renderHook(() => useClientSelection(apiPosting(post), rows));
    act(() => {
        result.current.setAll(rows.map((r) => r.id));
    });
    act(() => {
        result.current.addTag("vip");
    });
    const applied = vi.fn();
    act(() => {
        result.current.apply(applied);
    });
    expect(result.current.error).toBe(s.tooMany(CLIENT_BULK_MAX));
    act(() => {
        result.current.archive();
    });
    expect(post).not.toHaveBeenCalled();
    expect(applied).not.toHaveBeenCalled();
    expect(result.current.selected).toHaveLength(CLIENT_BULK_MAX + 1);
});

it("says a bulk archive ends memberships only when a selected client holds a live one", () => {
    replica.rows = (sql) => (sql === LIVE_MEMBERS_SQL ? [{ client_id: "cl_other" }] : []);
    const { result } = renderHook(
        () =>
            useClientSelection(
                apiPosting(() => Promise.reject(new Error("unused"))),
                [kept, other],
            ),
        { wrapper },
    );
    act(() => {
        result.current.toggle(kept.id);
    });
    expect(result.current.archiveBody).toBe(s.archiveBody);
    act(() => {
        result.current.toggle(other.id);
    });
    expect(result.current.archiveBody).toBe(s.archiveBodyMember);
});
