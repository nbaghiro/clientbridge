import { strings, useAsyncAction, type CardFormProps } from "@clientbridge/app-core/public";
import {
    Elements,
    ExpressCheckoutElement,
    PaymentElement,
    useElements,
    useStripe,
} from "@stripe/react-stripe-js";
import { type SubmitEvent, useEffect, useRef, useState } from "react";
import type { Appearance } from "@stripe/stripe-js";
import { themes } from "@clientbridge/tokens";

import { Button } from "./Button";
import { Notice } from "./Notice";
import { type WebProps, cx } from "./props";
import { stripeFor } from "./stripe";

/** With `onCancel` it renders framed with a cancel action; without, it is the bare public form. */
export function CardForm(props: WebProps<CardFormProps>) {
    const root = useRef<HTMLDivElement>(null);
    const [appearance, setAppearance] = useState<Appearance>({
        theme: "stripe",
        variables: {
            colorPrimary: themes.pewter.color.accent,
            colorText: themes.pewter.color.ink,
            colorBackground: themes.pewter.color.surface,
            borderRadius: `${String(themes.pewter.radius.base)}px`,
        },
    });
    useEffect(() => {
        if (!root.current) return;
        const style = getComputedStyle(root.current);
        const color = (name: string, fallback: string): string =>
            style.getPropertyValue(name).trim() || fallback;
        setAppearance({
            theme: "stripe",
            variables: {
                colorPrimary: color("--accent", themes.pewter.color.accent),
                colorText: color("--ink", themes.pewter.color.ink),
                colorBackground: color("--surface", themes.pewter.color.surface),
                colorDanger: color("--dan-fg", themes.pewter.color.danFg),
                borderRadius: `${String(themes.pewter.radius.base)}px`,
            },
        });
    }, []);
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
        <Elements stripe={stripePromise} options={{ clientSecret: props.clientSecret, appearance }}>
            <ConfirmForm
                {...props}
                className={props.onCancel !== undefined ? undefined : props.className}
            />
        </Elements>
    );
    return (
        <div ref={root}>
            {props.onCancel !== undefined ? (
                <div
                    className={cx("mt-3 rounded-md border border-line bg-bg p-4", props.className)}
                >
                    {form}
                </div>
            ) : (
                form
            )}
        </div>
    );
}

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
            {mode === "payment" ? <ExpressCheckoutElement onConfirm={confirmPayment} /> : null}
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
