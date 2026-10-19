import { useEffect, useMemo, useState } from "react";

import { formatDayTime, formatWeekdayName, parseTimestamp } from "../datetime";
import { strings } from "../strings";
import { zoneNote } from "./publicBooking";
import { type PublicBrand, usePublicResource } from "./publicResource";
import type { createPublicBookingClient } from "./publicBooking";

type BookingPage = Awaited<ReturnType<ReturnType<typeof createPublicBookingClient>["getServices"]>>;
interface PublicProfile extends BookingPage {
    brand: PublicBrand;
    cover_url: string | null;
    about: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    neighbourhood: string | null;
    gallery_urls: string[];
    timezone: string;
    hours: { weekday: number; start: string; end: string }[];
}
interface Opening {
    starts_at: string;
    ends_at: string;
    staff_id: string | null;
}
interface NextOpenings {
    services: { item_id: string; slots: Opening[] }[];
    through: string;
}
interface PublicProfileClient {
    get: (slug: string) => Promise<PublicProfile>;
    openings: (slug: string, itemIds: string[]) => Promise<NextOpenings>;
}

export function createPublicProfileClient(baseUrl: string): PublicProfileClient {
    const request = async <T>(path: string): Promise<T> => {
        const response = await fetch(`${baseUrl}${path}`);
        if (!response.ok)
            throw Object.assign(new Error(response.statusText), { status: response.status });
        return (await response.json()) as T;
    };
    return {
        get: (slug) => request<PublicProfile>(`/book/${encodeURIComponent(slug)}/profile`),
        openings: (slug, ids) =>
            request<NextOpenings>(
                `/book/${encodeURIComponent(slug)}/next-openings?${new URLSearchParams(ids.map((id) => ["item_ids", id])).toString()}`,
            ),
    };
}

export function usePublicProfile(client: PublicProfileClient, slug: string) {
    const { data: page, status, retry } = usePublicResource(client.get, slug);
    const [openings, setOpenings] = useState<Record<string, Opening[]>>({});
    const [openingsStatus, setOpeningsStatus] = useState<"loading" | "error" | "ready">("loading");
    useEffect(() => {
        if (page === null) return;
        let live = true;
        setOpenings({});
        setOpeningsStatus("loading");
        const load = async (): Promise<void> => {
            const entries: [string, Opening[]][] = [];
            for (let index = 0; index < page.services.length; index += 12) {
                const batch = await client.openings(
                    slug,
                    page.services.slice(index, index + 12).map((service) => service.id),
                );
                entries.push(
                    ...batch.services.map((service): [string, Opening[]] => [
                        service.item_id,
                        service.slots,
                    ]),
                );
            }
            if (live) {
                setOpenings(Object.fromEntries(entries));
                setOpeningsStatus("ready");
            }
        };
        load().catch(() => {
            if (live) setOpeningsStatus("error");
        });
        return () => {
            live = false;
        };
    }, [client, page, slug]);
    const categories =
        page === null
            ? []
            : [
                  ...new Set(
                      page.services.map(
                          (service) => service.category ?? strings.publicLanding.servicesTitle,
                      ),
                  ),
              ].map((label) => ({
                  label,
                  services: page.services.filter(
                      (service) =>
                          (service.category ?? strings.publicLanding.servicesTitle) === label,
                  ),
              }));
    const openingLabel = (starts: string): string =>
        page === null ? "" : formatDayTime(parseTimestamp(starts), page.timezone);
    // Opening hours count weekdays from Monday (0), as the server does.
    const weekday = (day: number): string => formatWeekdayName((day + 1) % 7);
    return {
        page,
        status,
        retry,
        categories,
        openings,
        openingsStatus,
        openingLabel,
        weekday,
        zoneNote: page === null ? null : zoneNote(page.timezone),
    };
}

interface BusinessNavigationAvailability {
    booking: boolean;
    shop: boolean;
    team: boolean;
    policies: boolean;
}

const navigationCache = new WeakMap<
    PublicProfileClient,
    Map<
        string,
        {
            expires: number;
            value: Promise<BusinessNavigationAvailability>;
        }
    >
>();

export function usePublicBusinessNavigation(
    client: PublicProfileClient,
    shop: { getShop: (slug: string) => Promise<{ items: readonly unknown[] }> },
    slug: string,
) {
    const load = useMemo(
        () => (key: string) => {
            let cache = navigationCache.get(client);
            if (!cache) {
                cache = new Map();
                navigationCache.set(client, cache);
            }
            const existing = cache.get(key);
            if (existing && existing.expires > Date.now()) return existing.value;
            const value = Promise.all([client.get(key), shop.getShop(key)])
                .then(([profile, products]) => ({
                    booking: profile.services.length > 0,
                    shop: products.items.length > 0,
                    team: profile.staff.length > 0,
                    policies: Boolean(profile.policy),
                }))
                .catch((error: unknown) => {
                    cache.delete(key);
                    throw error;
                });
            cache.set(key, { expires: Date.now() + 30_000, value });
            return value;
        },
        [client, shop],
    );
    return (
        usePublicResource(load, slug).data ?? {
            booking: false,
            shop: false,
            team: false,
            policies: false,
        }
    );
}
