// Unauthenticated online-booking client. A business booking slug is the only credential, so these
// hit the API with a plain `fetch` (never the authed session) against a base URL each platform
// supplies — mirroring `createPublicPayClient`.

import { useEffect, useState } from "react";

import { useAsyncAction } from "../hooks/useAsyncAction";
import { strings } from "../strings";
import { dateKey } from "../util/datetime";
import type { PublicBrand } from "./publicBrand";

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
    brand: PublicBrand;
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

export type PublicBookingStatus = "loading" | "not-found" | "error" | "booked" | "ready";

export interface PublicBookingForm {
    status: PublicBookingStatus;
    page: PublicBookingPage | null;
    result: PublicBookingResult | null;
    service: PublicService | null; // the picked service, derived from itemId
    itemId: string;
    setItemId: (v: string) => void;
    staffId: string;
    setStaffId: (v: string) => void;
    date: string;
    setDate: (v: string) => void;
    slots: PublicSlot[] | null; // null = not yet loaded (or selection incomplete)
    slotsError: string | null;
    startsAt: string;
    setStartsAt: (v: string) => void;
    name: string;
    setName: (v: string) => void;
    email: string;
    setEmail: (v: string) => void;
    phone: string;
    setPhone: (v: string) => void;
    canBook: boolean;
    submit: () => void;
    busy: boolean;
    error: string | null;
    setError: (message: string | null) => void;
}

/** View-model for the public online-booking wizard: load the page, pick service/staff/date (which
 *  refetches open slots), pick a time, enter contact details, then book. The deposit-card Elements
 *  render per-platform from `result.deposit_client_secret`. */
export function usePublicBookingForm(
    booking: PublicBookingClient,
    slug: string,
): PublicBookingForm {
    const [page, setPage] = useState<PublicBookingPage | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [itemId, setItemId] = useState("");
    const [staffId, setStaffId] = useState("");
    const [date, setDate] = useState(() => dateKey(new Date()));
    const [slots, setSlots] = useState<PublicSlot[] | null>(null);
    const [slotsError, setSlotsError] = useState<string | null>(null);
    const [startsAt, setStartsAt] = useState("");
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [result, setResult] = useState<PublicBookingResult | null>(null);
    const { busy, error, setError, run } = useAsyncAction();

    useEffect(() => {
        let live = true;
        setLoading(true);
        booking
            .getServices(slug)
            .then((p) => {
                if (live) setPage(p);
            })
            .catch((err: unknown) => {
                if (!live) return;
                if (err instanceof PublicBookingError && err.status === 404) setNotFound(true);
                else setLoadError(true);
            })
            .finally(() => {
                if (live) setLoading(false);
            });
        return () => {
            live = false;
        };
    }, [booking, slug]);

    useEffect(() => {
        setStartsAt("");
        if (itemId === "" || staffId === "" || date === "") {
            setSlots(null);
            return;
        }
        let live = true;
        setSlots(null);
        setSlotsError(null);
        booking
            .getSlots(slug, { itemId, staffId, date })
            .then((res) => {
                if (live) setSlots(res.slots);
            })
            .catch(() => {
                if (live) setSlotsError(strings.publicBooking.slotsLoadError);
            });
        return () => {
            live = false;
        };
    }, [booking, slug, itemId, staffId, date]);

    const canBook =
        startsAt !== "" &&
        name.trim().length > 0 &&
        (email.trim().length > 0 || phone.trim().length > 0);

    const status: PublicBookingStatus = loading
        ? "loading"
        : notFound
          ? "not-found"
          : loadError || page === null
            ? "error"
            : result !== null
              ? "booked"
              : "ready";

    const submit = (): void => {
        if (!canBook) {
            setError(strings.publicBooking.incompleteForm);
            return;
        }
        void run(
            async () => {
                setResult(
                    await booking.book(slug, {
                        itemId,
                        staffId,
                        startsAt,
                        client: { name: name.trim(), email: email.trim(), phone: phone.trim() },
                    }),
                );
            },
            {
                errorMessage: strings.publicBooking.bookError,
            },
        );
    };

    return {
        status,
        page,
        result,
        service: page?.services.find((s) => s.id === itemId) ?? null,
        itemId,
        setItemId,
        staffId,
        setStaffId,
        date,
        setDate,
        slots,
        slotsError,
        startsAt,
        setStartsAt,
        name,
        setName,
        email,
        setEmail,
        phone,
        setPhone,
        canBook,
        submit,
        busy,
        error,
        setError,
    };
}
