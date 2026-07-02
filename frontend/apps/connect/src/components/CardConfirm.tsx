import { strings, useAsyncAction } from "@clientbridge/app-core/public";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { type Stripe, loadStripe } from "@stripe/stripe-js";
import { type FormEvent, useMemo } from "react";

const PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

/** A Stripe Elements card confirm for a Connect direct charge — Elements targets the connected
 *  account and the PaymentIntent `clientSecret` is server-minted. `stripeAccount` is passed in (public
 *  pages render outside the sync context, so they can't read it from the replica). Pass `onCancel` for
 *  the framed, cancellable "charge a card" variant on authed screens; omit it for the bare public-pay
 *  variant. */
export function CardConfirm({
    clientSecret,
    stripeAccount,
    amountLabel,
    onPaid,
    onCancel,
}: {
    clientSecret: string;
    stripeAccount: string;
    amountLabel: string;
    onPaid: () => void;
    onCancel?: () => void;
}) {
    const framed = onCancel !== undefined;
    const stripePromise = useMemo<Promise<Stripe | null> | null>(
        () =>
            PUBLISHABLE_KEY && stripeAccount
                ? loadStripe(PUBLISHABLE_KEY, { stripeAccount })
                : null,
        [stripeAccount],
    );

    if (stripePromise === null) {
        if (onCancel !== undefined)
            return (
                <div className="mt-3 rounded-md border border-line bg-bg p-4">
                    <p className="text-sm text-danger">{strings.card.notConfiguredSavedCard}</p>
                    <div className="mt-3 flex justify-end">
                        <button
                            type="button"
                            onClick={onCancel}
                            className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-surface"
                        >
                            {strings.card.back}
                        </button>
                    </div>
                </div>
            );
        return <p className="text-sm text-danger-fg">{strings.card.notConfiguredContact}</p>;
    }

    const elements = (
        <Elements stripe={stripePromise} options={{ clientSecret }}>
            <CardForm amountLabel={amountLabel} onPaid={onPaid} onCancel={onCancel} />
        </Elements>
    );
    return framed ? (
        <div className="mt-3 rounded-md border border-line bg-bg p-4">{elements}</div>
    ) : (
        elements
    );
}

function CardForm({
    amountLabel,
    onPaid,
    onCancel,
}: {
    amountLabel: string;
    onPaid: () => void;
    onCancel: (() => void) | undefined;
}) {
    const stripe = useStripe();
    const elements = useElements();
    const { busy, error, setError, run } = useAsyncAction();

    const submit = (e: FormEvent): void => {
        e.preventDefault();
        if (!stripe || !elements) return;
        void run(
            async () => {
                const result = await stripe.confirmPayment({ elements, redirect: "if_required" });
                if (result.error) {
                    setError(result.error.message ?? strings.card.paymentFailed);
                    return;
                }
                onPaid();
            },
            { errorMessage: strings.card.paymentFailed },
        );
    };

    const submitClass =
        "rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60";

    return (
        <form onSubmit={submit} className="space-y-3">
            <PaymentElement />
            {error !== null ? <p className="text-sm text-danger-fg">{error}</p> : null}
            {onCancel !== undefined ? (
                <div className="flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-surface"
                    >
                        {strings.common.cancel}
                    </button>
                    <button type="submit" disabled={busy || !stripe} className={submitClass}>
                        {busy ? strings.card.charging : strings.card.charge(amountLabel)}
                    </button>
                </div>
            ) : (
                <button
                    type="submit"
                    disabled={busy || !stripe}
                    className={`w-full ${submitClass}`}
                >
                    {busy ? strings.common.working : strings.card.pay(amountLabel)}
                </button>
            )}
        </form>
    );
}
