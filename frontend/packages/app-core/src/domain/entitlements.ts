import { useBusinessQuery as useQuery } from "../hooks";

import { useMemo, useRef, useState } from "react";

import { type Load, useAsyncAction } from "../hooks";
import { type ApiLike, newIdempotencyKey } from "../api";
import { formatDate, formatMonthDay } from "../datetime";
import { blankToNull, formatMoney, formatPhone, parseCents } from "../format";
import type { IconName } from "../icons";
import type { DocTotalLine, Intent, TimelineEntry } from "../ui";
import { strings } from "../strings";
import { docRates, priceDoc } from "./billing";
import {
    giftAmounts,
    giftItems,
    packageOfferings,
    subscriptionPlans,
    useCatalogItems,
} from "./catalog";
import { type Checkout, type CheckoutMethod, NEW_CARD, useCheckout } from "./checkout";
import { useClients } from "./clients";
import { ownedLiabilitySql, sessionsUsedSql } from "./ledger";
import { checkoutMethods, useSavedCards } from "./payments";
import { useReplicaLoad } from "./sync";
import { useTaxSetup } from "./taxes";

export interface PackageRow {
    id: string;
    client_id: string;
    item_id: string;
    item_name: string | null;
    sessions_total: number;
    sessions_used: number;
    status: string;
}

export const CLIENT_PACKAGES_SQL = `
SELECT p.id, p.client_id, p.item_id, i.name AS item_name,
       p.sessions_total, ${sessionsUsedSql("p.id")} AS sessions_used, p.status
FROM packages p LEFT JOIN items i ON i.id = p.item_id
WHERE p.client_id = ? ORDER BY p.created_at DESC`;

export function useClientPackages(clientId: string): PackageRow[] {
    return useQuery<PackageRow>(CLIENT_PACKAGES_SQL, [clientId]).data;
}

export function packageStatusIntent(status: string): Intent {
    switch (status) {
        case "active":
            return "success";
        case "pending":
            return "accent";
        case "expired":
            return "danger";
        default:
            return "neutral"; // used, canceled
    }
}

export function sessionsRemaining(pkg: PackageRow): number {
    return Math.max(0, pkg.sessions_total - pkg.sessions_used);
}

/** A session can be drawn down only from an active package with sessions left. */
export function canConsume(pkg: PackageRow): boolean {
    return pkg.status === "active" && pkg.sessions_used < pkg.sessions_total;
}

export function consumeSession(api: ApiLike, packageId: string): Promise<PackageRow> {
    return api.post<PackageRow>(`/v1/packages/${packageId}/consume`, {});
}

export interface SubscriptionRow {
    id: string;
    client_id: string;
    item_id: string;
    item_name: string | null;
    status: string;
    current_period_start: string | null;
    current_period_end: string | null;
    payment_method_id: string | null;
}

export const CLIENT_SUBSCRIPTIONS_SQL = `
SELECT s.id, s.client_id, s.item_id, i.name AS item_name, s.status,
       s.current_period_start, s.current_period_end, s.payment_method_id
FROM subscriptions s LEFT JOIN items i ON i.id = s.item_id
WHERE s.client_id = ? ORDER BY s.created_at DESC`;

export function useClientSubscriptions(clientId: string): SubscriptionRow[] {
    return useQuery<SubscriptionRow>(CLIENT_SUBSCRIPTIONS_SQL, [clientId]).data;
}

export function subscriptionStatusIntent(status: string): Intent {
    switch (status) {
        case "active":
            return "success";
        case "past_due":
            return "danger";
        case "paused":
            return "warning";
        default:
            return "neutral"; // canceled
    }
}

/** Live (still-billing) subscriptions can be canceled; a canceled one is terminal. */
export function isCancelable(status: string): boolean {
    return status !== "canceled";
}

export function cancelSubscription(
    api: ApiLike,
    id: string,
): Promise<{ id: string; status: string }> {
    return api.post<{ id: string; status: string }>(`/v1/subscriptions/${id}/cancel`, {});
}

interface GiftCardRedeemResult {
    id: string;
    code: string;
    initial_cents: number;
    balance_cents: number;
    status: string;
}

function redeemGiftCard(
    api: ApiLike,
    input: { code: string; amount_cents: number },
    idempotencyKey: string,
): Promise<GiftCardRedeemResult> {
    return api.post<GiftCardRedeemResult>("/v1/gift-cards/redeem", input, { idempotencyKey });
}

