import { keepTabBusiness, selectReplicaBusiness, selectionQuery } from "@clientbridge/sync";
import { useBusinessQuery as useQuery } from "../hooks";
import { usePowerSync, useQuery as useGlobalQuery } from "@powersync/react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { type Load, useAsyncAction, useLoad, useSyncedDraft } from "../hooks";
import { BUSINESS_CURRENCY, formatList, formatMoney, formatParts } from "../format";
import { strings } from "../strings";
import { type ApiLike, failedCode, failedFields, failureMessage } from "../api";
import { type Viewer, isManager } from "./auth";
import type { ChoiceOption, Fact, SelectOption } from "../ui";
import { durationLabel } from "./publicBooking";
import { bareUrl, bookingPageUrl, businessPageUrl } from "../runtime";
import type { ShellTarget } from "./navigation";
import { BRAND_PALETTE } from "@clientbridge/tokens";
import { useStaff, staffName } from "./staff";
import { holdJoinedBusiness, useJoinedBusiness, useReplicaLoad, useSyncStatus } from "./sync";
import { SUPPORTED_ZONES, type SupportedZone } from "../zones";
import { dateKey } from "../datetime";
import { SUBJECT_ICON } from "../icons";
import { type SubjectKind, useSubjectKind } from "./subjects";
import { PROVINCE_LOCKED_SQL, taxSummary } from "./taxes";
import { depositCents } from "./catalog";
import { coverTarget, logoTarget, mediaUrl, useFileUpload } from "./files";

interface BusinessRow {
    id: string;
    name: string;
    slug: string;
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
    slug: string;
    timezone: string;
    billing_email: string;
}

// schemas/business.BUSINESS_NAME_MAX
export const BUSINESS_NAME_MAX = 100;
const TAGLINE_MAX = 120;

/** The requested fields a refusal named, with the message each one shows. */
function refusedFields<K extends string>(
    e: unknown,
    messages: Partial<Record<K, () => string>>,
    prefix = "",
): Partial<Record<K, string>> {
    const refused: Partial<Record<K, string>> = {};
    for (const path of failedFields(e)) {
        if (!path.startsWith(prefix)) continue;
        const key = path.slice(prefix.length).split(".")[0] as K;
        const message = messages[key];
        if (message !== undefined) refused[key] = message();
    }
    return refused;
}

function without<K extends string, V>(from: Partial<Record<K, V>>, key: K): Partial<Record<K, V>> {
    return Object.fromEntries(Object.entries(from).filter(([k]) => k !== key)) as Partial<
        Record<K, V>
    >;
}

