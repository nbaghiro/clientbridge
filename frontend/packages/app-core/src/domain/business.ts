import { selectReplicaBusiness } from "@clientbridge/sync";
import { useBusinessQuery as useQuery } from "../hooks";
import { usePowerSync, useQuery as useGlobalQuery } from "@powersync/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { type Load, useAsyncAction, useLoad } from "../hooks";
import { BUSINESS_CURRENCY, formatList, formatMoney, formatParts } from "../format";
import { strings } from "../strings";
import { type ApiLike, failedCode, failureMessage } from "../api";
import type { ChoiceOption, Fact, SelectOption } from "../ui";
import { mediaUrl } from "./files";
import { durationLabel } from "./publicBooking";
import type { ShellTarget } from "./navigation";
import { BRAND_COLOURS, useStaff, staffName } from "./staff";
import { useReplicaLoad, useSyncStatus } from "./sync";
import { SUPPORTED_ZONES, type SupportedZone } from "../zones";
import { dateKey } from "../datetime";
import type { SubjectKind } from "./subjects";
import { taxSummary } from "./taxes";

interface BusinessRow {
    id: string;
    name: string;
    timezone: string;
    billing_email: string | null;
    gst_hst_number: string | null;
    qst_number: string | null;
    province: ProvinceCode | null;
    unit: string | null;
    street_number: string | null;
    street_name: string | null;
    city: string | null;
    postal_code: string | null;
    legal_phone: string | null;
    brand: string | null; // JSON text in the replica: {logo_file_id?, primary?, tagline?}
}

type AddressKey = "unit" | "street_number" | "street_name" | "city" | "postal_code" | "legal_phone";
const ADDRESS_KEYS: readonly AddressKey[] = [
    "unit",
    "street_number",
    "street_name",
    "city",
    "postal_code",
    "legal_phone",
];
type Located = Pick<BusinessFields, AddressKey>;
type LocatedRow = Pick<BusinessRow, AddressKey>;

function located(row: LocatedRow): Located {
    return {
        unit: row.unit ?? "",
        street_number: row.street_number ?? "",
        street_name: row.street_name ?? "",
        city: row.city ?? "",
        postal_code: row.postal_code ?? "",
        legal_phone: row.legal_phone ?? "",
    };
}

interface BusinessFields extends Record<AddressKey, string> {
    name: string;
    timezone: string;
    billing_email: string;
    logo_file_id: string;
    primary: string;
    tagline: string;
}

const PROFILE_KEYS = [
    "cover_url",
    "about",
    "address",
    "phone",
    "email",
    "website",
    "neighbourhood",
    "gallery_urls",
    "pickup_prep_minutes",
    "pickup_hold_days",
    "pickup_capacity",
] as const;
type ProfileKey = (typeof PROFILE_KEYS)[number];
type ProfileFields = Record<ProfileKey, string>;
const EMPTY_PROFILE: ProfileFields = {
    cover_url: "",
    about: "",
    address: "",
    phone: "",
    email: "",
    website: "",
    neighbourhood: "",
    gallery_urls: "",
    pickup_prep_minutes: "60",
    pickup_hold_days: "3",
    pickup_capacity: "10",
};

// The cover has its own upload control, and pickup settings live with the products.
export const PUBLIC_PROFILE_FIELDS = (
    ["about", "address", "phone", "email", "website", "neighbourhood", "gallery_urls"] as const
).map((key) => ({
    key,
    get label() {
        return strings.business.getSetUp.profile[key];
    },
    multiline: key === "about" || key === "gallery_urls",
}));

export const PICKUP_FIELDS = (
    ["pickup_prep_minutes", "pickup_hold_days", "pickup_capacity"] as const
).map((key) => ({
    key,
    get label() {
        return strings.business.getSetUp.profile[key];
    },
}));

interface Brand {
    logo_file_id: string;
    primary: string;
    tagline: string;
    profile: ProfileFields;
    public_staff_ids: string[];
}

const NO_BRAND: Brand = {
    logo_file_id: "",
    primary: "",
    tagline: "",
    profile: EMPTY_PROFILE,
    public_staff_ids: [],
};

