import { useEffect, useState } from "react";

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
import { returnedPaid, type StripeReturn } from "./checkout";

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
    tip_cents: number;
    at: string | null;
}

interface PublicRefund {
    credit_note: string;
    amount_cents: number;
    paid_at: string | null;
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
    paying: boolean;
    clearing: boolean;
    paying_part: boolean;
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
    refunds: PublicRefund[];
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

/** What the client paid in all, the invoice and any tip they added on top. */
export function publicInvoicePaidCents(invoice: PublicInvoice): number {
    return invoice.total_cents + invoice.credits.reduce((sum, c) => sum + c.tip_cents, 0);
}

/** What the client reads under the lines: subtotal, tax per code, total, tip, payments and balance. */
export function publicInvoiceTotals(invoice: PublicInvoice): DocTotalLine[] {
    const pp = strings.publicPay;
    const discount = invoice.discount_cents ?? 0;
    const tip = invoice.credits.reduce((sum, c) => sum + c.tip_cents, 0);
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
        ...(tip > 0
            ? [{ key: "tip", label: pp.tipRow, cents: tip, kind: "subtotal" as const }]
            : []),
        ...invoice.credits.map((c, i): DocTotalLine => ({
            key: `credit-${String(i)}`,
            label:
                c.kind === "deposit"
                    ? pp.depositCredit
                    : pp.credit(
                          pp.method[c.method ?? "other"] ?? pp.method.other,
                          shortDate(c.at, invoice.timezone),
                      ),
            cents: c.amount_cents + c.tip_cents,
            kind: "credit",
        })),
        { key: "balance", label: pp.balanceDue, cents: invoice.balance_cents, kind: "balance" },
        ...invoice.refunds.map((r, i): DocTotalLine => ({
            key: `refund-${String(i)}`,
            label: pp.refundedOn(r.credit_note, shortDate(r.paid_at, invoice.timezone)),
            cents: r.amount_cents,
            kind: "subtotal",
        })),
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
            stamp: invoice.status === "refunded" ? pr.refundedStamp : paid ? pr.paidStamp : null,
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

type PublicPayStatus = "loading" | "not-found" | "error" | "ready" | "paid" | "paying-part";

interface PublicPayForm {
    status: PublicPayStatus;
    invoice: PublicInvoice | null;
    /** Voided or refunded: nothing is due, so the page offers no payment. */
    closed: boolean;
    closedBody: string;
    online: boolean;
    contact: ContactAction[];
    card: PublicCardIntent | null;
    payCard: () => void;
    tip: PayLinkTip;
    markPaid: () => void;
    cardCanceled: () => void;
    cancelCard: () => void;
    busy: boolean;
    error: string | null;
    setError: (message: string | null) => void;
}

/** The pay link; `returned` is Stripe's answer when a redirect payment sends the client back here. */
export function usePublicPayForm(
    pay: PublicPayClient,
    token: string,
    returnedNow: StripeReturn | null = null,
): PublicPayForm {
    const { status: load, data: invoice, retry } = usePublicResource(pay.getPublicInvoice, token);
    const [returned] = useState(returnedNow);
    const [card, setCard] = useState<PublicCardIntent | null>(null);
    // Stripe's event can land after the client is back, so its answer stands until then
    const [paid, setPaid] = useState(() => returnedPaid(returned));
    const { busy, error, setError, run } = useAsyncAction();
    useEffect(() => {
        if (returned?.status === "failed") setError(strings.checkout.paymentFailed);
    }, [returned, setError]);

    // a card payment Stripe took counts as paid before its event settles the invoice with us
    const settled = invoice?.status === "paid" || invoice?.paying === true;
    const status: PublicPayStatus =
        load !== "ready"
            ? load
            : paid || settled
              ? "paid"
              : invoice?.paying_part === true
                ? "paying-part"
                : "ready";

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
                    const code = failedCode(e);
                    if (code === "invoice_changed" || code === "payment_in_progress") retry();
                    return failureMessage(e, strings.publicPay.cardStartError);
                },
            },
        );
    };

    return {
        status,
        invoice,
        closed: invoice?.status === "void" || invoice?.status === "refunded",
        closedBody:
            invoice === null
                ? ""
                : invoice.status === "refunded"
                  ? strings.publicPay.refundedBody(invoice.business_name)
                  : strings.publicPay.closedBody(invoice.business_name),
        online: invoice?.accepts_card === true,
        contact: invoice !== null ? contactActions(invoice) : [],
        card,
        payCard,
        tip,
        cancelCard: () => {
            setCard(null);
        },
        cardCanceled: () => {
            setCard(null);
            setError(strings.publicPay.cardCanceled);
            retry();
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
    hint: string;
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
        hint: invoice?.taxes.length === 0 ? pp.tipHintNoTax : pp.tipHint,
        note:
            invoice?.taxes.length === 0
                ? pp.tipBaseNoTax(formatMoney(base, currency))
                : pp.tipBase(formatMoney(base, currency)),
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
