// Unauthenticated pay-by-link client. The URL token is the only credential, so these use a plain
// `fetch` against the same API base as the authed session — never the session fetch / auth header.

const baseUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8701";

export interface PublicInvoice {
    number: number | null;
    business_name: string;
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, init);
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new PublicPayError(res.status, text || res.statusText);
    }
    return (await res.json()) as T;
}

export function getPublicInvoice(token: string): Promise<PublicInvoice> {
    return request<PublicInvoice>(`/pay/${encodeURIComponent(token)}`);
}

export function payInterac(token: string): Promise<InteracRequest> {
    return request<InteracRequest>(`/pay/${encodeURIComponent(token)}/interac`, { method: "POST" });
}

export function payCard(token: string): Promise<PublicCardIntent> {
    return request<PublicCardIntent>(`/pay/${encodeURIComponent(token)}/card`, { method: "POST" });
}
