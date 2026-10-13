import { useBusinessQuery as useQuery } from "../hooks";

import { useRef, useState } from "react";

import { useAsyncAction } from "../hooks";
import { strings } from "../strings";
import { dateKey, useBusinessZone } from "../datetime";
import {
    blankToNull,
    formatMoney,
    formatMoneyShort,
    parseCents,
    BUSINESS_CURRENCY,
} from "../format";
import { type ApiLike, type Attempt, attemptKey } from "../api";
import type { CheckoutMethod } from "./checkout";
import { expectArrival } from "./sync";
import type { Intent } from "../ui";

export function invoiceBalanceKey(invoiceId: string): string {
    return `invoice-balance:${invoiceId}`;
}

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
    method: string; // card | bank_eft
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
        : card.brand
          ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1)
          : strings.payments.cardNoun;
    return card.last4 !== null ? strings.payments.savedCardLabel(noun, card.last4) : noun;
}

/** A card, or a bank account with an active mandate. */
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

/** Package and gift card purchases return only a client secret; the web confirm needs the account. */
export function useStripeAccountId(): string | null {
    const rows = useQuery<{ stripe_account_id: string | null }>(STRIPE_ACCOUNT_SQL).data;
    return rows[0]?.stripe_account_id ?? null;
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
    etransfer: "etransfer",
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
    const zone = useBusinessZone();
    const today = (): string => dateKey(new Date(), zone);
    const [receivedOn, setReceivedOn] = useState(today);
    const [note, setNote] = useState("");
    const [sendReceipt, setSendReceipt] = useState(true);
    const [attempted, setAttempted] = useState(false);
    const [done, setDone] = useState<PaymentDone | null>(null);
    const { busy, error, setError, run } = useAsyncAction();
    const keyRef = useRef<Attempt | null>(null);
    const resetKey = (): void => {
        keyRef.current = null;
    };

    const balanceCents = target.balanceCents;
    const parsed = amountMode === "full" ? balanceCents : parseCents(amount, BUSINESS_CURRENCY);
    const validAmount = parsed !== null && parsed > 0;
    const amountCents = validAmount ? parsed : 0;
    const tenderedCents =
        method === "cash" && tendered.trim() !== ""
            ? parseCents(tendered, BUSINESS_CURRENCY)
            : null;
    const changeCents =
        tenderedCents !== null && tenderedCents > amountCents ? tenderedCents - amountCents : 0;
    const afterCents = Math.max(0, balanceCents - amountCents);
    const dated = method === "etransfer" || method === "cheque";
    const dateOk = !dated || (/^\d{4}-\d{2}-\d{2}$/.test(receivedOn) && receivedOn <= today());

    const amountError = !attempted
        ? null
        : !validAmount
          ? r.amountInvalid(formatMoneyShort(0, BUSINESS_CURRENCY))
          : amountCents > balanceCents
            ? r.amountTooHigh(formatMoney(balanceCents, BUSINESS_CURRENCY))
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
        const key = attemptKey(keyRef, [target.invoiceId, body]);
        run(
            async () => {
                const res = await api.post<{ status: string; balance_cents: number }>(
                    `/v1/invoices/${target.invoiceId}/payments`,
                    body,
                    { idempotencyKey: key },
                );
                keyRef.current = null;
                const before = target.balanceCents;
                expectArrival(
                    invoiceBalanceKey(target.invoiceId),
                    res.status === "pending"
                        ? (current) => current < before
                        : (current) => current <= res.balance_cents,
                );
                if (res.status === "pending") {
                    setDone({ title: r.cardTitle, lines: [r.cardBody], paidInFull: false });
                    return;
                }
                const lines = [
                    res.balance_cents === 0
                        ? r.donePaid(target.label)
                        : r.donePartial(
                              target.label,
                              formatMoney(res.balance_cents, BUSINESS_CURRENCY),
                          ),
                ];
                if (changeCents > 0)
                    lines.push(r.giveChange(formatMoney(changeCents, BUSINESS_CURRENCY)));
                if (body.send_receipt && target.clientEmail !== null)
                    lines.push(r.receiptSent(target.clientEmail));
                setDone({ title: r.doneTitle, lines, paidInFull: res.balance_cents === 0 });
            },
            { errorMessage: r.error },
        );
    };

    const charging = method === "saved_card";
    const money = formatMoney(amountCents, BUSINESS_CURRENCY);
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
