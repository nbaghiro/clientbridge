import { useQuery } from "@powersync/react";
import { useCallback, useState } from "react";

import { useAsyncAction } from "../hooks/useAsyncAction";
import { strings } from "../strings";
import type { ApiLike } from "../util/api";
import type { Intent } from "../util/primitives";
import type { ItemRow } from "./catalog";
import { type Checkout, useCheckout } from "./checkout";
import { collectedSql } from "./ledger";
import { canManagePayments } from "./payments";

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
    receipt_email?: string | null;
    receipt_phone?: string | null;
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

export interface SaleDetails {
    clientId: string | null;
    receiptEmail: string | null;
    receiptPhone: string | null;
}

const NO_DETAILS: SaleDetails = { clientId: null, receiptEmail: null, receiptPhone: null };

function detailsBody(d: SaleDetails): Record<string, unknown> {
    return { client_id: d.clientId, receipt_email: d.receiptEmail, receipt_phone: d.receiptPhone };
}

export function createOrder(
    api: ApiLike,
    lines: OrderLineInput[],
    details: SaleDetails = NO_DETAILS,
): Promise<Order> {
    return api.post<Order>("/v1/orders", { ...detailsBody(details), lines });
}

export function updateOrder(
    api: ApiLike,
    orderId: string,
    lines: OrderLineInput[],
    details: SaleDetails = NO_DETAILS,
): Promise<Order> {
    return api.patch<Order>(`/v1/orders/${orderId}`, { ...detailsBody(details), lines });
}

/** Pay an open sale by online card: a saved card of the sale's client charges now; otherwise the
 *  returned client secret is confirmed by the card form. The webhook settles it. */
