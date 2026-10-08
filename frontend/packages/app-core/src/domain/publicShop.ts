import { useEffect, useMemo, useRef, useState } from "react";

import { useAsyncAction } from "../hooks";
import { strings } from "../strings";
import { newIdempotencyKey } from "../api";
import { type PublicBrand, usePublicResource } from "./publicResource";

interface PublicShopItem {
    variant_parent_id?: string | null;
    variant_label?: string | null;
    id: string;
    name: string;
    description: string | null;
    price_cents: number;
    currency: string;
    image_url: string | null;
    in_stock: boolean;
    category: string | null;
    // Null when the business doesn't track stock for it.
    stock_left: number | null;
}

export interface PublicShop {
    business_name: string;
    brand: PublicBrand;
    items: PublicShopItem[];
    stripe_account_id: string | null;
}

interface PublicShopOrderResult {
    subtotal_cents?: number | null;
    tax_total_cents?: number | null;
    order_id: string;
    order_token?: string | null;
    total_cents: number;
    currency: string;
    client_secret: string;
    stripe_account_id: string;
}

class PublicShopError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = "PublicShopError";
    }
}

interface PickupWindow {
    starts_at: string;
    ends_at: string;
}
interface PickupDays {
    windows: PickupWindow[];
    hold_days: number;
}

