// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { typedRows, useAsyncAction, useDraftList, useRemote, useSyncedDraft } from "./hooks";

afterEach(cleanup);

it("prevents simultaneous submissions before the busy state renders", async () => {
    let finish = (): void => undefined;
    const pending = new Promise<void>((resolve) => {
        finish = resolve;
    });
    const call = vi.fn(() => pending);
    const { result } = renderHook(() => useAsyncAction());
    act(() => {
        result.current.run(call);
        result.current.run(call);
    });
    expect(call).toHaveBeenCalledTimes(1);
    await act(async () => {
        finish();
        await pending;
    });
    act(() => {
        result.current.run(call);
    });
    expect(call).toHaveBeenCalledTimes(2);
    await act(async () => {
        await pending;
    });
});

it("ignores an older remote response when the resource changes", async () => {
    let first: (value: string) => void = () => undefined;
    let second: (value: string) => void = () => undefined;
    const a = new Promise<string>((resolve) => {
        first = resolve;
    });
    const b = new Promise<string>((resolve) => {
        second = resolve;
    });
    const { result, rerender } = renderHook(
        ({ key }) => useRemote(() => (key === "a" ? a : b), key),
        { initialProps: { key: "a" } },
    );
    rerender({ key: "b" });
    await act(async () => {
        second("current");
        await b;
    });
    expect(result.current.data).toBe("current");
    await act(async () => {
        first("stale");
        await a;
    });
    expect(result.current.data).toBe("current");
});

it("reloads a remote behind its shown answer and keeps it when the reload fails", async () => {
    const answers: (() => Promise<string>)[] = [
        () => Promise.resolve("first"),
        () => Promise.resolve("second"),
        () => Promise.reject(new Error("offline")),
    ];
    const { result } = renderHook(() =>
        useRemote(() => (answers.shift() ?? (() => Promise.resolve("none")))()),
    );
    await act(async () => {
        await Promise.resolve();
    });
    expect(result.current.data).toBe("first");
    let loadingDuring = false;
    await act(async () => {
        const reloading = result.current.reload();
        loadingDuring = result.current.isLoading;
        await reloading;
    });
    expect(loadingDuring).toBe(false);
    expect(result.current.data).toBe("second");
    await act(async () => {
        await result.current.reload();
    });
    expect(result.current.data).toBe("second");
    expect(result.current.error).toBeNull();
});

it("settles a remote when a reload overtakes its first load", async () => {
    const pending: ((value: string) => void)[] = [];
    const { result } = renderHook(() =>
        useRemote(
            () =>
                new Promise<string>((resolve) => {
                    pending.push(resolve);
                }),
        ),
    );
    expect(result.current.isLoading).toBe(true);
    let reloading = Promise.resolve();
    act(() => {
        reloading = result.current.reload();
    });
    await act(async () => {
        pending[0]?.("first");
        pending[1]?.("reloaded");
        await reloading;
    });
    expect(result.current.data).toBe("reloaded");
    expect(result.current.isLoading).toBe(false);
});

