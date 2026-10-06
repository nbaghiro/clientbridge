import { strings, useAsyncAction, type CardFormProps } from "@clientbridge/app-core/public";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import type { SubmitEvent } from "react";

import { Button } from "./Button";
import { Notice } from "./Notice";
import { type WebProps, cx } from "./props";
import { stripeFor } from "./stripe";

/** With `onCancel` it renders framed with a cancel action; without, it is the bare public form. */
export function CardForm(props: WebProps<CardFormProps>) {
    const stripePromise = stripeFor(props.stripeAccount);
    if (stripePromise === null) {
        return props.onCancel !== undefined ? (
            <div className={cx("mt-3 rounded-md border border-line bg-bg p-4", props.className)}>
                <Notice tone="danger">{strings.checkout.notConfiguredSavedCard}</Notice>
                <div className="mt-3 flex justify-end">
                    <Button variant="quiet" onPress={props.onCancel}>
                        {strings.checkout.back}
                    </Button>
                </div>
            </div>
        ) : (
            <Notice tone="danger" className={props.className}>
                {strings.checkout.notConfiguredContact}
            </Notice>
        );
    }
    const form = (
        <Elements stripe={stripePromise} options={{ clientSecret: props.clientSecret }}>
            <ConfirmForm
                {...props}
                className={props.onCancel !== undefined ? undefined : props.className}
            />
        </Elements>
    );
    return props.onCancel !== undefined ? (
        <div className={cx("mt-3 rounded-md border border-line bg-bg p-4", props.className)}>
            {form}
        </div>
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
    className,
}: WebProps<CardFormProps>) {
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
        <form onSubmit={submit} className={cx("space-y-3", className)}>
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
