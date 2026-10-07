import {
    createPublicPayClient,
    formatMoney,
    formatMoneyWithCurrency,
    invoiceStatusIntent,
    printedPublicInvoice,
    publicDocLines,
    publicInvoiceTotals,
    registrationLine,
    shortDate,
    strings,
    usePublicPayForm,
} from "@clientbridge/app-core/public";
import {
    Button,
    CardForm,
    Choice,
    DocTotals,
    Icon,
    Notice,
    StatusPill,
    TextField,
} from "@clientbridge/ui";
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
    const status = invoice.status === "sent" && isLate(invoice.due_at) ? "overdue" : invoice.status;
    const lines = publicDocLines(invoice.lines);
    const registration = registrationLine(invoice.gst_hst_number, invoice.qst_number);
    const doc = printedPublicInvoice(invoice, window.location.href, cssVar("accent"));

    return (
        <PublicDocument
            brand={invoice.brand}
            businessName={invoice.business_name}
            contact={invoice.interac_email}
            footer={pp.poweredBy}
        >
            <main className="mx-auto grid max-w-5xl gap-6 px-4 py-6 sm:px-5 sm:py-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
                <article className="order-2 rounded-xl border border-line bg-surface shadow-card lg:order-1">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-6 py-5">
                        <div>
                            <p className="text-sm text-muted">
                                {pp.requesting(invoice.business_name)}
                            </p>
                            <h1 className="mt-0.5 font-display text-2xl font-bold text-ink">
                                {invoice.number !== null
                                    ? pp.invoiceNumber(invoice.number)
                                    : pp.invoice}
                            </h1>
                        </div>
                        <StatusPill
                            status={pp.statusLabel[status] ?? status}
                            intent={invoiceStatusIntent(status)}
                            asWritten
                        />
                    </div>
                    <dl className="grid grid-cols-2 gap-4 border-b border-line-soft px-6 py-4 text-sm sm:grid-cols-3">
                        <Fact label={pp.billedTo} value={invoice.client_name ?? ""} />
                        <Fact label={pp.issued} value={shortDate(invoice.issued_at)} />
                        <Fact label={pp.due} value={shortDate(invoice.due_at)} />
                    </dl>
                    <ul className="divide-y divide-line-soft px-6">
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
                    <div className="mx-6 mb-5 mt-1 rounded-lg bg-bg px-4 py-3">
                        <DocTotals lines={publicInvoiceTotals(invoice)} />
                    </div>
                    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-4 text-xs text-muted">
                        <span>{registration}</span>
                        <Button
                            size="sm"
                            variant="outline"
                            icon="receipt"
                            onPress={() => {
                                setPrinting(true);
                            }}
                        >
                            {pp.downloadInvoice}
                        </Button>
                    </footer>
                </article>

                <aside className="order-1 rounded-xl border border-line bg-surface p-6 shadow-card lg:sticky lg:top-6 lg:order-2">
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
                            <p className="text-xs font-medium uppercase tracking-wide text-muted">
                                {pp.balanceDue}
                            </p>
                            <p className="mt-1 font-display text-4xl font-bold tabular-nums text-ink">
                                {formatMoneyWithCurrency(invoice.balance_cents, invoice.currency)}
                            </p>
                            {invoice.due_at !== null ? (
                                <p
                                    className={`mt-1 text-sm ${status === "overdue" ? "font-medium text-danger" : "text-muted"}`}
                                >
                                    {pp.dueOn(shortDate(invoice.due_at))}
                                </p>
                            ) : null}
                            {invoice.credits.length > 0 ? (
                                <ul className="mt-4 space-y-1.5 border-t border-line-soft pt-3 text-sm">
                                    <li className="flex justify-between gap-3 text-muted">
                                        <span>{pp.total}</span>
                                        <span className="tabular-nums">
                                            {formatMoney(invoice.total_cents)}
                                        </span>
                                    </li>
                                    {invoice.credits.map((c, i) => (
                                        <li
                                            key={String(i)}
                                            className="flex justify-between gap-3 text-ok-fg"
                                        >
                                            <span className="flex items-center gap-1.5">
                                                <Icon name="checkCircle" size={14} />
                                                {c.kind === "deposit"
                                                    ? pp.depositCredit
                                                    : pp.credit(
                                                          pp.method[c.method ?? "other"] ?? "",
                                                          shortDate(c.at),
                                                      )}
                                            </span>
                                            <span className="tabular-nums">
                                                −{formatMoney(c.amount_cents)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            ) : null}
                            <h2 className="mb-3 mt-6 text-sm font-semibold text-ink">
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
                                {form.method === "card" && form.card === null ? (
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

function isLate(due: string | null): boolean {
    return due !== null && new Date(due).getTime() < Date.now() - 86_400_000;
}

function Fact({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
            <dd className="mt-1 font-medium text-ink">{value}</dd>
        </div>
    );
}