interface GiftCardRedeemForm {
    code: string;
    setCode: (v: string) => void;
    amount: string;
    setAmount: (v: string) => void;
    busy: boolean;
    error: string | null;
    submit: () => void;
}

export function useGiftCardRedeemForm(api: ApiLike, onDone: () => void): GiftCardRedeemForm {
    const [code, setCodeState] = useState("");
    const [amount, setAmountState] = useState("");
    const { busy, error, setError, run } = useAsyncAction();
    // One key per redeem attempt, kept through retries so a timed-out redeem isn't drawn twice.
    const keyRef = useRef<string | null>(null);
    const setCode = (v: string): void => {
        keyRef.current = null;
        setCodeState(v);
    };
    const setAmount = (v: string): void => {
        keyRef.current = null;
        setAmountState(v);
    };

    const submit = (): void => {
        if (code.trim() === "") {
            setError(strings.entitlements.giftCards.enterCode);
            return;
        }
        const cents = Math.round(Number(amount) * 100);
        if (!Number.isFinite(cents) || cents <= 0) {
            setError(strings.entitlements.giftCards.enterRedeemAmount);
            return;
        }
        keyRef.current ??= newIdempotencyKey();
        const key = keyRef.current;
        const input = { code: code.trim().toUpperCase(), amount_cents: cents };
        run(() => redeemGiftCard(api, input, key), {
            onSuccess: () => {
                setCode("");
                setAmount("");
                onDone();
            },
            errorMessage: strings.entitlements.giftCards.redeemError,
        });
    };

    return { code, setCode, amount, setAmount, busy, error, submit };
}

const w = strings.entitlements;

export type WalletKind = "package" | "membership" | "gift_card";

export const WALLET_HOLDERS_SQL = `
SELECT c.id, c.name FROM clients c
WHERE c.id IN (SELECT client_id FROM packages
               UNION SELECT client_id FROM subscriptions
               UNION SELECT purchaser_client_id FROM gift_cards
                     WHERE purchaser_client_id IS NOT NULL)
ORDER BY c.name COLLATE NOCASE`;

export const WALLET_CLIENT_SQL = `
SELECT c.id, c.name, c.email, c.phone FROM clients c WHERE c.id = ?`;

export const WALLET_SQL = `
SELECT 'package' AS kind, p.id, i.name AS item_name, p.status, p.sessions_total,
       ${sessionsUsedSql("p.id")} AS sessions_used, p.expires_at, NULL AS code,
       NULL AS recipient, i.price_cents AS price_cents,
       ${ownedLiabilitySql("package", "deferred", "p.id")} AS balance_cents,
       NULL AS period_end, NULL AS method_brand, NULL AS method_last4, p.payment_id,
       pay.amount_cents AS paid_cents, p.created_at AS created_at
FROM packages p LEFT JOIN items i ON i.id = p.item_id
LEFT JOIN payments pay ON pay.id = p.payment_id
WHERE p.client_id = ?1
UNION ALL
SELECT 'membership', s.id, i.name, s.status, NULL, NULL, NULL, NULL, NULL, i.price_cents, NULL,
       s.current_period_end, pm.brand, pm.last4, NULL, NULL, s.created_at
FROM subscriptions s LEFT JOIN items i ON i.id = s.item_id
LEFT JOIN payment_methods pm ON pm.id = s.payment_method_id
WHERE s.client_id = ?1
UNION ALL
SELECT 'gift_card', g.id, NULL, g.status, NULL, NULL, g.expires_at, g.code, g.recipient,
       g.initial_cents, ${ownedLiabilitySql("gift_card", "gift_card", "g.id")}, NULL, NULL, NULL,
       g.payment_id, pay.amount_cents, g.created_at
FROM gift_cards g LEFT JOIN payments pay ON pay.id = g.payment_id
WHERE g.purchaser_client_id = ?1
ORDER BY created_at DESC`;

interface WalletRow {
    kind: WalletKind;
    id: string;
    item_name: string | null;
    status: string;
    sessions_total: number | null;
    sessions_used: number | null;
    expires_at: string | null;
    code: string | null;
    recipient: string | null;
    price_cents: number | null;
    balance_cents: number | null;
    period_end: string | null;
    method_brand: string | null;
    method_last4: string | null;
    payment_id: string | null;
    paid_cents: number | null;
    created_at: string;
}

