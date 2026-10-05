import { useQuery } from "@powersync/react";
import { useRef, useState } from "react";

import { useAsyncAction } from "../hooks";
import { type ApiLike, newIdempotencyKey } from "../api";
import { blankToNull } from "../format";
import { type Intent } from "../ui";
import { strings } from "../strings";
import { giftItems, useCatalogItems } from "./catalog";
import { type Checkout, useCheckout } from "./checkout";
import { ownedLiabilitySql, sessionsUsedSql } from "./ledger";

export interface PackageRow {
    id: string;
    client_id: string;
    item_id: string;
    item_name: string | null;
    sessions_total: number;
    sessions_used: number;
    status: string;
}

export const CLIENT_PACKAGES_SQL = `
SELECT p.id, p.client_id, p.item_id, i.name AS item_name,
       p.sessions_total, ${sessionsUsedSql("p.id")} AS sessions_used, p.status
FROM packages p LEFT JOIN items i ON i.id = p.item_id
WHERE p.client_id = ? ORDER BY p.created_at DESC`;

export function useClientPackages(clientId: string): PackageRow[] {
    return useQuery<PackageRow>(CLIENT_PACKAGES_SQL, [clientId]).data;
}

export function packageStatusIntent(status: string): Intent {
    switch (status) {
        case "active":
            return "success";
        case "pending":
            return "accent";
        case "expired":
            return "danger";
        default:
            return "neutral"; // used, canceled
    }
}

export function sessionsRemaining(pkg: PackageRow): number {
    return Math.max(0, pkg.sessions_total - pkg.sessions_used);
}

/** A session can be drawn down only from an active package with sessions left. */
export function canConsume(pkg: PackageRow): boolean {
    return pkg.status === "active" && pkg.sessions_used < pkg.sessions_total;
}

export interface PackagePurchaseInput {
    client_id: string;
    item_id: string;
    payment_method_id?: string | undefined;
}

export interface PackagePurchaseResult {
    package_id: string;
    payment_id: string;
    client_secret: string;
}

export function purchasePackage(
    api: ApiLike,
    input: PackagePurchaseInput,
    idempotencyKey: string,
): Promise<PackagePurchaseResult> {
    return api.post<PackagePurchaseResult>("/v1/packages", input, { idempotencyKey });
}

export function consumeSession(api: ApiLike, packageId: string): Promise<PackageRow> {
    return api.post<PackageRow>(`/v1/packages/${packageId}/consume`, {});
}

export interface PackageSaleForm {
    itemId: string;
    setItemId: (v: string) => void;
    checkout: Checkout;
    submit: () => void;
}

export function usePackageSaleForm(
    api: ApiLike,
    clientId: string,
    onDone: () => void,
): PackageSaleForm {
    const [itemId, setItemId] = useState("");
    const checkout = useCheckout(() => {
        setItemId("");
        onDone();
    });

    const submit = (): void => {
        if (itemId === "") {
            checkout.setError(strings.clients.choosePackage);
            return;
        }
        checkout.pay(
            ({ paymentMethodId, idempotencyKey }) =>
                purchasePackage(
                    api,
                    { client_id: clientId, item_id: itemId, payment_method_id: paymentMethodId },
                    idempotencyKey,
                ),
            strings.clients.sellPackageError,
        );
    };

    return {
        itemId,
        setItemId,
        checkout,
        submit,
    };
}

export interface SubscriptionRow {
    id: string;
    client_id: string;
    item_id: string;
    item_name: string | null;
    status: string;
    current_period_start: string | null;
    current_period_end: string | null;
    payment_method_id: string | null;
}

export const CLIENT_SUBSCRIPTIONS_SQL = `
SELECT s.id, s.client_id, s.item_id, i.name AS item_name, s.status,
       s.current_period_start, s.current_period_end, s.payment_method_id
FROM subscriptions s LEFT JOIN items i ON i.id = s.item_id
WHERE s.client_id = ? ORDER BY s.created_at DESC`;

