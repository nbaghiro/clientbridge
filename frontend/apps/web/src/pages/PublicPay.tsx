import {
    type InteracRequest,
    createPublicPayClient,
    formatMoneyWithCurrency,
    invoiceStatusIntent,
    strings,
    useAsyncAction,
    usePublicPayForm,
} from "@clientbridge/app-core";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { type Stripe, loadStripe } from "@stripe/stripe-js";
import { type FormEvent, useMemo } from "react";
import { useParams } from "react-router-dom";

import { StatusPill } from "../components/StatusPill";

const PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
const pay = createPublicPayClient(import.meta.env.VITE_API_URL ?? "http://localhost:8701");

export function PublicPay() {
    const { token = "" } = useParams<{ token: string }>();
    const form = usePublicPayForm(pay, token);
    const invoice = form.invoice;

    if (form.status === "loading")
        return <Frame>{<Centered>{strings.common.loading}</Centered>}</Frame>;

    if (form.status === "not-found")
        return (
            <Frame>
                <h1 className="font-display text-xl font-bold text-ink">
                    {strings.publicPay.notFoundTitle}
                </h1>
                <p className="mt-2 text-sm text-muted">{strings.publicPay.notFoundBody}</p>
            </Frame>
        );

    if (form.status === "error" || invoice === null)
        return (
            <Frame>
                <h1 className="font-display text-xl font-bold text-ink">
                    {strings.common.somethingWrong}
                </h1>
                <p className="mt-2 text-sm text-muted">{strings.common.tryAgainLater}</p>
            </Frame>
        );

    if (form.status === "paid") return <PaidState businessName={invoice.business_name} />;

    const runCard = (): void => {
        if (!PUBLISHABLE_KEY) {
            form.setError(strings.publicPay.cardNotConfigured);
            return;
        }
        form.payCard();
    };

    return (
        <Frame>
            <p className="text-sm text-muted">
                {strings.publicPay.requestingPayment(invoice.business_name)}
            </p>
            <div className="mt-1 flex items-center gap-2">
                <h1 className="font-display text-lg font-bold text-ink">
                    {invoice.number !== null
                        ? strings.publicPay.invoiceNumber(invoice.number)
                        : strings.publicPay.invoice}
                </h1>
                <StatusPill status={invoice.status} intent={invoiceStatusIntent(invoice.status)} />
            </div>

            <div className="mt-6 rounded-lg border border-line bg-bg px-5 py-4">
                <p className="text-xs uppercase tracking-wide text-muted">
                    {strings.publicPay.balanceDue}
                </p>
                <p className="mt-1 font-display text-4xl font-bold tabular-nums text-ink">
                    {formatMoneyWithCurrency(invoice.balance_cents, invoice.currency)}
                </p>
                {invoice.balance_cents !== invoice.total_cents ? (
                    <p className="mt-1 text-xs text-muted">
                        {strings.publicPay.ofTotal(
                            formatMoneyWithCurrency(invoice.total_cents, invoice.currency),
                        )}
                    </p>
                ) : null}
            </div>

            <h2 className="mt-6 text-sm font-semibold text-ink" id="pay-method-label">
                {strings.publicPay.chooseHowToPay}
            </h2>
            <div role="radiogroup" aria-labelledby="pay-method-label" className="mt-3 space-y-2">
                {form.methods.map((m) =>
                    m === "interac" ? (
                        <MethodOption
                            key={m}
                            label={strings.publicPay.interacLabel}
                            badge={strings.publicPay.interacBadge}
                            selected={form.method === "interac"}
                            onSelect={() => {
                                form.setMethod("interac");
                                form.setError(null);
                            }}
                        />
                    ) : (
                        <MethodOption
                            key={m}
                            label={strings.publicPay.cardLabel}
                            selected={form.method === "card"}
                            onSelect={() => {
                                form.setMethod("card");
                                form.setError(null);
                            }}
                        />
                    ),
                )}
            </div>

            <div className="mt-5">
                {form.method === "interac" ? (
                    form.interac ? (
                        <InteracInstructions result={form.interac} currency={invoice.currency} />
                    ) : (
                        <PrimaryButton onClick={form.payInterac} busy={form.busy}>
                            {strings.publicPay.payByInterac}
                        </PrimaryButton>
                    )
                ) : form.card ? (
                    <CardPay
                        clientSecret={form.card.client_secret}
                        stripeAccount={form.card.stripe_account_id}
                        amountLabel={formatMoneyWithCurrency(
                            invoice.balance_cents,
                            invoice.currency,
                        )}
                        onPaid={form.markPaid}
                    />
                ) : (
                    <PrimaryButton onClick={runCard} busy={form.busy}>
                        {strings.publicPay.payByCard}
                    </PrimaryButton>
                )}
                {form.error ? <p className="mt-3 text-sm text-danger-fg">{form.error}</p> : null}
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
            {busy ? strings.common.working : children}
        </button>
    );
}

function InteracInstructions({ result, currency }: { result: InteracRequest; currency: string }) {
    return (
        <div className="rounded-lg border border-accent-line bg-accent-weak px-4 py-4 text-sm text-ink">
            <p className="font-semibold">{strings.publicPay.interacHeading}</p>
            {result.send_to !== null ? (
                <p className="mt-2 leading-relaxed">
                    {strings.publicPay.interacSendPrefix}{" "}
                    <strong>{formatMoneyWithCurrency(result.amount_cents, currency)}</strong>{" "}
                    {strings.publicPay.interacTo} <strong>{result.send_to}</strong>{" "}
                    {strings.publicPay.interacAndPut} <strong>{result.reference_code}</strong>{" "}
                    {strings.publicPay.interacInMessage}
                </p>
            ) : (
                <p className="mt-2 leading-relaxed">
                    {strings.publicPay.interacNoEmail}{" "}
                    <strong>{formatMoneyWithCurrency(result.amount_cents, currency)}</strong>{" "}
                    {strings.publicPay.interacAndPut} <strong>{result.reference_code}</strong>{" "}
                    {strings.publicPay.interacInMessage}
                </p>
            )}
            <p className="mt-3 text-xs text-muted">{strings.publicPay.interacConfirmNote}</p>
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
        return <p className="text-sm text-danger-fg">{strings.publicPay.cardNotConfigured}</p>;

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
                    setError(result.error.message ?? strings.publicPay.paymentFailed);
                    return;
                }
                onPaid();
            },
            { errorMessage: strings.publicPay.paymentFailed },
        );
    };

    return (
        <form onSubmit={submit} className="space-y-4">
            <PaymentElement />
            {error ? <p className="text-sm text-danger-fg">{error}</p> : null}
            <PrimaryButton busy={busy} disabled={!stripe}>
                {strings.publicPay.payAmount(amountLabel)}
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
                    {strings.publicPay.paidTitle}
                </h1>
                <p className="mt-2 text-sm text-muted">
                    {strings.publicPay.paidBody(businessName)}
                </p>
            </div>
        </Frame>
    );
}
