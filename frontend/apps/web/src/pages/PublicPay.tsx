import {
    type PayMethod,
    formatMoney,
    invoiceStatusIntent,
    payMethods,
    useAsyncAction,
} from "@clientbridge/app-core";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { type Stripe, loadStripe } from "@stripe/stripe-js";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import { StatusPill } from "../components/StatusPill";
import {
    type InteracRequest,
    type PublicCardIntent,
    type PublicInvoice,
    PublicPayError,
    getPublicInvoice,
    payCard,
    payInterac,
} from "../lib/publicPay";

const formatAmount = (cents: number, currency: string): string =>
    `${formatMoney(cents)} ${currency.toUpperCase()}`;

const PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

export function PublicPay() {
    const { token = "" } = useParams<{ token: string }>();

    const [invoice, setInvoice] = useState<PublicInvoice | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [method, setMethod] = useState<PayMethod>("interac");
    const [interac, setInterac] = useState<InteracRequest | null>(null);
    const [card, setCard] = useState<PublicCardIntent | null>(null);
    const [paid, setPaid] = useState(false);
    const action = useAsyncAction();

    useEffect(() => {
        let live = true;
        setLoading(true);
        getPublicInvoice(token)
            .then((inv) => {
                if (live) setInvoice(inv);
            })
            .catch((err: unknown) => {
                if (!live) return;
                if (err instanceof PublicPayError && err.status === 404) setNotFound(true);
                else setLoadError("We couldn't load this invoice. Please try again later.");
            })
            .finally(() => {
                if (live) setLoading(false);
            });
        return () => {
            live = false;
        };
    }, [token]);

    if (loading) return <Frame>{<Centered>Loading…</Centered>}</Frame>;

    if (notFound)
        return (
            <Frame>
                <h1 className="font-display text-xl font-bold text-ink">Invoice not found</h1>
                <p className="mt-2 text-sm text-muted">
                    This payment link is invalid or has expired. Please check with the business that
                    sent it to you.
                </p>
            </Frame>
        );

    if (loadError || !invoice)
        return (
            <Frame>
                <h1 className="font-display text-xl font-bold text-ink">Something went wrong</h1>
                <p className="mt-2 text-sm text-muted">{loadError ?? "Please try again later."}</p>
            </Frame>
        );

    if (paid || invoice.status === "paid")
        return <PaidState businessName={invoice.business_name} />;

    const methods = payMethods(invoice);

    const runInterac = (): void => {
        void action.run(
            async () => {
                setInterac(await payInterac(token));
            },
            { errorMessage: "We couldn't start the Interac payment. Please try again." },
        );
    };

    const runCard = (): void => {
        if (!PUBLISHABLE_KEY) {
            action.setError("Card payments aren't configured. Please use Interac e-Transfer.");
            return;
        }
        void action.run(
            async () => {
                setCard(await payCard(token));
            },
            { errorMessage: "We couldn't start the card payment. Please try again." },
        );
    };

    return (
        <Frame>
            <p className="text-sm text-muted">{invoice.business_name} is requesting payment</p>
            <div className="mt-1 flex items-center gap-2">
                <h1 className="font-display text-lg font-bold text-ink">
                    {invoice.number !== null ? `Invoice #${invoice.number}` : "Invoice"}
                </h1>
                <StatusPill status={invoice.status} intent={invoiceStatusIntent(invoice.status)} />
            </div>

            <div className="mt-6 rounded-lg border border-line bg-bg px-5 py-4">
                <p className="text-xs uppercase tracking-wide text-muted">Balance due</p>
                <p className="mt-1 font-display text-4xl font-bold tabular-nums text-ink">
                    {formatAmount(invoice.balance_cents, invoice.currency)}
                </p>
                {invoice.balance_cents !== invoice.total_cents ? (
                    <p className="mt-1 text-xs text-muted">
                        of {formatAmount(invoice.total_cents, invoice.currency)} total
                    </p>
                ) : null}
            </div>

            <h2 className="mt-6 text-sm font-semibold text-ink" id="pay-method-label">
                Choose how to pay
            </h2>
            <div role="radiogroup" aria-labelledby="pay-method-label" className="mt-3 space-y-2">
                {methods.map((m) =>
                    m === "interac" ? (
                        <MethodOption
                            key={m}
                            label="Interac e-Transfer"
                            badge="Recommended · no fee"
                            selected={method === "interac"}
                            onSelect={() => {
                                setMethod("interac");
                                action.setError(null);
                            }}
                        />
                    ) : (
                        <MethodOption
                            key={m}
                            label="Credit or debit card"
                            selected={method === "card"}
                            onSelect={() => {
                                setMethod("card");
                                action.setError(null);
                            }}
                        />
                    ),
                )}
            </div>

            <div className="mt-5">
                {method === "interac" ? (
                    interac ? (
                        <InteracInstructions result={interac} currency={invoice.currency} />
                    ) : (
                        <PrimaryButton onClick={runInterac} busy={action.busy}>
                            Pay by Interac
                        </PrimaryButton>
                    )
                ) : card ? (
                    <CardPay
                        clientSecret={card.client_secret}
                        stripeAccount={card.stripe_account_id}
                        amountLabel={formatAmount(invoice.balance_cents, invoice.currency)}
                        onPaid={() => {
                            setPaid(true);
                        }}
                    />
                ) : (
                    <PrimaryButton onClick={runCard} busy={action.busy}>
                        Pay by card
                    </PrimaryButton>
                )}
                {action.error ? (
                    <p className="mt-3 text-sm text-danger-fg">{action.error}</p>
                ) : null}
            </div>
        </Frame>
    );
}

