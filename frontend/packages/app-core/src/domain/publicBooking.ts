// Public clients use plain fetch, never the authed session; the slug or token is the credential.

import { useEffect, useState } from "react";

import { useAsyncAction } from "../hooks";
import { strings } from "../strings";
import { dateKey } from "../datetime";
import { formatMoneyWithCurrency } from "../format";
import { type PublicBrand, usePublicResource } from "./publicResource";
import { cartSubtotal } from "./publicShop";

export interface PublicService {
    id: string;
    name: string;
    description: string | null;
    duration_min: number | null;
    price_cents: number;
    currency: string;
    deposit_required: boolean;
    deposit_amount_cents: number;
    image_url: string | null;
}

/** Price and length of a service, e.g. "$45.00 · 60 min". */
export function serviceSummary(s: PublicService): string {
    const mins =
        s.duration_min !== null ? strings.publicBooking.durationSuffix(s.duration_min) : "";
    return `${formatMoneyWithCurrency(s.price_cents, s.currency)}${mins}`;
}

export function serviceOptionLabel(s: PublicService): string {
    return `${s.name} — ${serviceSummary(s)}`;
}

export interface PublicStaff {
    id: string;
    name: string | null;
    title: string | null;
}

export interface PublicAddon {
    id: string;
    name: string;
    price_cents: number;
    currency: string;
    image_url: string | null;
}

export interface PublicBookingPage {
    business_name: string;
    brand: PublicBrand;
    services: PublicService[];
    staff: PublicStaff[];
    addons: PublicAddon[]; // products a client can add to a visit, paid with the visit
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
    getServices: (slug: string) => Promise<PublicBookingPage>;
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
            addons?: { itemId: string; quantity: number }[];
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
        book: (slug, { itemId, staffId, startsAt, client, addons = [] }) =>
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
                    addons: addons.map((a) => ({ item_id: a.itemId, quantity: a.quantity })),
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
    addons: Record<string, number>; // chosen add-on product id -> quantity
    toggleAddon: (itemId: string) => void;
    addonsTotalCents: number;
    canBook: boolean;
    submit: () => void;
    busy: boolean;
    error: string | null;
    setError: (message: string | null) => void;
}

export type PublicBusinessStatus = "loading" | "not-found" | "error" | "ready";

export interface PublicBusiness {
    status: PublicBusinessStatus;
    page: PublicBookingPage | null;
}

/** Profile, brand and services only, from the booking-page endpoint. */
export function usePublicBusiness(booking: PublicBookingClient, slug: string): PublicBusiness {
    const { status, data } = usePublicResource(booking.getServices, slug);
    return { status, page: data };
}

/** Changing service, staff or date refetches open slots. */
export function usePublicBookingForm(
    booking: PublicBookingClient,
    slug: string,
): PublicBookingForm {
    const { status: load, data: page } = usePublicResource(booking.getServices, slug);
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
    const [addons, setAddons] = useState<Record<string, number>>({});
    const { busy, error, setError, run } = useAsyncAction();
    const toggleAddon = (itemId: string): void => {
        setAddons((prev) => {
            if (!(itemId in prev)) return { ...prev, [itemId]: 1 };
            return Object.fromEntries(Object.entries(prev).filter(([id]) => id !== itemId));
        });
    };

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

    const status: PublicBookingStatus =
        load !== "ready" ? load : result !== null ? "booked" : "ready";

    const submit = (): void => {
        if (!canBook) {
            setError(strings.publicBooking.incompleteForm);
            return;
        }
        run(
            async () => {
                setResult(
                    await booking.book(slug, {
                        itemId,
                        staffId,
                        startsAt,
                        client: { name: name.trim(), email: email.trim(), phone: phone.trim() },
                        addons: Object.entries(addons).map(([id, quantity]) => ({
                            itemId: id,
                            quantity,
                        })),
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
        addons,
        toggleAddon,
        addonsTotalCents: cartSubtotal(page?.addons ?? [], addons),
        canBook,
        submit,
        busy,
        error,
        setError,
    };
}
