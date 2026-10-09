import {
    createPublicReceiptClient,
    formatMoney,
    shortDate,
    strings,
    usePublicReceipt,
} from "@clientbridge/app-core/public";
import { Button, DocTotals, StatusPill } from "@clientbridge/ui";
import { useParams } from "react-router-dom";

import { PublicDocument } from "../components/PublicDocument";
import { PublicStatus } from "../components/PublicStatus";
import { config } from "../config";

const receipts = createPublicReceiptClient(config.apiUrl);
const r = strings.publicReceipt;

/** A client's receipt for a desk sale: what was bought, tax per code, the tip and how it was paid. */
export function PublicReceipt() {
    const { token = "" } = useParams<{ token: string }>();
    const page = usePublicReceipt(receipts, token);
    const receipt = page.receipt;
    if (page.status === "loading") return <PublicStatus kind="loading" />;
    if (page.status === "not-found")
        return <PublicStatus kind="notFound" title={r.notFoundTitle} body={r.notFoundBody} />;
    if (page.status === "error" || receipt === null)
        return <PublicStatus kind="error" title={r.errorTitle} body={r.errorBody} />;
    const paid = receipt.payments
        .filter((p) => p.kind !== "refund")
        .reduce((n, p) => n + p.amount_cents, 0);
    const status = r.status[receipt.status] ?? receipt.status;
    return (
        <PublicDocument
            brand={receipt.brand}
            businessName={receipt.business_name}
            contact={null}
            width="narrow"
            hero={
                <>
                    <StatusPill
                        status={status}
                        intent={receipt.status === "paid" ? "success" : "warning"}
                        asWritten
                    />
                    <h1 className="mt-3 font-display text-3xl font-bold text-ink sm:text-4xl">
                        {r.title(receipt.business_name)}
                    </h1>
                    <p className="mt-2 text-sm text-ink-soft">
                        {[shortDate(receipt.created_at), receipt.client_name]
                            .filter(Boolean)
                            .join(" · ")}
                    </p>
                </>
            }
        >
            <main className="mx-auto max-w-3xl px-4 sm:px-6">
                <article className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
                    <div className="border-b border-line-soft bg-accent-weak px-6 py-5">
                        <div className="flex items-center justify-between gap-3">
                            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                                {r.title(receipt.business_name)}
                                {receipt.number !== null
                                    ? ` · ${r.sale(`S-${String(receipt.number)}`)}`
                                    : ""}
                            </h2>
                            <StatusPill
                                status={status}
                                intent={receipt.status === "paid" ? "success" : "warning"}
                                asWritten
                            />
                        </div>
                        <p className="mt-2 font-display text-4xl font-bold tabular-nums text-ink">
                            {formatMoney(paid)}
                        </p>
                        <p className="mt-1 text-sm text-muted">
                            {[shortDate(receipt.created_at), receipt.client_name]
                                .filter((v) => v !== null && v !== "")
                                .join(" · ")}
                        </p>
                        {receipt.served_by.length > 0 ? (
                            <p className="mt-0.5 text-sm text-muted">
                                {r.servedBy(receipt.served_by.join(", "))}
                            </p>
                        ) : null}
                    </div>
                    <ul className="divide-y divide-line-soft border-t border-line px-6">
                        {page.lines.map((l) => (
                            <li
                                key={l.id}
                                className="flex items-start justify-between gap-4 py-3 text-sm"
                            >
                                <div className="min-w-0">
                                    <p className="font-medium text-ink">{l.description}</p>
                                    <p className="mt-0.5 text-xs text-muted">
                                        {[
                                            l.quantity === 1
                                                ? null
                                                : strings.billing.qtyTimes(
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
                    <div className="border-t border-line px-6 py-4">
                        <DocTotals lines={page.totals} density="compact" />
                    </div>
                    <div className="space-y-3 border-t border-dashed border-line bg-bg px-6 py-5 print:hidden">
                        <Button
                            variant="outline"
                            full
                            icon="printer"
                            onPress={() => {
                                window.print();
                            }}
                        >
                            {r.print}
                        </Button>
                        {page.taxNumbers.length > 0 ? (
                            <p className="text-center text-xs text-muted">
                                {page.taxNumbers.join(" · ")}
                            </p>
                        ) : null}
                    </div>
                </article>
            </main>
        </PublicDocument>
    );
}
