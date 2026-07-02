// Unauthenticated pay-by-link client. The URL token is the only credential, so these hit the API
// with a plain `fetch` (never the authed session) against a base URL each platform supplies.

import { useEffect, useState } from "react";

import { useAsyncAction } from "../hooks/useAsyncAction";
import { strings } from "../strings";
import type { Intent } from "../util/primitives";
import type { PublicBrand } from "./publicBrand";

export type PayMethod = "interac" | "card";

/** Ranked pay methods for the public page: Interac first (no fee), card only when enabled. */
export function payMethods(invoice: { accepts_card: boolean }): PayMethod[] {
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

export interface PublicInvoice {
    number: number | null;
    business_name: string;
    brand: PublicBrand;
    currency: string;
    total_cents: number;
    balance_cents: number;
    status: string;
    accepts_card: boolean;
    interac_email: string | null;
}

export interface InteracRequest {
    payment_id: string;
    reference_code: string;
    send_to: string | null;
    amount_cents: number;
}

export interface PublicCardIntent {
    client_secret: string;
    stripe_account_id: string;
}

export class PublicPayError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = "PublicPayError";
    }
}

export interface PublicPayClient {
    getPublicInvoice(token: string): Promise<PublicInvoice>;
    payInterac(token: string): Promise<InteracRequest>;
    payCard(token: string): Promise<PublicCardIntent>;
}

/** Build a pay-by-link client bound to the public API origin (web `VITE_API_URL`, mobile config). */
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

export type PublicPayStatus = "loading" | "not-found" | "error" | "ready" | "paid";

export interface PublicPayForm {
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

/** View-model for the public pay-by-link page: load the invoice, pick a method, create the Interac
 *  request or card intent, and track paid state. Platforms render Stripe Elements / native card UI
 *  from `card`; everything else (the state machine) is shared. */
export function usePublicPayForm(pay: PublicPayClient, token: string): PublicPayForm {
    const [invoice, setInvoice] = useState<PublicInvoice | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [method, setMethod] = useState<PayMethod>("interac");
    const [interac, setInterac] = useState<InteracRequest | null>(null);
    const [card, setCard] = useState<PublicCardIntent | null>(null);
    const [paid, setPaid] = useState(false);
    const { busy, error, setError, run } = useAsyncAction();

    useEffect(() => {
        let live = true;
        setLoading(true);
        pay.getPublicInvoice(token)
            .then((inv) => {
                if (live) setInvoice(inv);
            })
            .catch((err: unknown) => {
                if (!live) return;
                if (err instanceof PublicPayError && err.status === 404) setNotFound(true);
                else setLoadError(true);
            })
            .finally(() => {
                if (live) setLoading(false);
            });
        return () => {
            live = false;
        };
    }, [pay, token]);

    const status: PublicPayStatus = loading
        ? "loading"
        : notFound
          ? "not-found"
          : loadError || invoice === null
            ? "error"
            : paid || invoice.status === "paid"
              ? "paid"
              : "ready";

    const payInterac = (): void => {
        void run(
            async () => {
                setInterac(await pay.payInterac(token));
            },
            { errorMessage: strings.publicPay.interacStartError },
        );
    };
    const payCard = (): void => {
        void run(
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
