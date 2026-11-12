import {
    activeLocale,
    cardConfirmFailure,
    refusedConfirm,
    strings,
    useAsyncAction,
    type CardConfirmResult,
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
                <Notice tone="danger">
                    {props.mode === "setup"
                        ? strings.checkout.notConfiguredSetup
                        : strings.checkout.notConfiguredSavedCard}
                </Notice>
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
                        locale: activeLocale("stripe"),
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
    variant = "public",
    returnUrl,
    submitLabel,
    busyLabel,
    onDone,
    onCanceled,
    onCancel,
    defaultValue,
    className,
}: WebProps<CardFormProps>) {
    const stripe = useStripe();
    const elements = useElements();
    const { busy, error, setError, run } = useAsyncAction();
    // a submit before the element is ready ignores its prefilled name and email
    const [ready, setReady] = useState(false);
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
                const result: CardConfirmResult | undefined =
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
                    const outcome = refusedConfirm(result.error.payment_intent?.status);
                    if (outcome === "paid") {
                        onDone();
                        return;
                    }
                    if (outcome === "canceled" && onCanceled !== undefined) {
                        onCanceled();
                        return;
                    }
                    setError(result.error.message ?? failed);
                    return;
                }
                const failure = cardConfirmFailure(mode, result);
                if (failure !== null) {
                    setError(failure);
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
            {mode === "payment" && variant === "public" ? (
                // Klarna sits in the method list below as a redirect, so a blocked popup cannot stop it
                <ExpressCheckoutElement
                    onConfirm={confirmPayment}
                    options={{
                        buttonHeight: EXPRESS_BUTTON_HEIGHT,
                        paymentMethods: { klarna: "never" },
                    }}
                />
            ) : null}
            {/* with card as the only method, tabs draw no panel around the card fields */}
            <PaymentElement
                onReady={() => {
                    setReady(true);
                }}
                options={{
                    layout: { type: "tabs" },
                    paymentMethodOrder: ["card"],
                    defaultValues: {
                        billingDetails: {
                            ...(defaultValue?.name ? { name: defaultValue.name } : {}),
                            ...(defaultValue?.email ? { email: defaultValue.email } : {}),
                        },
                    },
                }}
            />
            {error !== null ? <Notice tone="danger">{error}</Notice> : null}
            {onCancel !== undefined ? (
                <div className="flex justify-end gap-2">
                    <Button variant="quiet" onPress={onCancel}>
                        {strings.common.cancel}
                    </Button>
                    <Button submit busy={busy} disabled={!stripe || !ready}>
                        {busy ? busyLabel : submitLabel}
                    </Button>
                </div>
            ) : (
                <Button submit full size="lg" busy={busy} disabled={!stripe || !ready}>
                    {busy ? busyLabel : submitLabel}
                </Button>
            )}
        </form>
    );
}
