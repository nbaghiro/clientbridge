// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiLike } from "../api";
import { useServiceEditor } from "./catalog";

vi.mock("./taxes", async (original) => ({
    ...(await original<typeof import("./taxes")>()),
    useTaxSetup: () => ({ province: "BC", rates: [], registered: false }),
}));

describe("acknowledged catalog creation recovery", () => {
    for (const tracking of [true, false]) {
        it(
            tracking
                ? "resolves the original stock command before decreasing the edited opening count"
                : "resolves pending stock before turning tracking off and saves edited fields",
            async () => {
                const calls: { path: string; body: unknown; key: string | undefined }[] = [];
                const patches: { path: string; body: unknown }[] = [];
                let fail = true;
                const api: ApiLike = {
                    get: <T>() => Promise.resolve({} as T),
                    getText: () => Promise.resolve(""),
                    post: <T>(
                        path: string,
                        body?: unknown,
                        options?: { idempotencyKey?: string },
                    ) => {
                        calls.push({ path, body, key: options?.idempotencyKey });
                        if (path.endsWith("/restock") && fail) {
                            fail = false;
                            return Promise.reject(
                                new Error("response lost after the stock command"),
                            );
                        }
                        return Promise.resolve({ id: "item_owned" } as T);
                    },
                    patch: <T>(path: string, body?: unknown) => {
                        patches.push({ path, body });
                        return Promise.resolve({ id: "item_owned" } as T);
                    },
                    delete: <T>() => Promise.resolve({} as T),
                };
                const done = vi.fn();
                const { result } = renderHook(() => useServiceEditor(api, null, "product", done));
                act(() => {
                    result.current.form.set("name", "Gentle Paw Balm");
                    result.current.form.set("price", "15");
                    result.current.form.set("trackStock", true);
                    result.current.form.set("openingStock", "7");
                });
                await act(async () => {
                    result.current.form.submit();
                    await Promise.resolve();
                });
                expect(done).not.toHaveBeenCalled();
                act(() => {
                    result.current.form.set("openingStock", "3");
                    result.current.form.set("trackStock", tracking);
                    result.current.form.set("description", "Unscented care for sensitive paws.");
                });
                await act(async () => {
                    result.current.form.submit();
                    await Promise.resolve();
                });
                expect(done).toHaveBeenCalledOnce();
                expect(calls.filter((call) => call.path === "/v1/items")).toHaveLength(1);
                const stock = calls.filter((call) => call.path.endsWith("/restock"));
                expect(stock[0]?.key).toBeTruthy();
                expect(stock[1]).toEqual(stock[0]);
                expect(stock).toHaveLength(tracking ? 3 : 2);
                if (tracking) {
                    expect(stock[2]?.body).toMatchObject({ quantity: -4 });
                    expect(stock[2]?.key).not.toBe(stock[0]?.key);
                }
                expect(patches).toHaveLength(1);
                expect(patches[0]?.path).toBe("/v1/items/item_owned");
                expect(patches[0]?.body).toMatchObject({
                    track_stock: tracking,
                    description: "Unscented care for sensitive paws.",
                });
                expect(patches[0]?.body).not.toHaveProperty("kind");
            },
        );
    }
});

it("re-enables tracking after an off PATCH committed without its response before adjusting stock", async () => {
    let tracked = true;
    let stock = 0;
    let loseStock = true;
    let loseOffPatch = true;
    const applied = new Set<string>();
    const done = vi.fn();
    const api: ApiLike = {
        get: <T>() => Promise.resolve({} as T),
        getText: () => Promise.resolve(""),
        post: <T>(path: string, body?: unknown, options?: { idempotencyKey?: string }) => {
            if (path.endsWith("/restock")) {
                if (!tracked) return Promise.reject(new Error("stock tracking is off"));
                const key = options?.idempotencyKey ?? "";
                if (!applied.has(key)) {
                    stock += (body as { quantity: number }).quantity;
                    applied.add(key);
                }
                if (loseStock) {
                    loseStock = false;
                    return Promise.reject(new Error("stock response lost"));
                }
            }
            return Promise.resolve({ id: "item_owned" } as T);
        },
        patch: <T>(_path: string, body?: unknown) => {
            tracked = (body as { track_stock: boolean }).track_stock;
            if (!tracked && loseOffPatch) {
                loseOffPatch = false;
                return Promise.reject(new Error("off PATCH response lost"));
            }
            return Promise.resolve({ id: "item_owned" } as T);
        },
        delete: <T>() => Promise.resolve({} as T),
    };
    const { result } = renderHook(() => useServiceEditor(api, null, "product", done));
    act(() => {
        result.current.form.set("name", "Gentle Paw Balm");
        result.current.form.set("price", "15");
        result.current.form.set("trackStock", true);
        result.current.form.set("openingStock", "7");
    });
    await act(async () => {
        result.current.form.submit();
        await Promise.resolve();
    });
    expect(stock).toBe(7);
    act(() => {
        result.current.form.set("trackStock", false);
    });
    await act(async () => {
        result.current.form.submit();
        await Promise.resolve();
    });
    expect(tracked).toBe(false);
    expect(done).not.toHaveBeenCalled();
    act(() => {
        result.current.form.set("trackStock", true);
        result.current.form.set("openingStock", "3");
    });
    await act(async () => {
        result.current.form.submit();
        await Promise.resolve();
    });
    expect(tracked).toBe(true);
    expect(stock).toBe(3);
    expect(applied.size).toBe(2);
    expect(done).toHaveBeenCalledOnce();
});

