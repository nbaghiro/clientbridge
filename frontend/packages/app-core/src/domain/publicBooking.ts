// Unauthenticated online-booking client. A business booking slug is the only credential, so these
// hit the API with a plain `fetch` (never the authed session) against a base URL each platform
// supplies — mirroring `createPublicPayClient`.

export interface PublicService {
    id: string;
    name: string;
    description: string | null;
    duration_min: number | null;
    price_cents: number;
    currency: string;
    deposit_required: boolean;
    deposit_amount_cents: number;
}

export interface PublicStaff {
    id: string;
    name: string | null;
    title: string | null;
}

export interface PublicBookingPage {
    business_name: string;
    services: PublicService[];
    staff: PublicStaff[];
    stripe_account_id: string | null; // connected account to mount the deposit Elements, when onboarded
}

export interface PublicSlot {
    starts_at: string;
    ends_at: string;
}

export interface PublicSlots {
    slots: PublicSlot[];
}

export interface BookingClientInput {
    name: string;
    email?: string | null;
    phone?: string | null;
}

export interface PublicBookingResult {
    booking_id: string;
    deposit_client_secret: string | null;
    stripe_account_id: string | null; // connected account for the deposit charge
}

export class PublicBookingError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = "PublicBookingError";
    }
}

export interface PublicBookingClient {
    getServices(slug: string): Promise<PublicBookingPage>;
    getSlots(
        slug: string,
        params: { itemId: string; staffId: string; date: string },
    ): Promise<PublicSlots>;
    book(
        slug: string,
        input: {
            itemId: string;
            staffId: string;
            startsAt: string;
            client: BookingClientInput;
        },
    ): Promise<PublicBookingResult>;
}

/** Build a public-booking client bound to the API origin (web `VITE_API_URL`, mobile config). */
export function createPublicBookingClient(baseUrl: string): PublicBookingClient {
    const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
        const res = await fetch(`${baseUrl}${path}`, init);
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new PublicBookingError(res.status, text || res.statusText);
        }
        return (await res.json()) as T;
    };

    return {
        getServices: (slug) =>
            request<PublicBookingPage>(`/book/${encodeURIComponent(slug)}/services`),
        getSlots: (slug, { itemId, staffId, date }) => {
            const q = new URLSearchParams({ item_id: itemId, staff_id: staffId, date });
            return request<PublicSlots>(`/book/${encodeURIComponent(slug)}/slots?${q.toString()}`);
        },
        book: (slug, { itemId, staffId, startsAt, client }) =>
            request<PublicBookingResult>(`/book/${encodeURIComponent(slug)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    item_id: itemId,
                    staff_id: staffId,
                    starts_at: startsAt,
                    client: {
                        name: client.name,
                        email: client.email ?? null,
                        phone: client.phone ?? null,
                    },
                }),
            }),
    };
}
