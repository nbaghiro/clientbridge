import { useState } from "react";

import { formatList, formatMoney, formatPercent, parseCents, BUSINESS_CURRENCY } from "../format";
import { useAsyncAction } from "../hooks";
import { strings } from "../strings";
import type { DocTotalLine, PrintedDoc, PrintedDocLine, PrintedDocTax } from "../ui";
import {
    discountReason,
    docReference,
    longDate,
    type PostalParts,
    printedDoc,
    publicAddressLines,
    shortDate,
    taxRateLabel,
} from "./printing";
import { type PublicBrand, usePublicResource } from "./publicResource";
import { failedCode, failureMessage, refusal } from "../api";
import type { IconName } from "../icons";

export interface PublicDocLine {
    description: string;
    quantity: number;
    unit_amount_cents: number;
    amount_cents: number;
    tax_codes: string[];
    discount_cents?: number;
    discount_reason?: string | null;
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
    address?: Partial<PostalParts>;
    phone?: string | null;
    currency: string;
    timezone: string;
    subtotal_cents: number;
    tax_total_cents: number;
    total_cents: number;
    balance_cents: number;
    status: string;
    accepts_card: boolean;
    contact_phone: string | null;
    contact_email: string | null;
    client_name: string | null;
    issued_at: string | null;
    due_at: string | null;
    notes: string | null;
    gst_hst_number: string | null;
    qst_number: string | null;
    lines: PublicDocLine[];
    discount_cents?: number;
    discount_reason?: string | null;
    taxes: PublicDocTax[];
    credits: PublicCredit[];
    tip_for?: string[];
    tip_base_cents?: number;
}

export function publicDocTaxes(taxes: readonly PublicDocTax[]): PrintedDocTax[] {
    return taxes.map((t) => ({
        code: t.code,
        label: taxRateLabel(t.code, t.rate_bps),
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
    const discount = invoice.discount_cents ?? 0;
    return [
        ...(discount > 0
            ? [
                  {
                      key: "discount",
                      label: strings.publicReceipt.discount,
                      cents: discount,
                      kind: "credit" as const,
                      hint: discountReason(invoice.discount_reason) ?? undefined,
                  },
              ]
            : []),
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
                          pp.method[c.method ?? "other"] ?? pp.method.other,
                          shortDate(c.at, invoice.timezone),
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
    const online = !paid && invoice.accepts_card;
    const number = invoice.number === null ? null : String(invoice.number);
    return printedDoc(
        {
            kind: "invoice",
            currency: invoice.currency,
            number,
            partyName: invoice.client_name ?? "",
            partyLines: [],
            meta: [
                { label: pr.invoiceNumber, value: docReference(number) },
                { label: pr.issued, value: longDate(invoice.issued_at, invoice.timezone) },
                { label: pr.due, value: longDate(invoice.due_at, invoice.timezone) },
            ],
            lines: publicDocLines(invoice.lines),
            taxes: publicDocTaxes(invoice.taxes),
            totals: publicInvoiceTotals(invoice),
            headline: { label: strings.publicPay.balanceDue, cents: invoice.balance_cents },
            stamp: paid ? pr.paidStamp : null,
            payUrl: online ? payUrl : null,
            instructions: online ? [pr.payOnline(payUrl)] : [],
            message: invoice.notes,
        },
        {
            name: invoice.business_name,
            avatarUrl: invoice.brand.logo_url,
            tagline: invoice.brand.tagline,
            brandColor: invoice.brand.primary,
            email: invoice.contact_email,
            gstHstNumber: invoice.gst_hst_number,
            qstNumber: invoice.qst_number,
            address: publicAddressLines(invoice.address),
            phone: invoice.phone ?? null,
        },
        fallbackColor,
    );
}

interface PublicCardIntent {
    client_secret: string;
    stripe_account_id: string;
    amount_cents: number;
}

interface PublicPayClient {
    getPublicInvoice: (token: string) => Promise<PublicInvoice>;
    payCard(token: string, balanceCents: number, tipCents: number): Promise<PublicCardIntent>;
}

export function createPublicPayClient(baseUrl: string): PublicPayClient {
    const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
        const res = await fetch(`${baseUrl}${path}`, init);
        if (!res.ok) {
            throw await refusal(res);
        }
        return (await res.json()) as T;
    };

    return {
        getPublicInvoice: (token) => request<PublicInvoice>(`/pay/${encodeURIComponent(token)}`),
        payCard: (token, balanceCents, tipCents) =>
            request<PublicCardIntent>(`/pay/${encodeURIComponent(token)}/card`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ balance_cents: balanceCents, tip_cents: tipCents }),
            }),
    };
}

