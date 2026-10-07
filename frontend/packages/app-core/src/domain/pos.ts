import { useQuery } from "@powersync/react";
import { useCallback, useMemo, useState } from "react";

import { daysUntil, parseTimestamp, relativeDayTime } from "../datetime";
import { formatMoney, formatPhone } from "../format";
import { type Load, useAsyncAction } from "../hooks";
import { strings } from "../strings";
import type { ApiLike } from "../api";
import type { Intent } from "../ui";
import type { ItemRow } from "./catalog";
import { type Checkout, useCheckout } from "./checkout";
import { collectedSql, orderStatusSql } from "./ledger";
import { canManagePayments } from "./payments";
import { useReplicaLoad } from "./sync";

interface OrderLineInput {
    item_id: string;
    description: string;
    quantity: number;
    unit_amount_cents: number;
}

interface OrderLine {
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

interface CheckoutResult {
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

function createOrder(
    api: ApiLike,
    lines: OrderLineInput[],
    details: SaleDetails = NO_DETAILS,
): Promise<Order> {
    return api.post<Order>("/v1/orders", { ...detailsBody(details), lines });
}

function updateOrder(
    api: ApiLike,
    orderId: string,
    lines: OrderLineInput[],
    details: SaleDetails = NO_DETAILS,
): Promise<Order> {
    return api.patch<Order>(`/v1/orders/${orderId}`, { ...detailsBody(details), lines });
}

/** The webhook settles the payment. */
function payOrder(
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

function voidOrder(api: ApiLike, orderId: string): Promise<Order> {
    return api.post<Order>(`/v1/orders/${orderId}/void`, {});
}

export function checkout(api: ApiLike, orderId: string): Promise<CheckoutResult> {
    return api.post<CheckoutResult>(`/v1/orders/${orderId}/checkout`, {});
}

function requestConnectionToken(api: ApiLike): Promise<string> {
    return api.post<{ secret: string }>("/v1/terminal/connection-token", {}).then((r) => r.secret);
}

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

export const OPEN_ORDERS_SQL = `
SELECT o.id, o.client_id, c.name AS client_name, ${orderStatusSql("o")} AS status, o.total_cents,
       o.total_cents - ${collectedSql("order", "o.id")} AS balance_cents, o.created_at
FROM orders o LEFT JOIN clients c ON c.id = o.client_id
WHERE ${orderStatusSql("o")} = 'open' ORDER BY o.created_at DESC`;

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

// A paid online order moves unfulfilled -> ready -> picked_up; cancelling is a refund, not a status.
type PickupStatus = "unfulfilled" | "ready" | "picked_up";

const PICKUP_FLOW: PickupStatus[] = ["unfulfilled", "ready", "picked_up"];

const STATUS: Record<PickupStatus, { label: string; intent: Intent; empty: string }> = {
    unfulfilled: {
        label: strings.pos.pickup.toPack,
        intent: "warning",
        empty: strings.pos.pickup.emptyToPack,
    },
    ready: {
        label: strings.pos.pickup.ready,
        intent: "accent",
        empty: strings.pos.pickup.emptyReady,
    },
    picked_up: {
        label: strings.pos.pickup.pickedUp,
        intent: "success",
        empty: strings.pos.pickup.emptyPickedUp,
    },
};

export function nextPickupStatus(s: PickupStatus): PickupStatus | null {
    return s === "unfulfilled" ? "ready" : s === "ready" ? "picked_up" : null;
}

/** The client is told when an order is ready; nothing is sent when it is picked up. */
function setPickupStatus(
    api: ApiLike,
    orderId: string,
    status: Exclude<PickupStatus, "unfulfilled">,
): Promise<unknown> {
    return api.post(`/v1/orders/${orderId}/pickup`, { status });
}

export const PICKUP_ORDERS_SQL = `
SELECT o.id, o.client_id, c.name AS client_name, c.phone, c.email, o.pickup_status,
       o.total_cents, o.created_at, o.ready_at, o.picked_up_at
FROM orders o LEFT JOIN clients c ON c.id = o.client_id
WHERE o.source = 'online' AND o.pickup_status IS NOT NULL AND ${orderStatusSql("o")} = 'paid'
ORDER BY o.created_at DESC`;

export const PICKUP_LINES_SQL = `
SELECT l.id, l.order_id, l.item_id, l.description, l.quantity, l.unit_amount_cents,
       i.color AS item_color
FROM lines l JOIN orders o ON o.id = l.order_id LEFT JOIN items i ON i.id = l.item_id
WHERE o.source = 'online' AND o.pickup_status IS NOT NULL
ORDER BY l.order_id, l.position`;

interface PickupRow {
    id: string;
    client_id: string | null;
    client_name: string | null;
    phone: string | null;
    email: string | null;
    pickup_status: PickupStatus;
    total_cents: number;
    created_at: string;
    ready_at: string | null;
    picked_up_at: string | null;
}

interface PickupLineRow {
    id: string;
    order_id: string;
    item_id: string | null;
    description: string;
    quantity: number;
    unit_amount_cents: number;
    item_color: string | null;
}

interface PickupLine {
    id: string;
    itemId: string | null;
    name: string;
    quantity: number;
    unitCents: number;
    color: string | null;
}

interface PickupOrder {
    id: string;
    clientId: string | null;
    clientName: string;
    status: PickupStatus;
    statusLabel: string;
    intent: Intent;
    lines: PickupLine[];
    itemsLabel: string;
    total: string;
    contact: string;
    phone: string | null;
    email: string | null;
    // Placed, ready since or picked up at, whichever is latest.
    when: string;
    waiting: string;
}

export function pickupOrder(row: PickupRow, lines: PickupLineRow[], now: Date): PickupOrder {
    const status = row.pickup_status;
    const p = strings.pos.pickup;
    const since = parseTimestamp(
        status === "ready" && row.ready_at !== null ? row.ready_at : row.created_at,
    );
    const mine = lines.filter((l) => l.order_id === row.id);
    return {
        id: row.id,
        clientId: row.client_id,
        clientName: row.client_name ?? p.guest,
        status,
        statusLabel: STATUS[status].label,
        intent: STATUS[status].intent,
        lines: mine.map((l) => ({
            id: l.id,
            itemId: l.item_id,
            name: l.description,
            quantity: l.quantity,
            unitCents: l.unit_amount_cents,
            color: l.item_color,
        })),
        itemsLabel: p.items(mine.reduce((n, l) => n + l.quantity, 0)),
        total: formatMoney(row.total_cents),
        contact: [row.phone === null ? null : formatPhone(row.phone), row.email]
            .filter((v) => v !== null && v !== "")
            .join(" · "),
        phone: row.phone,
        email: row.email,
        when:
            status === "picked_up" && row.picked_up_at !== null
                ? p.pickedAt(relativeDayTime(parseTimestamp(row.picked_up_at), now))
                : status === "ready" && row.ready_at !== null
                  ? p.readySince(relativeDayTime(parseTimestamp(row.ready_at), now))
                  : p.placed(relativeDayTime(parseTimestamp(row.created_at), now)),
        waiting: p.waiting(Math.max(0, -daysUntil(since, now))),
    };
}

interface PickupQueue {
    load: Load;
    q: string;
    setQ: (q: string) => void;
    status: PickupStatus;
    setStatus: (s: PickupStatus) => void;
    all: PickupOrder[];
    segments: { key: PickupStatus; label: string; count: number }[];
    columns: {
        key: PickupStatus;
        label: string;
        intent: Intent;
        orders: PickupOrder[];
        empty: string;
    }[];
    list: PickupOrder[];
    selected: PickupOrder | null;
    select: (id: string | null) => void;
    advance: (id: string) => void;
    // A step the server allows from here, e.g. straight to picked up from to pack.
    move: (id: string, status: PickupStatus) => void;
    busyId: string | null;
    error: string | null;
}

/** The shared pickup queue: to pack, ready and picked up, worked from the front desk board. */
export function usePickupOrders(api: ApiLike): PickupQueue {
    const [now] = useState(() => new Date());
    const orders = useQuery<PickupRow>(PICKUP_ORDERS_SQL);
    const lines = useQuery<PickupLineRow>(PICKUP_LINES_SQL);
    const [q, setQ] = useState("");
    const [status, setStatus] = useState<PickupStatus>("unfulfilled");
    const [selectedId, select] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const { error, run } = useAsyncAction();
    const all = useMemo(
        () => orders.data.map((o) => pickupOrder(o, lines.data, now)),
        [orders.data, lines.data, now],
    );
    const t = q.trim().toLowerCase();
    const match = (o: PickupOrder): boolean =>
        t === "" ||
        [o.clientName, ...o.lines.map((l) => l.name)].some((v) => v.toLowerCase().includes(t));
    const load = useReplicaLoad([orders, lines], all.length === 0);
    const move = (id: string, to: PickupStatus): void => {
        if (to === "unfulfilled") return;
        setBusyId(id);
        run(() => setPickupStatus(api, id, to), {
            onSuccess: () => {
                setBusyId(null);
            },
            errorMessage: strings.pos.pickup.error,
        });
    };
    return {
        load,
        q,
        setQ,
        status,
        setStatus,
        all,
        segments: PICKUP_FLOW.map((k) => ({
            key: k,
            label: STATUS[k].label,
            count: all.filter((o) => o.status === k).length,
        })),
        columns: PICKUP_FLOW.map((k) => ({
            key: k,
            label: STATUS[k].label,
            intent: STATUS[k].intent,
            orders: all.filter((o) => o.status === k && match(o)),
            empty: STATUS[k].empty,
        })),
        list: all.filter((o) => o.status === status && match(o)),
        selected: all.find((o) => o.id === selectedId) ?? null,
        select,
        advance: (id) => {
            const order = all.find((o) => o.id === id);
            const next = order === undefined ? null : nextPickupStatus(order.status);
            if (next !== null) move(id, next);
        },
        move,
        busyId: error === null ? busyId : null,
        error,
    };
}

/** The steps staff can take from here; the server only moves an order forward. */
export function pickupActions(status: PickupStatus): { status: PickupStatus; label: string }[] {
    const pickedUp = { status: "picked_up" as const, label: strings.pos.markPickedUp };
    if (status === "unfulfilled")
        return [{ status: "ready", label: strings.pos.markReady }, pickedUp];
    return status === "ready" ? [pickedUp] : [];
}

export interface CartLine {
    key: string;
    itemId: string;
    description: string;
    unitAmountCents: number;
    quantity: number;
}

function cartLineInputs(lines: CartLine[]): OrderLineInput[] {
    return lines.map((l) => ({
        item_id: l.itemId,
        description: l.description,
        quantity: l.quantity,
        unit_amount_cents: l.unitAmountCents,
    }));
}

function cartSubtotalCents(lines: CartLine[]): number {
    return lines.reduce((sum, l) => sum + l.quantity * l.unitAmountCents, 0);
}

type RegisterPhase = "cart" | "review" | "awaiting_reader" | "paid";

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

/** Editing the cart after review drops back to the cart phase so the total is refetched before charging. */
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

interface SaleCheckout {
    checkout: Checkout;
    submit: () => void;
}

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