export const ENTITLEMENT_ICON: Record<WalletKind, IconName> = {
    package: "box",
    membership: "refresh",
    gift_card: "tag",
};

function walletStatus(r: WalletRow): string {
    if (r.kind === "gift_card" && r.status === "active" && (r.balance_cents ?? 0) <= 0)
        return "redeemed";
    return r.status;
}

function entitlementIntent(status: string): Intent {
    switch (status) {
        case "active":
            return "success";
        case "pending":
        case "paused":
            return "accent";
        case "past_due":
            return "danger";
        case "expired":
            return "warning";
        default:
            return "neutral";
    }
}

export interface EntitlementSummary {
    row: WalletRow;
    title: string;
    kindLabel: string;
    status: string;
    statusLabel: string;
    intent: Intent;
    balanceLabel: string;
    meter: { value: number; max: number; units: boolean; detail: string } | null;
    valueCents: number;
    note: string | null;
}

const day = (iso: string): string => formatDate(new Date(iso));

function summarizeEntitlement(r: WalletRow): EntitlementSummary {
    const status = walletStatus(r);
    const base = {
        row: r,
        kindLabel: w.kindNoun[r.kind],
        status,
        statusLabel: w.statusLabel[status] ?? status,
        intent: entitlementIntent(status),
    };
    if (r.kind === "package") {
        const total = r.sessions_total ?? 0;
        const used = r.sessions_used ?? 0;
        const left = status === "expired" ? 0 : Math.max(0, total - used);
        return {
            ...base,
            title: r.item_name ?? w.kindNoun.package,
            balanceLabel: w.sessionsLeft(left, total),
            meter: {
                value: left,
                max: Math.max(total, 1),
                units: true,
                detail: w.sessionsUsedOf(used, total),
            },
            valueCents: r.balance_cents ?? 0,
            note:
                status === "expired" && r.expires_at !== null
                    ? w.expired(day(r.expires_at))
                    : left === 1 && status === "active"
                      ? w.lastSession
                      : r.expires_at !== null
                        ? w.expires(day(r.expires_at))
                        : null,
        };
    }
    if (r.kind === "membership") {
        const card =
            r.method_last4 !== null
                ? strings.payments.savedCardLabel(
                      r.method_brand ?? strings.payments.cardNoun,
                      r.method_last4,
                  )
                : null;
        return {
            ...base,
            title: r.item_name ?? w.kindNoun.membership,
            balanceLabel:
                status === "past_due"
                    ? w.retrying
                    : r.period_end !== null
                      ? w.renews(formatMonthDay(new Date(r.period_end)))
                      : "",
            meter: null,
            valueCents: r.price_cents ?? 0,
            note: status === "past_due" ? w.pastDueNote : card,
        };
    }
    const initial = r.price_cents ?? 0;
    const balance = r.balance_cents ?? 0;
    return {
        ...base,
        title: r.code ?? w.kindNoun.gift_card,
        balanceLabel: w.moneyLeft(formatMoney(balance)),
        meter: {
            value: initial > 0 ? Math.round((balance / initial) * 100) : 0,
            max: 100,
            units: false,
            detail: w.ofAmount(formatMoney(initial)),
        },
        valueCents: balance,
        note:
            status === "expired" && r.expires_at !== null
                ? w.expired(day(r.expires_at))
                : r.recipient !== null
                  ? w.forRecipient(r.recipient)
                  : null,
    };
}

interface WalletClient {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
}

interface EntitlementWallet {
    load: Load;
    holders: { key: string; label: string }[];
    clientId: string;
    setClientId: (id: string) => void;
    client: WalletClient | null;
    contact: string;
    summaries: EntitlementSummary[];
    totals: { deferredCents: number; giftCents: number; monthlyCents: number };
}

const KIND_ORDER: WalletKind[] = ["membership", "package", "gift_card"];

