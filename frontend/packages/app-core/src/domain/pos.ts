import { useQuery } from "@powersync/react";
import { useCallback, useState } from "react";

import { useAsyncAction } from "../hooks/useAsyncAction";
import type { ApiLike } from "../util/api";
import type { Intent } from "../util/primitives";
import type { ItemRow } from "./catalog";

export interface OrderLineInput {
    item_id: string;
    description: string;
    quantity: number;
    unit_amount_cents: number;
}

export interface OrderLine {
    id: string;
    description: string;
    quantity: number;
    unit_amount_cents: number;
    amount_cents: number;
    tax_amount_cents: number;
    item_id: string | null;
    position: number;
}

export interface Order {
    id: string;
    client_id: string | null;
    status: string;
    currency: string;
    subtotal_cents: number;
    tax_total_cents: number;
    total_cents: number;
    amount_paid_cents: number;
    balance_cents: number;
    lines: OrderLine[];
}

export interface CheckoutResult {
    order_id: string;
    client_secret: string;
    payment_id: string;
}

export function createOrder(
    api: ApiLike,
    lines: OrderLineInput[],
    clientId: string | null = null,
): Promise<Order> {
    return api.post<Order>("/v1/orders", { client_id: clientId, lines });
}

export function updateOrder(
    api: ApiLike,
    orderId: string,
    lines: OrderLineInput[],
): Promise<Order> {
    return api.patch<Order>(`/v1/orders/${orderId}`, { lines });
}

export function voidOrder(api: ApiLike, orderId: string): Promise<Order> {
    return api.post<Order>(`/v1/orders/${orderId}/void`, {});
}

export function checkout(api: ApiLike, orderId: string): Promise<CheckoutResult> {
    return api.post<CheckoutResult>(`/v1/orders/${orderId}/checkout`, {});
}

export function requestConnectionToken(api: ApiLike): Promise<string> {
    return api.post<{ secret: string }>("/v1/terminal/connection-token", {}).then((r) => r.secret);
}

/** The Stripe Terminal token-provider seam. The native reader SDK (NOT wired here) calls this to
 *  authorize the card reader; the hook returns a stable provider to hand to the SDK on connect. */
export function useConnectionToken(api: ApiLike): () => Promise<string> {
    return useCallback(() => requestConnectionToken(api), [api]);
}

export interface OpenOrderRow {
    id: string;
    client_id: string | null;
    client_name: string | null;
    status: string;
    total_cents: number;
    balance_cents: number;
    created_at: string;
}

const OPEN_ORDERS_SQL = `
SELECT o.id, o.client_id, c.name AS client_name, o.status, o.total_cents, o.balance_cents, o.created_at
FROM orders o LEFT JOIN clients c ON c.id = o.client_id
WHERE o.status = 'open' ORDER BY o.created_at DESC`;

/** Open (un-charged) orders, synced — the register's "held" sales. */
export function useOpenOrders(): OpenOrderRow[] {
    return useQuery<OpenOrderRow>(OPEN_ORDERS_SQL).data;
}

export function orderStatusIntent(status: string): Intent {
    switch (status) {
        case "paid":
            return "success";
        case "open":
            return "accent";
        case "void":
            return "danger";
        default:
            return "neutral";
    }
}

export interface CartLine {
    key: string;
    itemId: string;
    description: string;
    unitAmountCents: number;
    quantity: number;
}

export function cartLineInputs(lines: CartLine[]): OrderLineInput[] {
    return lines.map((l) => ({
        item_id: l.itemId,
        description: l.description,
        quantity: l.quantity,
        unit_amount_cents: l.unitAmountCents,
    }));
}

export function cartSubtotalCents(lines: CartLine[]): number {
    return lines.reduce((sum, l) => sum + l.quantity * l.unitAmountCents, 0);
}

export type RegisterPhase = "cart" | "review" | "awaiting_reader";

export interface Cart {
    lines: CartLine[];
    addItem: (item: ItemRow) => void;
    removeLine: (key: string) => void;
    setQuantity: (key: string, quantity: number) => void;
    clear: () => void;
    subtotalCents: number;
    isEmpty: boolean;
    phase: RegisterPhase;
    order: Order | null;
    checkoutResult: CheckoutResult | null;
    busy: boolean;
    error: string | null;
    review: () => void;
    charge: () => void;
    voidSale: () => void;
    newSale: () => void;
}

let cartSeq = 0;

/** Register view-model: a local cart of catalog lines → server-totalled order (tax computed
 *  server-side on create/update) → checkout (returns a Terminal client_secret). Editing the cart
 *  after a review drops back to the cart phase so the total is re-fetched before charging. */
export function useCart(api: ApiLike): Cart {
    const [lines, setLines] = useState<CartLine[]>([]);
    const [phase, setPhase] = useState<RegisterPhase>("cart");
    const [order, setOrder] = useState<Order | null>(null);
    const [checkoutResult, setCheckoutResult] = useState<CheckoutResult | null>(null);
    const { busy, error, setError, run } = useAsyncAction();

    const invalidate = (): void => {
        setPhase("cart");
        setCheckoutResult(null);
    };

    const addItem = (item: ItemRow): void => {
        invalidate();
        setLines((ls) => {
            const existing = ls.find((l) => l.itemId === item.id);
            if (existing !== undefined)
                return ls.map((l) =>
                    l.key === existing.key ? { ...l, quantity: l.quantity + 1 } : l,
                );
            return [
                ...ls,
                {
                    key: `c${(cartSeq += 1)}`,
                    itemId: item.id,
                    description: item.name,
                    unitAmountCents: item.price_cents ?? 0,
                    quantity: 1,
                },
            ];
        });
    };

    const removeLine = (key: string): void => {
        invalidate();
        setLines((ls) => ls.filter((l) => l.key !== key));
    };

    const setQuantity = (key: string, quantity: number): void => {
        invalidate();
        setLines((ls) =>
            ls.map((l) => (l.key === key ? { ...l, quantity: Math.max(1, quantity) } : l)),
        );
    };

    const clear = (): void => {
        invalidate();
        setLines([]);
    };

    const newSale = (): void => {
        setLines([]);
        setOrder(null);
        setCheckoutResult(null);
        setError(null);
        setPhase("cart");
    };

    const review = (): void => {
        if (lines.length === 0) {
            setError("Add an item before charging.");
            return;
        }
        const payload = cartLineInputs(lines);
        void run(
            async () => {
                const result =
                    order === null
                        ? await createOrder(api, payload)
                        : await updateOrder(api, order.id, payload);
                setOrder(result);
                setPhase("review");
            },
            { errorMessage: "Couldn't total this sale. Please try again." },
        );
    };

    const charge = (): void => {
        if (order === null) return;
        void run(
            async () => {
                const result = await checkout(api, order.id);
                setCheckoutResult(result);
                setPhase("awaiting_reader");
            },
            { errorMessage: "Couldn't start the charge. Please try again." },
        );
    };

    const voidSale = (): void => {
        if (order === null) {
            newSale();
            return;
        }
        void run(() => voidOrder(api, order.id), {
            onSuccess: newSale,
            errorMessage: "Couldn't void this sale. Please try again.",
        });
    };

    return {
        lines,
        addItem,
        removeLine,
        setQuantity,
        clear,
        subtotalCents: cartSubtotalCents(lines),
        isEmpty: lines.length === 0,
        phase,
        order,
        checkoutResult,
        busy,
        error,
        review,
        charge,
        voidSale,
        newSale,
    };
}
