// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { strings } from "../strings";
import {
    type PublicShop,
    cartSubtotal,
    productCount,
    shopTotalLines,
    useShopFlow,
} from "./publicShop";

const items = [
    { id: "it_a", price_cents: 1500 },
    { id: "it_b", price_cents: 899 },
];

describe("cartSubtotal", () => {
    it("multiplies each price by its cart quantity", () => {
        expect(cartSubtotal(items, { it_a: 2, it_b: 1 })).toBe(3899);
    });

    it("ignores items not in the cart and cart ids no longer listed", () => {
        expect(cartSubtotal(items, { it_b: 3, it_gone: 4 })).toBe(2697);
        expect(cartSubtotal(items, {})).toBe(0);
    });
});

describe("productCount", () => {
    const catalog = [
        { id: "it_travel" },
        { id: "it_travel_100", variant_parent_id: "it_travel" },
        { id: "it_travel_250", variant_parent_id: "it_travel" },
        { id: "it_brush", variant_parent_id: null },
    ];

    it("adds a product's variants to its own quantity", () => {
        expect(productCount(catalog, { it_travel_100: 2, it_travel_250: 1 }, "it_travel")).toBe(3);
    });

    it("counts a plain product alone and ignores other products", () => {
        expect(productCount(catalog, { it_brush: 2, it_travel_100: 4 }, "it_brush")).toBe(2);
        expect(productCount(catalog, {}, "it_brush")).toBe(0);
    });
});

describe("shopTotalLines", () => {
    it("shows the cart subtotal as an estimate before the order exists", () => {
        expect(shopTotalLines(3899, null)).toEqual([
            {
                key: "total",
                label: strings.publicShop.estimatedTotal,
                cents: 3899,
                kind: "total",
            },
        ]);
    });

    it("uses the server's subtotal, tax and total once the order is placed", () => {
        const lines = shopTotalLines(3899, {
            subtotal_cents: 3800,
            tax_total_cents: 190,
            total_cents: 3990,
        });
        expect(lines.map((line) => [line.kind, line.cents])).toEqual([
            ["subtotal", 3800],
            ["tax", 190],
            ["total", 3990],
        ]);
    });

    it("falls back to the cart subtotal and leaves out tax the server did not report", () => {
        const lines = shopTotalLines(1500, { total_cents: 1500 });
        expect(lines.map((line) => [line.kind, line.cents])).toEqual([
            ["subtotal", 1500],
            ["total", 1500],
        ]);
    });
});

type ShopClient = Parameters<typeof useShopFlow>[0];
type Place = ShopClient["placeOrder"];

describe("a placed order survives a reload", () => {
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });
    const shop = {
        business_name: "Birchbark",
        brand: {},
        items: [],
        stripe_account_id: "acct_shop",
    } as unknown as PublicShop;
    const placed = {
        order_id: "ord_1",
        order_token: "tok",
        total_cents: 3248,
        currency: "CAD",
        client_secret: "pi_1_secret",
        stripe_account_id: "acct_shop",
    };
    const storage = (): Map<string, string> => new Map<string, string>();
    const shopClient = (placeOrder: ReturnType<typeof vi.fn<Place>>): ShopClient => ({
        getShop: vi.fn().mockResolvedValue(shop),
        getPickup: vi.fn().mockResolvedValue({ windows: [], hold_days: 3, timezone: "UTC" }),
        placeOrder,
    });
    const asStorage = (map: Map<string, string>) => ({
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => map.set(k, v),
        removeItem: (k: string) => map.delete(k),
    });

    async function order(
        placeOrder: ReturnType<typeof vi.fn<Place>>,
        map: Map<string, string>,
    ): Promise<void> {
        const { result, unmount } = renderHook(() =>
            useShopFlow(shopClient(placeOrder), "birchbark", asStorage(map)),
        );
        await waitFor(() => {
            expect(result.current.status).toBe("ready");
        });
        act(() => {
            result.current.setQuantity("it_brush", 1);
            result.current.setName("Robin Bennett");
            result.current.setEmail("robin@example.ca");
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(placeOrder).toHaveBeenCalledTimes(1);
        });
        unmount();
    }

    it("returns to the same order's payment after the response was lost", async () => {
        const map = storage();
        const lost = vi.fn<Place>().mockRejectedValue(new TypeError("lost response"));
        await order(lost, map);
        const placeOrder = vi.fn<Place>().mockResolvedValue(placed);
        const { result } = renderHook(() =>
            useShopFlow(shopClient(placeOrder), "birchbark", asStorage(map)),
        );
        await waitFor(() => {
            expect(result.current.status).toBe("ready");
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(result.current.status).toBe("paying");
        });
        expect(placeOrder.mock.calls[0]?.[2]).toBe(lost.mock.calls[0]?.[2]);
        const reloaded = renderHook(() =>
            useShopFlow(shopClient(vi.fn<Place>()), "birchbark", asStorage(map)),
        );
        await waitFor(() => {
            expect(reloaded.result.current.status).toBe("paying");
        });
        expect(reloaded.result.current.order?.order_id).toBe("ord_1");
    });

    it("starts a new order once the held one would have been released", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const map = storage();
        const first = vi.fn<Place>().mockResolvedValue(placed);
        await order(first, map);
        vi.setSystemTime(Date.now() + 31 * 60 * 1000);
        const placeOrder = vi.fn<Place>().mockResolvedValue({ ...placed, order_id: "ord_2" });
        const { result } = renderHook(() =>
            useShopFlow(shopClient(placeOrder), "birchbark", asStorage(map)),
        );
        await waitFor(() => {
            expect(result.current.status).toBe("ready");
        });
        expect(result.current.order).toBeNull();
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(placeOrder).toHaveBeenCalledTimes(1);
        });
        expect(placeOrder.mock.calls[0]?.[2]).not.toBe(first.mock.calls[0]?.[2]);
    });
});