interface ContactAction {
    key: string;
    icon: IconName;
    label: string;
    href: string;
}

/** How to reach a business that takes no payments online: the phone and email its page shows. */
function contactActions(invoice: PublicInvoice): ContactAction[] {
    const actions: ContactAction[] = [];
    if (invoice.contact_phone !== null)
        actions.push({
            key: "phone",
            icon: "phone",
            label: invoice.contact_phone,
            href: `tel:${invoice.contact_phone}`,
        });
    if (invoice.contact_email !== null)
        actions.push({
            key: "email",
            icon: "mail",
            label: invoice.contact_email,
            href: `mailto:${invoice.contact_email}`,
        });
    return actions;
}

type PublicPayStatus = "loading" | "not-found" | "error" | "ready" | "paid";

interface PublicPayForm {
    status: PublicPayStatus;
    invoice: PublicInvoice | null;
    online: boolean;
    contact: ContactAction[];
    card: PublicCardIntent | null;
    payCard: () => void;
    tip: PayLinkTip;
    markPaid: () => void;
    cancelCard: () => void;
    busy: boolean;
    error: string | null;
    setError: (message: string | null) => void;
}

export function usePublicPayForm(pay: PublicPayClient, token: string): PublicPayForm {
    const { status: load, data: invoice, retry } = usePublicResource(pay.getPublicInvoice, token);
    const [card, setCard] = useState<PublicCardIntent | null>(null);
    const [paid, setPaid] = useState(false);
    const { busy, error, setError, run } = useAsyncAction();

    const status: PublicPayStatus =
        load !== "ready" ? load : paid || invoice?.status === "paid" ? "paid" : "ready";

    const tip = usePayLinkTip(invoice);
    const payCard = (): void => {
        if (tip.error !== null || invoice === null) return;
        run(
            async () => {
                setCard(await pay.payCard(token, invoice.balance_cents, tip.cents));
            },
            {
                errorMessage: (e) => {
                    // the server charges only the balance this page showed, so show the new one
                    if (failedCode(e) === "invoice_changed") retry();
                    return failureMessage(e, strings.publicPay.cardStartError);
                },
            },
        );
    };

    return {
        status,
        invoice,
        online: invoice?.accepts_card === true,
        contact: invoice !== null ? contactActions(invoice) : [],
        card,
        payCard,
        tip,
        cancelCard: () => {
            setCard(null);
        },
        markPaid: () => {
            setPaid(true);
        },
        busy,
        error,
        setError,
    };
}

const TIP_PERCENTS = [15, 18, 20] as const;

interface PayLinkTip {
    available: boolean;
    title: string;
    note: string;
    key: string;
    options: { key: string; label: string; hint: string }[];
    choose: (key: string) => void;
    custom: string;
    setCustom: (v: string) => void;
    cents: number;
    totalCents: number;
    error: string | null;
}

/** The client's tip on a pay link: a share of the price before tax, never taxed itself. */
function usePayLinkTip(invoice: PublicInvoice | null): PayLinkTip {
    const pp = strings.publicPay;
    const [key, setKey] = useState("none");
    const [custom, setCustom] = useState("");
    const base = invoice?.tip_base_cents ?? invoice?.subtotal_cents ?? 0;
    const balance = invoice?.balance_cents ?? 0;
    const currency = invoice?.currency ?? BUSINESS_CURRENCY;
    const customCents = parseCents(custom, currency);
    const pct = TIP_PERCENTS.find((n) => String(n) === key);
    const cents =
        pct !== undefined
            ? Math.round((base * pct) / 100)
            : key === "custom"
              ? (customCents ?? 0)
              : 0;
    const error =
        key === "custom" && custom.trim() !== "" && customCents === null
            ? pp.tipInvalid
            : cents > balance
              ? pp.tipTooBig
              : null;
    const names = invoice?.tip_for ?? [];
    return {
        available: base > 0,
        title: pp.tipTitle(names.length === 0 ? pp.tipTeam : formatList(names)),
        note: pp.tipBase(formatMoney(base, currency)),
        key,
        options: [
            ...TIP_PERCENTS.map((n) => ({
                key: String(n),
                label: formatPercent(n / 100),
                hint: formatMoney(Math.round((base * n) / 100), currency),
            })),
            { key: "custom", label: pp.tipCustom, hint: pp.tipAmount },
            { key: "none", label: pp.tipNone, hint: formatMoney(0, currency) },
        ],
        choose: setKey,
        custom,
        setCustom: (v) => {
            setKey("custom");
            setCustom(v);
        },
        cents,
        totalCents: balance + cents,
        error,
    };
}