it("settles a remote when a reload overtakes its first load and fails", async () => {
    const pending: { resolve: (value: string) => void; reject: (e: Error) => void }[] = [];
    const { result } = renderHook(() =>
        useRemote(
            () =>
                new Promise<string>((resolve, reject) => {
                    pending.push({ resolve, reject });
                }),
        ),
    );
    let reloading = Promise.resolve();
    act(() => {
        reloading = result.current.reload();
    });
    await act(async () => {
        pending[0]?.resolve("first");
        pending[1]?.reject(new Error("offline"));
        await reloading;
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error?.message).toBe("offline");
});

it("clears a failed first load once a reload answers", async () => {
    const answers: (() => Promise<string>)[] = [
        () => Promise.reject(new Error("offline")),
        () => Promise.resolve("back"),
    ];
    const { result } = renderHook(() =>
        useRemote(() => (answers.shift() ?? (() => Promise.resolve("none")))()),
    );
    await act(async () => {
        await Promise.resolve();
    });
    expect(result.current.error).not.toBeNull();
    await act(async () => {
        await result.current.reload();
    });
    expect(result.current.data).toBe("back");
    expect(result.current.error).toBeNull();
});

const KEYS = ["name", "phone"] as const;

it("edits a draft list over its stored rows and stops at the limit", () => {
    const stored = [{ name: "Rosa", phone: "" }];
    const { result } = renderHook(() => useDraftList(KEYS, stored, 3));
    expect(result.current.rows).toEqual(stored);
    for (let i = 0; i < 4; i++)
        act(() => {
            result.current.add();
        });
    expect(result.current.rows).toHaveLength(3);
    act(() => {
        result.current.set(1, "name", "Ngozi");
    });
    act(() => {
        result.current.remove(0);
    });
    expect(result.current.rows).toEqual([
        { name: "Ngozi", phone: "" },
        { name: "", phone: "" },
    ]);
    expect(stored).toEqual([{ name: "Rosa", phone: "" }]);
});

it("keeps no rows for a record without the list", () => {
    const { result } = renderHook(() => useDraftList(KEYS, null, 3));
    act(() => {
        result.current.add();
    });
    expect(result.current.rows).toBeNull();
    expect(typedRows(KEYS, result.current.rows)).toEqual([]);
});

it("sends trimmed values and drops blank fields and blank rows", () => {
    expect(
        typedRows(KEYS, [
            { name: " Ngozi ", phone: "" },
            { name: " ", phone: "" },
            { name: "", phone: "613-555-0181" },
        ]),
    ).toEqual([{ name: "Ngozi" }, { phone: "613-555-0181" }]);
});

describe("useSyncedDraft", () => {
    interface Card {
        city: string;
        team: string[];
    }
    const stored: Card = { city: "Victoria", team: ["st_a"] };

    function draftOver(first: Card | null) {
        return renderHook(({ row }: { row: Card | null }) => useSyncedDraft(row), {
            initialProps: { row: first },
        });
    }

    it("shows the edits over the stored values and reports only what changed", () => {
        const { result } = draftOver(stored);
        expect(result.current.dirty).toBe(false);
        act(() => {
            result.current.set("city", "Nanaimo");
            result.current.set("team", (team) => [...team, "st_b"]);
        });
        expect(result.current.values).toEqual({ city: "Nanaimo", team: ["st_a", "st_b"] });
        expect(result.current.changes).toEqual({ city: "Nanaimo", team: ["st_a", "st_b"] });
        expect(result.current.dirty).toBe(true);
    });

    it("lets a later change from another device through a value typed back to the stored one", () => {
        const { result, rerender } = draftOver(stored);
        act(() => {
            result.current.set("city", "Nanaimo");
            result.current.set("team", ["st_a", "st_b"]);
        });
        act(() => {
            result.current.set("city", "Victoria");
            result.current.set("team", ["st_a"]);
        });
        expect(result.current.dirty).toBe(false);
        rerender({ row: { city: "Sidney", team: ["st_a", "st_c"] } });
        expect(result.current.values).toEqual({ city: "Sidney", team: ["st_a", "st_c"] });
        expect(result.current.dirty).toBe(false);
    });

    it("builds a change on what is shown once a value typed back lets the replica through", () => {
        const { result, rerender } = draftOver(stored);
        act(() => {
            result.current.set("team", ["st_a", "st_b"]);
        });
        act(() => {
            result.current.set("team", ["st_a"]);
        });
        rerender({ row: { city: "Victoria", team: ["st_a", "st_c"] } });
        act(() => {
            result.current.set("team", (team) => [...team, "st_d"]);
        });
        expect(result.current.changes).toEqual({ team: ["st_a", "st_c", "st_d"] });
    });

    it("follows the replica in a field not being edited", () => {
        const { result, rerender } = draftOver(stored);
        act(() => {
            result.current.set("city", "Sidney");
        });
        rerender({ row: { city: "Victoria", team: ["st_z"] } });
        expect(result.current.values).toEqual({ city: "Sidney", team: ["st_z"] });
        expect(result.current.changes).toEqual({ city: "Sidney" });
    });

    it("keeps an edit made through a callback from before the replica changed", () => {
        const { result, rerender } = draftOver(stored);
        const early = result.current.set;
        rerender({ row: { city: "Sidney", team: ["st_a"] } });
        act(() => {
            result.current.set("city", "Victoria");
        });
        act(() => {
            early("team", ["st_b"]);
        });
        expect(result.current.changes).toEqual({ city: "Victoria", team: ["st_b"] });
    });

    it("shows what was saved until the replica moves on, and keeps edits made during the save", () => {
        const { result, rerender } = draftOver(stored);
        act(() => {
            result.current.set("city", "Nanaimo");
        });
        const sent = result.current.changes;
        act(() => {
            result.current.set("team", ["st_b"]);
        });
        act(() => {
            result.current.settle(sent, { city: "Nanaimo", team: ["st_a"] });
        });
        expect(result.current.base).toEqual({ city: "Nanaimo", team: ["st_a"] });
        expect(result.current.changes).toEqual({ team: ["st_b"] });
        rerender({ row: { city: "Duncan", team: ["st_a"] } });
        expect(result.current.values).toEqual({ city: "Duncan", team: ["st_b"] });
    });

    it("holds no values until the stored row loads", () => {
        const { result, rerender } = draftOver(null);
        expect(result.current.values).toBeNull();
        rerender({ row: stored });
        expect(result.current.values).toEqual(stored);
    });
});
