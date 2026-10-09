import { useBusinessQuery as useQuery } from "../hooks";

import { useRef, useState } from "react";

import { useAsyncAction } from "../hooks";
import { strings } from "../strings";
import { formatDate } from "../datetime";
import { blankToNull, formatMoney, formatPhone, parseCents } from "../format";
import { type ApiLike, newIdempotencyKey } from "../api";
import type { CheckoutMethod } from "./checkout";
import type { Intent } from "../ui";

export interface PaymentRow {
    id: string;
    kind: string;
    parent_payment_id: string | null;
    amount_cents: number;
    currency: string;
    status: string;
    method: string;
    created_at: string;
    paid_at: string | null;
    reference: string | null;
    note: string | null;
    tendered_cents: number | null;
}

export const INVOICE_PAYMENTS_SQL = `
SELECT id, kind, parent_payment_id, amount_cents, currency, status, method, created_at, paid_at,
       reference, note, tendered_cents
FROM payments WHERE invoice_id = ? ORDER BY created_at`;

export function useInvoicePayments(invoiceId: string): PaymentRow[] {
    return useQuery<PaymentRow>(INVOICE_PAYMENTS_SQL, [invoiceId]).data;
}

/** A refund row (a negative entry against a prior payment), vs an original charge. */
export function isRefundRow(payment: { kind: string }): boolean {
    return payment.kind === "refund";
}

/** Only owners and admins may issue refunds (matches the backend's payment role gate). */
export function canManagePayments(role: string | null): boolean {
    return role === "owner" || role === "admin";
}

/** `base` is the one pay host (pay.clientbridge.ca in production) each app is configured with. */
export function payLinkUrl(base: string, token: string): string {
    return `${base.replace(/\/+$/, "")}/i/${token}`;
}

/** Credit notes are numbered after the invoice or sale they credit, from 1: CN-1143-1, CN-S-1044-1. */
export function creditNoteNumber(docNumber: string | number, n: number): string {
    return `CN-${String(docNumber)}-${String(n)}`;
}

export interface SavedCardRow {
    id: string;
    client_id: string;
    method: string; // card | bank_eft | interac
    brand: string | null;
    last4: string | null;
    preferred: number; // SQLite boolean → 0/1
    mandate_status: string;
    status: string;
}

export const SAVED_CARDS_SQL = `
SELECT id, client_id, method, brand, last4, preferred, mandate_status, status
FROM payment_methods
WHERE client_id = ? AND status = 'active'
ORDER BY preferred DESC, created_at`;

/** A client's active saved payment methods (cards + bank/PAD mandates), default first. */
export function useSavedCards(clientId: string): SavedCardRow[] {
    return useQuery<SavedCardRow>(SAVED_CARDS_SQL, [clientId]).data;
}

/** A bank/EFT pre-authorized-debit mandate, vs a saved card. */
export function isMandate(card: SavedCardRow): boolean {
    return card.method === "bank_eft";
}

/** "Visa ···· 4242" for a card, "Bank account ···· 6789" for a PAD mandate. */
export function savedCardLabel(card: SavedCardRow): string {
    const noun = isMandate(card)
        ? strings.payments.bankAccountNoun
        : card.method === "interac"
          ? strings.payments.interacNoun
          : card.brand
            ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1)
            : strings.payments.cardNoun;
    return card.last4 !== null ? strings.payments.savedCardLabel(noun, card.last4) : noun;
}

/** A card, or a bank account with an active mandate; an Interac contact can't be charged. */
function isChargeable(card: SavedCardRow): boolean {
    return card.method === "card" || (isMandate(card) && card.mandate_status === "active");
}

export function canBeDefault(card: SavedCardRow): boolean {
    return card.preferred !== 1 && isChargeable(card);
}

export function checkoutMethods(cards: SavedCardRow[]): CheckoutMethod[] {
    return cards.filter(isChargeable).map((c) => ({ id: c.id, label: savedCardLabel(c) }));
}

