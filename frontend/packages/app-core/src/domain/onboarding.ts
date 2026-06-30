import { useState } from "react";

import { useAsyncAction } from "../hooks/useAsyncAction";
import type { ApiLike } from "../util/api";

// The 13 Canadian provinces/territories the backend seeds tax rates for; an unknown code is a 422.
export type ProvinceCode =
    | "AB"
    | "BC"
    | "MB"
    | "NB"
    | "NL"
    | "NS"
    | "NT"
    | "NU"
    | "ON"
    | "PE"
    | "QC"
    | "SK"
    | "YT";

export interface Province {
    code: ProvinceCode;
    name: string;
}

export const PROVINCES: Province[] = [
    { code: "AB", name: "Alberta" },
    { code: "BC", name: "British Columbia" },
    { code: "MB", name: "Manitoba" },
    { code: "NB", name: "New Brunswick" },
    { code: "NL", name: "Newfoundland and Labrador" },
    { code: "NS", name: "Nova Scotia" },
    { code: "NT", name: "Northwest Territories" },
    { code: "NU", name: "Nunavut" },
    { code: "ON", name: "Ontario" },
    { code: "PE", name: "Prince Edward Island" },
    { code: "QC", name: "Quebec" },
    { code: "SK", name: "Saskatchewan" },
    { code: "YT", name: "Yukon" },
];

export interface OnboardInput {
    name: string;
    slug: string;
    province: ProvinceCode;
    timezone?: string;
    locale?: string;
}

/** Matches the backend BusinessOut; kept local so app-core needn't depend on api-client for it. */
export interface Business {
    id: string;
    name: string;
    slug: string;
    province: string | null;
    timezone: string;
    locale: string;
    status: string;
}

/** Provision the caller's business (POST /v1/onboarding) — the owner Staff row + the province's tax
 *  rates are seeded server-side, then sync down into the local replica. */
export function onboard(api: ApiLike, input: OnboardInput): Promise<Business> {
    return api.post<Business>("/v1/onboarding", {
        name: input.name.trim(),
        slug: input.slug.trim(),
        province: input.province,
        timezone: input.timezone ?? null,
        locale: input.locale ?? "en",
    });
}

/** Business name → URL-safe slug (lowercase, accent-stripped, hyphen-separated, alnum only). */
export function slugify(name: string): string {
    return name
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/gu, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export interface OnboardingForm {
    name: string;
    setName: (v: string) => void;
    slug: string;
    setSlug: (v: string) => void;
    province: ProvinceCode;
    setProvince: (v: ProvinceCode) => void;
    busy: boolean;
    error: string | null;
    submit: () => void;
}

/** Create-your-business view-model: name (auto-slugged until edited) + province + validation + submit;
 *  the platform owns only the inputs and the province picker. */
export function useOnboardingForm(
    api: ApiLike,
    onCreated: (business: Business) => void,
): OnboardingForm {
    const [name, setNameState] = useState("");
    const [slug, setSlugState] = useState("");
    const [slugEdited, setSlugEdited] = useState(false);
    const [province, setProvince] = useState<ProvinceCode>("ON");
    const { busy, error, setError, run } = useAsyncAction();

    const setName = (v: string): void => {
        setNameState(v);
        if (!slugEdited) setSlugState(slugify(v));
    };

    const setSlug = (v: string): void => {
        setSlugEdited(true);
        setSlugState(slugify(v));
    };

    const submit = (): void => {
        if (name.trim().length === 0) {
            setError("Business name is required");
            return;
        }
        if (slug.length === 0) {
            setError("A web address is required");
            return;
        }
        void run(
            async () => {
                onCreated(await onboard(api, { name, slug, province }));
            },
            { errorMessage: "Couldn’t create your business — that web address may be taken." },
        );
    };

    return { name, setName, slug, setSlug, province, setProvince, busy, error, submit };
}
