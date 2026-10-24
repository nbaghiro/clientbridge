import { useState } from "react";

import { formatList, formatParts, formatPhone } from "../format";
import { useAsyncAction } from "../hooks";
import { strings } from "../strings";
import type { DocTotalLine, PrintedDoc, PrintedDocLine } from "../ui";
import { type PublicDocLine, type PublicDocTax, publicDocLines, publicDocTaxes } from "./publicPay";
import {
    type PostalParts,
    discountReason,
    longDate,
    printedDoc,
    publicAddressLines,
    saleNumber,
} from "./printing";
import { type PublicBrand, usePublicResource } from "./publicResource";
import { failureMessage, refusal } from "../api";

interface PublicReceiptPayment {
    kind: "payment" | "deposit" | "refund";
    method: string | null;
    amount_cents: number;
    tip_cents: number;
    at: string | null;
}

export interface PublicReceipt {
    number: number | null;
    business_name: string;
    brand: PublicBrand;
    address?: Partial<PostalParts>;
    phone?: string | null;
    gst_hst_number: string | null;
    qst_number: string | null;
    client_name: string | null;
    served_by: string[];
    status: string;
    currency: string;
    timezone: string;
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

/** A visit's receipt for an insurer, numbered as the invoice or sale it was paid on. */
export interface VisitReceipt extends PublicReceipt {
    source: "invoice" | "sale";
    service: string;
    visit_at: string;
    practitioner: string | null;
    practitioner_title: string | null;
}

interface PublicReceiptClient {
    getReceipt: (token: string) => Promise<PublicReceipt>;
    getVisitReceipt: (manageToken: string) => Promise<VisitReceipt>;
}

export function createPublicReceiptClient(baseUrl: string): PublicReceiptClient {
    const get = async <T>(path: string): Promise<T> => {
        const res = await fetch(`${baseUrl}${path}`);
        if (!res.ok) throw await refusal(res);
        return (await res.json()) as T;
    };
    return {
        getReceipt: (token) => get<PublicReceipt>(`/receipt/${encodeURIComponent(token)}`),
        getVisitReceipt: (token) =>
            get<VisitReceipt>(`/manage/${encodeURIComponent(token)}/receipt`),
    };
}

function amountPaid(receipt: PublicReceipt): number {
    return receipt.payments.reduce(
        (n, p) => n + (p.kind === "refund" ? -p.amount_cents : p.amount_cents),
        0,
    );
}

/** The visit's receipt as a printed page: the document's lines and payments, with the practitioner. */
export function printedVisitReceipt(receipt: VisitReceipt, fallbackColor: string): PrintedDoc {
    const pr = strings.printing;
    const helpers = receipt.served_by.filter((name) => name !== receipt.practitioner);
    const number =
        receipt.number === null
            ? null
            : receipt.source === "sale"
              ? saleNumber(receipt.number)
              : String(receipt.number);
    return printedDoc(
        {
            kind: "receipt",
            currency: receipt.currency,
            number,
            partyName: receipt.client_name ?? "",
            partyLines: [],
            meta: [
                {
                    label: receipt.source === "sale" ? pr.forSale : pr.forInvoice,
                    value: number ?? "",
                },
                {
                    label: pr.practitioner,
                    value: formatParts([receipt.practitioner, receipt.practitioner_title]),
                },
                ...(helpers.length === 0
                    ? []
                    : [{ label: pr.assistedBy, value: formatList(helpers, "unit") }]),
                { label: pr.serviceDate, value: longDate(receipt.visit_at, receipt.timezone) },
                { label: pr.service, value: receipt.service },
            ],
            lines: publicDocLines(receipt.lines),
            taxes: publicDocTaxes(receipt.taxes),
            totals: publicReceiptTotals(receipt),
            headline: { label: pr.amountPaid, cents: amountPaid(receipt) },
            stamp: receipt.status === "paid" ? pr.paidStamp : null,
        },
        {
            name: receipt.business_name,
            avatarUrl: receipt.brand.logo_url,
            tagline: receipt.brand.tagline,
            brandColor: receipt.brand.primary,
            email: null,
            gstHstNumber: receipt.gst_hst_number,
            qstNumber: receipt.qst_number,
            address: publicAddressLines(receipt.address),
            phone: receipt.phone ?? null,
        },
        fallbackColor,
    );
}

export interface VisitReceiptView {
    doc: PrintedDoc | null;
    busy: boolean;
    error: string | null;
    open: () => void;
    close: () => void;
}

/** Fetches the visit's receipt on demand; a visit not billed or not yet paid says so. */
export function useVisitReceipt(
    fetchReceipt: () => Promise<VisitReceipt>,
    fallbackColor: string,
): VisitReceiptView {
    const [doc, setDoc] = useState<PrintedDoc | null>(null);
    const { busy, error, setError, run } = useAsyncAction();
    return {
        doc,
        busy,
        error,
        open: () => {
            run(
                async () => {
                    setDoc(printedVisitReceipt(await fetchReceipt(), fallbackColor));
                },
                { errorMessage: (e) => failureMessage(e, strings.publicReceipt.visitError) },
            );
        },
        close: () => {
            setDoc(null);
            setError(null);
        },
    };
}

/** The receipt's money summary: discount, subtotal, tax per code, tip and what was paid. */
export function publicReceiptTotals(receipt: PublicReceipt): DocTotalLine[] {
    const r = strings.publicReceipt;
    const rows: DocTotalLine[] = [];
    if (receipt.discount_cents > 0)
        rows.push({
            key: "discount",
            label: r.discount,
            cents: receipt.discount_cents,
            kind: "credit",
            hint: discountReason(receipt.discount_reason) ?? undefined,
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
                      : (r.method[p.method ?? "other"] ?? r.method.other),
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
    // The business's address lines and phone, under the receipt.
    businessLines: string[];
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
        businessLines:
            data === null
                ? []
                : [...publicAddressLines(data.address), formatPhone(data.phone)].filter(
                      (line) => line !== "",
                  ),
    };
}
