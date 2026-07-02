import { strings, useAsyncAction } from "@clientbridge/app-core/public";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { type Stripe, loadStripe } from "@stripe/stripe-js";
import { type FormEvent, useMemo } from "react";

const PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

/** Stripe Elements card confirm for a Connect direct charge — Elements targets the connected account
 *  and the PaymentIntent `clientSecret` is server-minted. `stripeAccount` is passed in (the public
 *  pages render outside any sync context, so they can't read it from a replica). The Connect copy is
 *  the bare public variant only; the provider app keeps its own framed/cancellable variant. */
export function CardConfirm({
    clientSecret,
    stripeAccount,
    amountLabel,
    onPaid,
}: {
    clientSecret: string;
    stripeAccount: string;
    amountLabel: string;
    onPaid: () => void;
}) {
    const stripePromise = useMemo<Promise<Stripe | null> | null>(
        () =>
            PUBLISHABLE_KEY && stripeAccount
                ? loadStripe(PUBLISHABLE_KEY, { stripeAccount })
                : null,
        [stripeAccount],
    );

    if (stripePromise === null)
        return <p className="text-sm text-danger-fg">{strings.card.notConfiguredContact}</p>;

    return (
        <Elements stripe={stripePromise} options={{ clientSecret }}>
            <CardForm amountLabel={amountLabel} onPaid={onPaid} />
        </Elements>
    );
}

function CardForm({ amountLabel, onPaid }: { amountLabel: string; onPaid: () => void }) {
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

    return (
        <form onSubmit={submit} className="space-y-3">
            <PaymentElement />
            {error !== null ? <p className="text-sm text-danger-fg">{error}</p> : null}
            <button
                type="submit"
                disabled={busy || !stripe}
                className="w-full rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
            >
                {busy ? strings.common.working : strings.card.pay(amountLabel)}
            </button>
        </form>
    );
}