it("replays an uncertain create snapshot before applying edited fields and enabling opening stock", async () => {
    const calls: { method: string; body: unknown; key?: string | undefined }[] = [];
    let failCreate = true;
    const done = vi.fn();
    const api: ApiLike = {
        get: <T>() => Promise.resolve({} as T),
        getText: () => Promise.resolve(""),
        post: <T>(path: string, body?: unknown, options?: { idempotencyKey?: string }) => {
            calls.push({ method: path, body, key: options?.idempotencyKey });
            if (path === "/v1/items" && failCreate) {
                failCreate = false;
                return Promise.reject(new Error("create response lost"));
            }
            return Promise.resolve({ id: "item_owned" } as T);
        },
        patch: <T>(path: string, body?: unknown) => {
            calls.push({ method: `PATCH ${path}`, body });
            return Promise.resolve({ id: "item_owned" } as T);
        },
        delete: <T>() => Promise.resolve({} as T),
    };
    const { result } = renderHook(() => useServiceEditor(api, null, "product", done));
    act(() => {
        result.current.form.set("name", "Gentle Paw Balm");
        result.current.form.set("price", "15");
    });
    await act(async () => {
        result.current.form.submit();
        await Promise.resolve();
    });
    act(() => {
        result.current.form.set("description", "Unscented care for sensitive paws.");
        result.current.form.set("cost", "7");
        result.current.form.set("trackStock", true);
        result.current.form.set("openingStock", "9");
    });
    await act(async () => {
        result.current.form.submit();
        await Promise.resolve();
    });
    expect(calls.map((call) => call.method)).toEqual([
        "/v1/items",
        "/v1/items",
        "PATCH /v1/items/item_owned",
        "/v1/items/item_owned/restock",
    ]);
    expect(calls[0]?.key).toBeTruthy();
    expect(calls[1]).toEqual(calls[0]);
    expect(calls[0]?.body).toMatchObject({ track_stock: false, cost_cents: null });
    expect(calls[2]?.body).toMatchObject({
        track_stock: true,
        cost_cents: 700,
        description: "Unscented care for sensitive paws.",
    });
    expect(calls[2]?.body).not.toHaveProperty("kind");
    expect(calls[3]?.body).toMatchObject({ quantity: 9 });
    expect(done).toHaveBeenCalledOnce();
});

it.each([
    [409, "conflict", true],
    [422, "invalid_request", true],
    [422, "unprocessable", true],
    [404, "not_found", true],
    [500, null, false],
    [403, "forbidden", false],
    [429, "rate_limited", false],
    [422, "idempotency_key_reused", false],
])(
    "classifies create refusal %s/%s without losing an uncertain command",
    async (status, code, fresh) => {
        const calls: { body: unknown; key: string | undefined }[] = [];
        let refuse = true;
        const api: ApiLike = {
            get: <T>() => Promise.resolve({} as T),
            getText: () => Promise.resolve(""),
            post: <T>(_path: string, body?: unknown, options?: { idempotencyKey?: string }) => {
                calls.push({ body, key: options?.idempotencyKey });
                if (refuse) {
                    refuse = false;
                    return Promise.reject(
                        Object.assign(new Error("request refused"), { status, code }),
                    );
                }
                return Promise.resolve({ id: "item_owned" } as T);
            },
            patch: <T>() => Promise.resolve({ id: "item_owned" } as T),
            delete: <T>() => Promise.resolve({} as T),
        };
        const { result } = renderHook(() => useServiceEditor(api, null, "product", vi.fn()));
        act(() => {
            result.current.form.set("name", "Paw Balm");
            result.current.form.set("price", "15");
        });
        await act(async () => {
            result.current.form.submit();
            await Promise.resolve();
        });
        act(() => {
            result.current.form.set("name", "Gentle Paw Balm");
        });
        await act(async () => {
            result.current.form.submit();
            await Promise.resolve();
        });
        expect(calls).toHaveLength(2);
        expect(calls[0]?.key).toBeTruthy();
        if (fresh) {
            expect(calls[1]?.key).not.toBe(calls[0]?.key);
            expect(calls[1]?.body).toMatchObject({ name: "Gentle Paw Balm" });
        } else expect(calls[1]).toEqual(calls[0]);
    },
);