function parseBrand(raw: string | null): Brand {
    if (raw === null || raw === "") return NO_BRAND;
    try {
        const b = JSON.parse(raw) as Record<string, unknown>;
        return {
            logo_file_id: typeof b.logo_file_id === "string" ? b.logo_file_id : "",
            primary: typeof b.primary === "string" ? b.primary : "",
            tagline: typeof b.tagline === "string" ? b.tagline : "",
            profile: Object.fromEntries(
                PROFILE_KEYS.map((key) => [
                    key,
                    key === "gallery_urls" && Array.isArray(b[key])
                        ? b[key]
                              .filter((value): value is string => typeof value === "string")
                              .join("\n")
                        : typeof b[key] === "string" || typeof b[key] === "number"
                          ? String(b[key])
                          : EMPTY_PROFILE[key],
                ]),
            ) as ProfileFields,
            public_staff_ids: Array.isArray(b.public_staff_ids)
                ? b.public_staff_ids.filter((id): id is string => typeof id === "string")
                : [],
        };
    } catch {
        return NO_BRAND;
    }
}

// The zones the server supports, in its order; a business already in another zone keeps it as an extra choice.
const ZONE_LABELS: Record<SupportedZone, () => string> = {
    "America/St_Johns": () => strings.business.timeZones.newfoundland,
    "America/Halifax": () => strings.business.timeZones.atlantic,
    "America/Toronto": () => strings.business.timeZones.eastern,
    "America/Winnipeg": () => strings.business.timeZones.central,
    "America/Regina": () => strings.business.timeZones.saskatchewan,
    "America/Edmonton": () => strings.business.timeZones.mountain,
    "America/Whitehorse": () => strings.business.timeZones.yukon,
    "America/Vancouver": () => strings.business.timeZones.pacific,
    "America/Creston": () => strings.business.timeZones.creston,
    "America/Dawson_Creek": () => strings.business.timeZones.dawsonCreek,
    "America/Fort_Nelson": () => strings.business.timeZones.fortNelson,
    "America/Atikokan": () => strings.business.timeZones.atikokan,
    "America/Blanc-Sablon": () => strings.business.timeZones.blancSablon,
};
const TIME_ZONES = SUPPORTED_ZONES.map((zone) => ({ zone, label: ZONE_LABELS[zone] }));

/** The time zones a business can pick, with the one it has now even when it is not listed. */
export function timeZoneOptions(current: string): SelectOption<string>[] {
    const listed = TIME_ZONES.map((z) => ({ key: z.zone, label: z.label() }));
    return current === "" || TIME_ZONES.some((z) => z.zone === current)
        ? listed
        : [...listed, { key: current, label: current }];
}

export const BUSINESS_TEXT_FIELDS: {
    key: keyof BusinessFields;
    label: string;
    placeholder: string;
}[] = [
    {
        key: "name",
        get label() {
            return strings.business.nameLabel;
        },
        get placeholder() {
            return strings.business.namePlaceholder;
        },
    },
    {
        key: "billing_email",
        get label() {
            return strings.business.billingEmailLabel;
        },
        get placeholder() {
            return strings.business.billingEmailPlaceholder;
        },
    },
];

export const BUSINESS_ADDRESS_FIELDS: {
    key: AddressKey;
    label: string;
    placeholder?: string;
    type: "text" | "tel";
    autoComplete?: string;
}[] = [
    {
        key: "unit",
        get label() {
            return strings.business.legalAddress.unit;
        },
        type: "text",
        autoComplete: "address-line2",
    },
    {
        key: "street_number",
        get label() {
            return strings.business.legalAddress.streetNumber;
        },
        type: "text",
    },
    {
        key: "street_name",
        get label() {
            return strings.business.legalAddress.streetName;
        },
        type: "text",
    },
    {
        key: "city",
        get label() {
            return strings.business.legalAddress.city;
        },
        type: "text",
        autoComplete: "address-level2",
    },
    {
        key: "postal_code",
        get label() {
            return strings.business.legalAddress.postalCode;
        },
        get placeholder() {
            return strings.business.legalAddress.postalCodePlaceholder;
        },
        type: "text",
        autoComplete: "postal-code",
    },
    {
        key: "legal_phone",
        get label() {
            return strings.business.legalAddress.legalPhone;
        },
        get placeholder() {
            return strings.business.legalAddress.legalPhonePlaceholder;
        },
        type: "tel",
        autoComplete: "tel",
    },
];

