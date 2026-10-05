import { strings, useAsyncAction } from "@clientbridge/app-core/public";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import type { SubmitEvent } from "react";

import { Button } from "./Button";
import { Notice } from "./Notice";
import { stripeFor } from "./stripe";

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

/** With `onCancel` it renders framed with a cancel action; without, it is the bare public form. */
export function CardForm(props: CardFormProps) {
    const stripePromise = stripeFor(props.stripeAccount);
    if (stripePromise === null) {
        return props.onCancel !== undefined ? (
            <div className="mt-3 rounded-md border border-line bg-bg p-4">
                <Notice tone="danger">{strings.checkout.notConfiguredSavedCard}</Notice>
                <div className="mt-3 flex justify-end">
                    <Button variant="quiet" onPress={props.onCancel}>
                        {strings.checkout.back}
                    </Button>
                </div>
            </div>
        ) : (
            <Notice tone="danger">{strings.checkout.notConfiguredContact}</Notice>
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
    const failed = mode === "payment" ? strings.checkout.paymentFailed : strings.checkout.saveError;

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
            {error !== null ? <Notice tone="danger">{error}</Notice> : null}
            {onCancel !== undefined ? (
                <div className="flex justify-end gap-2">
                    <Button variant="quiet" onPress={onCancel}>
                        {strings.common.cancel}
                    </Button>
                    <Button submit busy={busy} disabled={!stripe}>
                        {busy ? busyLabel : submitLabel}
                    </Button>
                </div>
            ) : (
                <Button submit full size="lg" busy={busy} disabled={!stripe}>
                    {busy ? busyLabel : submitLabel}
                </Button>
            )}
        </form>
    );
}