/** One client's packages, plans and gift cards, with what the business still owes them. */
export function useEntitlementWallet(initialClientId: string | null = null): EntitlementWallet {
    const holdersQuery = useQuery<{ id: string; name: string }>(WALLET_HOLDERS_SQL);
    const [chosen, setClientId] = useState<string | null>(initialClientId);
    const clientId = chosen ?? holdersQuery.data[0]?.id ?? "";
    const rowsQuery = useQuery<WalletRow>(WALLET_SQL, [clientId]);
    const client = useQuery<WalletClient>(WALLET_CLIENT_SQL, [clientId]).data[0] ?? null;
    const load = useReplicaLoad([holdersQuery, rowsQuery], holdersQuery.data.length === 0);
    const summaries = useMemo(
        () =>
            rowsQuery.data
                .map(summarizeEntitlement)
                .sort(
                    (a, b) =>
                        KIND_ORDER.indexOf(a.row.kind) - KIND_ORDER.indexOf(b.row.kind) ||
                        Number(a.status !== "active") - Number(b.status !== "active"),
                ),
        [rowsQuery.data],
    );
    const live = (x: EntitlementSummary): boolean =>
        x.status === "active" || x.status === "past_due";
    return {
        load,
        holders: holdersQuery.data.map((h) => ({ key: h.id, label: h.name })),
        clientId,
        setClientId,
        client,
        contact:
            client === null
                ? ""
                : [client.phone === null ? null : formatPhone(client.phone), client.email]
                      .filter(Boolean)
                      .join(" · "),
        summaries,
        totals: {
            deferredCents: summaries
                .filter((x) => x.row.kind === "package")
                .reduce((sum, x) => sum + x.valueCents, 0),
            giftCents: summaries
                .filter((x) => x.row.kind === "gift_card" && x.status === "active")
                .reduce((sum, x) => sum + x.valueCents, 0),
            monthlyCents: summaries
                .filter((x) => x.row.kind === "membership" && live(x))
                .reduce((sum, x) => sum + x.valueCents, 0),
        },
    };
}

export const ENTITLEMENT_HISTORY_SQL = `
SELECT e.journal_id, e.event, MIN(e.occurred_at) AS at,
       SUM(CASE WHEN a.category IN ('deferred', 'gift_card') THEN e.amount_cents ELSE 0 END) AS cents
FROM entries e JOIN accounts a ON a.id = e.account_id
WHERE e.subject_type = ? AND e.subject_id = ?
GROUP BY e.journal_id, e.event ORDER BY at`;

interface HistoryRow {
    journal_id: string;
    event: string;
    at: string | null;
    cents: number;
}

export type EntitlementActionKey = "use" | "cancel" | "refund";

export interface EntitlementDetail {
    summary: EntitlementSummary;
    facts: { label: string; value: string }[];
    timeline: TimelineEntry[];
    ledgerNote: string;
    actions: EntitlementActionKey[];
    notYet: string | null;
    busy: boolean;
    error: string | null;
    run: (action: EntitlementActionKey) => void;
}

/** One package, plan or gift card: facts, what happened to its money, and what staff can do next. */
export function useEntitlementDetail(
    api: ApiLike,
    summary: EntitlementSummary | null,
    openRefund: (paymentId: string) => void,
): EntitlementDetail | null {
    const r = summary?.row ?? null;
    const subjectType = r?.kind === "gift_card" ? "gift_card" : "package";
    const history = useQuery<HistoryRow>(ENTITLEMENT_HISTORY_SQL, [subjectType, r?.id ?? ""]).data;
    const { busy, error, run } = useAsyncAction();
    if (summary === null || r === null) return null;

    const facts: { label: string; value: string }[] = [];
    let ledgerNote: string = w.ledgerMembership;
    const actions: EntitlementActionKey[] = [];
    if (r.kind === "package") {
        const total = r.sessions_total ?? 1;
        const used = r.sessions_used ?? 0;
        const share = Math.floor((r.price_cents ?? 0) / Math.max(1, total));
        if (r.paid_cents !== null)
            facts.push({ label: w.factPaid, value: formatMoney(r.paid_cents) });
        facts.push({ label: w.factDeferred, value: formatMoney(r.balance_cents) });
        if (summary.status === "active" && used < total)
            facts.push({ label: w.factNextSession, value: formatMoney(share) });
        if (r.expires_at !== null) facts.push({ label: w.factExpires, value: day(r.expires_at) });
        ledgerNote = w.ledgerPackage(formatMoney(share));
        if (summary.status === "active" && used < total) actions.push("use");
        if (summary.status === "active" && used === 0 && r.payment_id !== null)
            actions.push("refund");
    } else if (r.kind === "membership") {
        if (summary.note !== null && summary.status !== "past_due")
            facts.push({ label: w.factPaid, value: summary.note });
        if (r.period_end !== null)
            facts.push({
                label: w.factNextCharge,
                value: `${day(r.period_end)} · ${formatMoney(r.price_cents)}`,
            });
        if (summary.status !== "canceled") actions.push("cancel");
    } else {
        facts.push({ label: w.factCode, value: r.code ?? "" });
        if (r.recipient !== null) facts.push({ label: w.factRecipient, value: r.recipient });
        facts.push({
            label: w.factBalance,
            value: `${formatMoney(r.balance_cents)} ${w.ofAmount(formatMoney(r.price_cents))}`,
        });
        if (r.expires_at !== null) facts.push({ label: w.factExpires, value: day(r.expires_at) });
        ledgerNote = w.ledgerGift;
        if (
            summary.status === "active" &&
            r.balance_cents === r.price_cents &&
            r.payment_id !== null
        )
            actions.push("refund");
    }
    facts.push({ label: w.factBought, value: day(r.created_at) });

    return {
        summary,
        facts,
        ledgerNote,
        actions,
        notYet: r.kind === "membership" ? w.notYet : null,
        timeline: history.map((h) => ({
            key: h.journal_id,
            label:
                h.cents !== 0
                    ? `${w.event[h.event] ?? h.event} · ${formatMoney(Math.abs(h.cents))}`
                    : (w.event[h.event] ?? h.event),
            at: h.at === null ? "" : day(h.at),
            intent: (h.event === "payment"
                ? "accent"
                : h.event === "consumption" || h.event === "redemption"
                  ? "success"
                  : h.event === "dispute"
                    ? "danger"
                    : "neutral") satisfies Intent,
        })),
        busy,
        error,
        run: (action) => {
            if (action === "refund") {
                if (r.payment_id !== null) openRefund(r.payment_id);
                return;
            }
            const call =
                action === "use"
                    ? () => consumeSession(api, r.id)
                    : () => cancelSubscription(api, r.id);
            run(call, { errorMessage: w.actionError });
        },
    };
}

