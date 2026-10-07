import { useState } from "react";

import { useAsyncAction } from "../hooks";
import { strings } from "../strings";
import type { DocTotalLine, Intent, PrintedDoc, PrintedDocLine, PrintedDocTax } from "../ui";
import { longDate, printedDoc, ratePct, shortDate } from "./printing";
import { type PublicBrand, usePublicResource } from "./publicResource";

type PayMethod = "interac" | "card";

/** Ranked pay methods for the public page: Interac first (no fee), card only when enabled. */
function payMethods(invoice: { accepts_card: boolean }): PayMethod[] {
    return invoice.accepts_card ? ["interac", "card"] : ["interac"];
}

// The status → visual-intent decision is shared; each platform maps the intent to its own tokens.
export function invoiceStatusIntent(status: string): Intent {
    switch (status) {
        case "paid":
            return "success";
        case "sent":
            return "accent";
        case "partial":
            return "warning";
        case "overdue":
            return "danger";
        default:
            return "neutral"; // draft, void
    }
}

export interface PublicDocLine {
    description: string;
    quantity: number;
    unit_amount_cents: number;
    amount_cents: number;
    tax_codes: string[];
}

export interface PublicDocTax {
    code: string;
    rate_bps: number;
    base_cents: number;
    cents: number;
}

interface PublicCredit {
    kind: "payment" | "deposit";
    method: string | null;
    amount_cents: number;
    at: string | null;
}

interface PublicInvoice {
    number: number | null;
    business_name: string;
    brand: PublicBrand;
    currency: string;
    subtotal_cents: number;
    tax_total_cents: number;
    total_cents: number;
    balance_cents: number;
    status: string;
    accepts_card: boolean;
    interac_email: string | null;
    client_name: string | null;
    issued_at: string | null;
    due_at: string | null;
    notes: string | null;
    gst_hst_number: string | null;
    qst_number: string | null;
    lines: PublicDocLine[];
    taxes: PublicDocTax[];
    credits: PublicCredit[];
}

export function publicDocTaxes(taxes: readonly PublicDocTax[]): PrintedDocTax[] {
    return taxes.map((t) => ({
        code: t.code,
        label: strings.billing.taxRow(t.code, ratePct(t.code, t.rate_bps)),
        baseCents: t.base_cents,
        cents: t.cents,
    }));
}

export function publicDocLines(lines: readonly PublicDocLine[]): PrintedDocLine[] {
    return lines.map((l, i) => ({
        id: String(i),
        description: l.description,
        subject: null,
        quantity: l.quantity,
        unitCents: l.unit_amount_cents,
        amountCents: l.amount_cents,
        taxCodes: l.tax_codes,
    }));
}

/** What the client reads under the lines: subtotal, tax per code, total, payments and balance. */
export function publicInvoiceTotals(invoice: PublicInvoice): DocTotalLine[] {
    const pp = strings.publicPay;
    return [
        { key: "subtotal", label: pp.subtotal, cents: invoice.subtotal_cents, kind: "subtotal" },
        ...publicDocTaxes(invoice.taxes).map((t): DocTotalLine => ({
            key: t.code,
            label: t.label,
            cents: t.cents,
            kind: "tax",
        })),
        { key: "total", label: pp.total, cents: invoice.total_cents, kind: "total" },
        ...invoice.credits.map((c, i): DocTotalLine => ({
            key: `credit-${String(i)}`,
            label:
                c.kind === "deposit"
                    ? pp.depositCredit
                    : pp.credit(
                          pp.method[c.method ?? "other"] ?? pp.method.other ?? "",
                          shortDate(c.at),
                      ),
            cents: c.amount_cents,
            kind: "credit",
        })),
        { key: "balance", label: pp.balanceDue, cents: invoice.balance_cents, kind: "balance" },
    ];
}

