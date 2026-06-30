import { useAsyncAction } from "@clientbridge/app-core";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { type Stripe, loadStripe } from "@stripe/stripe-js";
import { type FormEvent, useMemo } from "react";

const PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

/** A Stripe Elements card confirm for a Connect direct charge — the Elements instance targets the
 *  connected account, and the PaymentIntent client_secret is server-minted. Shared by the public
 *  pay-link and the public-booking deposit. */
export function ConnectedCardConfirm({
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
        () => (PUBLISHABLE_KEY ? loadStripe(PUBLISHABLE_KEY, { stripeAccount }) : null),
        [stripeAccount],
    );

    if (!stripePromise)
        return (
            <p className="text-sm text-danger-fg">
                Card payments aren't configured. Please contact the business.
            </p>
        );

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
                    setError(result.error.message ?? "Payment failed. Please try again.");
                    return;
                }
                onPaid();
            },
            { errorMessage: "Payment failed. Please try again." },
        );
    };

    return (
        <form onSubmit={submit} className="space-y-4">
            <PaymentElement />
            {error ? <p className="text-sm text-danger-fg">{error}</p> : null}
            <button
                type="submit"
                disabled={busy || !stripe}
                className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
            >
                {busy ? "Working…" : `Pay ${amountLabel}`}
            </button>
        </form>
    );
}
