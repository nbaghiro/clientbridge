import {
    createPublicPayClient,
    formatMoney,
    formatMoneyWithCurrency,
    printedPublicInvoice,
    publicDocLines,
    publicInvoiceTotals,
    registrationLine,
    shortDate,
    strings,
    usePublicPayForm,
} from "@clientbridge/app-core/public";
import { Button, CardForm, Choice, DocTotals, Icon, Notice, TextField } from "@clientbridge/ui";
import { cssVar } from "@clientbridge/tokens";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { PrintModal, PublicDocument } from "../components/PublicDocument";
import { PublicDone, PublicStatus } from "../components/PublicStatus";
import { useEmbedSuccess } from "../embed";
import { config } from "../config";

const PUBLISHABLE_KEY = config.stripePublishableKey;
const pay = createPublicPayClient(config.apiUrl);
const pp = strings.publicPay;

export function PublicPay() {
    const { token = "" } = useParams<{ token: string }>();
    const form = usePublicPayForm(pay, token);
    const navigate = useNavigate();
    const openInterac = (): void => {
        const done = navigate(`/i/${token}/etransfer`);
        if (done) done.catch(() => undefined);
    };
    const invoice = form.invoice;
    const [printing, setPrinting] = useState(false);
    useEmbedSuccess(form.status === "paid", "pay");

    if (form.status === "loading") return <PublicStatus kind="loading" />;
    if (form.status === "not-found")
        return <PublicStatus kind="notFound" title={pp.notFoundTitle} body={pp.notFoundBody} />;
    if (form.status === "error" || invoice === null) return <PublicStatus kind="error" />;

    const paid = form.status === "paid";
    if (paid && invoice.status !== "paid")
        return (
            <PublicDone
                brand={invoice.brand}
                title={pp.paidTitle}
                body={pp.paidBody(invoice.business_name)}
            />
        );

    const runCard = (): void => {
        if (!PUBLISHABLE_KEY) {
            form.setError(pp.cardNotConfigured);
            return;
        }
        form.payCard();
    };
    const lines = publicDocLines(invoice.lines);
    const registration = registrationLine(invoice.gst_hst_number, invoice.qst_number);
    const doc = printedPublicInvoice(invoice, window.location.href, cssVar("accent"));

    return (
        <PublicDocument
            brand={invoice.brand}
            businessName={invoice.business_name}
            contact={null}
            actions={
                <Button
                    variant="outline"
                    size="sm"
                    icon="printer"
                    label={pp.downloadInvoice}
                    onPress={() => {
                        setPrinting(true);
                    }}
                >
                    <span className="hidden sm:inline">{pp.downloadInvoice}</span>
                </Button>
            }
            footer={pp.poweredBy}
            hero={
                <div>
                    <p className="text-sm font-medium text-ink-soft">
                        {invoice.number !== null ? pp.invoiceNumber(invoice.number) : pp.invoice} ·{" "}
                        {invoice.business_name}
                    </p>
                    <h1 className="mt-3 font-display text-5xl font-bold tracking-tight text-ink sm:text-6xl">
                        <span className="sr-only">
                            {invoice.number !== null
                                ? pp.invoiceNumber(invoice.number)
                                : pp.invoice}{" "}
                        </span>
                        {invoice.status === "paid"
                            ? formatMoneyWithCurrency(invoice.total_cents, invoice.currency)
                            : formatMoneyWithCurrency(invoice.balance_cents, invoice.currency)}
                    </h1>
                    <p className="mt-3 text-sm text-ink-soft">
                        {invoice.number !== null ? pp.invoiceNumber(invoice.number) : pp.invoice}
                        {invoice.due_at !== null ? ` · ${pp.dueOn(shortDate(invoice.due_at))}` : ""}
                    </p>
                </div>
            }
        >
            <main className="mx-auto grid max-w-6xl gap-5 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
                <article className="order-2 space-y-5">
                    <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
                        <div className="flex items-baseline justify-between gap-3 px-5 pt-5">
                            <h2 className="font-display text-base font-bold text-ink">
                                {pp.details}
                            </h2>
                            <span className="text-xs text-muted">
                                {invoice.number !== null
                                    ? pp.invoiceNumber(invoice.number)
                                    : pp.invoice}
                            </span>
                        </div>
                        <ul className="divide-y divide-line-soft px-5">
                            {lines.map((l) => (
                                <li
                                    key={l.id}
                                    className="flex items-start justify-between gap-4 py-3.5 text-sm"
                                >
                                    <div className="min-w-0">
                                        <p className="font-medium text-ink">{l.description}</p>
                                        <p className="mt-0.5 text-xs text-muted">
                                            {[
                                                strings.billing.qtyTimes(
                                                    l.quantity,
                                                    formatMoney(l.unitCents),
                                                ),
                                                l.taxCodes.join(" + "),
                                            ]
                                                .filter(Boolean)
                                                .join(" · ")}
                                        </p>
                                    </div>
                                    <span className="font-medium tabular-nums text-ink">
                                        {formatMoney(l.amountCents)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                        <div className="mx-5 mb-5 mt-3 border-t border-line pt-3">
                            <DocTotals lines={publicInvoiceTotals(invoice)} />
                        </div>
                        {registration !== "" ? (
                            <p className="px-5 pb-5 text-xs text-muted">{registration}</p>
                        ) : null}
                    </section>
                    {invoice.notes !== null ? (
                        <section className="rounded-2xl bg-accent-weak p-5">
                            <p className="text-xs font-semibold text-accent-strong">
                                {strings.publicEstimate.note}
                            </p>
                            <p className="mt-1.5 text-sm leading-relaxed text-ink">
                                {invoice.notes}
                            </p>
                        </section>
                    ) : null}
                </article>

                <aside className="order-1 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-7">
                    {invoice.status === "paid" ? (
                        <div className="flex flex-col items-center py-6 text-center">
                            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-ok-bg text-ok-fg">
                                <Icon name="check" size={28} />
                            </span>
                            <h2 className="mt-4 font-display text-xl font-bold text-ink">
                                {pp.paidTitle}
                            </h2>
                            <p className="mt-1 max-w-xs text-sm text-ink-soft">
                                {pp.paidBody(invoice.business_name)}
                            </p>
                        </div>
                    ) : (
                        <>
                            <h2 className="mb-5 font-display text-xl font-bold text-ink">
                                {pp.chooseHowToPay}
                            </h2>
                            <div className="space-y-4">
                                <Choice
                                    layout="cards"
                                    label={pp.chooseHowToPay}
                                    options={form.methods.map((m) =>
                                        m === "interac"
                                            ? {
                                                  key: m,
                                                  label: pp.interacLabel,
                                                  hint: pp.interacBadge,
                                              }
                                            : { key: m, label: pp.cardLabel, hint: pp.cardBadge },
                                    )}
                                    value={form.method}
                                    onChange={(m) => {
                                        form.setMethod(m);
                                        form.setError(null);
                                    }}
                                />
                                {form.method === "card" &&
                                form.card === null &&
                                form.tip.available ? (
                                    <section className="space-y-3 border-t border-line-soft pt-4">
                                        <div>
                                            <h3 className="text-sm font-semibold text-ink">
                                                {form.tip.title}
                                            </h3>
                                            <p className="text-xs text-muted">{pp.tipHint}</p>
                                        </div>
                                        <Choice
                                            layout="tiles"
                                            columns={3}
                                            label={form.tip.title}
                                            options={form.tip.options}
                                            value={form.tip.key}
                                            onChange={form.tip.choose}
                                        />
                                        {form.tip.key === "custom" ? (
                                            <TextField
                                                label={pp.tipAmount}
                                                prefix="$"
                                                type="number"
                                                width="narrow"
                                                value={form.tip.custom}
                                                onChange={form.tip.setCustom}
                                                error={form.tip.error}
                                            />
                                        ) : null}
                                        <p className="text-xs text-muted">{form.tip.note}</p>
                                        {form.tip.cents > 0 ? (
                                            <p className="flex justify-between text-sm text-ink">
                                                <span>{pp.tipRow}</span>
                                                <span className="tabular-nums">
                                                    {formatMoney(form.tip.cents)}
                                                </span>
                                            </p>
                                        ) : null}
                                    </section>
                                ) : null}
                                {form.method === "interac" ? (
                                    <Button size="lg" full onPress={openInterac}>
                                        {invoice.interac ? pp.seeSteps : pp.payByInterac}
                                    </Button>
                                ) : form.card ? (
                                    <CardForm
                                        clientSecret={form.card.client_secret}
                                        stripeAccount={form.card.stripe_account_id}
                                        submitLabel={strings.checkout.pay(
                                            formatMoneyWithCurrency(
                                                form.tip.totalCents,
                                                invoice.currency,
                                            ),
                                        )}
                                        busyLabel={strings.common.working}
                                        onDone={form.markPaid}
                                        onCancel={form.cancelCard}
                                    />
                                ) : (
                                    <Button size="lg" full onPress={runCard} busy={form.busy}>
                                        {form.busy
                                            ? strings.common.working
                                            : form.tip.cents > 0
                                              ? pp.payWithTip(
                                                    formatMoneyWithCurrency(
                                                        form.tip.totalCents,
                                                        invoice.currency,
                                                    ),
                                                )
                                              : pp.payByCard}
                                    </Button>
                                )}
                                {form.error ? <Notice tone="danger">{form.error}</Notice> : null}
                            </div>
                        </>
                    )}
                </aside>
            </main>
            {printing ? (
                <PrintModal
                    doc={doc}
                    printLabel={pp.downloadInvoice}
                    onClose={() => {
                        setPrinting(false);
                    }}
                />
            ) : null}
        </PublicDocument>
    );
}
