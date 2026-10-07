import { useEffect, useRef, useState } from "react";

import { useAsyncAction } from "../hooks";
import { strings } from "../strings";
import { type PublicBrand, usePublicResource } from "./publicResource";

interface PublicPreferences {
    business_name: string;
    brand: PublicBrand;
    first_name: string;
    email_hint: string | null;
    phone_hint: string | null;
    email: boolean;
    sms: boolean;
}

class PublicPreferencesError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = "PublicPreferencesError";
    }
}

interface PublicPreferencesClient {
    get: (token: string) => Promise<PublicPreferences>;
    save(token: string, input: { email: boolean; sms: boolean }): Promise<PublicPreferences>;
    unsubscribe(token: string, channel: "email" | "sms" | null): Promise<PublicPreferences>;
}

export function createPublicPreferencesClient(baseUrl: string): PublicPreferencesClient {
    const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
        const res = await fetch(`${baseUrl}${path}`, init);
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new PublicPreferencesError(res.status, text || res.statusText);
        }
        return (await res.json()) as T;
    };
    const post = (body: unknown): RequestInit => ({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    return {
        get: (token) => request(`/prefs/${encodeURIComponent(token)}`),
        save: (token, input) => request(`/prefs/${encodeURIComponent(token)}`, post(input)),
        unsubscribe: (token, channel) =>
            request(`/prefs/${encodeURIComponent(token)}/unsubscribe`, post({ channel })),
    };
}

interface PreferencesPage {
    status: "loading" | "not-found" | "error" | "ready";
    prefs: PublicPreferences | null;
    retry: () => void;
    // The client used Subscribe again after a one-click unsubscribe.
    resubscribed: boolean;
    offersEmail: boolean;
    setOffersEmail: (v: boolean) => void;
    offersSms: boolean;
    setOffersSms: (v: boolean) => void;
    save: () => void;
    saved: boolean;
    unsubscribeAll: () => void;
    resubscribe: () => void;
    busy: boolean;
    error: string | null;
}

/** Opening an email's unsubscribe link takes that address off news and offers in one step (CASL). */
export function usePreferencesPage(
    client: PublicPreferencesClient,
    token: string,
    unsubscribeOnOpen: boolean,
): PreferencesPage {
    const { status, data, setData, retry } = usePublicResource(client.get, token);
    const [email, setEmail] = useState<boolean | null>(null);
    const [sms, setSms] = useState<boolean | null>(null);
    const [saved, setSaved] = useState(false);
    const [resubscribed, setResubscribed] = useState(false);
    const ran = useRef(false);
    const { busy, error, run } = useAsyncAction();
    const p = strings.publicPreferences;

    const apply = (next: PublicPreferences): void => {
        setData(next);
        setEmail(null);
        setSms(null);
    };

    useEffect(() => {
        if (!unsubscribeOnOpen || ran.current || status !== "ready") return;
        ran.current = true;
        run(
            async () => {
                apply(await client.unsubscribe(token, "email"));
            },
            { errorMessage: p.saveError },
        );
    });

    return {
        status,
        prefs: data,
        retry,
        resubscribed,
        offersEmail: email ?? data?.email ?? false,
        setOffersEmail: (v) => {
            setSaved(false);
            setEmail(v);
        },
        offersSms: sms ?? data?.sms ?? false,
        setOffersSms: (v) => {
            setSaved(false);
            setSms(v);
        },
        save: () => {
            run(
                async () => {
                    apply(
                        await client.save(token, {
                            email: email ?? data?.email ?? false,
                            sms: sms ?? data?.sms ?? false,
                        }),
                    );
                },
                {
                    onSuccess: () => {
                        setSaved(true);
                    },
                    errorMessage: p.saveError,
                },
            );
        },
        saved,
        unsubscribeAll: () => {
            run(
                async () => {
                    apply(await client.unsubscribe(token, null));
                },
                {
                    onSuccess: () => {
                        setSaved(true);
                    },
                    errorMessage: p.saveError,
                },
            );
        },
        resubscribe: () => {
            run(
                async () => {
                    apply(await client.save(token, { email: true, sms: data?.sms ?? false }));
                    setResubscribed(true);
                },
                { errorMessage: p.saveError },
            );
        },
        busy,
        error,
    };
}
