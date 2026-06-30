import { useAsyncAction, useStripeAccountId } from "@clientbridge/app-core";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { type Stripe, loadStripe } from "@stripe/stripe-js";
import { type FormEvent, useMemo } from "react";

const PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

/** The interactive purchase card seam: confirms a package/gift-card PaymentIntent `client_secret`
 *  with a new card. A direct charge on the connected account, so Elements targets that account. */
export function PurchaseCardConfirm({
    clientSecret,
    amountLabel,
    onPaid,
    onCancel,
}: {
    clientSecret: string;
    amountLabel: string;
    onPaid: () => void;
    onCancel: () => void;
}) {
    const account = useStripeAccountId() ?? "";
    const stripePromise = useMemo<Promise<Stripe | null> | null>(
        () =>
            PUBLISHABLE_KEY && account
                ? loadStripe(PUBLISHABLE_KEY, { stripeAccount: account })
                : null,
        [account],
    );

    if (stripePromise === null)
        return (
            <div className="mt-3 rounded-md border border-line bg-bg p-4">
                <p className="text-sm text-danger">
                    Card payments aren’t configured. Charge a saved card instead.
                </p>
                <div className="mt-3 flex justify-end">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-surface"
                    >
                        Back
                    </button>
                </div>
            </div>
        );

    return (
        <div className="mt-3 rounded-md border border-line bg-bg p-4">
            <Elements stripe={stripePromise} options={{ clientSecret }}>
                <ConfirmForm amountLabel={amountLabel} onPaid={onPaid} onCancel={onCancel} />
            </Elements>
        </div>
    );
}

function ConfirmForm({
    amountLabel,
    onPaid,
    onCancel,
}: {
    amountLabel: string;
    onPaid: () => void;
    onCancel: () => void;
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
                    setError(result.error.message ?? "Payment failed. Please try again.");
                    return;
                }
                onPaid();
            },
            { errorMessage: "Payment failed. Please try again." },
        );
    };

    return (
        <form onSubmit={submit} className="space-y-3">
            <PaymentElement />
            {error !== null ? <p className="text-sm text-danger">{error}</p> : null}
            <div className="flex justify-end gap-2">
                <button
                    type="button"
                    onClick={onCancel}
                    className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-surface"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    disabled={busy || !stripe}
                    className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                >
                    {busy ? "Charging…" : `Charge ${amountLabel}`}
                </button>
            </div>
        </form>
    );
}
