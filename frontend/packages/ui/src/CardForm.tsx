import { strings, useAsyncAction } from "@clientbridge/app-core/public";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import type { SubmitEvent } from "react";

import { stripeFor } from "./stripe";
import { primaryButton, quietButton } from "./styles";

export interface CardFormProps {
    clientSecret: string;
    stripeAccount: string;
    /** "payment" confirms a charge; "setup" saves the method for later. */
    mode?: "payment" | "setup";
    submitLabel: string;
    busyLabel: string;
    onDone: () => void;
    onCancel?: () => void;
}

/** Stripe Elements confirm for a server-minted client secret on the business's connected account.
 *  With `onCancel` it renders framed with a cancel action (staff screens); without, it is the bare
 *  full-width form the public pages use. */
export function CardForm(props: CardFormProps) {
    const stripePromise = stripeFor(props.stripeAccount);
    if (stripePromise === null) {
        return props.onCancel !== undefined ? (
            <div className="mt-3 rounded-md border border-line bg-bg p-4">
                <p className="text-sm text-danger">{strings.card.notConfiguredSavedCard}</p>
                <div className="mt-3 flex justify-end">
                    <button type="button" onClick={props.onCancel} className={quietButton}>
                        {strings.card.back}
                    </button>
                </div>
            </div>
        ) : (
            <p className="text-sm text-danger-fg">{strings.card.notConfiguredContact}</p>
        );
    }
    const form = (
        <Elements stripe={stripePromise} options={{ clientSecret: props.clientSecret }}>
            <ConfirmForm {...props} />
        </Elements>
    );
    return props.onCancel !== undefined ? (
        <div className="mt-3 rounded-md border border-line bg-bg p-4">{form}</div>
    ) : (
        form
    );
}

function ConfirmForm({
    mode = "payment",
    submitLabel,
    busyLabel,
    onDone,
    onCancel,
}: CardFormProps) {
    const stripe = useStripe();
    const elements = useElements();
    const { busy, error, setError, run } = useAsyncAction();
    const failed = mode === "payment" ? strings.card.paymentFailed : strings.card.saveError;

    const submit = (e: SubmitEvent): void => {
        e.preventDefault();
        if (!stripe || !elements) return;
        run(
            async () => {
                const result =
                    mode === "payment"
                        ? await stripe.confirmPayment({ elements, redirect: "if_required" })
                        : await stripe.confirmSetup({ elements, redirect: "if_required" });
                if (result.error) {
                    setError(result.error.message ?? failed);
                    return;
                }
                onDone();
            },
            { errorMessage: failed },
        );
    };

    return (
        <form onSubmit={submit} className="space-y-3">
            <PaymentElement />
            {error !== null ? <p className="text-sm text-danger-fg">{error}</p> : null}
            {onCancel !== undefined ? (
                <div className="flex justify-end gap-2">
                    <button type="button" onClick={onCancel} className={quietButton}>
                        {strings.common.cancel}
                    </button>
                    <button type="submit" disabled={busy || !stripe} className={primaryButton}>
                        {busy ? busyLabel : submitLabel}
                    </button>
                </div>
            ) : (
                <button
                    type="submit"
                    disabled={busy || !stripe}
                    className={`w-full ${primaryButton}`}
                >
                    {busy ? busyLabel : submitLabel}
                </button>
            )}
        </form>
    );
}
