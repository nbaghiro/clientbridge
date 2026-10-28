// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ApiLike } from "../api";
import { strings } from "../strings";
import { type InvoiceRecord, useInvoiceActions } from "./billing";

afterEach(cleanup);

const invoice = { row: { id: "inv_1" }, title: "Invoice #1" } as unknown as InvoiceRecord;

function api(post: ApiLike["post"]): ApiLike {
    return { get: vi.fn(), getText: vi.fn(), post, patch: vi.fn(), delete: vi.fn() };
}

it("says a dropped connection may have gone through, and retries with the same key", async () => {
    const keys: (string | undefined)[] = [];
    const post = vi.fn((_path: string, _body: unknown, opts?: { idempotencyKey?: string }) => {
        keys.push(opts?.idempotencyKey);
        return keys.length === 1
            ? Promise.reject(new TypeError("Failed to fetch"))
            : Promise.resolve({ number: 1 });
    });
    const { result } = renderHook(() => useInvoiceActions(api(post as ApiLike["post"])));
    act(() => {
        result.current.voidIt(invoice);
    });
    await waitFor(() => {
        expect(result.current.error).toBe(strings.billing.actionUnconfirmed);
    });
    act(() => {
        result.current.voidIt(invoice);
    });
    await waitFor(() => {
        expect(result.current.notice).toBe(strings.billing.invoiceVoided("Invoice #1"));
    });
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
});

it("says nothing changed when the server refused the action", async () => {
    const refused = Object.assign(new Error("POST → 409"), { status: 409, code: null });
    const post = vi.fn(() => Promise.reject(refused));
    const { result } = renderHook(() => useInvoiceActions(api(post as ApiLike["post"])));
    act(() => {
        result.current.voidIt(invoice);
    });
    await waitFor(() => {
        expect(result.current.error).toBe(strings.billing.actionError);
    });
});
