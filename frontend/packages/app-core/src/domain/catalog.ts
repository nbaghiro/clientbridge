import { useQuery } from "@powersync/react";
import { useState } from "react";

import { useAsyncAction } from "../hooks/useAsyncAction";
import type { ApiLike } from "../util/api";
import { blankToNull } from "../util/format";

export interface ItemRow {
    id: string;
    kind: string;
    name: string;
    category: string | null;
    price_cents: number | null;
    duration_min: number | null;
    active: number;
}

export const KIND_LABEL: Record<string, string> = {
    service: "Service",
    product: "Product",
    class: "Class",
    package: "Package",
    subscription: "Subscription",
    gift: "Gift card",
};

export const ITEM_KINDS = [
    "service",
    "product",
    "class",
    "package",
    "subscription",
    "gift",
] as const;

const ITEMS_SQL =
    "SELECT id, kind, name, category, price_cents, duration_min, active FROM items ORDER BY active DESC, name COLLATE NOCASE";

export function useCatalogItems(): ItemRow[] {
    return useQuery<ItemRow>(ITEMS_SQL).data;
}

export function filterItems(rows: ItemRow[], q: string): ItemRow[] {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter(
        (i) => i.name.toLowerCase().includes(t) || (i.category ?? "").toLowerCase().includes(t),
    );
}

export interface ItemInput {
    kind: string;
    name: string;
    priceDollars?: string | number;
    durationMin?: string | number | null;
    category?: string | null;
}

export function createItem(api: ApiLike, input: ItemInput): Promise<{ id: string }> {
    const dollars = Number(input.priceDollars);
    return api.post<{ id: string }>("/v1/items", {
        kind: input.kind,
        name: input.name.trim(),
        price_cents: Math.round((Number.isFinite(dollars) ? dollars : 0) * 100),
        duration_min: input.durationMin ? Number(input.durationMin) : null,
        category: blankToNull(input.category),
    });
}

export interface ItemForm {
    kind: string;
    setKind: (v: string) => void;
    name: string;
    setName: (v: string) => void;
    price: string;
    setPrice: (v: string) => void;
    duration: string;
    setDuration: (v: string) => void;
    category: string;
    setCategory: (v: string) => void;
    busy: boolean;
    error: string | null;
    submit: () => void;
}

/** Shared add-item form: field state + validation + submit; the platform owns only the inputs. */
export function useItemForm(api: ApiLike, onCreated: () => void): ItemForm {
    const [kind, setKind] = useState("service");
    const [name, setName] = useState("");
    const [price, setPrice] = useState("");
    const [duration, setDuration] = useState("");
    const [category, setCategory] = useState("");
    const { busy, error, setError, run } = useAsyncAction();

    const submit = (): void => {
        if (name.trim().length === 0) {
            setError("Name is required");
            return;
        }
        void run(
            () =>
                createItem(api, {
                    kind,
                    name,
                    priceDollars: price,
                    durationMin: duration,
                    category,
                }),
            {
                onSuccess: () => {
                    setName("");
                    setPrice("");
                    setDuration("");
                    setCategory("");
                    onCreated();
                },
                errorMessage: "Could not add item",
            },
        );
    };

    return {
        kind,
        setKind,
        name,
        setName,
        price,
        setPrice,
        duration,
        setDuration,
        category,
        setCategory,
        busy,
        error,
        submit,
    };
}
