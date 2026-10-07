import { useQuery } from "@powersync/react";
import { useEffect, useRef, useState } from "react";

import { type Load, useAsyncAction } from "../hooks";
import { strings } from "../strings";
import type { ApiLike } from "../api";
import type { ChoiceOption, Fact } from "../ui";
import { mediaUrl } from "./files";
import { durationLabel, money } from "./publicBooking";
import type { ShellTarget } from "./navigation";
import { useReplicaLoad } from "./sync";

interface BusinessRow {
    id: string;
    name: string;
    timezone: string;
    locale: string;
    billing_email: string | null;
    gst_hst_number: string | null;
    qst_number: string | null;
    brand: string | null; // JSON text in the replica: {logo_file_id?, primary?, tagline?}
}

interface BusinessFields {
    name: string;
    timezone: string;
    locale: string;
    billing_email: string;
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

function parseBrand(raw: string | null): Brand {
    if (raw === null || raw === "") return NO_BRAND;
    try {
        const b = JSON.parse(raw) as Record<string, unknown>;
        return {
            logo_file_id: typeof b.logo_file_id === "string" ? b.logo_file_id : "",
            primary: typeof b.primary === "string" ? b.primary : "",
            tagline: typeof b.tagline === "string" ? b.tagline : "",
        };
    } catch {
        return NO_BRAND;
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

    useEffect(() => {
        if (row !== null && fields === null) {
            const brand = parseBrand(row.brand);
            loadedBrand.current = brand;
            setFields({
                name: row.name,
                timezone: row.timezone,
                locale: row.locale,
                billing_email: row.billing_email ?? "",
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
        // Send `brand` only when it changed; the brand panel in Get set up owns it.
        const { logo_file_id, primary, tagline, ...text } = fields;
        const b = loadedBrand.current;
        const brandChanged =
            logo_file_id !== b.logo_file_id || primary !== b.primary || tagline !== b.tagline;
        const brand = { logo_file_id: logo_file_id || null, primary, tagline };
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
            : null;

    return { fields, businessId: row?.id ?? null, logoSrc, set, busy, error, saved, submit };
}

export const BUSINESS_ID_SQL = "SELECT id FROM businesses LIMIT 1";

/** `null` until the business row syncs; sync-write inserts need it for tenancy. */
export const BUSINESS_NAME_SQL = "SELECT name FROM businesses LIMIT 1";

export function useBusinessName(): string {
    return useQuery<{ name: string }>(BUSINESS_NAME_SQL).data[0]?.name ?? "";
}

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
function slugify(name: string): string {
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
    (SELECT COUNT(*) FROM staff) AS team,
    (SELECT COALESCE(MAX(stripe_charges_enabled), 0) FROM businesses) AS stripe,
    (SELECT slug FROM businesses LIMIT 1) AS slug,
    (SELECT name FROM businesses LIMIT 1) AS name,
    (SELECT brand FROM businesses LIMIT 1) AS brand,
    (SELECT province FROM businesses LIMIT 1) AS province,
    (SELECT COALESCE(MAX(tax_registered), 0) FROM businesses) AS tax_registered,
    (SELECT MAX(pst_number) FROM businesses) AS pst_number,
    (SELECT MAX(setup_dismissed_at) FROM businesses) AS dismissed_at,
    (SELECT COUNT(*) FROM items WHERE active = 1 AND kind = 'class') AS classes,
    (SELECT group_concat(invite_email, ', ') FROM staff WHERE status = 'invited') AS invites`;

interface SetupCounts {
    services: number;
    hours: number;
    team: number;
    stripe: number;
    slug: string | null;
    name: string | null;
    brand: string | null;
    province: string | null;
    tax_registered: number;
    pst_number: string | null;
    dismissed_at: string | null;
    classes: number;
    invites: string | null;
}

type SetupTaskKey = "business" | "services" | "hours" | "brand" | "stripe" | "team" | "tax";

interface SetupTask {
    key: SetupTaskKey;
    label: string;
    hint: string;
    action: string;
    done: boolean;
    target: ShellTarget;
}

/** What a business still has to do to take bookings and get paid, derived from synced rows. */
export function setupTasks(c: SetupCounts): SetupTask[] {
    const o = strings.business.getSetUp;
    const brand = parseBrand(c.brand);
    const province = PROVINCES.find((p) => p.code === c.province)?.name ?? null;
    const invites = c.invites === null ? [] : c.invites.split(", ");
    return [
        {
            key: "business",
            ...o.tasks.business,
            hint: [c.name, province].filter((x) => x !== null && x !== "").join(", "),
            done: true,
            target: "business",
        },
        {
            key: "services",
            ...o.tasks.services,
            hint:
                c.services > 0
                    ? o.servicesHint(c.services - c.classes, c.classes)
                    : o.fresh.services,
            done: c.services > 0,
            target: "catalog",
        },
        {
            key: "hours",
            ...o.tasks.hours,
            hint: c.hours > 0 ? o.hoursSet : o.fresh.hours,
            done: c.hours > 0,
            target: "hours",
        },
        {
            key: "brand",
            ...o.tasks.brand,
            done: brand.primary !== "" || brand.logo_file_id !== "",
            target: "setup",
        },
        {
            key: "stripe",
            ...o.tasks.stripe,
            hint: c.stripe === 1 ? o.stripeOn : o.fresh.stripe,
            done: c.stripe === 1,
            target: "gettingPaid",
        },
        {
            key: "team",
            ...o.tasks.team,
            hint: o.teamHint(invites),
            done: c.team > 1,
            target: "team",
        },
        {
            key: "tax",
            ...o.tasks.tax,
            hint: c.tax_registered === 1 ? o.taxHint(c.pst_number !== null) : o.fresh.tax,
            done: c.tax_registered === 1,
            target: "taxes",
        },
    ];
}

export interface SetupProgress {
    businessName: string;
    brandColor: string | null;
    slug: string | null;
    steps: SetupTask[];
    done: number;
    total: number;
    complete: boolean;
    dismissed: boolean;
}

/** The public booking page for a business, on the Connect host the app is configured with. */
export function bookingPageUrl(base: string, slug: string): string {
    return `${base.replace(/\/+$/, "")}/book/${slug}`;
}

function progressOf(row: SetupCounts | undefined): SetupProgress {
    const counts = row ?? NO_COUNTS;
    const steps = setupTasks(counts);
    const done = steps.filter((x) => x.done).length;
    return {
        businessName: counts.name ?? "",
        brandColor: parseBrand(counts.brand).primary || null,
        slug: counts.slug,
        steps,
        done,
        total: steps.length,
        complete: row !== undefined && done === steps.length,
        dismissed: counts.dismissed_at !== null,
    };
}

export function useSetupProgress(): SetupProgress {
    return progressOf(useQuery<SetupCounts>(SETUP_PROGRESS_SQL).data[0]);
}

const NO_COUNTS: SetupCounts = {
    services: 0,
    hours: 0,
    team: 0,
    stripe: 0,
    slug: null,
    name: null,
    brand: null,
    province: null,
    tax_registered: 0,
    pst_number: null,
    dismissed_at: null,
    classes: 0,
    invites: null,
};

interface SetupChecklist extends SetupProgress {
    load: Load;
    live: boolean;
    bookingUrl: string;
    setHidden: (hidden: boolean) => void;
    hideError: string | null;
}

/** The Get set up list, the same steps and count the sidebar and Today show. */
export function useSetupChecklist(api: ApiLike, bookBase: string): SetupChecklist {
    const query = useQuery<SetupCounts>(SETUP_PROGRESS_SQL);
    const c = query.data[0] ?? NO_COUNTS;
    const load = useReplicaLoad([query], false);
    const { error, run } = useAsyncAction();
    return {
        ...progressOf(query.data[0]),
        load,
        live: c.services > 0 && c.hours > 0,
        bookingUrl:
            c.slug === null ? "" : bookingPageUrl(bookBase, c.slug).replace(/^https?:\/\//, ""),
        setHidden: (hidden) => {
            run(() => api.patch("/v1/business", { setup_dismissed: hidden }), {
                errorMessage: strings.business.saveError,
            });
        },
        hideError: error,
    };
}

export const BRAND_COLOURS = [
    "#2E4A3F",
    "#3F5E80",
    "#2E6670",
    "#7D5A82",
    "#A95C43",
    "#86621E",
    "#3A4654",
] as const;

export interface BrandForm {
    ready: boolean;
    businessId: string | null;
    name: string;
    slug: string;
    province: string | null;
    logoFileId: string;
    setLogoFileId: (id: string) => void;
    colour: string;
    setColour: (v: string) => void;
    tagline: string;
    setTagline: (v: string) => void;
    busy: boolean;
    error: string | null;
    saved: boolean;
    submit: () => void;
}

export const BRAND_SQL = "SELECT id, name, slug, province, brand FROM businesses LIMIT 1";

/** Logo, colour and tagline for the booking page, saved to the business brand. */
export function useBrandForm(api: ApiLike): BrandForm {
    const row = useQuery<{
        id: string;
        name: string;
        slug: string;
        province: string | null;
        brand: string | null;
    }>(BRAND_SQL).data[0];
    const stored = parseBrand(row?.brand ?? null);
    const [draft, setDraft] = useState<Brand | null>(null);
    const [saved, setSaved] = useState(false);
    const { busy, error, run } = useAsyncAction();
    const current = draft ?? stored;
    const edit = (patch: Partial<Brand>): void => {
        setDraft({ ...current, ...patch });
        setSaved(false);
    };
    return {
        ready: row !== undefined,
        businessId: row?.id ?? null,
        name: row?.name ?? "",
        slug: row?.slug ?? "",
        province: row?.province ?? null,
        logoFileId: current.logo_file_id,
        setLogoFileId: (id) => {
            edit({ logo_file_id: id });
        },
        colour: current.primary || BRAND_COLOURS[1],
        setColour: (v) => {
            edit({ primary: v });
        },
        tagline: current.tagline,
        setTagline: (v) => {
            edit({ tagline: v });
        },
        busy,
        error,
        saved,
        submit: () => {
            run(
                () =>
                    api.patch("/v1/business", {
                        brand: {
                            logo_file_id: current.logo_file_id || null,
                            primary: current.primary || BRAND_COLOURS[1],
                            tagline: current.tagline,
                        },
                    }),
                {
                    errorMessage: strings.business.saveError,
                    onSuccess: () => {
                        setSaved(true);
                        setDraft(null);
                    },
                },
            );
        },
    };
}

export const BOOKING_PREVIEW_SQL = `
SELECT id, name, description, duration_min, price_cents, deposit_type, deposit_value FROM items
WHERE active = 1 AND online_bookable = 1 AND kind IN ('service', 'class')
ORDER BY name COLLATE NOCASE`;

export const PREVIEW_RATING_SQL = `
SELECT AVG(rating) AS average, COUNT(*) AS n FROM reviews WHERE status = 'published'`;

interface PreviewItem {
    id: string;
    name: string;
    description: string | null;
    duration_min: number | null;
    price_cents: number;
    deposit_type: string;
    deposit_value: number | null;
}

export interface BookingPreview {
    services: ChoiceOption<string>[];
    selected: string | null;
    select: (id: string) => void;
    facts: Fact[];
    rating: string | null;
}

// The same deposit the server asks for at booking (services/catalog.deposit_cents).
function previewDeposit(i: PreviewItem): number {
    if (i.deposit_type === "none" || i.deposit_value === null) return 0;
    return i.deposit_type === "fixed"
        ? i.deposit_value
        : Math.round((i.price_cents * i.deposit_value) / 100);
}

/** The booking page's first step from the replica: the bookable services, a pick and the rating. */
export function useBookingPreview(limit: number): BookingPreview {
    const items = useQuery<PreviewItem>(BOOKING_PREVIEW_SQL).data.slice(0, limit);
    const rating = useQuery<{ average: number | null; n: number }>(PREVIEW_RATING_SQL).data[0];
    const [selected, setSelected] = useState<string | null>(null);
    const chosen = items.find((i) => i.id === selected) ?? null;
    const b = strings.publicBooking;
    return {
        services: items.map((i) => {
            const deposit = previewDeposit(i);
            return {
                key: i.id,
                label: i.name,
                hint: [
                    i.duration_min !== null ? durationLabel(i.duration_min) : null,
                    money(i.price_cents),
                    deposit > 0 ? b.deposit(money(deposit)) : null,
                ]
                    .filter((x) => x !== null)
                    .join(" · "),
                detail: i.description ?? undefined,
            };
        }),
        selected: chosen?.id ?? null,
        select: setSelected,
        facts:
            chosen === null
                ? []
                : [
                      {
                          key: "service",
                          icon: "paw",
                          title: chosen.name,
                          ...(chosen.duration_min !== null
                              ? { detail: durationLabel(chosen.duration_min) }
                              : {}),
                      },
                  ],
        rating:
            rating?.average === null || rating === undefined || rating.n === 0
                ? null
                : b.reviews(rating.average.toFixed(1), rating.n),
    };
}