export function mandateStatusIntent(status: string): Intent {
    switch (status) {
        case "active":
            return "success";
        case "pending":
            return "warning";
        case "revoked":
            return "danger";
        default:
            return "neutral";
    }
}

export const STRIPE_ACCOUNT_SQL =
    "SELECT stripe_account_id FROM businesses WHERE stripe_account_id IS NOT NULL LIMIT 1";

export const TERMINAL_LOCATION_SQL =
    "SELECT stripe_terminal_location_id FROM businesses WHERE stripe_terminal_location_id IS NOT NULL LIMIT 1";

/** Package and gift card purchases return only a client secret; the web confirm needs the account. */
export function useStripeAccountId(): string | null {
    const rows = useQuery<{ stripe_account_id: string | null }>(STRIPE_ACCOUNT_SQL).data;
    return rows[0]?.stripe_account_id ?? null;
}

/** Null until the first connection-token call mints the location. */
export function useStripeTerminalLocation(): string | null {
    const rows = useQuery<{ stripe_terminal_location_id: string | null }>(
        TERMINAL_LOCATION_SQL,
    ).data;
    return rows[0]?.stripe_terminal_location_id ?? null;
}

export function detachCard(api: ApiLike, id: string): Promise<{ detached: boolean }> {
    return api.delete<{ detached: boolean }>(`/v1/payments/methods/${id}`);
}

export function setDefaultCard(api: ApiLike, id: string): Promise<{ id: string }> {
    return api.post<{ id: string }>(`/v1/payments/methods/${id}/default`, {});
}

export type TenderKey = "saved_card" | "reader" | "cash" | "etransfer" | "cheque";

const TENDER_METHOD: Record<Exclude<TenderKey, "reader">, string> = {
    saved_card: "card",
    cash: "cash",
    etransfer: "interac",
    cheque: "cheque",
};

interface TenderOption {
    key: TenderKey;
    label: string;
    hint: string;
    disabled?: boolean;
}

interface RecordTarget {
    invoiceId: string;
    label: string;
    clientId: string;
    clientEmail: string | null;
    balanceCents: number;
}

interface PaymentDone {
    title: string;
    lines: string[];
    paidInFull: boolean;
}

interface PaymentRecorder {
    methods: TenderOption[];
    method: TenderKey;
    setMethod: (k: TenderKey) => void;
    amountMode: "full" | "part";
    setAmountMode: (m: "full" | "part") => void;
    amount: string;
    setAmount: (v: string) => void;
    balanceCents: number;
    tendered: string;
    setTendered: (v: string) => void;
    changeCents: number;
    reference: string;
    setReference: (v: string) => void;
    receivedOn: string;
    setReceivedOn: (v: string) => void;
    note: string;
    setNote: (v: string) => void;
    sendReceipt: boolean;
    setSendReceipt: (v: boolean) => void;
    receiptTo: string | null;
    amountCents: number;
    afterCents: number;
    resultLabel: string;
    amountError: string | null;
    tenderedError: string | null;
    dateError: string | null;
    submitLabel: string;
    busy: boolean;
    error: string | null;
    submit: () => void;
    done: PaymentDone | null;
    reset: () => void;
}