/** The invoice as a printed page, for "Download invoice" on the pay link. */
export function printedPublicInvoice(
    invoice: PublicInvoice,
    payUrl: string,
    fallbackColor: string,
): PrintedDoc {
    const pr = strings.printing;
    const paid = invoice.balance_cents <= 0;
    const number = invoice.number === null ? pr.draftNumber : String(invoice.number);
    return printedDoc(
        {
            kind: "invoice",
            number,
            partyName: invoice.client_name ?? "",
            partyLines: [],
            meta: [
                { label: pr.invoiceNumber, value: `#${number}` },
                { label: pr.issued, value: longDate(invoice.issued_at) },
                { label: pr.due, value: longDate(invoice.due_at) },
            ],
            lines: publicDocLines(invoice.lines),
            taxes: publicDocTaxes(invoice.taxes),
            totals: publicInvoiceTotals(invoice),
            headline: { label: strings.publicPay.balanceDue, cents: invoice.balance_cents },
            stamp: paid ? pr.paidStamp : null,
            payUrl: paid ? null : payUrl,
            instructions: paid
                ? []
                : [
                      pr.payOnline(payUrl),
                      ...(invoice.interac_email !== null
                          ? [pr.payInterac(invoice.interac_email)]
                          : []),
                  ],
            message: invoice.notes,
        },
        {
            name: invoice.business_name,
            tagline: invoice.brand.tagline,
            brandColor: invoice.brand.primary,
            email: invoice.interac_email,
            gstHstNumber: invoice.gst_hst_number,
            qstNumber: invoice.qst_number,
        },
        fallbackColor,
    );
}

export interface InteracRequest {
    payment_id: string;
    reference_code: string;
    send_to: string | null;
    amount_cents: number;
}

interface PublicCardIntent {
    client_secret: string;
    stripe_account_id: string;
}

class PublicPayError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = "PublicPayError";
    }
}

interface PublicPayClient {
    getPublicInvoice: (token: string) => Promise<PublicInvoice>;
    payInterac(token: string): Promise<InteracRequest>;
    payCard(token: string): Promise<PublicCardIntent>;
}

export function createPublicPayClient(baseUrl: string): PublicPayClient {
    const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
        const res = await fetch(`${baseUrl}${path}`, init);
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new PublicPayError(res.status, text || res.statusText);
        }
        return (await res.json()) as T;
    };

    return {
        getPublicInvoice: (token) => request<PublicInvoice>(`/pay/${encodeURIComponent(token)}`),
        payInterac: (token) =>
            request<InteracRequest>(`/pay/${encodeURIComponent(token)}/interac`, {
                method: "POST",
            }),
        payCard: (token) =>
            request<PublicCardIntent>(`/pay/${encodeURIComponent(token)}/card`, { method: "POST" }),
    };
}

type PublicPayStatus = "loading" | "not-found" | "error" | "ready" | "paid";

interface PublicPayForm {
    status: PublicPayStatus;
    invoice: PublicInvoice | null;
    methods: PayMethod[];
    method: PayMethod;
    setMethod: (m: PayMethod) => void;
    interac: InteracRequest | null;
    card: PublicCardIntent | null;
    payInterac: () => void;
    payCard: () => void;
    markPaid: () => void;
    busy: boolean;
    error: string | null;
    setError: (message: string | null) => void;
}

export function usePublicPayForm(pay: PublicPayClient, token: string): PublicPayForm {
    const { status: load, data: invoice } = usePublicResource(pay.getPublicInvoice, token);
    const [method, setMethod] = useState<PayMethod>("interac");
    const [interac, setInterac] = useState<InteracRequest | null>(null);
    const [card, setCard] = useState<PublicCardIntent | null>(null);
    const [paid, setPaid] = useState(false);
    const { busy, error, setError, run } = useAsyncAction();

    const status: PublicPayStatus =
        load !== "ready" ? load : paid || invoice?.status === "paid" ? "paid" : "ready";

    const payInterac = (): void => {
        run(
            async () => {
                setInterac(await pay.payInterac(token));
            },
            { errorMessage: strings.publicPay.interacStartError },
        );
    };
    const payCard = (): void => {
        run(
            async () => {
                setCard(await pay.payCard(token));
            },
            { errorMessage: strings.publicPay.cardStartError },
        );
    };

    return {
        status,
        invoice,
        methods: invoice !== null ? payMethods(invoice) : [],
        method,
        setMethod,
        interac,
        card,
        payInterac,
        payCard,
        markPaid: () => {
            setPaid(true);
        },
        busy,
        error,
        setError,
    };
}
