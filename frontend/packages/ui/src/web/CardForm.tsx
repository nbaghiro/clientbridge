import {
    baseLocale,
    strings,
    useAsyncAction,
    type CardFormProps,
} from "@clientbridge/app-core/public";
import {
    Elements,
    ExpressCheckoutElement,
    PaymentElement,
    useElements,
    useStripe,
} from "@stripe/react-stripe-js";
import { type SubmitEvent, useLayoutEffect, useRef, useState } from "react";
import type { Appearance } from "@stripe/stripe-js";
import { STRIPE_FONTS, stripeElementsAppearance } from "@clientbridge/tokens";

import { Button } from "./Button";
import { Notice } from "./Notice";
import { type WebProps, cx } from "./props";
import { resolvedColors, stripeFor } from "./stripe";

/** With `onCancel` it adds a cancel action; without, it is the bare public form. */
export function CardForm(props: WebProps<CardFormProps>) {
    const root = useRef<HTMLDivElement>(null);
    const [appearance, setAppearance] = useState<Appearance | null>(null);
    // measured before paint so Stripe mounts once, already in the page's (or business's) colours
    useLayoutEffect(() => {
        const touch = window.matchMedia("(pointer: coarse)").matches;
        setAppearance(stripeElementsAppearance(resolvedColors(root.current), touch));
    }, []);
    const stripePromise = stripeFor(props.stripeAccount);
    if (stripePromise === null) {
        return props.onCancel !== undefined ? (
            <div className={cx("mt-3 space-y-3", props.className)}>
                <Notice tone="danger">{strings.checkout.notConfiguredSavedCard}</Notice>
                <div className="flex justify-end">
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
    return (
        <div
            ref={root}
            className={props.onCancel !== undefined ? cx("mt-3", props.className) : undefined}
        >
            {appearance === null ? null : (
                <Elements
                    stripe={stripePromise}
                    options={{
                        clientSecret: props.clientSecret,
                        appearance,
                        fonts: STRIPE_FONTS,
                        locale: baseLocale(),
                    }}
                >
                    <ConfirmForm
                        {...props}
                        className={props.onCancel !== undefined ? undefined : props.className}
                    />
                </Elements>
            )}
        </div>
    );
}

// The height of our lg Button, which sits under the express buttons.
const EXPRESS_BUTTON_HEIGHT = 40;

function ConfirmForm({
    mode = "payment",
    returnUrl,
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

    const confirmPayment = (): void => {
        if (!stripe || !elements) return;
        run(
            async () => {
                const submitted = await elements.submit();
                if (submitted.error) {
                    setError(submitted.error.message ?? failed);
                    return;
                }
                const result =
                    mode === "payment"
                        ? await stripe.confirmPayment({
                              elements,
                              confirmParams: { return_url: returnUrl ?? window.location.href },
                              redirect: "if_required",
                          })
                        : await stripe.confirmSetup({
                              elements,
                              confirmParams: { return_url: returnUrl ?? window.location.href },
                              redirect: "if_required",
                          });
                if (result.error) {
                    setError(result.error.message ?? failed);
                    return;
                }
                // only a payment that went through, or a debit on its way, counts as done
                const status = "paymentIntent" in result ? result.paymentIntent.status : null;
                if (status !== null && status !== "succeeded" && status !== "processing") {
                    setError(failed);
                    return;
                }
                onDone();
            },
            { errorMessage: failed },
        );
    };

    const submit = (e: SubmitEvent): void => {
        e.preventDefault();
        confirmPayment();
    };

    return (
        <form onSubmit={submit} className={cx("space-y-3", className)}>
            {mode === "payment" ? (
                <ExpressCheckoutElement
                    onConfirm={confirmPayment}
                    options={{ buttonHeight: EXPRESS_BUTTON_HEIGHT }}
                />
            ) : null}
            {/* with card as the only method, tabs draw no panel around the card fields */}
            <PaymentElement options={{ layout: { type: "tabs" } }} />
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
