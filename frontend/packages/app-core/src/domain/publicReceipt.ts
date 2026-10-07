import { strings } from "../strings";
import type { DocTotalLine, PrintedDocLine } from "../ui";
import { type PublicDocLine, type PublicDocTax, publicDocLines, publicDocTaxes } from "./publicPay";
import { type PublicBrand, usePublicResource } from "./publicResource";

interface PublicReceiptPayment {
    kind: "payment" | "deposit" | "refund";
    method: string;
    amount_cents: number;
    tip_cents: number;
    at: string | null;
}

export interface PublicReceipt {
    number: number | null;
    business_name: string;
    brand: PublicBrand;
    gst_hst_number: string | null;
    qst_number: string | null;
    client_name: string | null;
    served_by: string[];
    status: string;
    currency: string;
    created_at: string;
    lines: PublicDocLine[];
    discount_cents: number;
    discount_reason: string | null;
    subtotal_cents: number;
    taxes: PublicDocTax[];
    tax_total_cents: number;
    total_cents: number;
    tip_cents: number;
    payments: PublicReceiptPayment[];
}

class PublicReceiptError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = "PublicReceiptError";
    }
}

interface PublicReceiptClient {
    getReceipt: (token: string) => Promise<PublicReceipt>;
}

export function createPublicReceiptClient(baseUrl: string): PublicReceiptClient {
    return {
        getReceipt: async (token) => {
            const res = await fetch(`${baseUrl}/receipt/${encodeURIComponent(token)}`);
            if (!res.ok) throw new PublicReceiptError(res.status, res.statusText);
            return (await res.json()) as PublicReceipt;
        },
    };
}

/** The receipt's money summary: discount, subtotal, tax per code, tip and what was paid. */
function publicReceiptTotals(receipt: PublicReceipt): DocTotalLine[] {
    const r = strings.publicReceipt;
    const rows: DocTotalLine[] = [];
    if (receipt.discount_cents > 0)
        rows.push({
            key: "discount",
            label: r.discount,
            cents: receipt.discount_cents,
            kind: "credit",
            hint: receipt.discount_reason ?? undefined,
        });
    rows.push({
        key: "subtotal",
        label: r.subtotal,
        cents: receipt.subtotal_cents,
        kind: "subtotal",
    });
    for (const t of publicDocTaxes(receipt.taxes))
        rows.push({ key: t.code, label: t.label, cents: t.cents, kind: "tax" });
    if (receipt.tip_cents > 0)
        rows.push({
            key: "tip",
            label: r.tip,
            cents: receipt.tip_cents,
            kind: "subtotal",
            hint: r.tipNoTax,
        });
    rows.push({
        key: "total",
        label: r.total,
        cents: receipt.total_cents + receipt.tip_cents,
        kind: "total",
    });
    for (const [i, p] of receipt.payments.entries())
        rows.push({
            key: `pay-${String(i)}`,
            label:
                p.kind === "refund"
                    ? r.refund
                    : p.kind === "deposit"
                      ? r.deposit
                      : (r.method[p.method] ?? r.method.other ?? ""),
            cents: p.kind === "refund" ? -p.amount_cents : p.amount_cents,
            kind: "credit",
        });
    return rows;
}

interface PublicReceiptPage {
    status: "loading" | "not-found" | "error" | "ready";
    receipt: PublicReceipt | null;
    lines: PrintedDocLine[];
    totals: DocTotalLine[];
    taxNumbers: string[];
}

/** A client's receipt from its link: the sale's lines, tax per code, tip and payments. */
export function usePublicReceipt(client: PublicReceiptClient, token: string): PublicReceiptPage {
    const { status, data } = usePublicResource(client.getReceipt, token);
    const r = strings.publicReceipt;
    return {
        status,
        receipt: data,
        lines: data === null ? [] : publicDocLines(data.lines),
        totals: data === null ? [] : publicReceiptTotals(data),
        taxNumbers:
            data === null
                ? []
                : [
                      ...(data.gst_hst_number === null ? [] : [r.gst(data.gst_hst_number)]),
                      ...(data.qst_number === null ? [] : [r.qst(data.qst_number)]),
                  ],
    };
}
