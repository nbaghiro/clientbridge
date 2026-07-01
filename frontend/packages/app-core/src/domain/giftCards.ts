import { useQuery } from "@powersync/react";
import { useState } from "react";

import { useAsyncAction } from "../hooks/useAsyncAction";
import type { ApiLike } from "../util/api";
import { blankToNull } from "../util/format";
import type { Intent } from "../util/primitives";
import { useInteractivePurchase } from "./payments";

export interface GiftCardRow {
    id: string;
    code: string;
    initial_cents: number;
    balance_cents: number;
    status: string;
    recipient: string | null;
}

const GIFT_CARDS_SQL = `
SELECT id, code, initial_cents, balance_cents, status, recipient
FROM gift_cards ORDER BY created_at DESC`;

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
): Promise<GiftCardRedeemResult> {
    return api.post<GiftCardRedeemResult>("/v1/gift-cards/redeem", input);
}

export type GiftSaleMode = "preset" | "custom";

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
    paymentMethodId: string; // "" = pay with a new card (interactive)
    setPaymentMethodId: (v: string) => void;
    busy: boolean;
    error: string | null;
    clientSecret: string | null;
    submit: () => void;
    cancel: () => void;
    complete: () => void;
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
    const [paymentMethodId, setPaymentMethodId] = useState("");
    const purchase = useInteractivePurchase(() => {
        setPurchaserClientId("");
        setMode("custom");
        setItemId("");
        setAmount("");
        setRecipient("");
        setPaymentMethodId("");
        onDone();
    });

    const submit = (): void => {
        if (purchaserClientId === "") {
            purchase.setError("Choose a purchaser");
            return;
        }
        let face: { item_id: string } | { amount_cents: number };
        if (mode === "preset") {
            if (itemId === "") {
                purchase.setError("Choose a gift card");
                return;
            }
            face = { item_id: itemId };
        } else {
            const cents = Math.round(Number(amount) * 100);
            if (!Number.isFinite(cents) || cents <= 0) {
                purchase.setError("Enter a gift card amount");
                return;
            }
            face = { amount_cents: cents };
        }
        const interactive = paymentMethodId === "";
        purchase.submit(
            (idempotencyKey) =>
                purchaseGiftCard(
                    api,
                    {
                        purchaser_client_id: purchaserClientId,
                        ...face,
                        recipient: blankToNull(recipient),
                        payment_method_id: interactive ? undefined : paymentMethodId,
                    },
                    idempotencyKey,
                ),
            interactive,
            "Couldn't sell this gift card. Please try again.",
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
        paymentMethodId,
        setPaymentMethodId,
        busy: purchase.busy,
        error: purchase.error,
        clientSecret: purchase.clientSecret,
        submit,
        cancel: purchase.cancel,
        complete: purchase.complete,
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
    const [code, setCode] = useState("");
    const [amount, setAmount] = useState("");
    const { busy, error, setError, run } = useAsyncAction();

    const submit = (): void => {
        if (code.trim() === "") {
            setError("Enter a gift card code");
            return;
        }
        const cents = Math.round(Number(amount) * 100);
        if (!Number.isFinite(cents) || cents <= 0) {
            setError("Enter a redemption amount");
            return;
        }
        void run(
            () => redeemGiftCard(api, { code: code.trim().toUpperCase(), amount_cents: cents }),
            {
                onSuccess: () => {
                    setCode("");
                    setAmount("");
                    onDone();
                },
                errorMessage: "Couldn't redeem this gift card. Please try again.",
            },
        );
    };

    return { code, setCode, amount, setAmount, busy, error, submit };
}
