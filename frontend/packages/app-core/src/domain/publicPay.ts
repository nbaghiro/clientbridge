// Unauthenticated pay-by-link client. The URL token is the only credential, so these hit the API
// with a plain `fetch` (never the authed session) against a base URL each platform supplies.

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
