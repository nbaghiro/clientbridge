import { useEffect, useRef, useState } from "react";

import { formatDate } from "../datetime";
import { formatMoney, parseCents } from "../format";
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
    discount_cents?: number;
    discount_reason?: string | null;
    taxes: PublicDocTax[];
    credits: PublicCredit[];
    interac?: PublicInteracRequest | null;
    tip_for?: string[];
}

interface PublicInteracRequest {
    reference_code: string;
    amount_cents: number;
    send_to: string | null;
    expires_at: string | null;
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
    const discount = invoice.discount_cents ?? 0;
    return [
        ...(discount > 0
            ? [
                  {
                      key: "discount",
                      label: strings.publicReceipt.discount,
                      cents: discount,
                      kind: "credit" as const,
                      hint: invoice.discount_reason ?? undefined,
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
    expires_at?: string | null;
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
    payCard(token: string, tipCents?: number): Promise<PublicCardIntent>;
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
        payCard: (token, tipCents = 0) =>
            request<PublicCardIntent>(`/pay/${encodeURIComponent(token)}/card`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tip_cents: tipCents }),
            }),
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
    tip: PayLinkTip;
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
    const tip = usePayLinkTip(invoice);
    const payCard = (): void => {
        if (tip.error !== null) return;
        run(
            async () => {
                setCard(await pay.payCard(token, tip.cents));
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
        tip,
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
    const base = invoice?.subtotal_cents ?? 0;
    const balance = invoice?.balance_cents ?? 0;
    const customCents = parseCents(custom);
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
        title: pp.tipTitle(names.length === 0 ? pp.tipTeam : names.join(" and ")),
        note: pp.tipBase(formatMoney(base)),
        key,
        options: [
            ...TIP_PERCENTS.map((n) => ({
                key: String(n),
                label: `${String(n)}%`,
                hint: formatMoney(Math.round((base * n) / 100)),
            })),
            { key: "custom", label: pp.tipCustom, hint: pp.tipAmount },
            { key: "none", label: pp.tipNone, hint: formatMoney(0) },
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

const POLL_MS = 10_000;

interface InteracStep {
    text: string;
    copy: { key: string; label: string; value: string; code: boolean } | null;
}

interface PublicInterac {
    status: PublicPayStatus;
    invoice: PublicInvoice | null;
    paidCents: number;
    amount: string;
    reference: string;
    steps: InteracStep[];
    done: number[];
    toggleStep: (i: number) => void;
    progress: string;
    copied: string | null;
    copy: (key: string) => void;
    validUntil: string | null;
    error: string | null;
}

/** The e-Transfer steps for a pay link: the waiting request (or a new one), checked every few seconds. */
export function usePublicInterac(pay: PublicPayClient, token: string): PublicInterac {
    const pp = strings.publicPay;
    const { status: load, data: invoice, setData } = usePublicResource(pay.getPublicInvoice, token);
    const [request, setRequest] = useState<PublicInteracRequest | null>(null);
    const [done, setDone] = useState<number[]>([]);
    const [copied, setCopied] = useState<string | null>(null);
    const { error, run } = useAsyncAction();
    const asked = useRef(false);
    const waiting = invoice?.interac ?? request;
    const paid = invoice?.status === "paid";

    useEffect(() => {
        if (load !== "ready" || paid || waiting !== null || asked.current) return;
        asked.current = true;
        run(
            async () => {
                const made = await pay.payInterac(token);
                setRequest({
                    reference_code: made.reference_code,
                    amount_cents: made.amount_cents,
                    send_to: made.send_to,
                    expires_at: made.expires_at ?? null,
                });
            },
            { errorMessage: pp.interacStartError },
        );
    }, [load, paid, waiting, pay, token, run, pp.interacStartError]);

    useEffect(() => {
        if (load !== "ready" || paid) return;
        const timer = setInterval(() => {
            pay.getPublicInvoice(token)
                .then(setData)
                .catch(() => undefined);
        }, POLL_MS);
        return () => {
            clearInterval(timer);
        };
    }, [load, paid, pay, token, setData]);

    const amount = formatMoney(waiting?.amount_cents ?? invoice?.balance_cents ?? 0);
    const reference = waiting?.reference_code ?? "";
    const email = waiting?.send_to ?? invoice?.interac_email ?? null;
    const steps: InteracStep[] = [
        { text: pp.step1, copy: null },
        {
            text: email === null ? pp.step2NoEmail : pp.step2(email),
            copy:
                email === null
                    ? null
                    : { key: "email", label: pp.sendTo, value: email, code: false },
        },
        {
            text: pp.step3(amount),
            copy: { key: "amount", label: pp.amountToSend, value: amount, code: false },
        },
        {
            text: pp.step4(reference),
            copy: { key: "ref", label: pp.putInMessage, value: reference, code: true },
        },
    ];
    const status: PublicPayStatus = load !== "ready" ? load : paid ? "paid" : "ready";
    return {
        status,
        invoice,
        paidCents: invoice === null ? 0 : invoice.total_cents - invoice.balance_cents,
        amount,
        reference,
        steps,
        done,
        toggleStep: (i) => {
            setDone((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i]));
        },
        progress: pp.progressLabel(done.length, steps.length),
        copied,
        copy: setCopied,
        validUntil:
            waiting?.expires_at === null || waiting?.expires_at === undefined
                ? null
                : pp.validUntil(formatDate(new Date(waiting.expires_at))),
        error,
    };
}
