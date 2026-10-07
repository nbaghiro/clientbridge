import { useQuery } from "@powersync/react";
import { useEffect, useRef, useState } from "react";

import { useAsyncAction } from "../hooks";
import { strings } from "../strings";
import type { ApiLike } from "../api";
import { mediaUrl } from "./files";
import type { ShellTarget } from "./navigation";

interface BusinessRow {
    id: string;
    name: string;
    timezone: string;
    locale: string;
    billing_email: string | null;
    gst_hst_number: string | null;
    qst_number: string | null;
    brand: string | null; // JSON text in the replica: {logo_file_id?, logo_url?, primary?, tagline?}
}

interface BusinessFields {
    name: string;
    timezone: string;
    locale: string;
    billing_email: string;
    gst_hst_number: string;
    qst_number: string;
    logo_file_id: string;
    primary: string;
    tagline: string;
}

interface Brand {
    logo_file_id: string;
    primary: string;
    tagline: string;
}

const NO_BRAND: Brand = { logo_file_id: "", primary: "", tagline: "" };

function parseBrand(raw: string | null): Brand & { legacyLogoUrl: string | null } {
    if (raw === null || raw === "") return { ...NO_BRAND, legacyLogoUrl: null };
    try {
        const b = JSON.parse(raw) as Record<string, unknown>;
        return {
            logo_file_id: typeof b.logo_file_id === "string" ? b.logo_file_id : "",
            primary: typeof b.primary === "string" ? b.primary : "",
            tagline: typeof b.tagline === "string" ? b.tagline : "",
            legacyLogoUrl: typeof b.logo_url === "string" ? b.logo_url : null,
        };
    } catch {
        return { ...NO_BRAND, legacyLogoUrl: null };
    }
}

export const BUSINESS_TEXT_FIELDS: {
    key: keyof BusinessFields;
    label: string;
    placeholder: string;
}[] = [
    {
        key: "name",
        label: strings.business.nameLabel,
        placeholder: strings.business.namePlaceholder,
    },
    {
        key: "timezone",
        label: strings.business.timezoneLabel,
        placeholder: strings.business.timezonePlaceholder,
    },
    {
        key: "billing_email",
        label: strings.business.billingEmailLabel,
        placeholder: strings.business.billingEmailPlaceholder,
    },
    {
        key: "gst_hst_number",
        label: strings.business.gstLabel,
        placeholder: strings.business.gstPlaceholder,
    },
    {
        key: "qst_number",
        label: strings.business.qstLabel,
        placeholder: strings.business.qstPlaceholder,
    },
];

export const LOCALES: { code: string; label: string }[] = [{ code: "en", label: "English" }];

interface BusinessForm {
    fields: BusinessFields | null; // null until the synced business row loads
    businessId: string | null;
    /** The logo to preview: the uploaded file's media link, else a logo set by URL before uploads. */
    logoSrc: (apiBase: string) => string | null;
    set: (key: keyof BusinessFields, value: string) => void;
    busy: boolean;
    error: string | null;
    saved: boolean;
    submit: () => void;
}

export const BUSINESS_SQL =
    "SELECT id, name, timezone, locale, billing_email, gst_hst_number, qst_number, brand FROM businesses LIMIT 1";

/** The saved row flows back through sync, so the form shows the server's values on the next render. */
export function useBusinessForm(api: ApiLike): BusinessForm {
    const row = useQuery<BusinessRow>(BUSINESS_SQL).data[0] ?? null;
    const { busy, error, setError, run } = useAsyncAction();
    const [fields, setFields] = useState<BusinessFields | null>(null);
    const [saved, setSaved] = useState(false);
    const loadedBrand = useRef<Brand>(NO_BRAND);
    const legacyLogoUrl = row === null ? null : parseBrand(row.brand).legacyLogoUrl;

    useEffect(() => {
        if (row !== null && fields === null) {
            const brand = parseBrand(row.brand);
            loadedBrand.current = {
                logo_file_id: brand.logo_file_id,
                primary: brand.primary,
                tagline: brand.tagline,
            };
            setFields({
                name: row.name,
                timezone: row.timezone,
                locale: row.locale,
                billing_email: row.billing_email ?? "",
                gst_hst_number: row.gst_hst_number ?? "",
                qst_number: row.qst_number ?? "",
                logo_file_id: brand.logo_file_id,
                primary: brand.primary,
                tagline: brand.tagline,
            });
        }
    }, [row, fields]);

    const set = (key: keyof BusinessFields, value: string): void => {
        setSaved(false);
        setFields((f) => (f === null ? f : { ...f, [key]: value }));
    };

    const submit = (): void => {
        if (fields === null) return;
        if (fields.name.trim().length === 0) {
            setError(strings.business.nameRequired);
            return;
        }
        // Send `brand` only when it changed, so mobile (no brand fields) doesn't blank it.
        const { logo_file_id, primary, tagline, ...text } = fields;
        const b = loadedBrand.current;
        const brandChanged =
            logo_file_id !== b.logo_file_id || primary !== b.primary || tagline !== b.tagline;
        const brand = {
            logo_file_id: logo_file_id || null,
            logo_url: logo_file_id ? null : legacyLogoUrl,
            primary,
            tagline,
        };
        const body = brandChanged ? { ...text, brand } : text;
        run(() => api.patch("/v1/business", body), {
            onSuccess: () => {
                loadedBrand.current = { logo_file_id, primary, tagline }; // now what's on the server
                setSaved(true);
            },
            errorMessage: strings.business.saveError,
        });
    };

    const logoSrc = (apiBase: string): string | null =>
        fields !== null && fields.logo_file_id !== ""
            ? mediaUrl(apiBase, fields.logo_file_id)
            : legacyLogoUrl;

    return { fields, businessId: row?.id ?? null, logoSrc, set, busy, error, saved, submit };
}

