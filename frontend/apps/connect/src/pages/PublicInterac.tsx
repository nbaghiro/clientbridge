import {
    createPublicPayClient,
    formatMoney,
    strings,
    usePublicInterac,
} from "@clientbridge/app-core/public";
import { Button, Checkbox, CopyField, Icon, KeyValueList, Notice } from "@clientbridge/ui";
import { useNavigate, useParams } from "react-router-dom";

import { PublicDocument } from "../components/PublicDocument";
import { PublicStatus } from "../components/PublicStatus";
import { config } from "../config";

const pay = createPublicPayClient(config.apiUrl);
const pp = strings.publicPay;

export function PublicInterac() {
    const { token = "" } = useParams<{ token: string }>();
    const navigate = useNavigate();
    const flow = usePublicInterac(pay, token);
    const invoice = flow.invoice;

    if (flow.status === "loading") return <PublicStatus kind="loading" />;
    if (flow.status === "not-found")
        return <PublicStatus kind="notFound" title={pp.notFoundTitle} body={pp.notFoundBody} />;
    if (flow.status === "error" || invoice === null) return <PublicStatus kind="error" />;

    const back = (): void => {
        const done = navigate(`/i/${token}`);
        if (done) done.catch(() => undefined);
    };

    return (
        <PublicDocument
            brand={invoice.brand}
            businessName={invoice.business_name}
            contact={invoice.interac_email}
            footer={pp.poweredBy}
        >
            <main className="flex justify-center px-4 py-8 sm:py-10">
                <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-card sm:p-8">
                    <p className="text-sm text-muted">
                        {invoice.number !== null ? pp.invoiceNumber(invoice.number) : pp.invoice}
                    </p>
                    <h1 className="mt-0.5 font-display text-xl font-bold text-ink">
                        {pp.etransferTitle(invoice.business_name)}
                    </h1>
                    {flow.status === "paid" ? (
                        <div className="mt-5 flex items-start gap-3 rounded-lg bg-ok-bg px-4 py-3 text-ok-fg">
                            <Icon name="checkCircle" size={20} />
                            <div className="text-sm">
                                <p className="font-semibold">{pp.statusReceived}</p>
                                <p className="mt-0.5">
                                    {pp.statusReceivedBody(
                                        formatMoney(invoice.total_cents),
                                        invoice.business_name,
                                    )}
                                </p>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="mt-4 rounded-lg border border-line bg-bg px-4 py-1">
                                <KeyValueList
                                    rows={[
                                        {
                                            label: pp.total,
                                            value: formatMoney(invoice.total_cents),
                                        },
                                        {
                                            label: pp.paidSoFar,
                                            value: formatMoney(flow.paidCents),
                                        },
                                        { label: pp.amountToSend, value: flow.amount },
                                    ]}
                                />
                            </div>
                            <div className="mt-6 flex items-baseline justify-between">
                                <h2 className="text-sm font-semibold text-ink">{pp.steps}</h2>
                                <span className="text-xs text-muted">{flow.progress}</span>
                            </div>
                            <ol className="mt-3 space-y-3">
                                {flow.steps.map((step, i) => {
                                    const done = flow.done.includes(i);
                                    return (
                                        <li
                                            key={step.text}
                                            className={`rounded-lg border px-4 py-3 ${done ? "border-line bg-bg" : "border-accent-line bg-surface"}`}
                                        >
                                            <div className="flex items-start gap-3">
                                                <span className="pt-0.5">
                                                    <Checkbox
                                                        label={pp.markStep(i + 1)}
                                                        hideLabel
                                                        value={done}
                                                        onChange={() => {
                                                            flow.toggleStep(i);
                                                        }}
                                                    />
                                                </span>
                                                <p
                                                    className={`text-sm leading-relaxed ${done ? "text-muted line-through" : "text-ink"}`}
                                                >
                                                    {step.text}
                                                </p>
                                            </div>
                                            {step.copy !== null &&
                                            !done &&
                                            step.copy.value !== "" ? (
                                                <div className="mt-3">
                                                    <CopyField
                                                        label={step.copy.label}
                                                        value={step.copy.value}
                                                        variant={step.copy.code ? "code" : "line"}
                                                        copyLabel={pp.copy}
                                                        copiedLabel={pp.copied}
                                                    />
                                                </div>
                                            ) : null}
                                        </li>
                                    );
                                })}
                            </ol>
                            <div
                                role="status"
                                className="mt-5 flex items-start gap-3 rounded-lg border border-line bg-bg px-4 py-3"
                            >
                                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-accent" />
                                <div>
                                    <p className="text-sm font-semibold text-ink">
                                        {pp.statusWaiting}
                                    </p>
                                    <p className="mt-0.5 text-xs text-muted">
                                        {pp.statusWaitingBody}
                                    </p>
                                </div>
                            </div>
                            {flow.validUntil !== null ? (
                                <p className="mt-3 text-xs text-muted">{flow.validUntil}</p>
                            ) : null}
                            {flow.error !== null ? (
                                <div className="mt-3">
                                    <Notice tone="danger">{flow.error}</Notice>
                                </div>
                            ) : null}
                        </>
                    )}
                    <div className="mt-4 border-t border-line-soft pt-4 text-center">
                        <Button variant="link" onPress={back}>
                            {flow.status === "paid" || !invoice.accepts_card
                                ? pp.viewInvoice
                                : pp.payByCardInstead}
                        </Button>
                    </div>
                </div>
            </main>
        </PublicDocument>
    );
}
