// Unauthenticated online shop: a business's products bought online and collected in person. Keyed
// by the business slug like the booking page; hits the API with a plain `fetch`.

import { useRef, useState } from "react";

import { useAsyncAction } from "../hooks";
import { strings } from "../strings";
import { newIdempotencyKey } from "../api";
import { type PublicBrand, usePublicResource } from "./publicResource";

export interface PublicShopItem {
    id: string;
    name: string;
    description: string | null;
    price_cents: number;
    currency: string;
    image_url: string | null;
    in_stock: boolean;
}

export interface PublicShop {
    business_name: string;
    brand: PublicBrand;
    items: PublicShopItem[];
    stripe_account_id: string | null;
}

export interface PublicShopOrderResult {
    order_id: string;
    total_cents: number;
    currency: string;
    client_secret: string;
    stripe_account_id: string;
}

export class PublicShopError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = "PublicShopError";
    }
}

export interface PublicShopClient {
    getShop: (slug: string) => Promise<PublicShop>;
    placeOrder(
        slug: string,
        input: {
            client: { name: string; email: string | null; phone: string | null };
            lines: { itemId: string; quantity: number }[];
        },
        idempotencyKey: string,
    ): Promise<PublicShopOrderResult>;
}

export function createPublicShopClient(baseUrl: string): PublicShopClient {
    const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
        const res = await fetch(`${baseUrl}${path}`, init);
        if (!res.ok) {
            const body = (await res.json().catch(() => null)) as { message?: string } | null;
            throw new PublicShopError(res.status, body?.message ?? res.statusText);
        }
        return (await res.json()) as T;
    };
    return {
        getShop: (slug) => request<PublicShop>(`/book/${encodeURIComponent(slug)}/shop`),
        placeOrder: (slug, { client, lines }, idempotencyKey) =>
            request<PublicShopOrderResult>(`/book/${encodeURIComponent(slug)}/shop/orders`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
                body: JSON.stringify({
                    client,
                    lines: lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity })),
                }),
            }),
    };
}

/** The price of the chosen quantities, ignoring ids that aren't (or are no longer) offered. */
export function cartSubtotal(
    items: { id: string; price_cents: number }[],
    cart: Record<string, number>,
): number {
    return items.reduce((sum, item) => sum + item.price_cents * (cart[item.id] ?? 0), 0);
}

export type PublicShopStatus = "loading" | "not-found" | "error" | "ready" | "paying" | "paid";

export interface PublicShopForm {
    status: PublicShopStatus;
    shop: PublicShop | null;
    cart: Record<string, number>;
    setQuantity: (itemId: string, quantity: number) => void;
    subtotalCents: number;
    name: string;
    setName: (v: string) => void;
    email: string;
    setEmail: (v: string) => void;
    phone: string;
    setPhone: (v: string) => void;
    canOrder: boolean;
    submit: () => void;
    order: PublicShopOrderResult | null;
    markPaid: () => void;
    cancelPayment: () => void;
    busy: boolean;
    error: string | null;
}

/** View-model for the shop page: pick products, give a name and an email or phone, then pay by card
 *  for pickup. One idempotency key per order attempt, kept across retries until it succeeds. */
export function usePublicShop(client: PublicShopClient, slug: string): PublicShopForm {
    const { status: load, data: shop } = usePublicResource(client.getShop, slug);
    const [cart, setCart] = useState<Record<string, number>>({});
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [order, setOrder] = useState<PublicShopOrderResult | null>(null);
    const [paid, setPaid] = useState(false);
    const key = useRef<string | null>(null);
    const { busy, error, setError, run } = useAsyncAction();

    const setQuantity = (itemId: string, quantity: number): void => {
        key.current = null;
        setCart((prev) => {
            if (quantity > 0) return { ...prev, [itemId]: Math.min(quantity, 20) };
            return Object.fromEntries(Object.entries(prev).filter(([id]) => id !== itemId));
        });
    };
    const lines = Object.entries(cart).map(([itemId, quantity]) => ({ itemId, quantity }));
    const canOrder =
        lines.length > 0 &&
        name.trim().length > 0 &&
        (email.trim().length > 0 || phone.trim().length > 0);

    const submit = (): void => {
        if (!canOrder) {
            setError(strings.publicShop.incomplete);
            return;
        }
        key.current ??= newIdempotencyKey();
        const attempt = key.current;
        run(
            async () => {
                try {
                    setOrder(
                        await client.placeOrder(
                            slug,
                            {
                                client: {
                                    name: name.trim(),
                                    email: email.trim() || null,
                                    phone: phone.trim() || null,
                                },
                                lines,
                            },
                            attempt,
                        ),
                    );
                } catch (e) {
                    if (e instanceof PublicShopError && e.status === 409) {
                        setError(e.message);
                        return;
                    }
                    throw e;
                }
            },
            { errorMessage: strings.publicShop.orderError },
        );
    };

    const status: PublicShopStatus =
        load !== "ready" ? load : paid ? "paid" : order !== null ? "paying" : "ready";

    return {
        status,
        shop,
        cart,
        setQuantity,
        subtotalCents: cartSubtotal(shop?.items ?? [], cart),
        name,
        setName,
        email,
        setEmail,
        phone,
        setPhone,
        canOrder,
        submit,
        order,
        markPaid: () => {
            key.current = null;
            setPaid(true);
        },
        cancelPayment: () => {
            setOrder(null);
        },
        busy,
        error,
    };
}
