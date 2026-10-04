import { useQuery } from "@powersync/react";
import { useRef, useState } from "react";

import { useAsyncAction } from "../hooks/useAsyncAction";
import type { ApiLike } from "../util/api";
import { blankToNull } from "../util/format";
import { type Intent, newIdempotencyKey } from "../util/primitives";
import { strings } from "../strings";
import { giftItems, useCatalogItems } from "./catalog";
import { type Checkout, useCheckout } from "./checkout";
import { ownedLiabilitySql } from "./ledger";

export interface GiftCardRow {
    id: string;
    code: string;
    initial_cents: number;
    balance_cents: number;
    status: string;
    recipient: string | null;
}

const GIFT_CARDS_SQL = `
SELECT g.id, g.code, g.initial_cents, ${ownedLiabilitySql("gift_card", "gift_card", "g.id")} AS balance_cents,
       g.status, g.recipient
FROM gift_cards g ORDER BY g.created_at DESC`;

export function useGiftCards(): GiftCardRow[] {
    return useQuery<GiftCardRow>(GIFT_CARDS_SQL).data;
}

export function giftCardStatusIntent(status: string): Intent {
    switch (status) {
        case "active":
            return "success";
        case "pending":
            return "accent";
        case "expired":
            return "danger";
        default:
            return "neutral"; // redeemed, void
    }
}

export interface GiftCardPurchaseInput {
    purchaser_client_id: string;
    item_id?: string | undefined;
    amount_cents?: number | undefined;
    recipient?: string | null;
    payment_method_id?: string | undefined;
}

export interface GiftCardPurchaseResult {
    gift_card_id: string;
    code: string;
    payment_id: string;
    client_secret: string;
}

export function purchaseGiftCard(
    api: ApiLike,
    input: GiftCardPurchaseInput,
    idempotencyKey: string,
): Promise<GiftCardPurchaseResult> {
    return api.post<GiftCardPurchaseResult>("/v1/gift-cards", input, { idempotencyKey });
}

export interface GiftCardRedeemResult {
    id: string;
    code: string;
    initial_cents: number;
    balance_cents: number;
    status: string;
}

export function redeemGiftCard(
    api: ApiLike,
    input: { code: string; amount_cents: number },
    idempotencyKey: string,
): Promise<GiftCardRedeemResult> {
    return api.post<GiftCardRedeemResult>("/v1/gift-cards/redeem", input, { idempotencyKey });
}

export type GiftSaleMode = "preset" | "custom";

export const GIFT_SALE_MODES: GiftSaleMode[] = ["preset", "custom"];
export const GIFT_SALE_MODE_LABEL: Record<GiftSaleMode, string> = {
    preset: strings.giftCards.modePreset,
    custom: strings.giftCards.modeCustom,
};

export interface GiftCardSaleForm {
    purchaserClientId: string;
    setPurchaserClientId: (v: string) => void;
    mode: GiftSaleMode; // "preset" sends item_id; "custom" sends amount_cents
    setMode: (v: GiftSaleMode) => void;
    itemId: string;
    setItemId: (v: string) => void;
    amount: string;
    setAmount: (v: string) => void;
    recipient: string;
    setRecipient: (v: string) => void;
    faceAmountCents: number | null; // the card's face value (preset price or parsed custom), for display
    checkout: Checkout;
    submit: () => void;
}

/** Sell-gift-card form: a purchaser client + either a preset gift item (`item_id`) or a custom face
 *  value (`amount_cents`) — exactly one — plus an optional recipient, charged to a saved card
 *  (off-session) or a new card (interactive Elements confirm). */
export function useGiftCardSaleForm(api: ApiLike, onDone: () => void): GiftCardSaleForm {
    const [purchaserClientId, setPurchaserClientId] = useState("");
    const [mode, setMode] = useState<GiftSaleMode>("custom");
    const [itemId, setItemId] = useState("");
    const [amount, setAmount] = useState("");
    const [recipient, setRecipient] = useState("");
    const items = giftItems(useCatalogItems());
    const customCents = Math.round(Number(amount) * 100);
    const faceAmountCents =
        mode === "preset"
            ? (items.find((i) => i.id === itemId)?.price_cents ?? null)
            : Number.isFinite(customCents) && customCents > 0
              ? customCents
              : null;
    const checkout = useCheckout(() => {
        setPurchaserClientId("");
        setMode("custom");
        setItemId("");
        setAmount("");
        setRecipient("");
        onDone();
    });

    const submit = (): void => {
        if (purchaserClientId === "") {
            checkout.setError(strings.giftCards.choosePurchaser);
            return;
        }
        let face: { item_id: string } | { amount_cents: number };
        if (mode === "preset") {
            if (itemId === "") {
                checkout.setError(strings.giftCards.chooseGiftCard);
                return;
            }
            face = { item_id: itemId };
        } else {
            if (faceAmountCents === null) {
                checkout.setError(strings.giftCards.enterAmount);
                return;
            }
            face = { amount_cents: faceAmountCents };
        }
        checkout.pay(
            ({ paymentMethodId, idempotencyKey }) =>
                purchaseGiftCard(
                    api,
                    {
                        purchaser_client_id: purchaserClientId,
                        ...face,
                        recipient: blankToNull(recipient),
                        payment_method_id: paymentMethodId,
                    },
                    idempotencyKey,
                ),
            strings.giftCards.sellError,
        );
    };

    return {
        purchaserClientId,
        setPurchaserClientId,
        mode,
        setMode,
        itemId,
        setItemId,
        amount,
        setAmount,
        recipient,
        setRecipient,
        faceAmountCents,
        checkout,
        submit,
    };
}

export interface GiftCardRedeemForm {
    code: string;
    setCode: (v: string) => void;
    amount: string;
    setAmount: (v: string) => void;
    busy: boolean;
    error: string | null;
    submit: () => void;
}

/** Redeem form: draw an amount against a gift card code. */
export function useGiftCardRedeemForm(api: ApiLike, onDone: () => void): GiftCardRedeemForm {
    const [code, setCodeState] = useState("");
    const [amount, setAmountState] = useState("");
    const { busy, error, setError, run } = useAsyncAction();
    // One key per redeem attempt, kept through retries so a timed-out redeem isn't drawn twice.
    const keyRef = useRef<string | null>(null);
    const setCode = (v: string): void => {
        keyRef.current = null;
        setCodeState(v);
    };
    const setAmount = (v: string): void => {
        keyRef.current = null;
        setAmountState(v);
    };

    const submit = (): void => {
        if (code.trim() === "") {
            setError(strings.giftCards.enterCode);
            return;
        }
        const cents = Math.round(Number(amount) * 100);
        if (!Number.isFinite(cents) || cents <= 0) {
            setError(strings.giftCards.enterRedeemAmount);
            return;
        }
        keyRef.current ??= newIdempotencyKey();
        const key = keyRef.current;
        const input = { code: code.trim().toUpperCase(), amount_cents: cents };
        run(() => redeemGiftCard(api, input, key), {
            onSuccess: () => {
                setCode("");
                setAmount("");
                onDone();
            },
            errorMessage: strings.giftCards.redeemError,
        });
    };

    return { code, setCode, amount, setAmount, busy, error, submit };
}
