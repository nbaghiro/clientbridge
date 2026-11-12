// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { strings } from "../strings";
import type { StripeReturn } from "./checkout";
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
        number: 21,
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
        releaseOrder: vi.fn().mockResolvedValue(undefined),
    });
    const asStorage = (map: Map<string, string>) => ({
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => map.set(k, v),
        removeItem: (k: string) => map.delete(k),
    });
    // the hook loads through the client it is given, so each render must pass the same one
    const mount = (client: ShopClient, map: Map<string, string>, returned?: StripeReturn) => {
        const kept = asStorage(map);
        return renderHook(() => useShopFlow(client, "birchbark", kept, returned));
    };

    async function order(
        placeOrder: ReturnType<typeof vi.fn<Place>>,
        map: Map<string, string>,
    ): Promise<void> {
        const { result, unmount } = mount(shopClient(placeOrder), map);
        await waitFor(() => {
            expect(result.current.status).toBe("ready");
        });
        act(() => {
            result.current.setQuantity("it_brush", 1);
            result.current.setName("Robin Bennett");
            result.current.setPhone("+16045550142");
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
        const { result } = mount(shopClient(placeOrder), map);
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
        const reloaded = mount(shopClient(vi.fn<Place>()), map);
        await waitFor(() => {
            expect(reloaded.result.current.status).toBe("paying");
        });
        expect(reloaded.result.current.order?.order_id).toBe("ord_1");
    });

    function returnTo(map: Map<string, string>, returned: StripeReturn) {
        return mount(shopClient(vi.fn<Place>()), map, returned);
    }

    it("shows the order paid when Stripe sends the client back from that order's payment", async () => {
        const map = storage();
        await order(vi.fn<Place>().mockResolvedValue(placed), map);
        const back = returnTo(map, { intent: "pi_1", status: "succeeded" });
        await waitFor(() => {
            expect(back.result.current.status).toBe("paid");
        });
        expect(back.result.current.order?.order_id).toBe("ord_1");
        expect(JSON.parse(map.get("connect-order:birchbark") ?? "null")).toMatchObject({
            paid: true,
        });
        back.unmount();
    });

    it("keeps paying when the return is for another intent, and says when it failed", async () => {
        const map = storage();
        await order(vi.fn<Place>().mockResolvedValue(placed), map);
        const other = returnTo(map, { intent: "pi_9", status: "succeeded" });
        await waitFor(() => {
            expect(other.result.current.status).toBe("paying");
        });
        other.unmount();
        const failed = returnTo(map, { intent: "pi_1", status: "failed" });
        await waitFor(() => {
            expect(failed.result.current.status).toBe("paying");
        });
        expect(failed.result.current.error).toBe(strings.checkout.paymentFailed);
        failed.unmount();
    });

    it("starts a new order once the held one would have been released", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const map = storage();
        const first = vi.fn<Place>().mockResolvedValue(placed);
        await order(first, map);
        vi.setSystemTime(Date.now() + 31 * 60 * 1000);
        const placeOrder = vi.fn<Place>().mockResolvedValue({ ...placed, order_id: "ord_2" });
        const { result } = mount(shopClient(placeOrder), map);
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

describe("after paying or losing stock", () => {
    afterEach(() => {
        cleanup();
    });
    const brush = {
        id: "it_brush",
        name: "Self-Cleaning Slicker Brush",
        description: null,
        price_cents: 2900,
        currency: "CAD",
        taxable: true,
        image_url: null,
        in_stock: true,
        category: null,
        stock_left: 3,
    };
    const shop = (stockLeft: number): PublicShop => ({
        business_name: "Birchbark",
        brand: { logo_url: null, primary: null, tagline: null },
        items: [{ ...brush, stock_left: stockLeft, in_stock: stockLeft > 0 }],
        stripe_account_id: "acct_shop",
        charges_tax: true,
    });
    const placed = {
        order_id: "ord_1",
        order_token: "tok",
        number: 22,
        total_cents: 3248,
        currency: "CAD",
        client_secret: "pi_1_secret",
        stripe_account_id: "acct_shop",
    };
    const asStorage = (map: Map<string, string>) => ({
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => map.set(k, v),
        removeItem: (k: string) => map.delete(k),
    });
    const client = (getShop: ShopClient["getShop"], placeOrder: Place): ShopClient => ({
        getShop,
        getPickup: vi.fn().mockResolvedValue({ windows: [], hold_days: 3, timezone: "UTC" }),
        placeOrder,
        releaseOrder: vi.fn().mockResolvedValue(undefined),
    });

    async function checkout(c: ShopClient, map: Map<string, string>, quantity: number) {
        const hook = renderHook(() => useShopFlow(c, "birchbark", asStorage(map)));
        await waitFor(() => {
            expect(hook.result.current.status).toBe("ready");
        });
        act(() => {
            hook.result.current.setQuantity("it_brush", quantity);
            hook.result.current.setName("Robin Bennett");
            hook.result.current.setPhone("+16045550142");
        });
        act(() => {
            hook.result.current.submit();
        });
        return hook;
    }

    it("names the order by its sale number and keeps the confirmation across a reload", async () => {
        const map = new Map<string, string>();
        const c = client(
            vi.fn().mockResolvedValue(shop(3)),
            vi.fn<Place>().mockResolvedValue(placed),
        );
        const { result, unmount } = await checkout(c, map, 1);
        await waitFor(() => {
            expect(result.current.status).toBe("paying");
        });
        expect(result.current.orderNumber).toBe("S-22");
        act(() => {
            result.current.markPaid();
        });
        unmount();
        const reloaded = renderHook(() => useShopFlow(c, "birchbark", asStorage(map)));
        await waitFor(() => {
            expect(reloaded.result.current.status).toBe("paid");
        });
        expect(reloaded.result.current.order?.order_token).toBe("tok");
        act(() => {
            reloaded.result.current.startOver();
        });
        expect(reloaded.result.current.status).toBe("ready");
        expect(reloaded.result.current.count).toBe(0);
    });

    it("releases the unpaid order when the shopper steps back, and the next try is a new order", async () => {
        const placeOrder = vi.fn<Place>().mockResolvedValue(placed);
        const c = client(vi.fn().mockResolvedValue(shop(3)), placeOrder);
        const { result } = await checkout(c, new Map(), 1);
        await waitFor(() => {
            expect(result.current.status).toBe("paying");
        });
        act(() => {
            result.current.cancelPayment();
        });
        await waitFor(() => {
            expect(result.current.status).toBe("ready");
        });
        expect(c.releaseOrder).toHaveBeenCalledWith("tok");
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(placeOrder).toHaveBeenCalledTimes(2);
        });
        expect(placeOrder.mock.calls[1]?.[2]).not.toBe(placeOrder.mock.calls[0]?.[2]);
    });

    it("shows the confirmation when the card went through before the page heard", async () => {
        const c = client(
            vi.fn().mockResolvedValue(shop(3)),
            vi.fn<Place>().mockResolvedValue(placed),
        );
        c.releaseOrder = vi
            .fn()
            .mockRejectedValue(
                Object.assign(new Error("paid"), { status: 409, code: "checkout_paid" }),
            );
        const { result } = await checkout(c, new Map(), 1);
        await waitFor(() => {
            expect(result.current.status).toBe("paying");
        });
        act(() => {
            result.current.cancelPayment();
        });
        await waitFor(() => {
            expect(result.current.status).toBe("paid");
        });
        expect([result.current.orderNumber, result.current.error]).toEqual(["S-22", null]);
        act(() => {
            result.current.startOver();
        });
        expect([result.current.status, result.current.error]).toEqual(["ready", null]);
    });

    it("lets go of an unpaid order left past its resume window", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            const map = new Map<string, string>();
            const c = client(
                vi.fn().mockResolvedValue(shop(3)),
                vi.fn<Place>().mockResolvedValue(placed),
            );
            const first = await checkout(c, map, 1);
            await waitFor(() => {
                expect(first.result.current.status).toBe("paying");
            });
            first.unmount();
            vi.setSystemTime(Date.now() + 26 * 60 * 1000);
            const later = renderHook(() => useShopFlow(c, "birchbark", asStorage(map)));
            await waitFor(() => {
                expect(c.releaseOrder).toHaveBeenCalledWith("tok");
            });
            expect(later.result.current.order).toBeNull();
            expect(map.has("connect-order:birchbark")).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it("tells a confirmation read back after a reload from one paid on the page", async () => {
        const map = new Map<string, string>();
        const c = client(
            vi.fn().mockResolvedValue(shop(3)),
            vi.fn<Place>().mockResolvedValue(placed),
        );
        const { result, unmount } = await checkout(c, map, 1);
        await waitFor(() => {
            expect(result.current.status).toBe("paying");
        });
        act(() => {
            result.current.markPaid();
        });
        expect(result.current.restored).toBe(false);
        unmount();
        const reloaded = renderHook(() => useShopFlow(c, "birchbark", asStorage(map)));
        await waitFor(() => {
            expect(reloaded.result.current.status).toBe("paid");
        });
        expect(reloaded.result.current.restored).toBe(true);
    });

    it("reloads the shop when stock ran out, trims the cart and names what changed", async () => {
        const getShop = vi.fn().mockResolvedValueOnce(shop(3)).mockResolvedValue(shop(1));
        const refused = Object.assign(new Error("refused"), { status: 409, code: "out_of_stock" });
        const { result } = await checkout(
            client(getShop, vi.fn<Place>().mockRejectedValue(refused)),
            new Map(),
            3,
        );
        await waitFor(() => {
            expect(result.current.error).toBe(
                strings.publicShop.stockChanged("Self-Cleaning Slicker Brush"),
            );
        });
        expect(result.current.cart).toEqual({ it_brush: 1 });
        expect(result.current.shop?.items[0]?.stock_left).toBe(1);
    });
});

describe("the shop's tax row", () => {
    const order = (tax: number | null) => ({
        subtotal_cents: 2400,
        tax_total_cents: tax,
        total_cents: 2400 + (tax ?? 0),
    });

    it("appears only when the order charged tax", () => {
        const keys = (tax: number | null) => shopTotalLines(2400, order(tax)).map((l) => l.key);
        expect(keys(288)).toEqual(["subtotal", "tax", "total"]);
        expect(keys(0)).toEqual(["subtotal", "total"]);
        expect(keys(null)).toEqual(["subtotal", "total"]);
    });
});
