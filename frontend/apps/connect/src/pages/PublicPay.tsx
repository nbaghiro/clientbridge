import {
    type InteracRequest,
    type PublicBrand,
    createPublicPayClient,
    formatMoneyWithCurrency,
    invoiceStatusIntent,
    strings,
    usePublicPayForm,
} from "@clientbridge/app-core/public";
import { Button, CardForm, Choice, Notice, StatusPill } from "@clientbridge/ui";
import { useParams } from "react-router-dom";

import { PublicCentered, PublicFrame } from "../components/PublicFrame";
import { useEmbedSuccess } from "../embed";
import { config } from "../config";

const PUBLISHABLE_KEY = config.stripePublishableKey;
const pay = createPublicPayClient(config.apiUrl);

export function PublicPay() {
    const { token = "" } = useParams<{ token: string }>();
    const form = usePublicPayForm(pay, token);
    const invoice = form.invoice;
    useEmbedSuccess(form.status === "paid", "pay");

    if (form.status === "loading")
        return (
            <PublicFrame>{<PublicCentered>{strings.common.loading}</PublicCentered>}</PublicFrame>
        );

    if (form.status === "not-found")
        return (
            <PublicFrame>
                <h1 className="font-display text-xl font-bold text-ink">
                    {strings.publicPay.notFoundTitle}
                </h1>
                <p className="mt-2 text-sm text-muted">{strings.publicPay.notFoundBody}</p>
            </PublicFrame>
        );

    if (form.status === "error" || invoice === null)
        return (
            <PublicFrame>
                <h1 className="font-display text-xl font-bold text-ink">
                    {strings.common.somethingWrong}
                </h1>
                <p className="mt-2 text-sm text-muted">{strings.common.tryAgainLater}</p>
            </PublicFrame>
        );

    if (form.status === "paid")
        return <PaidState businessName={invoice.business_name} brand={invoice.brand} />;

    const runCard = (): void => {
        if (!PUBLISHABLE_KEY) {
            form.setError(strings.publicPay.cardNotConfigured);
            return;
        }
        form.payCard();
    };

    return (
        <PublicFrame brand={invoice.brand}>
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

            <h2 className="mt-6 text-sm font-semibold text-ink">
                {strings.publicPay.chooseHowToPay}
            </h2>
            <div className="mt-3">
                <Choice
                    layout="cards"
                    label={strings.publicPay.chooseHowToPay}
                    options={form.methods.map((m) =>
                        m === "interac"
                            ? {
                                  key: m,
                                  label: strings.publicPay.interacLabel,
                                  hint: strings.publicPay.interacBadge,
                              }
                            : { key: m, label: strings.publicPay.cardLabel },
                    )}
                    value={form.method}
                    onChange={(m) => {
                        form.setMethod(m);
                        form.setError(null);
                    }}
                />
            </div>

            <div className="mt-5">
                {form.method === "interac" ? (
                    form.interac ? (
                        <InteracInstructions result={form.interac} currency={invoice.currency} />
                    ) : (
                        <Button size="lg" full onPress={form.payInterac} busy={form.busy}>
                            {form.busy ? strings.common.working : strings.publicPay.payByInterac}
                        </Button>
                    )
                ) : form.card ? (
                    <CardForm
                        clientSecret={form.card.client_secret}
                        stripeAccount={form.card.stripe_account_id}
                        submitLabel={strings.checkout.pay(
                            formatMoneyWithCurrency(invoice.balance_cents, invoice.currency),
                        )}
                        busyLabel={strings.common.working}
                        onDone={form.markPaid}
                    />
                ) : (
                    <Button size="lg" full onPress={runCard} busy={form.busy}>
                        {form.busy ? strings.common.working : strings.publicPay.payByCard}
                    </Button>
                )}
                {form.error ? (
                    <div className="mt-3">
                        <Notice tone="danger">{form.error}</Notice>
                    </div>
                ) : null}
            </div>
        </PublicFrame>
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

function PaidState({
    businessName,
    brand = null,
}: {
    businessName: string;
    brand?: PublicBrand | null;
}) {
    return (
        <PublicFrame brand={brand}>
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
        </PublicFrame>
    );
}