export function useClientSubscriptions(clientId: string): SubscriptionRow[] {
    return useQuery<SubscriptionRow>(CLIENT_SUBSCRIPTIONS_SQL, [clientId]).data;
}

export function subscriptionStatusIntent(status: string): Intent {
    switch (status) {
        case "active":
            return "success";
        case "past_due":
            return "danger";
        case "paused":
            return "warning";
        default:
            return "neutral"; // canceled
    }
}

/** Live (still-billing) subscriptions can be canceled; a canceled one is terminal. */
export function isCancelable(status: string): boolean {
    return status !== "canceled";
}

export interface SubscriptionInput {
    client_id: string;
    item_id: string;
    payment_method_id: string;
}

export function createSubscription(
    api: ApiLike,
    input: SubscriptionInput,
    idempotencyKey: string,
): Promise<{ id: string }> {
    return api.post<{ id: string }>("/v1/subscriptions", input, { idempotencyKey });
}

export function cancelSubscription(
    api: ApiLike,
    id: string,
): Promise<{ id: string; status: string }> {
    return api.post<{ id: string; status: string }>(`/v1/subscriptions/${id}/cancel`, {});
}

export interface SubscriptionForm {
    itemId: string;
    setItemId: (v: string) => void;
    checkout: Checkout;
    submit: () => void;
}

/** Start-subscription form: a `kind="subscription"` item charged to a saved method (no new card). */
export function useSubscriptionForm(
    api: ApiLike,
    clientId: string,
    onCreated: () => void,
): SubscriptionForm {
    const [itemId, setItemId] = useState("");
    const checkout = useCheckout(
        () => {
            setItemId("");
            onCreated();
        },
        { allowNewCard: false },
    );

    const submit = (): void => {
        if (itemId === "") {
            checkout.setError(strings.clients.choosePlan);
            return;
        }
        checkout.pay(
            ({ paymentMethodId, idempotencyKey }) =>
                createSubscription(
                    api,
                    {
                        client_id: clientId,
                        item_id: itemId,
                        payment_method_id: paymentMethodId ?? "",
                    },
                    idempotencyKey,
                ),
            strings.clients.startSubscriptionError,
        );
    };

    return { itemId, setItemId, checkout, submit };
}

export interface GiftCardRow {
    id: string;
    code: string;
    initial_cents: number;
    balance_cents: number;
    status: string;
    recipient: string | null;
}

export const GIFT_CARDS_SQL = `
SELECT g.id, g.code, g.initial_cents, ${ownedLiabilitySql("gift_card", "gift_card", "g.id")} AS balance_cents,
       CASE WHEN g.status = 'active'
                 AND ${ownedLiabilitySql("gift_card", "gift_card", "g.id")} = 0
            THEN 'redeemed' ELSE g.status END AS status,
       g.recipient
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
    preset: strings.entitlements.giftCards.modePreset,
    custom: strings.entitlements.giftCards.modeCustom,
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

/** Exactly one of a preset gift item or a custom amount. */
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
            checkout.setError(strings.entitlements.giftCards.choosePurchaser);
            return;
        }
        let face: { item_id: string } | { amount_cents: number };
        if (mode === "preset") {
            if (itemId === "") {
                checkout.setError(strings.entitlements.giftCards.chooseGiftCard);
                return;
            }
            face = { item_id: itemId };
        } else {
            if (faceAmountCents === null) {
                checkout.setError(strings.entitlements.giftCards.enterAmount);
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
            strings.entitlements.giftCards.sellError,
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
            setError(strings.entitlements.giftCards.enterCode);
            return;
        }
        const cents = Math.round(Number(amount) * 100);
        if (!Number.isFinite(cents) || cents <= 0) {
            setError(strings.entitlements.giftCards.enterRedeemAmount);
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
            errorMessage: strings.entitlements.giftCards.redeemError,
        });
    };

    return { code, setCode, amount, setAmount, busy, error, submit };
}