interface PublicShopClient {
    getPickup: (slug: string) => Promise<PickupDays>;
    getShop: (slug: string) => Promise<PublicShop>;
    placeOrder(
        slug: string,
        input: {
            client: { name: string; email: string | null; phone: string | null };
            lines: { itemId: string; quantity: number }[];
            pickup_from: string | null;
            pickup_to: string | null;
            note: string | null;
            notify_sms: boolean;
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
        getPickup: (slug) =>
            request<PickupDays>(`/book/${encodeURIComponent(slug)}/shop/pickup-days`),
        getShop: (slug) => request<PublicShop>(`/book/${encodeURIComponent(slug)}/shop`),
        placeOrder: (slug, { client, lines, ...pickup }, idempotencyKey) =>
            request<PublicShopOrderResult>(`/book/${encodeURIComponent(slug)}/shop/orders`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
                body: JSON.stringify({
                    client,
                    ...pickup,
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

type PublicShopStatus = "loading" | "not-found" | "error" | "ready" | "paying" | "paid";

interface PublicShopForm {
    pickup: PickupDays | null;
    pickupFrom: string;
    setPickupFrom: (value: string) => void;
    note: string;
    setNote: (value: string) => void;
    notifySms: boolean;
    setNotifySms: (value: boolean) => void;
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

/** One idempotency key per order attempt, kept across retries until it succeeds. */
interface ShopStorage {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
}

function storedCart(storage: ShopStorage | undefined, slug: string): Record<string, number> {
    try {
        const raw: unknown = JSON.parse(storage?.getItem(`connect-cart:${slug}`) ?? "{}");
        if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
        return Object.fromEntries(
            Object.entries(raw).filter(
                (entry): entry is [string, number] =>
                    typeof entry[1] === "number" &&
                    Number.isInteger(entry[1]) &&
                    entry[1] > 0 &&
                    entry[1] <= 20,
            ),
        );
    } catch {
        return {};
    }
}

function usePublicShop(
    client: PublicShopClient,
    slug: string,
    storage?: ShopStorage,
): PublicShopForm {
    const { status: load, data: shop } = usePublicResource(client.getShop, slug);
    const [cart, setCart] = useState<Record<string, number>>(() => storedCart(storage, slug));
    const [name, setName] = useState("");
    const pickup = usePublicResource(client.getPickup, slug).data;
    const [pickupFrom, setPickupFrom] = useState("");
    const [note, setNote] = useState("");
    const [notifySms, setNotifySms] = useState(true);
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [order, setOrder] = useState<PublicShopOrderResult | null>(null);
    const [paid, setPaid] = useState(false);
    const key = useRef<string | null>(null);
    const attemptedInput = useRef("");
    const { busy, error, setError, run } = useAsyncAction();

    useEffect(() => {
        try {
            storage?.setItem(`connect-cart:${slug}`, JSON.stringify(cart));
        } catch {
            /* Storage can be disabled by the host browser. */
        }
    }, [cart, slug, storage]);

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
        const fingerprint = JSON.stringify({
            name: name.trim(),
            email: email.trim(),
            phone: phone.trim(),
            lines,
            pickupFrom,
            note: note.trim(),
            notifySms,
        });
        if (attemptedInput.current !== fingerprint) {
            key.current = null;
            attemptedInput.current = fingerprint;
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
                                pickup_from: pickupFrom || null,
                                pickup_to:
                                    pickup?.windows.find(
                                        (window) => window.starts_at === pickupFrom,
                                    )?.ends_at ?? null,
                                note: note.trim() || null,
                                notify_sms: notifySms,
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
        pickup,
        pickupFrom,
        setPickupFrom,
        note,
        setNote,
        notifySms,
        setNotifySms,
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
            setCart({});
        },
        cancelPayment: () => {
            setOrder(null);
        },
        busy,
        error,
    };
}

const MAX_EACH = 20;

/** The shop page: the cart and checkout from usePublicShop, plus categories, cart lines and stock caps. */
export function useShopFlow(client: PublicShopClient, slug: string, storage?: ShopStorage) {
    const base = usePublicShop(client, slug, storage);
    const [search, setSearch] = useState("");
    const [category, setCategory] = useState("all");
    const [pickupDay, setPickupDay] = useState("asap");
    const items = useMemo(() => base.shop?.items ?? [], [base.shop]);
    const cap = (item: PublicShopItem): number => Math.min(MAX_EACH, item.stock_left ?? MAX_EACH);
    const lines = items
        .filter((i) => (base.cart[i.id] ?? 0) > 0)
        .map((i) => ({ item: i, quantity: base.cart[i.id] ?? 0, max: cap(i) }));
    const cats = Array.from(
        new Set(items.map((i) => i.category).filter((c): c is string => c !== null && c !== "")),
    );
    return {
        ...base,
        category,
        setCategory,
        pickupDay,
        pickupDays: [
            { key: "asap", label: strings.publicShop.pickupAsap },
            ...Array.from(
                new Map(
                    (base.pickup?.windows ?? []).map((window) => [
                        window.starts_at.slice(0, 10),
                        window,
                    ]),
                ).entries(),
            ).map(([key, window]) => ({
                key,
                label: new Date(window.starts_at).toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                }),
            })),
        ],
        pickupWindows: (base.pickup?.windows ?? [])
            .filter((window) => window.starts_at.slice(0, 10) === pickupDay)
            .map((window) => ({
                key: window.starts_at,
                label: new Date(window.starts_at).toLocaleTimeString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                }),
                hint: new Date(window.ends_at).toLocaleTimeString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                }),
            })),
        setPickupDay: (day: string) => {
            setPickupDay(day);
            base.setPickupFrom(
                base.pickup?.windows.find((window) => window.starts_at.slice(0, 10) === day)
                    ?.starts_at ?? "",
            );
        },
        categories: [
            { key: "all", label: strings.publicShop.all },
            ...cats.map((c) => ({ key: c, label: c })),
        ],
        search,
        setSearch,
        variants: (id: string) => items.filter((item) => item.variant_parent_id === id),
        visible: items
            .filter(
                (i) =>
                    !i.variant_parent_id &&
                    (category === "all" || i.category === category) &&
                    `${i.name} ${i.description ?? ""}`
                        .toLocaleLowerCase()
                        .includes(search.trim().toLocaleLowerCase()),
            )
            .map((item) => {
                const variants = items.filter(
                    (candidate) => candidate.variant_parent_id === item.id,
                );
                return variants.length
                    ? {
                          ...item,
                          price_cents: Math.min(...variants.map((variant) => variant.price_cents)),
                          in_stock: variants.some((variant) => variant.in_stock),
                          stock_left: null,
                      }
                    : item;
            }),
        lines,
        count: lines.reduce((n, l) => n + l.quantity, 0),
        addOne: (item: PublicShopItem) => {
            base.setQuantity(item.id, Math.min(cap(item), (base.cart[item.id] ?? 0) + 1));
        },
        setLine: (item: PublicShopItem, quantity: number) => {
            base.setQuantity(item.id, Math.min(cap(item), quantity));
        },
        orderNumber: base.order ? base.order.order_id.slice(-6).toUpperCase() : null,
    };
}

export type ShopFlow = ReturnType<typeof useShopFlow>;