const today = (): string => {
    const d = new Date();
    const pad = (n: number): string => String(n).padStart(2, "0");
    return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** One payment on an invoice, method first: cash with change, an e-Transfer or cheque received, or a saved card. */
export function usePaymentRecorder(api: ApiLike, target: RecordTarget): PaymentRecorder {
    const r = strings.billing.rec;
    const cards = checkoutMethods(useSavedCards(target.clientId));
    const card = cards[0] ?? null;
    const methods: TenderOption[] = [
        card !== null
            ? { key: "saved_card", label: card.label, hint: r.savedCardHint }
            : { key: "saved_card", label: r.noSavedCard, hint: r.noSavedCardHint, disabled: true },
        { key: "reader", label: r.reader, hint: r.readerHint, disabled: true },
        { key: "cash", label: r.cash, hint: r.cashHint },
        { key: "etransfer", label: r.etransfer, hint: r.etransferHint },
        { key: "cheque", label: r.cheque, hint: r.chequeHint },
    ];
    const [method, setMethodState] = useState<TenderKey>("cash");
    const [amountMode, setAmountModeState] = useState<"full" | "part">("full");
    const [amount, setAmountState] = useState("");
    const [tendered, setTendered] = useState("");
    const [reference, setReference] = useState("");
    const [receivedOn, setReceivedOn] = useState(today);
    const [note, setNote] = useState("");
    const [sendReceipt, setSendReceipt] = useState(true);
    const [attempted, setAttempted] = useState(false);
    const [done, setDone] = useState<PaymentDone | null>(null);
    const { busy, error, setError, run } = useAsyncAction();
    const keyRef = useRef<string | null>(null);
    const resetKey = (): void => {
        keyRef.current = null;
    };

    const balanceCents = target.balanceCents;
    const parsed = amountMode === "full" ? balanceCents : parseCents(amount);
    const validAmount = parsed !== null && parsed > 0;
    const amountCents = validAmount ? parsed : 0;
    const tenderedCents = method === "cash" && tendered.trim() !== "" ? parseCents(tendered) : null;
    const changeCents =
        tenderedCents !== null && tenderedCents > amountCents ? tenderedCents - amountCents : 0;
    const afterCents = Math.max(0, balanceCents - amountCents);
    const dated = method === "etransfer" || method === "cheque";
    const dateOk = !dated || (/^\d{4}-\d{2}-\d{2}$/.test(receivedOn) && receivedOn <= today());

    const amountError = !attempted
        ? null
        : !validAmount
          ? r.amountInvalid
          : amountCents > balanceCents
            ? r.amountTooHigh(formatMoney(balanceCents))
            : null;
    const tenderedError =
        attempted &&
        tendered.trim() !== "" &&
        (tenderedCents === null || tenderedCents < amountCents)
            ? r.tenderedShort
            : null;
    const dateError = attempted && !dateOk ? r.dateInvalid : null;

    const submit = (): void => {
        setAttempted(true);
        if (!validAmount || amountCents > balanceCents || !dateOk) return;
        if (tendered.trim() !== "" && (tenderedCents === null || tenderedCents < amountCents))
            return;
        if (method === "reader" || (method === "saved_card" && card === null)) return;
        keyRef.current ??= newIdempotencyKey();
        const key = keyRef.current;
        const body = {
            method: TENDER_METHOD[method],
            amount_cents: amountCents,
            tendered_cents: tenderedCents,
            reference: blankToNull(reference),
            received_on: dated ? receivedOn : null,
            note: blankToNull(note),
            payment_method_id: method === "saved_card" ? card?.id : null,
            send_receipt: sendReceipt && target.clientEmail !== null,
        };
        run(
            async () => {
                const res = await api.post<{ status: string; balance_cents: number }>(
                    `/v1/invoices/${target.invoiceId}/payments`,
                    body,
                    { idempotencyKey: key },
                );
                keyRef.current = null;
                if (res.status === "pending") {
                    setDone({ title: r.cardTitle, lines: [r.cardBody], paidInFull: false });
                    return;
                }
                const lines = [
                    res.balance_cents === 0
                        ? r.donePaid(target.label)
                        : r.donePartial(target.label, formatMoney(res.balance_cents)),
                ];
                if (changeCents > 0) lines.push(r.giveChange(formatMoney(changeCents)));
                if (body.send_receipt && target.clientEmail !== null)
                    lines.push(r.receiptSent(target.clientEmail));
                setDone({ title: r.doneTitle, lines, paidInFull: res.balance_cents === 0 });
            },
            { errorMessage: r.error },
        );
    };

    const charging = method === "saved_card";
    const money = formatMoney(amountCents);
    return {
        methods,
        method,
        setMethod: (k) => {
            resetKey();
            setError(null);
            setMethodState(k);
        },
        amountMode,
        setAmountMode: (m) => {
            resetKey();
            setAmountModeState(m);
        },
        amount,
        setAmount: (v) => {
            resetKey();
            setAmountState(v);
        },
        balanceCents,
        tendered,
        setTendered,
        changeCents,
        reference,
        setReference: (v) => {
            resetKey();
            setReference(v);
        },
        receivedOn,
        setReceivedOn,
        note,
        setNote,
        sendReceipt,
        setSendReceipt,
        receiptTo: target.clientEmail,
        amountCents,
        afterCents,
        resultLabel: afterCents === 0 ? r.resultPaid : r.resultPartial,
        amountError,
        tenderedError,
        dateError,
        submitLabel: busy
            ? charging
                ? r.charging
                : r.recording
            : charging
              ? r.charge(money)
              : r.record(money),
        busy,
        error,
        submit,
        done,
        reset: () => {
            resetKey();
            setDone(null);
            setAttempted(false);
            setAmountModeState("full");
            setAmountState("");
            setTendered("");
            setReference("");
            setNote("");
        },
    };
}

interface InteracRequestRow {
    id: string;
    reference_code: string | null;
    amount_cents: number;
    status: string;
    channel: string | null;
    expires_at: string | null;
    created_at: string;
    paid_at: string | null;
}

export const INVOICE_INTERAC_SQL = `
SELECT id, reference_code, amount_cents, status, channel, expires_at, created_at, paid_at
FROM payments WHERE invoice_id = ? AND provider = 'interac' AND kind != 'refund'
ORDER BY created_at`;

type InteracChannel = "sms" | "email";
type InteracExpiry = "7" | "14" | "30";

interface InteracInvoice {
    id: string;
    number: number | null;
    client_name: string | null;
    client_email: string | null;
    client_phone: string | null;
    total_cents: number | null;
    balance_cents: number | null;
    due_at: string | null;
    pay_token: string | null;
}

interface InteracSender {
    name: string;
    email: string | null;
}

interface InteracRequestForm {
    title: string;
    facts: { label: string; value: string }[];
    amount: string;
    setAmount: (v: string) => void;
    amountHint: string;
    channel: InteracChannel;
    setChannel: (c: InteracChannel) => void;
    channels: { key: InteracChannel; label: string; disabled?: boolean }[];
    to: string;
    expiry: InteracExpiry;
    setExpiry: (e: InteracExpiry) => void;
    expiries: { key: InteracExpiry; label: string }[];
    preview: string;
    replaces: string | null;
    history: { key: string; label: string; detail: string; at: string; intent: Intent }[];
    busy: boolean;
    error: string | null;
    sent: string | null;
    submit: () => void;
}

function requestState(r: InteracRequestRow, now: number): string {
    if (r.status === "pending" && r.expires_at !== null && Date.parse(r.expires_at) <= now)
        return "expired";
    return r.status;
}

/** Ask for an e-Transfer from an invoice; a new request cancels the code still waiting. */
export function useInteracRequestForm(
    api: ApiLike,
    invoice: InteracInvoice,
    sender: InteracSender,
    payBase: string,
): InteracRequestForm {
    const t = strings.payments.interac;
    const rows = useQuery<InteracRequestRow>(INVOICE_INTERAC_SQL, [invoice.id]).data;
    const balance = invoice.balance_cents ?? 0;
    const [amount, setAmountState] = useState((balance / 100).toFixed(2));
    const hasPhone = (invoice.client_phone ?? "") !== "";
    const hasEmail = (invoice.client_email ?? "") !== "";
    const [channel, setChannelState] = useState<InteracChannel>(hasPhone ? "sms" : "email");
    const [expiry, setExpiry] = useState<InteracExpiry>("14");
    const [sent, setSent] = useState<string | null>(null);
    const { busy, error, setError, run } = useAsyncAction();
    const keyRef = useRef<string | null>(null);
    const now = Date.now();
    const waiting = rows.find((r) => requestState(r, now) === "pending") ?? null;
    const cents = parseCents(amount);
    const to =
        channel === "sms"
            ? hasPhone
                ? formatPhone(invoice.client_phone)
                : ""
            : (invoice.client_email ?? "");
    const label = strings.refunds.subject.invoice(invoice.number ?? 0);

    const submit = (): void => {
        if (cents === null || cents <= 0 || cents > balance) {
            setError(t.errAmount(formatMoney(balance)));
            return;
        }
        if (to === "") {
            setError(t.errContact);
            return;
        }
        keyRef.current ??= newIdempotencyKey();
        const key = keyRef.current;
        const body = { amount_cents: cents, channel, expires_in_days: Number(expiry) };
        run(
            () =>
                api.post(`/v1/invoices/${invoice.id}/interac-request`, body, {
                    idempotencyKey: key,
                }),
            {
                onSuccess: () => {
                    keyRef.current = null;
                    setSent(t.sent(to));
                },
                errorMessage: t.requestError,
            },
        );
    };

    return {
        title: t.requestFor(label, invoice.client_name ?? ""),
        facts: [
            { label: t.facts.total, value: formatMoney(invoice.total_cents) },
            { label: t.facts.paid, value: formatMoney((invoice.total_cents ?? 0) - balance) },
            { label: t.facts.balance, value: formatMoney(balance) },
            {
                label: t.facts.due,
                value: invoice.due_at === null ? "" : formatDate(new Date(invoice.due_at)),
            },
        ],
        amount,
        setAmount: (v) => {
            keyRef.current = null;
            setSent(null);
            setAmountState(v);
        },
        amountHint: t.amountHint(formatMoney(balance)),
        channel,
        setChannel: (c) => {
            keyRef.current = null;
            setSent(null);
            setChannelState(c);
        },
        channels: [
            { key: "sms", label: t.channels.sms ?? "sms", disabled: !hasPhone },
            { key: "email", label: t.channels.email ?? "email", disabled: !hasEmail },
        ],
        to: to === "" ? (channel === "sms" ? t.noPhone : t.noEmail) : to,
        expiry,
        setExpiry: (e) => {
            keyRef.current = null;
            setExpiry(e);
        },
        expiries: (["7", "14", "30"] as const).map((k) => ({
            key: k,
            label: t.expiryOptions[k] ?? k,
        })),
        preview: t.previewMessage(
            sender.name,
            formatMoney(cents ?? balance),
            sender.email ?? t.noPayEmail,
            t.newCode,
            invoice.pay_token === null ? "" : payLinkUrl(payBase, invoice.pay_token),
        ),
        replaces:
            waiting?.reference_code !== undefined && waiting.reference_code !== null
                ? t.replacesOld(waiting.reference_code)
                : null,
        history: rows.map((r) => {
            const state = requestState(r, now);
            return {
                key: r.id,
                label:
                    state === "succeeded"
                        ? t.received(formatMoney(r.amount_cents))
                        : t.requested(r.reference_code ?? "", formatMoney(r.amount_cents)),
                detail: [
                    t.state[state] ?? state,
                    t.sentVia(r.channel),
                    r.expires_at !== null && state === "pending"
                        ? t.expiresOn(formatDate(new Date(r.expires_at)))
                        : "",
                ]
                    .filter(Boolean)
                    .join(" · "),
                at: formatDate(new Date(r.paid_at ?? r.created_at)),
                intent: (state === "succeeded"
                    ? "success"
                    : state === "pending"
                      ? "accent"
                      : "neutral") satisfies Intent,
            };
        }),
        busy,
        error,
        sent,
        submit,
    };
}
