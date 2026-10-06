import { useState } from "react";

import { useAsyncAction } from "../hooks";
import { strings } from "../strings";
import type { Intent } from "../ui";
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

interface PublicInvoice {
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