export const BUSINESS_ID_SQL = "SELECT id FROM businesses LIMIT 1";

/** `null` until the business row syncs; sync-write inserts need it for tenancy. */
export function useBusinessId(): string | null {
    return useQuery<{ id: string }>(BUSINESS_ID_SQL).data[0]?.id ?? null;
}

// The 13 Canadian provinces/territories the backend seeds tax rates for; an unknown code is a 422.
type ProvinceCode =
    "AB" | "BC" | "MB" | "NB" | "NL" | "NS" | "NT" | "NU" | "ON" | "PE" | "QC" | "SK" | "YT";

export interface Province {
    code: ProvinceCode;
    name: string;
}

export const PROVINCES: Province[] = [
    { code: "AB", name: strings.business.onboarding.provinceAB },
    { code: "BC", name: strings.business.onboarding.provinceBC },
    { code: "MB", name: strings.business.onboarding.provinceMB },
    { code: "NB", name: strings.business.onboarding.provinceNB },
    { code: "NL", name: strings.business.onboarding.provinceNL },
    { code: "NS", name: strings.business.onboarding.provinceNS },
    { code: "NT", name: strings.business.onboarding.provinceNT },
    { code: "NU", name: strings.business.onboarding.provinceNU },
    { code: "ON", name: strings.business.onboarding.provinceON },
    { code: "PE", name: strings.business.onboarding.provincePE },
    { code: "QC", name: strings.business.onboarding.provinceQC },
    { code: "SK", name: strings.business.onboarding.provinceSK },
    { code: "YT", name: strings.business.onboarding.provinceYT },
];

interface OnboardInput {
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

interface OnboardingForm {
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
            setError(strings.business.onboarding.nameRequired);
            return;
        }
        if (slug.length === 0) {
            setError(strings.business.onboarding.slugRequired);
            return;
        }
        run(
            async () => {
                onCreated(await onboard(api, { name, slug, province }));
            },
            { errorMessage: strings.business.onboarding.createError },
        );
    };

    return { name, setName, slug, setSlug, province, setProvince, busy, error, submit };
}

export const SETUP_PROGRESS_SQL = `
SELECT
    (SELECT COUNT(*) FROM items WHERE active = 1 AND kind IN ('service', 'class')) AS services,
    (SELECT COUNT(*) FROM hours WHERE basis = 'recurring' AND available = 1) AS hours,
    (SELECT COUNT(*) FROM clients) AS clients,
    (SELECT COUNT(*) FROM staff) AS team,
    (SELECT COALESCE(MAX(stripe_charges_enabled), 0) FROM businesses) AS stripe,
    (SELECT COUNT(*) FROM bookings WHERE source = 'online') AS online,
    (SELECT slug FROM businesses LIMIT 1) AS slug,
    (SELECT name FROM businesses LIMIT 1) AS name,
    (SELECT brand FROM businesses LIMIT 1) AS brand`;

interface SetupCounts {
    services: number;
    hours: number;
    clients: number;
    team: number;
    stripe: number;
    online: number;
    slug: string | null;
    name: string | null;
    brand: string | null;
}

type SetupStepKey = "service" | "hours" | "client" | "team" | "stripe" | "page";

interface SetupStep {
    key: SetupStepKey;
    label: string;
    hint: string;
    done: boolean;
    target: ShellTarget;
}

export interface SetupProgress {
    businessName: string;
    brandColor: string | null;
    slug: string | null;
    steps: SetupStep[];
    done: number;
    total: number;
    complete: boolean;
}

/** What a new business still has to do before clients can book, derived from synced rows. */
function setupSteps(c: SetupCounts, bookingLink: string): SetupStep[] {
    const s = strings.business.setupSteps;
    return [
        { key: "service", ...s.service, done: c.services > 0, target: "catalog" },
        { key: "hours", ...s.hours, done: c.hours > 0, target: "hours" },
        { key: "client", ...s.client, done: c.clients > 0, target: "client" },
        { key: "team", ...s.team, done: c.team > 1, target: "team" },
        { key: "stripe", ...s.stripe, done: c.stripe === 1, target: "gettingPaid" },
        {
            key: "page",
            label: s.page.label,
            hint: bookingLink,
            done: c.online > 0,
            target: "onlineBooking",
        },
    ];
}

/** The public booking page for a business, on the Connect host the app is configured with. */
export function bookingPageUrl(base: string, slug: string): string {
    return `${base.replace(/\/+$/, "")}/book/${slug}`;
}

export function useSetupProgress(bookBase: string): SetupProgress {
    const row = useQuery<SetupCounts>(SETUP_PROGRESS_SQL).data[0];
    const counts: SetupCounts = row ?? {
        services: 0,
        hours: 0,
        clients: 0,
        team: 0,
        stripe: 0,
        online: 0,
        slug: null,
        name: null,
        brand: null,
    };
    const link = counts.slug === null ? "" : bookingPageUrl(bookBase, counts.slug);
    const steps = setupSteps(counts, link.replace(/^https?:\/\//, ""));
    const done = steps.filter((x) => x.done).length;
    return {
        businessName: counts.name ?? "",
        brandColor: parseBrand(counts.brand).primary || null,
        slug: counts.slug,
        steps,
        done,
        total: steps.length,
        complete: row !== undefined && done === steps.length,
    };
}
