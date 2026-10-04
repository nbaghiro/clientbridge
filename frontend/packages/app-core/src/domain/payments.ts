import { useQuery } from "@powersync/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAsyncAction } from "../hooks/useAsyncAction";
import { strings } from "../strings";
import { formatMoney } from "../util/format";
import type { ApiLike } from "../util/api";
import type { CheckoutMethod } from "./checkout";
import { newIdempotencyKey } from "../util/primitives";
import type { Intent } from "../util/primitives";

export interface ConnectStatus {
    connected: boolean;
    charges_enabled: boolean;
    payouts_enabled: boolean;
    details_submitted: boolean;
    kyc_status: string;
    disabled_reason: string | null;
    currently_due: string[];
    past_due: string[];
    pending_verification: string[];
}

/** Provider's Stripe Connect status (REST). `null` = loading, `"error"` = the fetch failed.
 *  Bump `reloadKey` to refetch (e.g. after onboarding). */
export function useConnectStatus(api: ApiLike, reloadKey = 0): ConnectStatus | "error" | null {
    const [status, setStatus] = useState<ConnectStatus | "error" | null>(null);
    useEffect(() => {
        api.get<ConnectStatus>("/v1/connect/status")
            .then(setStatus)
            .catch(() => {
                setStatus("error");
            });
    }, [api, reloadKey]);
    return status;
}

export interface OnboardingLink {
    url: string;
    charges_enabled: boolean;
}

export function startOnboarding(api: ApiLike): Promise<OnboardingLink> {
    return api.post<OnboardingLink>("/v1/connect/onboard", {});
}

const REQUIREMENT_LABELS: Record<string, string> = {
    external_account: strings.payments.reqExternalAccount,
    "business_profile.url": strings.payments.reqBusinessWebsite,
    "business_profile.mcc": strings.payments.reqBusinessCategory,
    "business_profile.product_description": strings.payments.reqProductDescription,
    "individual.id_number": strings.payments.reqIdNumber,
    "individual.verification.document": strings.payments.reqPhotoId,
    "individual.verification.additional_document": strings.payments.reqProofOfAddress,
    "individual.address.line1": strings.payments.reqHomeAddress,
    "company.tax_id": strings.payments.reqBusinessNumber,
    "tos_acceptance.date": strings.payments.reqTosAcceptance,
};