const PROFILE_KEYS = [
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

// schemas/business.BrandInput
const PROFILE_MAX = {
    about: 3000,
    address: 300,
    phone: 40,
    email: 254,
    website: 2048,
    neighbourhood: 100,
} as const;

// The cover has its own upload control, and pickup settings live with the products.
export const PUBLIC_PROFILE_FIELDS = (
    ["about", "address", "phone", "email", "website", "neighbourhood", "gallery_urls"] as const
).map((key) => ({
    key,
    get label() {
        return strings.business.getSetUp.profile[key];
    },
    multiline: key === "about" || key === "gallery_urls",
    maxLength: key === "gallery_urls" ? undefined : PROFILE_MAX[key],
}));

export const PICKUP_FIELDS = (
    ["pickup_prep_minutes", "pickup_hold_days", "pickup_capacity"] as const
).map((key) => ({
    key,
    get label() {
        return strings.business.getSetUp.profile[key];
    },
}));

type Brand = ProfileFields & {
    logo_file_id: string;
    cover_file_id: string;
    primary: string;
    tagline: string;
    public_staff_ids: string[];
};

const NO_BRAND: Brand = {
    ...EMPTY_PROFILE,
    logo_file_id: "",
    cover_file_id: "",
    primary: "",
    tagline: "",
    public_staff_ids: [],
};

function parseBrand(raw: string | null): Brand {
    if (raw === null || raw === "") return NO_BRAND;
    try {
        const b = JSON.parse(raw) as Record<string, unknown>;
        return {
            ...(Object.fromEntries(
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
            ) as ProfileFields),
            logo_file_id: typeof b.logo_file_id === "string" ? b.logo_file_id : "",
            cover_file_id: typeof b.cover_file_id === "string" ? b.cover_file_id : "",
            primary: typeof b.primary === "string" ? b.primary : "",
            tagline: typeof b.tagline === "string" ? b.tagline : "",
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
    maxLength?: number;
}[] = [
    {
        key: "name",
        get label() {
            return strings.business.nameLabel;
        },
        get placeholder() {
            return strings.business.namePlaceholder;
        },
        maxLength: BUSINESS_NAME_MAX,
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
    /** A document has charged tax, so the province can no longer change. */
    provinceLocked: boolean;
    set: (key: keyof BusinessFields, value: string) => void;
    /** The slug differs from the saved one, so links and QR codes already shared will stop working. */
    slugChanged: boolean;
    fieldErrors: Partial<Record<keyof BusinessFields, string>>;
    dirty: boolean;
    busy: boolean;
    error: string | null;
    saved: boolean;
    submit: () => void;
}

export const BUSINESS_SQL =
    "SELECT id, name, slug, timezone, billing_email, gst_hst_number, qst_number, province, unit, street_number, street_name, city, postal_code, legal_phone, brand FROM businesses LIMIT 1";

function businessFields(row: BusinessRow): BusinessFields {
    return {
        name: row.name,
        slug: row.slug,
        timezone: row.timezone,
        billing_email: row.billing_email ?? "",
        ...located(row),
    };
}

const BUSINESS_FIELD_ERRORS: Partial<Record<keyof BusinessFields, () => string>> = {
    name: () => strings.business.fieldErrors.name,
    billing_email: () => strings.business.fieldErrors.email,
    postal_code: () => strings.business.fieldErrors.postalCode,
    legal_phone: () => strings.business.fieldErrors.legalPhone,
    unit: () => strings.business.fieldErrors.tooLong,
    street_number: () => strings.business.fieldErrors.tooLong,
    street_name: () => strings.business.fieldErrors.tooLong,
    city: () => strings.business.fieldErrors.tooLong,
};

interface FieldErrors<K extends string> {
    errors: Partial<Record<K, string>>;
    clear: (key: K) => void;
    reset: () => void;
    /** Marks the fields a refusal named and returns the message for the whole form. */
    explain: (e: unknown) => string;
}

function useFieldErrors<K extends string>(
    messages: Partial<Record<K, () => string>>,
    prefix = "",
): FieldErrors<K> {
    const [errors, setErrors] = useState<Partial<Record<K, string>>>({});
    return {
        errors,
        clear: (key) => {
            setErrors((current) => without(current, key));
        },
        reset: () => {
            setErrors({});
        },
        explain: (e) => {
            const refused = refusedFields(e, messages, prefix);
            setErrors(refused);
            return Object.keys(refused).length > 0
                ? strings.business.checkFields
                : failureMessage(e, strings.business.saveError);
        },
    };
}

/** Holds only what was edited over the synced row, and sends only that, so a stale form erases nothing. */
export function useBusinessForm(api: ApiLike): BusinessForm {
    const row = useQuery<BusinessRow>(BUSINESS_SQL).data[0] ?? null;
    const locked = useQuery<{ province_locked: number }>(PROVINCE_LOCKED_SQL).data[0];
    const { busy, error, setError, run } = useAsyncAction();
    const draft = useSyncedDraft(row === null ? null : businessFields(row));
    const fieldErrors = useFieldErrors(BUSINESS_FIELD_ERRORS);
    const [saved, setSaved] = useState(false);
    const fields = draft.values;

    const submit = (): void => {
        if (fields === null) return;
        if (fields.name.trim().length === 0) {
            setError(strings.business.nameRequired);
            return;
        }
        const slug = slugify(fields.slug);
        if (slug.length === 0) {
            setError(strings.business.onboarding.slugRequired);
            return;
        }
        const sent = draft.changes;
        const body = { ...sent, ...(sent.slug === undefined ? {} : { slug }) };
        let updated: BusinessRow | null = null;
        run(
            async () => {
                updated = await api.patch<BusinessRow>("/v1/business", body);
            },
            {
                onSuccess: () => {
                    fieldErrors.reset();
                    draft.settle(sent, updated === null ? null : businessFields(updated));
                    setSaved(true);
                },
                errorMessage: fieldErrors.explain,
            },
        );
    };

    return {
        fields,
        province: PROVINCES.find((p) => p.code === row?.province)?.name ?? "",
        provinceLocked: locked?.province_locked === 1,
        set: (key, value) => {
            setSaved(false);
            fieldErrors.clear(key);
            draft.set(key, key === "slug" ? slugDraft(value) : value);
        },
        slugChanged:
            fields !== null && draft.base !== null && slugify(fields.slug) !== draft.base.slug,
        fieldErrors: fieldErrors.errors,
        dirty: draft.dirty,
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
    drivingSchool: "student",
    cleaning: "property",
    landscaping: "property",
    security: "site",
    detailing: "vehicle",
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

/** Typed text as a slug in progress: a trailing dash stays, so the next word can follow it. */
function slugDraft(text: string): string {
    return text
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/gu, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+/, "")
        .slice(0, 40);
}

/** Business name → the public page's subdomain label: lowercase letters, digits and dashes. */
function slugify(name: string): string {
    return slugDraft(name).replace(/-+$/, "");
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
    submit: () => void;
}

// the preview's tax day; the server gives the business its province's zone, hours from this one
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
    const { busy, error, setError, run } = useAsyncAction();

    const setName = (v: string): void => {
        setNameState(v);
        if (!slugEdited) setSlugState(slugify(v));
    };

    const setSlug = (v: string): void => {
        setSlugEdited(true);
        setSlugState(slugDraft(v));
    };

    const submit = (): void => {
        if (name.trim().length === 0) {
            setError(strings.business.onboarding.nameRequired);
            return;
        }
        if (slugify(slug).length === 0) {
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
                onCreated(await onboard(api, { name, slug: slugify(slug), province, industry }));
            },
            {
                errorMessage: (e) =>
                    failedCode(e) === "email_unverified"
                        ? strings.business.onboarding.verifyFirst
                        : failureMessage(e, strings.business.onboarding.createError),
            },
        );
    };

    return {
        name,
        setName,
        slug,
        setSlug,
        province,
        setProvince: (v) => {
            setProvince(v);
            setError(null);
        },
        industry,
        setIndustry: (v) => {
            setIndustry(v);
            setError(null);
        },
        taxSummary:
            province === null ? null : taxSummary(province, dateKey(new Date(), NEW_BUSINESS_ZONE)),
        busy,
        error,
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
    const branded = brand.primary !== "" || brand.logo_file_id !== "";
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
            ...(branded ? { action: o.editBrand } : {}),
            done: branded,
            target: "brand",
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
    /** The booking page's link once it can take bookings, else null. */
    bookingLink: (bookUrl: string) => string | null;
    steps: SetupTask[];
    done: number;
    total: number;
    complete: boolean;
    dismissed: boolean;
    /** A service and hours exist, so the booking page can take bookings. */
    live: boolean;
}

function progressOf(row: SetupCounts | undefined): SetupProgress {
    const counts = row ?? NO_COUNTS;
    const steps = setupTasks(counts);
    const done = steps.filter((x) => x.done).length;
    const live = counts.services > 0 && counts.hours > 0;
    return {
        businessName: counts.name ?? "",
        logoFileId: parseBrand(counts.brand).logo_file_id || null,
        brandColor: parseBrand(counts.brand).primary || null,
        slug: counts.slug,
        bookingLink: (bookUrl) =>
            counts.slug === null || !live ? null : bookingPageUrl(bookUrl, counts.slug),
        steps,
        done,
        total: steps.length,
        complete: row !== undefined && done === steps.length,
        dismissed: counts.dismissed_at !== null,
        live,
    };
}

export function useSetupProgress(): SetupProgress {
    return progressOf(useQuery<SetupCounts>(SETUP_PROGRESS_SQL).data[0]);
}

/** Whether an empty schedule should say what setup is missing: once known, to someone who can add it. */
export function useBookingSetupMissing(viewer: Viewer | null): boolean {
    const row = useQuery<SetupCounts>(SETUP_PROGRESS_SQL).data[0];
    return row !== undefined && !progressOf(row).live && viewer !== null && isManager(viewer.role);
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
    pageUrl: string;
    setHidden: (hidden: boolean) => void;
    hideError: string | null;
}

/** The Get set up list, the same steps and count the sidebar and Today show. */
export function useSetupChecklist(api: ApiLike, pageUrl: string): SetupChecklist {
    const query = useQuery<SetupCounts>(SETUP_PROGRESS_SQL);
    const c = query.data[0] ?? NO_COUNTS;
    const load = useReplicaLoad([query], false);
    const { error, run } = useAsyncAction();
    return {
        ...progressOf(query.data[0]),
        load,
        pageUrl: c.slug === null ? "" : bareUrl(businessPageUrl(pageUrl, c.slug)),
        setHidden: (hidden) => {
            run(() => api.patch("/v1/business", { setup_dismissed: hidden }), {
                errorMessage: strings.business.saveError,
            });
        },
        hideError: error,
    };
}

type BrandFieldKey = ProfileKey | "tagline";

const BRAND_FIELD_ERRORS: Partial<Record<BrandFieldKey, () => string>> = {
    tagline: () => strings.business.fieldErrors.tooLong,
    about: () => strings.business.fieldErrors.tooLong,
    address: () => strings.business.fieldErrors.tooLong,
    neighbourhood: () => strings.business.fieldErrors.tooLong,
    phone: () => strings.business.fieldErrors.tooLong,
    email: () => strings.business.fieldErrors.email,
    website: () => strings.business.fieldErrors.website,
    gallery_urls: () => strings.business.fieldErrors.gallery,
    pickup_prep_minutes: () => strings.business.fieldErrors.pickupPrep,
    pickup_hold_days: () => strings.business.fieldErrors.pickupHold,
    pickup_capacity: () => strings.business.fieldErrors.pickupCapacity,
};

/** A brand picture: uploading one puts its file id in the draft, removing one clears it. */
interface BrandImage {
    src: (apiBase: string) => string | null;
    upload: (body: Blob | Promise<Blob>) => void;
    remove: () => void;
    busy: boolean;
    error: string | null;
}

export interface BrandForm {
    ready: boolean;
    name: string;
    slug: string;
    province: string | null;
    logo: BrandImage;
    cover: BrandImage;
    /** A logo or cover is still on its way, so leaving or saving now would lose it. */
    uploading: boolean;
    colour: string;
    setColour: (v: string) => void;
    tagline: string;
    setTagline: (v: string) => void;
    taglineMax: number;
    profile: ProfileFields;
    setProfile: (key: ProfileKey, value: string) => void;
    publicTeam: { id: string; name: string; selected: boolean }[];
    setPublicTeam: (id: string, selected: boolean) => void;
    fieldErrors: Partial<Record<BrandFieldKey, string>>;
    dirty: boolean;
    busy: boolean;
    error: string | null;
    saved: boolean;
    submit: () => void;
}

export const BRAND_SQL = "SELECT id, name, slug, province, brand FROM businesses LIMIT 1";

function brandValue(key: string, value: string | string[]): unknown {
    if (key === "logo_file_id" || key === "cover_file_id") return value === "" ? null : value;
    if (key === "gallery_urls" && typeof value === "string")
        return value
            .split("\n")
            .map((url) => url.trim())
            .filter(Boolean);
    return key.startsWith("pickup_") ? Number(value) : value;
}

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
    const draft = useSyncedDraft(row === undefined ? null : parseBrand(row.brand));
    const fieldErrors = useFieldErrors(BRAND_FIELD_ERRORS, "brand.");
    const [saved, setSaved] = useState(false);
    const { busy, error, run } = useAsyncAction();
    const current = draft.values ?? NO_BRAND;
    const edit = <K extends keyof Brand>(
        key: K,
        value: Brand[K] | ((current: Brand[K]) => Brand[K]),
    ): void => {
        draft.set(key, value);
        setSaved(false);
        if (key in BRAND_FIELD_ERRORS) fieldErrors.clear(key as BrandFieldKey);
    };
    const logoFiles = useFileUpload(api, (id) => {
        edit("logo_file_id", id);
    });
    const coverFiles = useFileUpload(api, (id) => {
        edit("cover_file_id", id);
    });
    const image = (
        files: ReturnType<typeof useFileUpload>,
        key: "logo_file_id" | "cover_file_id",
        target: typeof logoTarget,
    ): BrandImage => ({
        src: (apiBase) => mediaUrl(apiBase, current[key] === "" ? null : current[key]),
        upload: (body) => {
            if (row !== undefined) files.upload(body, target(row.id));
        },
        remove: () => {
            edit(key, "");
        },
        busy: files.busy,
        error: files.error,
    });
    const uploading = logoFiles.busy || coverFiles.busy;
    return {
        ready: row !== undefined,
        name: row?.name ?? "",
        slug: row?.slug ?? "",
        province: row?.province ?? null,
        logo: image(logoFiles, "logo_file_id", logoTarget),
        cover: image(coverFiles, "cover_file_id", coverTarget),
        uploading,
        colour: current.primary || BRAND_PALETTE.slate,
        setColour: (v) => {
            edit("primary", v);
        },
        tagline: current.tagline,
        setTagline: (v) => {
            edit("tagline", v);
        },
        taglineMax: TAGLINE_MAX,
        profile: Object.fromEntries(
            PROFILE_KEYS.map((key) => [key, current[key]]),
        ) as ProfileFields,
        setProfile: (key, value) => {
            edit(key, value);
        },
        publicTeam: team.map((person) => ({
            id: person.id,
            name: staffName(person),
            selected: current.public_staff_ids.includes(person.id),
        })),
        setPublicTeam: (id, selected) => {
            edit("public_staff_ids", (ids) =>
                selected ? [...new Set([...ids, id])] : ids.filter((value) => value !== id),
            );
        },
        fieldErrors: fieldErrors.errors,
        dirty: draft.dirty,
        busy,
        error,
        saved,
        submit: () => {
            if (draft.values === null || uploading) return;
            logoFiles.reset();
            coverFiles.reset();
            const sent = draft.changes;
            // the colour on show is the one saved, even when the owner kept the suggested swatch
            const brand = {
                ...Object.fromEntries(
                    Object.entries(sent).map(([key, value]) => [key, brandValue(key, value)]),
                ),
                ...(current.primary === "" ? { primary: BRAND_PALETTE.slate } : {}),
            };
            let updated: { brand?: unknown } | null = null;
            run(
                async () => {
                    updated = await api.patch<{ brand?: unknown }>("/v1/business", { brand });
                },
                {
                    errorMessage: fieldErrors.explain,
                    onSuccess: () => {
                        const answer = updated?.brand;
                        fieldErrors.reset();
                        draft.settle(
                            sent,
                            answer === undefined ? null : parseBrand(JSON.stringify(answer)),
                        );
                        setSaved(true);
                    },
                },
            );
        },
    };
}

/** The name a screen reader says for a brand swatch. */
export function brandColourName(colour: string): string {
    const name = (Object.keys(BRAND_PALETTE) as (keyof typeof BRAND_PALETTE)[]).find(
        (key) => BRAND_PALETTE[key] === colour,
    );
    return name === undefined ? colour : strings.business.getSetUp.colourNames[name];
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

/** The booking page's first step from the replica: the bookable services and a pick. */
export function useBookingPreview(limit: number): BookingPreview {
    const items = useQuery<PreviewItem>(BOOKING_PREVIEW_SQL).data.slice(0, limit);
    const kind = useSubjectKind();
    const [selected, setSelected] = useState<string | null>(null);
    const chosen = items.find((i) => i.id === selected) ?? null;
    const b = strings.publicBooking;
    return {
        services: items.map((i) => {
            const deposit = depositCents(i.price_cents, i.deposit_type, i.deposit_value);
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
                          icon: kind === null ? "tag" : SUBJECT_ICON[kind],
                          title: chosen.name,
                          ...(chosen.duration_min !== null
                              ? { detail: durationLabel(chosen.duration_min) }
                              : {}),
                      },
                  ],
    };
}

export interface BusinessSwitch {
    options: SelectOption<string>[];
    selectedId: string | null;
    choose: (id: string) => void;
    busy: boolean;
    error: string | null;
}

const BusinessSwitchContext = createContext<BusinessSwitch | null>(null);

export const BusinessSwitchProvider = BusinessSwitchContext.Provider;

/** The picker for a viewer on more than one team, wherever the shell offers it; null otherwise. */
export function useBusinessSwitch(): BusinessSwitch | null {
    const picker = useContext(BusinessSwitchContext);
    return picker !== null && picker.options.length > 1 ? picker : null;
}

export function useBusinessSelection(bindApi: (businessId: string | null) => void) {
    const db = usePowerSync();
    const businesses = useGlobalQuery<{ id: string; name: string }>(
        "SELECT id, name FROM businesses ORDER BY name, id",
    );
    const selection = useGlobalQuery<{ business_id: string }>(...selectionQuery());
    const selectedId =
        businesses.data.find((row) => row.id === selection.data[0]?.business_id)?.id ?? null;
    useEffect(() => {
        if (selectedId !== null) keepTabBusiness(db, selectedId).catch(() => undefined);
    }, [db, selectedId]);
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
    const joined = useJoinedBusiness();
    useEffect(() => {
        if (joined === null || !businesses.data.some((row) => row.id === joined)) return;
        holdJoinedBusiness(null);
        choose(joined);
    }, [joined, businesses.data, choose]);
    const ready =
        !businesses.error &&
        !selection.error &&
        !businesses.isLoading &&
        !selection.isLoading &&
        // a team just joined is on its way, so the splash holds rather than showing onboarding
        (selectedId !== null || (noBusinesses && confirmedEmpty && joined === null));
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
