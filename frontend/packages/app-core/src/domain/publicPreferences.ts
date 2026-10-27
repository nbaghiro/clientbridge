import { useEffect, useRef, useState } from "react";

import { useAsyncAction } from "../hooks";
import { strings } from "../strings";
import { type PublicBrand, usePublicResource } from "./publicResource";
import { refusal } from "../api";

interface PublicPreferences {
    business_name: string;
    brand: PublicBrand;
    first_name: string;
    phone_hint: string | null;
    sms: boolean;
}

interface PublicPreferencesClient {
    get: (token: string) => Promise<PublicPreferences>;
    save(token: string, input: { sms: boolean }): Promise<PublicPreferences>;
    unsubscribe(token: string): Promise<PublicPreferences>;
}

export function createPublicPreferencesClient(baseUrl: string): PublicPreferencesClient {
    const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
        const res = await fetch(`${baseUrl}${path}`, init);
        if (!res.ok) {
            throw await refusal(res);
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
        unsubscribe: (token) =>
            request(`/prefs/${encodeURIComponent(token)}/unsubscribe`, post({})),
    };
}

interface PreferencesPage {
    status: "loading" | "not-found" | "error" | "ready";
    prefs: PublicPreferences | null;
    retry: () => void;
    resubscribed: boolean;
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
    const [sms, setSms] = useState<boolean | null>(null);
    const [saved, setSaved] = useState(false);
    const [resubscribed, setResubscribed] = useState(false);
    const ran = useRef(false);
    const { busy, error, run } = useAsyncAction();
    const p = strings.publicPreferences;

    const apply = (next: PublicPreferences): void => {
        setData(next);
        setSms(null);
    };

    useEffect(() => {
        if (!unsubscribeOnOpen || ran.current || status !== "ready") return;
        ran.current = true;
        run(
            async () => {
                apply(await client.unsubscribe(token));
            },
            { errorMessage: p.saveError },
        );
    });

    return {
        status,
        prefs: data,
        retry,
        resubscribed,
        offersSms: sms ?? data?.sms ?? false,
        setOffersSms: (v) => {
            setSaved(false);
            setSms(v);
        },
        save: () => {
            run(
                async () => {
                    apply(await client.save(token, { sms: sms ?? data?.sms ?? false }));
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
                    apply(await client.unsubscribe(token));
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
                    apply(await client.save(token, { sms: true }));
                    setResubscribed(true);
                },
                { errorMessage: p.saveError },
            );
        },
        busy,
        error,
    };
}