/** Humanize a Stripe requirement key (e.g. `individual.dob.day`) into provider-facing copy. */
export function formatRequirement(key: string): string {
    const known = REQUIREMENT_LABELS[key];
    if (known !== undefined) return known;
    if (key.startsWith("individual.dob") || key.startsWith("person.dob"))
        return strings.payments.reqDateOfBirth;
    const tail = key.split(".").pop() ?? key;
    const words = tail.replace(/_/g, " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
}

export type ConnectPhase =
    | "loading"
    | "error"
    | "not_connected"
    | "in_progress"
    | "pending"
    | "restricted"
    | "enabled"
    | "disabled";

export interface ConnectOnboarding {
    phase: ConnectPhase;
    busy: boolean;
    error: string | null;
    headline: string;
    ctaLabel: string;
    showCta: boolean;
    requirements: string[];
    payoutsEnabled: boolean;
    connect: () => void;
    refresh: () => void;
}

const HEADLINES: Record<Exclude<ConnectPhase, "loading" | "error">, string> = {
    not_connected: strings.payments.headlineNotConnected,
    in_progress: strings.payments.headlineInProgress,
    pending: strings.payments.headlinePending,
    restricted: strings.payments.headlineRestricted,
    enabled: strings.payments.headlineEnabled,
    disabled: strings.payments.headlineDisabled,
};

function phaseOf(status: ConnectStatus): ConnectPhase {
    if (!status.connected) return "not_connected";
    switch (status.kyc_status) {
        case "pending":
        case "restricted":
        case "enabled":
        case "disabled":
            return status.kyc_status;
        default:
            return "in_progress"; // not_started, but the account exists
    }
}

/** Shared Stripe Connect onboarding view-model: the KYC phase, what Stripe still needs, the connect
 *  action, and error copy. `openUrl` is injected per platform (web `location.href`, mobile `Linking`). */
export function useConnectOnboarding(
    api: ApiLike,
    openUrl: (url: string) => void,
): ConnectOnboarding {
    const [reloadKey, setReloadKey] = useState(0);
    const status = useConnectStatus(api, reloadKey);
    const { busy, error, run } = useAsyncAction();

    const phase: ConnectPhase =
        status === null ? "loading" : status === "error" ? "error" : phaseOf(status);

    const requirements =
        status !== null && status !== "error"
            ? [...new Set([...status.currently_due, ...status.past_due].map(formatRequirement))]
            : [];

    const ctaLabel =
        phase === "restricted"
            ? strings.payments.finishVerification
            : phase === "in_progress"
              ? strings.payments.continueSetup
              : strings.payments.connectStripe;

    const showCta = phase === "not_connected" || phase === "in_progress" || phase === "restricted";
    const headline = phase === "loading" || phase === "error" ? "" : HEADLINES[phase];
    const payoutsEnabled = status !== null && status !== "error" && status.payouts_enabled;

    const connect = (): void => {
        run(
            async () => {
                const { url } = await startOnboarding(api);
                openUrl(url);
            },
            { errorMessage: strings.payments.onboardingStartError },
        );
    };

    const refresh = useCallback((): void => {
        setReloadKey((k) => k + 1);
    }, []);

    return {
        phase,
        busy,
        error,
        headline,
        ctaLabel,
        showCta,
        requirements,
        payoutsEnabled,
        connect,
        refresh,
    };
}

export function refundPayment(
    api: ApiLike,
    paymentId: string,
    amountCents: number,
    idempotencyKey: string,
): Promise<{ refund_id: string; status: string }> {
    return api.post<{ refund_id: string; status: string }>(
        `/v1/payments/${paymentId}/refund?amount_cents=${String(amountCents)}`,
        {},
        { idempotencyKey },
    );
}

export interface RefundForm {
    amount: string;
    setAmount: (amount: string) => void;
    remainingCents: number;
    busy: boolean;
    error: string | null;
    submit: () => void;
}

/** A refund of all or part of what's left on a payment; a blank amount refunds the rest. */
export function useRefundForm(
    api: ApiLike,
    payment: PaymentRow,
    allPayments: PaymentRow[],
): RefundForm {
    const [amount, setAmountState] = useState("");
    const { busy, error, setError, run } = useAsyncAction();
    const remainingCents = refundableCents(payment, allPayments);
    // One key per refund attempt, kept through retries so a timed-out refund isn't issued twice.
    const keyRef = useRef<string | null>(null);
    const setAmount = (next: string): void => {
        keyRef.current = null;
        setAmountState(next);
    };

    const submit = (): void => {
        const cents = amount.trim() === "" ? remainingCents : Math.round(Number(amount) * 100);
        if (!Number.isFinite(cents) || cents <= 0 || cents > remainingCents) {
            setError(strings.invoices.refundAmountInvalid);
            return;
        }
        keyRef.current ??= newIdempotencyKey();
        const key = keyRef.current;
        run(() => refundPayment(api, payment.id, cents, key), {
            onSuccess: () => {
                setAmount("");
            },
            errorMessage: strings.invoices.refundError,
        });
    };

    return { amount, setAmount, remainingCents, busy, error, submit };
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
}

export const INVOICE_PAYMENTS_SQL = `
SELECT id, kind, parent_payment_id, amount_cents, currency, status, method, created_at
FROM payments WHERE invoice_id = ? ORDER BY created_at`;

export function useInvoicePayments(invoiceId: string): PaymentRow[] {
    return useQuery<PaymentRow>(INVOICE_PAYMENTS_SQL, [invoiceId]).data;
}

/** A refund row (a negative entry against a prior payment), vs an original charge. */
export function isRefundRow(payment: { kind: string }): boolean {
    return payment.kind === "refund";
}

/** Refundable only once: a succeeded non-refund payment with no sibling refund yet (matches the
 *  backend's one-refund-per-payment 409 — so the button disappears after a refund posts). */
/** What's still refundable on a payment after the refunds already made against it. */
export function refundableCents(payment: PaymentRow, allPayments: PaymentRow[]): number {
    const refunded = allPayments
        .filter((p) => p.parent_payment_id === payment.id && p.status === "succeeded")
        .reduce((sum, p) => sum + p.amount_cents, 0);
    return payment.amount_cents - refunded;
}

export function refundPlaceholder(remainingCents: number): string {
    return strings.invoices.refundAmountPlaceholder(formatMoney(remainingCents));
}

export function isRefundable(payment: PaymentRow, allPayments: PaymentRow[]): boolean {
    return (
        payment.status === "succeeded" &&
        !isRefundRow(payment) &&
        refundableCents(payment, allPayments) > 0
    );
}

/** Only owners and admins may issue refunds (matches the backend's payment role gate). */
export function canManagePayments(role: string | null): boolean {
    return role === "owner" || role === "admin";
}

export function paymentStatusIntent(status: string): Intent {
    switch (status) {
        case "succeeded":
            return "success";
        case "pending":
            return "accent";
        case "failed":
        case "canceled":
            return "danger";
        default:
            return "neutral"; // refunded
    }
}

/** An invoice can be paid when it's been issued and still owes a balance. */
export function isPayable(row: { status: string; balance_cents: number | null }): boolean {
    return (
        row.status !== "draft" &&
        row.status !== "void" &&
        row.status !== "paid" &&
        (row.balance_cents ?? 0) > 0
    );
}

/** Public pay-page URL for an invoice token. `base` is the public-web origin each app supplies
 *  (web `window.location.origin`; mobile a configured URL). */
export function payLinkUrl(base: string, token: string): string {
    return `${base.replace(/\/+$/, "")}/pay/${token}`;
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
export function isChargeable(card: SavedCardRow): boolean {
    return card.method === "card" || (isMandate(card) && card.mandate_status === "active");
}

export function canBeDefault(card: SavedCardRow): boolean {
    return card.preferred !== 1 && isChargeable(card);
}

/** The saved methods a checkout can charge, labelled. */
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

/** The connected Stripe account id, read off the synced `businesses` row. The package/gift-card
 *  purchase responses return only a `client_secret`; the web Elements confirm needs the account to
 *  target the direct charge, so it reads it here (the saved-card/PublicPay seams get it inline). */
export function useStripeAccountId(): string | null {
    const rows = useQuery<{ stripe_account_id: string | null }>(STRIPE_ACCOUNT_SQL).data;
    return rows[0]?.stripe_account_id ?? null;
}

/** The business's Stripe Terminal Location (minted server-side on first POS use, then synced) —
 *  the POS reader connects under it. Null until the connection-token call has minted it. */
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
