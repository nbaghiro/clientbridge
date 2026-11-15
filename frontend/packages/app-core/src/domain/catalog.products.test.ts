// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiLike } from "../api";
import { BusinessZoneContext } from "../datetime";
import { strings } from "../strings";
import { type ItemRow, itemOption, useProductEditor, useRestockForm } from "./catalog";

const s = strings.catalog;
const setup = { ready: true };

beforeEach(() => {
    setup.ready = true;
});

vi.mock("./taxes", async (original) => {
    const taxes = await original<typeof import("./taxes")>();
    return {
        ...taxes,
        useTaxSetup: () => ({
            province: "BC",
            rates: taxes.ratesOn("BC", "2026-11-13"),
            registered: true,
            ready: setup.ready,
        }),
    };
});

const shampoo: ItemRow = {
    id: "it_shampoo",
    kind: "product",
    name: "Oatmeal Shampoo",
    description: null,
    category: "Bath",
    price_cents: 2400,
    currency: "CAD",
    duration_min: null,
    capacity: null,
    active: 1,
    color: null,
    image_file_id: "fl_photo",
    online_bookable: 0,
    buffer_before_min: 0,
    buffer_after_min: 0,
    deposit_type: "none",
    deposit_value: null,
    session_count: null,
    validity_days: null,
    interval: null,
    frequency: null,
    tax_class: "standard",
    sku: "BB-SHAMPOO",
    cost_cents: 1000,
    track_stock: 1,
    sell_online: 1,
    stock_on_hand: 3,
    low_stock_at: 1,
    covers_item_id: null,
    visits_per_period: null,
    member_discount_bps: null,
    gift_amounts: null,
    staff_ids: null,
    resource_ids: null,
};

const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(BusinessZoneContext.Provider, { value: "America/Vancouver" }, children);

function stubApi(fail: (path: string) => boolean): ApiLike {
    return {
        get: <T>() => Promise.resolve({} as T),
        getText: () => Promise.resolve(""),
        post: <T>(path: string) =>
            fail(path)
                ? Promise.reject(new Error("the network dropped"))
                : Promise.resolve({ id: "it_new", stock_on_hand: 3 } as T),
        patch: <T>() => Promise.resolve({ id: "it_new" } as T),
        delete: <T>() => Promise.resolve({} as T),
    };
}

describe("a product in a picker", () => {
    it("is found by its SKU, name, category or price in any case, with its photo", () => {
        const option = itemOption(shampoo);
        expect(option).toMatchObject({
            key: "it_shampoo",
            label: "Oatmeal Shampoo",
            detail: "$24.00",
            media: { kind: "item", name: "Oatmeal Shampoo" },
        });
        for (const q of ["bb-shampoo", " BB-SHAM ", "oatmeal", "bath", "24.00"])
            expect(option.match?.(q)).toBe(true);
        expect(option.match?.("conditioner")).toBe(false);
    });
});

describe("product editor", () => {
    it("asks for a price before a cost when neither margin input is there", () => {
        const { result } = renderHook(
            () =>
                useProductEditor(
                    stubApi(() => false),
                    null,
                    vi.fn(),
                ),
            { wrapper },
        );
        expect(result.current.margin).toBeNull();
        expect(result.current.marginMissing).toBe(s.marginNeedsPrice);
        act(() => {
            result.current.form.set("cost", "10");
        });
        expect(result.current.marginMissing).toBe(s.marginNeedsPrice);
        act(() => {
            result.current.form.set("price", "24");
            result.current.form.set("cost", "");
        });
        expect(result.current.marginMissing).toBe(s.marginUnknown);
    });

    it("claims no tax until the business's tax setup has synced", () => {
        setup.ready = false;
        const { result, rerender } = renderHook(
            () =>
                useProductEditor(
                    stubApi(() => false),
                    shampoo,
                    vi.fn(),
                ),
            { wrapper },
        );
        expect(result.current.tax).toBeNull();
        setup.ready = true;
        rerender();
        expect(result.current.tax).toContain("$26.88");
    });

    it("says the item is saved when only its opening stock failed", async () => {
        const done = vi.fn();
        const { result } = renderHook(
            () =>
                useProductEditor(
                    stubApi((path) => path.endsWith("/restock")),
                    null,
                    done,
                ),
            { wrapper },
        );
        act(() => {
            result.current.form.set("name", "Oatmeal Shampoo");
            result.current.form.set("price", "24");
            result.current.form.set("trackStock", true);
            result.current.form.set("openingStock", "3");
        });
        act(() => {
            result.current.form.submit();
        });
        await waitFor(() => {
            expect(result.current.form.error).toBe(s.addUnfinished);
        });
        expect(done).not.toHaveBeenCalled();
    });

    it("says the item wasn't added when the create itself failed", async () => {
        const { result } = renderHook(
            () =>
                useProductEditor(
                    stubApi((path) => path === "/v1/items"),
                    null,
                    vi.fn(),
                ),
            { wrapper },
        );
        act(() => {
            result.current.form.set("name", "Oatmeal Shampoo");
            result.current.form.set("price", "24");
        });
        act(() => {
            result.current.form.submit();
        });
        await waitFor(() => {
            expect(result.current.form.error).toBe(s.addError);
        });
    });
});

describe("a count correction", () => {
    it("can't take the shelf below zero, and doesn't ask the server to", () => {
        const api = stubApi(() => false);
        const post = vi.spyOn(api, "post");
        const { result } = renderHook(() => useRestockForm(api, shampoo, vi.fn()), { wrapper });
        act(() => {
            result.current.setQuantity("-4");
        });
        act(() => {
            result.current.submit();
        });
        expect(result.current.error).toBe(strings.api.stockBelowZero);
        expect(post).not.toHaveBeenCalled();
    });

    it("may empty the shelf", async () => {
        const done = vi.fn();
        const { result } = renderHook(
            () =>
                useRestockForm(
                    stubApi(() => false),
                    shampoo,
                    done,
                ),
            {
                wrapper,
            },
        );
        act(() => {
            result.current.setQuantity("-3");
        });
        expect(result.current.after).toBe(0);
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(done).toHaveBeenCalledWith(-3);
        });
    });
});
