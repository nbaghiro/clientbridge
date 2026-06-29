import { useQuery } from "@powersync/react";
import { useState } from "react";

import { useAsyncAction } from "../hooks/useAsyncAction";
import type { ApiLike } from "../util/api";
import type { Intent } from "../util/intent";

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

const CLIENT_SUBSCRIPTIONS_SQL = `
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
): Promise<{ id: string }> {
    return api.post<{ id: string }>("/v1/subscriptions", input);
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
    paymentMethodId: string;
    setPaymentMethodId: (v: string) => void;
    busy: boolean;
    error: string | null;
    submit: () => void;
}

/** Start-subscription form: picks a `kind="subscription"` item + a saved method, then creates it. */
export function useSubscriptionForm(
    api: ApiLike,
    clientId: string,
    onCreated: () => void,
): SubscriptionForm {
    const [itemId, setItemId] = useState("");
    const [paymentMethodId, setPaymentMethodId] = useState("");
    const { busy, error, setError, run } = useAsyncAction();

    const submit = (): void => {
        if (itemId === "") {
            setError("Choose a subscription plan");
            return;
        }
        if (paymentMethodId === "") {
            setError("Choose a payment method");
            return;
        }
        void run(
            () =>
                createSubscription(api, {
                    client_id: clientId,
                    item_id: itemId,
                    payment_method_id: paymentMethodId,
                }),
            {
                onSuccess: () => {
                    setItemId("");
                    setPaymentMethodId("");
                    onCreated();
                },
                errorMessage: "Couldn't start the subscription. Please try again.",
            },
        );
    };

    return { itemId, setItemId, paymentMethodId, setPaymentMethodId, busy, error, submit };
}