interface BusinessForm {
    fields: BusinessFields | null; // null until the synced business row loads
    /** The province's name, shown here and changed in Sales tax, since it sets the tax charged. */
    province: string;
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
    "SELECT id, name, timezone, billing_email, gst_hst_number, qst_number, province, unit, street_number, street_name, city, postal_code, legal_phone, brand FROM businesses LIMIT 1";

/** The saved row flows back through sync, so the form shows the server's values on the next render. */
export function useBusinessForm(api: ApiLike): BusinessForm {
    const row = useQuery<BusinessRow>(BUSINESS_SQL).data[0] ?? null;
    const { busy, error, setError, run } = useAsyncAction();
    const [fields, setFields] = useState<BusinessFields | null>(null);
    const [saved, setSaved] = useState(false);
    const loadedBrand = useRef<Brand>(NO_BRAND);
    const loadedAddress = useRef<Located | null>(null);

    useEffect(() => {
        if (row !== null && fields === null) {
            const brand = parseBrand(row.brand);
            loadedBrand.current = brand;
            loadedAddress.current = located(row);
            setFields({
                name: row.name,
                timezone: row.timezone,
                billing_email: row.billing_email ?? "",
                logo_file_id: brand.logo_file_id,
                primary: brand.primary,
                tagline: brand.tagline,
                ...loadedAddress.current,
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
        const { logo_file_id, primary, tagline, name, timezone, billing_email } = fields;
        // Send `brand` and address fields only when they changed, so a stale form cannot erase them.
        const b = loadedBrand.current;
        const brandChanged =
            logo_file_id !== b.logo_file_id || primary !== b.primary || tagline !== b.tagline;
        const brand = { logo_file_id: logo_file_id || null, primary, tagline };
        const address = loadedAddress.current;
        const moved = ADDRESS_KEYS.filter((key) => fields[key] !== address?.[key]);
        const body = {
            name,
            timezone,
            billing_email,
            ...Object.fromEntries(moved.map((key) => [key, fields[key]])),
            ...(brandChanged ? { brand } : {}),
        };
        let updated: LocatedRow | null = null;
        const save = async (): Promise<void> => {
            updated = await api.patch<LocatedRow>("/v1/business", body);
        };
        run(save, {
            onSuccess: () => {
                loadedBrand.current = { ...b, logo_file_id, primary, tagline }; // now what's on the server
                if (updated !== null) {
                    const saved = located(updated);
                    loadedAddress.current = saved;
                    setFields((f) => (f === null ? f : { ...f, ...saved }));
                }
                setSaved(true);
            },
            errorMessage: (e) => failureMessage(e, strings.business.saveError),
        });
    };

    const logoSrc = (apiBase: string): string | null =>
        fields !== null && fields.logo_file_id !== ""
            ? mediaUrl(apiBase, fields.logo_file_id)
            : null;

    const province = PROVINCES.find((p) => p.code === row?.province)?.name ?? "";

    return {
        fields,
        province,
        businessId: row?.id ?? null,
        logoSrc,
        set,
        busy,
        error,
        saved,
        submit,
    };
}

export const BUSINESS_ID_SQL = "SELECT id FROM businesses LIMIT 1";

const BUSINESS_ZONE_SQL = "SELECT id, timezone FROM businesses LIMIT 1";

/** `null` until the business row syncs; sync-write inserts need it for tenancy. */
export const BUSINESS_NAME_SQL = "SELECT name FROM businesses LIMIT 1";

export function useBusinessName(): string {
    return useQuery<{ name: string }>(BUSINESS_NAME_SQL).data[0]?.name ?? "";
}

export function useBusinessLoad(): Load & { zone: string | null } {
    const db = usePowerSync();
    const business = useQuery<{ id: string; timezone: string }>(BUSINESS_ZONE_SQL);
    const synced = useSyncStatus().hasSynced ?? false;
    const empty = business.data.length === 0;
    const [confirmedEmpty, setConfirmedEmpty] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let active = true;
        setConfirmedEmpty(false);
        setError(null);
        if (synced && !business.isLoading && empty) {
            // sync status can lead the watched query and the selection, so read the replica unscoped
            db.getOptional<{ id: string }>(BUSINESS_ID_SQL)
                .then((row) => {
                    if (active) setConfirmedEmpty(row === null);
                })
                .catch((reason: unknown) => {
                    if (active)
                        setError(reason instanceof Error ? reason : new Error(String(reason)));
                });
        }
        return () => {
            active = false;
        };
    }, [db, synced, business.isLoading, empty, attempt]);
    const load = useLoad(
        [
            business,
            {
                isLoading: empty && (!synced || !confirmedEmpty),
                error,
                refresh: () => {
                    setAttempt((value) => value + 1);
                },
            },
        ],
        empty,
    );
    return { ...load, zone: business.data[0]?.timezone ?? null };
}

export function useBusinessId(): string | null {
    return useQuery<{ id: string }>(BUSINESS_ID_SQL).data[0]?.id ?? null;
}

// The 13 Canadian provinces/territories the backend seeds tax rates for; an unknown code is a 422.
type ProvinceCode =
    "AB" | "BC" | "MB" | "NB" | "NL" | "NS" | "NT" | "NU" | "ON" | "PE" | "QC" | "SK" | "YT";

interface Province {
    code: ProvinceCode;
    name: string;
}

export const PROVINCES: Province[] = [
    {
        code: "AB",
        get name() {
            return strings.business.onboarding.provinceAB;
        },
    },
    {
        code: "BC",
        get name() {
            return strings.business.onboarding.provinceBC;
        },
    },
    {
        code: "MB",
        get name() {
            return strings.business.onboarding.provinceMB;
        },
    },
    {
        code: "NB",
        get name() {
            return strings.business.onboarding.provinceNB;
        },
    },
    {
        code: "NL",
        get name() {
            return strings.business.onboarding.provinceNL;
        },
    },
    {
        code: "NS",
        get name() {
            return strings.business.onboarding.provinceNS;
        },
    },
    {
        code: "NT",
        get name() {
            return strings.business.onboarding.provinceNT;
        },
    },
    {
        code: "NU",
        get name() {
            return strings.business.onboarding.provinceNU;
        },
    },
    {
        code: "ON",
        get name() {
            return strings.business.onboarding.provinceON;
        },
    },
    {
        code: "PE",
        get name() {
            return strings.business.onboarding.provincePE;
        },
    },
    {
        code: "QC",
        get name() {
            return strings.business.onboarding.provinceQC;
        },
    },
    {
        code: "SK",
        get name() {
            return strings.business.onboarding.provinceSK;
        },
    },
    {
        code: "YT",
        get name() {
            return strings.business.onboarding.provinceYT;
        },
    },
];

interface OnboardInput {
    name: string;
    slug: string;
    province: ProvinceCode;
    industry: Industry;
    timezone?: string;
}

/** Matches the backend BusinessOut; kept local so app-core needn't depend on api-client for it. */
export interface Business {
    id: string;
    name: string;
    slug: string;
    province: string | null;
    timezone: string;
    status: string;
}

function onboard(api: ApiLike, input: OnboardInput): Promise<Business> {
    return api.post<Business>("/v1/onboarding", {
        name: input.name.trim(),
        slug: input.slug.trim(),
        province: input.province,
        subject: INDUSTRY_SUBJECTS[input.industry],
        timezone: input.timezone ?? null,
    });
}

const INDUSTRY_SUBJECTS = {
    petGrooming: "pet",
    petCare: "pet",
    tutoring: "student",
    cleaning: "property",
    landscaping: "property",
    security: "site",
    beauty: null,
    fitness: null,
    wellness: null,
    photography: null,
    tattoo: null,
    other: null,
} as const satisfies Record<string, SubjectKind | null>;

/** What the owner does; signup maps it to the business's subject kind and does not store it. */
type Industry = keyof typeof INDUSTRY_SUBJECTS;

export function industryOptions(): SelectOption<Industry>[] {
    return (Object.keys(INDUSTRY_SUBJECTS) as Industry[]).map((key) => ({
        key,
        label: strings.business.onboarding.industry(key),
    }));
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
    // no default, so the owner always picks the province that sets their sales tax
    province: ProvinceCode | null;
    setProvince: (v: ProvinceCode) => void;
    industry: Industry | null;
    setIndustry: (v: Industry) => void;
    // "GST 5% + PST 7%": the taxes the new business will charge in its province
    taxSummary: string | null;
    busy: boolean;
    error: string | null;
    needsVerification: boolean;
    submit: () => void;
}

// the server gives a new business this zone, so its first tax day is read there
const NEW_BUSINESS_ZONE = "America/Toronto";

export function useOnboardingForm(
    api: ApiLike,
    onCreated: (business: Business) => void,
): OnboardingForm {
    const [name, setNameState] = useState("");
    const [slug, setSlugState] = useState("");
    const [slugEdited, setSlugEdited] = useState(false);
    const [province, setProvince] = useState<ProvinceCode | null>(null);
    const [industry, setIndustry] = useState<Industry | null>(null);
    // Stays true across retries so the verify step keeps one code instead of mailing a new one.
    const [needsVerification, setNeedsVerification] = useState(false);
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
        if (province === null) {
            setError(strings.business.onboarding.provinceRequired);
            return;
        }
        if (industry === null) {
            setError(strings.business.onboarding.industryRequired);
            return;
        }
        run(
            async () => {
                onCreated(await onboard(api, { name, slug, province, industry }));
            },
            {
                errorMessage: (e) => {
                    if (failedCode(e) !== "email_unverified")
                        return strings.business.onboarding.createError;
                    setNeedsVerification(true);
                    return strings.business.onboarding.verifyFirst;
                },
            },
        );
    };

    return {
        name,
        setName,
        slug,
        setSlug,
        province,
        setProvince,
        industry,
        setIndustry: (v) => {
            setIndustry(v);
            setError(null);
        },
        taxSummary:
            province === null ? null : taxSummary(province, dateKey(new Date(), NEW_BUSINESS_ZONE)),
        busy,
        error,
        needsVerification,
        submit,
    };
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
            hint: formatList(
                [c.name, province].filter((x): x is string => x !== null && x !== ""),
                "unit",
            ),
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
            target: "business",
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
            hint: o.teamHint(invites.length, invites[0] ?? ""),
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
    logoFileId: string | null;
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
export function bookingHost(base: string): string {
    return base.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

export function bookingPageUrl(base: string, slug: string): string {
    return `${base.replace(/\/+$/, "")}/b/${slug}/book`;
}

function progressOf(row: SetupCounts | undefined): SetupProgress {
    const counts = row ?? NO_COUNTS;
    const steps = setupTasks(counts);
    const done = steps.filter((x) => x.done).length;
    return {
        businessName: counts.name ?? "",
        logoFileId: parseBrand(counts.brand).logo_file_id || null,
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
    profile: ProfileFields;
    setProfile: (key: ProfileKey, value: string) => void;
    publicTeam: { id: string; name: string; selected: boolean }[];
    setPublicTeam: (id: string, selected: boolean) => void;
    busy: boolean;
    error: string | null;
    saved: boolean;
    submit: () => void;
}

export const BRAND_SQL = "SELECT id, name, slug, province, brand FROM businesses LIMIT 1";

/** Logo, colour and tagline for the booking page, saved to the business brand. */
export function useBrandForm(api: ApiLike): BrandForm {
    const team = useStaff();
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
        profile: current.profile,
        setProfile: (key, value) => {
            edit({ profile: { ...current.profile, [key]: value } });
        },
        publicTeam: team.map((person) => ({
            id: person.id,
            name: staffName(person),
            selected: current.public_staff_ids.includes(person.id),
        })),
        setPublicTeam: (id, selected) => {
            edit({
                public_staff_ids: selected
                    ? [...new Set([...current.public_staff_ids, id])]
                    : current.public_staff_ids.filter((value) => value !== id),
            });
        },
        busy,
        error,
        saved,
        submit: () => {
            run(
                () =>
                    api.patch("/v1/business", {
                        brand: {
                            ...current.profile,
                            gallery_urls: current.profile.gallery_urls
                                .split("\n")
                                .map((url) => url.trim())
                                .filter(Boolean),
                            pickup_prep_minutes: Number(current.profile.pickup_prep_minutes),
                            pickup_hold_days: Number(current.profile.pickup_hold_days),
                            pickup_capacity: Number(current.profile.pickup_capacity),
                            public_staff_ids: current.public_staff_ids,
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
}

// The same deposit the server asks for at booking (services/catalog.deposit_cents).
function previewDeposit(i: PreviewItem): number {
    if (i.deposit_type === "none" || i.deposit_value === null) return 0;
    return i.deposit_type === "fixed"
        ? i.deposit_value
        : Math.round((i.price_cents * i.deposit_value) / 100);
}

/** The booking page's first step from the replica: the bookable services and a pick. */
export function useBookingPreview(limit: number): BookingPreview {
    const items = useQuery<PreviewItem>(BOOKING_PREVIEW_SQL).data.slice(0, limit);
    const [selected, setSelected] = useState<string | null>(null);
    const chosen = items.find((i) => i.id === selected) ?? null;
    const b = strings.publicBooking;
    return {
        services: items.map((i) => {
            const deposit = previewDeposit(i);
            return {
                key: i.id,
                label: i.name,
                hint: formatParts([
                    i.duration_min !== null ? durationLabel(i.duration_min) : null,
                    formatMoney(i.price_cents, BUSINESS_CURRENCY),
                    deposit > 0 ? b.deposit(formatMoney(deposit, BUSINESS_CURRENCY)) : null,
                ]),
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
    };
}

export function useBusinessSelection(bindApi: (businessId: string | null) => void) {
    const db = usePowerSync();
    const businesses = useGlobalQuery<{ id: string; name: string }>(
        "SELECT id, name FROM businesses ORDER BY name, id",
    );
    const selection = useGlobalQuery<{ business_id: string }>(
        "SELECT business_id FROM business_selection WHERE id = 'current'",
    );
    const selectedId =
        businesses.data.find((row) => row.id === selection.data[0]?.business_id)?.id ?? null;
    const synced = useSyncStatus().hasSynced ?? false;
    const onlyId = businesses.data.length === 1 ? businesses.data[0]?.id : undefined;
    const [applied, setApplied] = useState<string | null | undefined>(undefined);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [firstSyncTimedOut, setFirstSyncTimedOut] = useState(false);
    const [confirmedEmpty, setConfirmedEmpty] = useState(false);
    const noBusinesses = synced && !businesses.isLoading && businesses.data.length === 0;
    useEffect(() => {
        let active = true;
        setConfirmedEmpty(false);
        if (noBusinesses) {
            // the watched list can trail the sync status, so read the replica before onboarding
            db.getOptional<{ id: string }>(BUSINESS_ID_SQL)
                .then((row) => {
                    if (active) setConfirmedEmpty(row === null);
                })
                .catch(() => undefined);
        }
        return () => {
            active = false;
        };
    }, [db, noBusinesses]);
    useEffect(() => {
        if (synced || businesses.data.length > 0) return;
        const timer = setTimeout(() => {
            setFirstSyncTimedOut(true);
        }, 30_000);
        return () => {
            clearTimeout(timer);
        };
    }, [synced, businesses.data.length]);
    const choose = useCallback(
        (id: string): void => {
            if (!businesses.data.some((row) => row.id === id)) return;
            setBusy(true);
            selectReplicaBusiness(db, id)
                .then(
                    () => {
                        setError(null);
                    },
                    () => {
                        setError(strings.business.switchError);
                    },
                )
                .finally(() => {
                    setBusy(false);
                });
        },
        [db, businesses.data],
    );
    useEffect(() => {
        if (onlyId && !selectedId) choose(onlyId);
    }, [onlyId, selectedId, choose]);
    const ready =
        !businesses.error &&
        !selection.error &&
        !businesses.isLoading &&
        !selection.isLoading &&
        (selectedId !== null || (noBusinesses && confirmedEmpty));
    useEffect(() => {
        if (ready) {
            bindApi(selectedId);
            setApplied(selectedId);
        }
    }, [bindApi, selectedId, ready]);
    return {
        options: businesses.data.map((row) => ({ key: row.id, label: row.name })),
        selectedId,
        choose,
        ready: ready && applied === selectedId,
        needsChoice: businesses.data.length > 1 && selectedId === null,
        busy,
        error:
            error ??
            (businesses.error ||
            selection.error ||
            (firstSyncTimedOut && !synced && businesses.data.length === 0)
                ? strings.business.switchError
                : null),
    };
}