const CASH = "cash";

function giftPresets(item: Parameters<typeof giftAmounts>[0] | null): string[] {
    const suggested = item === null ? [] : giftAmounts(item);
    return suggested.length > 0 ? suggested.map((c) => String(c / 100)) : [...w.giftPresets];
}
const SALE_KINDS: WalletKind[] = ["package", "membership", "gift_card"];

export interface EntitlementSaleForm {
    kind: WalletKind;
    setKind: (k: WalletKind) => void;
    kinds: { key: WalletKind; label: string }[];
    items: { key: string; label: string; hint: string }[];
    noItems: string | null;
    itemId: string;
    setItemId: (id: string) => void;
    amount: string;
    setAmount: (v: string) => void;
    presets: { key: string; label: string }[];
    recipient: string;
    setRecipient: (v: string) => void;
    clientId: string;
    setClientId: (id: string) => void;
    clientOptions: { key: string; label: string }[];
    methods: CheckoutMethod[];
    checkout: Checkout;
    needsCard: boolean;
    lines: DocTotalLine[];
    totalCents: number;
    submitLabel: string;
    busyLabel: string;
    submit: () => void;
    sold: string | null;
    reset: () => void;
}

/** One sell form for packages, memberships and gift cards: cash, a saved card or a new card. */
export function useEntitlementSaleForm(
    api: ApiLike,
    opts: {
        kind?: WalletKind | undefined;
        clientId?: string | null | undefined;
        onDone?: (() => void) | undefined;
    } = {},
): EntitlementSaleForm {
    const catalog = useCatalogItems();
    const clients = useClients();
    const tax = useTaxSetup(api);
    const [kind, setKindState] = useState<WalletKind>(opts.kind ?? "package");
    const [itemId, setItemId] = useState("");
    const [amount, setAmount] = useState("50");
    const [recipient, setRecipient] = useState("");
    const [clientId, setClientId] = useState(opts.clientId ?? "");
    const [sold, setSold] = useState<string | null>(null);
    const cards = useSavedCards(clientId);
    const pool =
        kind === "package"
            ? packageOfferings(catalog)
            : kind === "membership"
              ? subscriptionPlans(catalog)
              : [];
    const item = pool.find((i) => i.id === itemId) ?? pool[0] ?? null;
    const saved = checkoutMethods(cards);
    const methods: CheckoutMethod[] =
        kind === "membership" ? saved : [{ id: CASH, label: w.cash }, ...saved];
    const giftCents = parseCents(amount) ?? 0;
    const client = clients.find((c) => c.id === clientId) ?? null;
    const what =
        kind === "gift_card"
            ? `${formatMoney(giftCents)} ${w.kindNoun.gift_card.toLowerCase()}`
            : (item?.name ?? "");
    const checkout = useCheckout(
        () => {
            setSold(w.doneBody(what, client?.name ?? ""));
            opts.onDone?.();
        },
        { allowNewCard: kind !== "membership", defaultMethod: methods[0]?.id ?? NEW_CARD },
    );

    const subtotal = kind === "gift_card" ? giftCents : (item?.price_cents ?? 0);
    const priced = priceDoc(
        kind === "gift_card"
            ? []
            : [{ amountCents: subtotal, taxClass: "standard", included: true }],
        docRates(tax.rates, tax.registered),
    );
    const total = subtotal + priced.taxCents;
    const lines: DocTotalLine[] =
        kind === "gift_card"
            ? [
                  {
                      key: "subtotal",
                      label: w.kindNoun.gift_card,
                      cents: subtotal,
                      kind: "subtotal",
                  },
                  { key: "tax", label: w.noTax, cents: 0, kind: "tax" },
                  { key: "total", label: w.total, cents: total, kind: "total" },
              ]
            : [
                  { key: "subtotal", label: w.subtotal, cents: subtotal, kind: "subtotal" },
                  ...priced.taxes.map((t) => ({
                      key: t.code,
                      label: t.label,
                      cents: t.cents,
                      kind: "tax" as const,
                  })),
                  {
                      key: "total",
                      label: kind === "membership" ? w.perPeriodTotal : w.total,
                      cents: total,
                      kind: "total",
                  },
              ];

    const submit = (): void => {
        if (clientId === "") {
            checkout.setError(w.errClient);
            return;
        }
        if (kind === "gift_card" && (giftCents < 500 || giftCents > 100_000)) {
            checkout.setError(w.errAmount);
            return;
        }
        if (kind !== "gift_card" && item === null) {
            checkout.setError(w.errItem);
            return;
        }
        if (kind === "membership" && saved.length === 0) {
            checkout.setError(w.membershipNeedsCard);
            return;
        }
        checkout.pay(({ paymentMethodId, idempotencyKey }) => {
            const cash = paymentMethodId === CASH;
            const card = cash ? undefined : paymentMethodId;
            const opt = { idempotencyKey };
            if (kind === "gift_card")
                return api.post<object>(
                    "/v1/gift-cards",
                    {
                        purchaser_client_id: clientId,
                        amount_cents: giftCents,
                        recipient: blankToNull(recipient),
                        payment_method_id: card,
                        cash,
                    },
                    opt,
                );
            const itemRef = item?.id ?? "";
            if (kind === "package")
                return api.post<object>(
                    "/v1/packages",
                    { client_id: clientId, item_id: itemRef, payment_method_id: card, cash },
                    opt,
                );
            return api.post<object>(
                "/v1/subscriptions",
                { client_id: clientId, item_id: itemRef, payment_method_id: card ?? "" },
                opt,
            );
        }, w.sellError);
    };

    return {
        kind,
        setKind: (k) => {
            setKindState(k);
            setItemId("");
            checkout.setMethod(k === "membership" ? (saved[0]?.id ?? NEW_CARD) : CASH);
            checkout.setError(null);
        },
        kinds: SALE_KINDS.map((k) => ({ key: k, label: w.kindNoun[k] })),
        items: pool.map((i) => ({
            key: i.id,
            label: i.name,
            hint: formatMoney(i.price_cents),
        })),
        noItems:
            kind !== "gift_card" && pool.length === 0
                ? w.noItems(w.kindNoun[kind].toLowerCase())
                : null,
        itemId: item?.id ?? "",
        setItemId,
        amount,
        setAmount,
        presets: giftPresets(giftItems(catalog)[0] ?? null).map((p) => ({
            key: p,
            label: `$${p}`,
        })),
        recipient,
        setRecipient,
        clientId,
        setClientId,
        clientOptions: clients.map((c) => ({ key: c.id, label: c.name })),
        methods,
        checkout,
        needsCard: kind === "membership" && clientId !== "" && saved.length === 0,
        lines,
        totalCents: total,
        submitLabel:
            checkout.method === CASH ? w.record(formatMoney(total)) : w.charge(formatMoney(total)),
        busyLabel: w.busy,
        submit,
        sold,
        reset: () => {
            setSold(null);
            checkout.cancel();
        },
    };
}