function Frame({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10">
            <div className="w-full max-w-md rounded-xl border border-line bg-surface p-7 shadow-card">
                {children}
            </div>
        </div>
    );
}

function Centered({ children }: { children: React.ReactNode }) {
    return <p className="py-8 text-center text-sm text-muted">{children}</p>;
}

function MethodOption({
    label,
    badge,
    selected,
    onSelect,
}: {
    label: string;
    badge?: string;
    selected: boolean;
    onSelect: () => void;
}) {
    return (
        <button
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={onSelect}
            className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition ${
                selected
                    ? "border-accent bg-accent-weak"
                    : "border-line bg-bg hover:border-accent-line"
            }`}
        >
            <span
                className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                    selected ? "border-accent" : "border-line"
                }`}
            >
                {selected ? <span className="h-2 w-2 rounded-full bg-accent" /> : null}
            </span>
            <span className="flex-1 text-sm font-medium text-ink">{label}</span>
            {badge ? (
                <span className="rounded-full bg-ok-bg px-2 py-0.5 text-xs font-medium text-ok-fg">
                    {badge}
                </span>
            ) : null}
        </button>
    );
}

function PrimaryButton({
    children,
    onClick,
    busy,
    disabled,
}: {
    children: React.ReactNode;
    onClick?: () => void;
    busy?: boolean;
    disabled?: boolean;
}) {
    return (
        <button
            type={onClick ? "button" : "submit"}
            onClick={onClick}
            disabled={busy ?? disabled ?? false}
            className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
        >
            {busy ? "Working…" : children}
        </button>
    );
}

function InteracInstructions({ result, currency }: { result: InteracRequest; currency: string }) {
    return (
        <div className="rounded-lg border border-accent-line bg-accent-weak px-4 py-4 text-sm text-ink">
            <p className="font-semibold">Send your Interac e-Transfer</p>
            {result.send_to !== null ? (
                <p className="mt-2 leading-relaxed">
                    Send an Interac e-Transfer of{" "}
                    <strong>{formatAmount(result.amount_cents, currency)}</strong> to{" "}
                    <strong>{result.send_to}</strong> and put{" "}
                    <strong>{result.reference_code}</strong> in the message.
                </p>
            ) : (
                <p className="mt-2 leading-relaxed">
                    The business will share their e-Transfer email with you. Send{" "}
                    <strong>{formatAmount(result.amount_cents, currency)}</strong> and put{" "}
                    <strong>{result.reference_code}</strong> in the message.
                </p>
            )}
            <p className="mt-3 text-xs text-muted">
                Your payment will be marked as received once the business confirms the transfer.
            </p>
        </div>
    );
}

function CardPay({
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
    // Connect direct charge: the Elements instance must target the connected account.
    const stripePromise = useMemo<Promise<Stripe | null> | null>(
        () => (PUBLISHABLE_KEY ? loadStripe(PUBLISHABLE_KEY, { stripeAccount }) : null),
        [stripeAccount],
    );

    if (!stripePromise)
        return (
            <p className="text-sm text-danger-fg">
                Card payments aren't configured. Please use Interac e-Transfer.
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
            <PrimaryButton busy={busy} disabled={!stripe}>
                Pay {amountLabel}
            </PrimaryButton>
        </form>
    );
}

function PaidState({ businessName }: { businessName: string }) {
    return (
        <Frame>
            <div className="py-4 text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-ok-bg text-2xl text-ok-fg">
                    ✓
                </span>
                <h1 className="mt-4 font-display text-xl font-bold text-ink">
                    This invoice is paid — thank you
                </h1>
                <p className="mt-2 text-sm text-muted">
                    Your payment to {businessName} is complete. A receipt will follow from the
                    business.
                </p>
            </div>
        </Frame>
    );
}