export function payOrder(
    api: ApiLike,
    orderId: string,
    paymentMethodId: string | undefined,
    idempotencyKey: string,
): Promise<CheckoutResult> {
    return api.post<CheckoutResult>(
        `/v1/orders/${orderId}/pay`,
        { payment_method_id: paymentMethodId ?? null },
        { idempotencyKey },
    );
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
SELECT o.id, o.client_id, c.name AS client_name, o.status, o.total_cents,
       o.total_cents - ${collectedSql("order", "o.id")} AS balance_cents, o.created_at
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

export type PickupStatus = "unfulfilled" | "ready" | "picked_up";

export interface OnlineOrderRow {
    id: string;
    client_name: string | null;
    total_cents: number;
    currency: string;
    pickup_status: PickupStatus;
    summary: string | null;
    created_at: string;
}

const ONLINE_ORDERS_SQL = `
SELECT o.id, c.name AS client_name, o.total_cents, o.currency, o.pickup_status, o.created_at,
       (SELECT group_concat(CAST(l.quantity AS INTEGER) || ' × ' || l.description, ', ')
        FROM lines l WHERE l.parent_type = 'order' AND l.parent_id = o.id) AS summary
FROM orders o LEFT JOIN clients c ON c.id = o.client_id
WHERE o.source = 'online' AND o.status = 'paid' AND o.pickup_status <> 'picked_up'
ORDER BY o.created_at`;

/** Paid shop orders still waiting to be collected, oldest first. */
export function useOnlineOrders(): OnlineOrderRow[] {
    return useQuery<OnlineOrderRow>(ONLINE_ORDERS_SQL).data;
}

export const PICKUP_LABEL: Record<PickupStatus, string> = {
    unfulfilled: strings.pos.pickupUnfulfilled,
    ready: strings.pos.pickupReady,
    picked_up: strings.pos.pickupDone,
};

export function pickupIntent(status: PickupStatus): Intent {
    return status === "ready" ? "success" : "warning";
}

/** The steps staff can take from here; the server only moves an order forward. */
export function pickupActions(status: PickupStatus): { status: PickupStatus; label: string }[] {
    const pickedUp = { status: "picked_up" as const, label: strings.pos.markPickedUp };
    if (status === "unfulfilled")
        return [{ status: "ready", label: strings.pos.markReady }, pickedUp];
    return status === "ready" ? [pickedUp] : [];
}

export function setPickup(api: ApiLike, orderId: string, status: PickupStatus): Promise<Order> {
    return api.post<Order>(`/v1/orders/${orderId}/pickup`, { status });
}

export interface PickupAction {
    advance: (orderId: string, status: PickupStatus) => void;
    busy: boolean;
    error: string | null;
}

export function usePickupAction(api: ApiLike): PickupAction {
    const { busy, error, run } = useAsyncAction();
    return {
        advance: (orderId, status) => {
            run(() => setPickup(api, orderId, status), { errorMessage: strings.pos.pickupError });
        },
        busy,
        error,
    };
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

export type RegisterPhase = "cart" | "review" | "awaiting_reader" | "paid";

export interface Cart {
    lines: CartLine[];
    clientId: string | null;
    setClientId: (id: string | null) => void;
    receiptEmail: string;
    setReceiptEmail: (v: string) => void;
    receiptPhone: string;
    setReceiptPhone: (v: string) => void;
    markPaid: () => void;
    backToCart: () => void;
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

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Register view-model: a local cart of catalog lines → server-totalled order (tax computed
 *  server-side on create/update) → checkout (returns a Terminal client_secret). Editing the cart
 *  after a review drops back to the cart phase so the total is re-fetched before charging. */
export function useCart(api: ApiLike): Cart {
    const [lines, setLines] = useState<CartLine[]>([]);
    const [phase, setPhase] = useState<RegisterPhase>("cart");
    const [order, setOrder] = useState<Order | null>(null);
    const [checkoutResult, setCheckoutResult] = useState<CheckoutResult | null>(null);
    const [clientId, setClientIdState] = useState<string | null>(null);
    const [receiptEmail, setReceiptEmailState] = useState("");
    const [receiptPhone, setReceiptPhoneState] = useState("");
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
        setClientIdState(null);
        setReceiptEmailState("");
        setReceiptPhoneState("");
        setError(null);
        setPhase("cart");
    };

    const review = (): void => {
        if (lines.length === 0) {
            setError(strings.pos.addItemFirst);
            return;
        }
        const email = receiptEmail.trim();
        if (email !== "" && !EMAIL.test(email)) {
            setError(strings.pos.receiptEmailInvalid);
            return;
        }
        const payload = cartLineInputs(lines);
        const details: SaleDetails = {
            clientId,
            receiptEmail: email === "" ? null : email,
            receiptPhone: receiptPhone.trim() === "" ? null : receiptPhone.trim(),
        };
        run(
            async () => {
                const result =
                    order === null
                        ? await createOrder(api, payload, details)
                        : await updateOrder(api, order.id, payload, details);
                setOrder(result);
                setPhase("review");
            },
            { errorMessage: strings.pos.totalError },
        );
    };

    const charge = (): void => {
        if (order === null) return;
        run(
            async () => {
                const result = await checkout(api, order.id);
                setCheckoutResult(result);
                setPhase("awaiting_reader");
            },
            { errorMessage: strings.pos.chargeStartError },
        );
    };

    const voidSale = (): void => {
        if (order === null) {
            newSale();
            return;
        }
        run(() => voidOrder(api, order.id), {
            onSuccess: newSale,
            errorMessage: strings.pos.voidError,
        });
    };

    return {
        lines,
        clientId,
        setClientId: (id) => {
            invalidate();
            setClientIdState(id);
        },
        receiptEmail,
        setReceiptEmail: (v) => {
            invalidate();
            setReceiptEmailState(v);
        },
        receiptPhone,
        setReceiptPhone: (v) => {
            invalidate();
            setReceiptPhoneState(v);
        },
        markPaid: () => {
            setPhase("paid");
        },
        backToCart: invalidate,
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

/** Voiding a sale is a manager action; staff ring up and collect. */
export function canVoidSale(role: string | null): boolean {
    return canManagePayments(role);
}

export interface SaleCheckout {
    checkout: Checkout;
    submit: () => void;
}

/** Card payment for a reviewed sale through the shared checkout; the sale's client's saved card is
 *  the default, a walk-in pays with a new card. */
export function useSaleCheckout(api: ApiLike, cart: Cart, defaultMethod?: string): SaleCheckout {
    const checkout = useCheckout(
        cart.markPaid,
        defaultMethod === undefined ? {} : { defaultMethod },
    );
    const submit = (): void => {
        const order = cart.order;
        if (order === null) return;
        checkout.pay(
            ({ paymentMethodId, idempotencyKey }) =>
                payOrder(api, order.id, paymentMethodId, idempotencyKey),
            strings.pos.payError,
        );
    };
    return { checkout, submit };
}
