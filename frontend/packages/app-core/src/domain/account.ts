import { useQuery } from "@powersync/react";
import { useEffect, useRef, useState } from "react";

import { useAsyncAction } from "../hooks/useAsyncAction";
import { strings } from "../strings";
import type { ApiLike } from "../util/api";
import { mediaUrl } from "./files";

interface AccountRow {
    id: string;
    name: string;
    timezone: string;
    locale: string;
    billing_email: string | null;
    gst_hst_number: string | null;
    qst_number: string | null;
    brand: string | null; // JSON text in the replica: {logo_file_id?, logo_url?, primary?, tagline?}
}

export interface AccountFields {
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

/** The editable business-profile text fields, shared so web + mobile render the same set + labels. */
export const ACCOUNT_TEXT_FIELDS: {
    key: keyof AccountFields;
    label: string;
    placeholder: string;
}[] = [
    { key: "name", label: strings.account.nameLabel, placeholder: strings.account.namePlaceholder },
    {
        key: "timezone",
        label: strings.account.timezoneLabel,
        placeholder: strings.account.timezonePlaceholder,
    },
    {
        key: "billing_email",
        label: strings.account.billingEmailLabel,
        placeholder: strings.account.billingEmailPlaceholder,
    },
    {
        key: "gst_hst_number",
        label: strings.account.gstLabel,
        placeholder: strings.account.gstPlaceholder,
    },
    {
        key: "qst_number",
        label: strings.account.qstLabel,
        placeholder: strings.account.qstPlaceholder,
    },
];

/**
 * The account's selectable UI languages. The picker renders only when more than one is listed.
 */
export const LOCALES: { code: string; label: string }[] = [{ code: "en", label: "English" }];

export interface AccountForm {
    fields: AccountFields | null; // null until the synced business row loads
    businessId: string | null;
    /** The logo to preview: the uploaded file's media link, else a logo set by URL before uploads. */
    logoSrc: (apiBase: string) => string | null;
    set: (key: keyof AccountFields, value: string) => void;
    busy: boolean;
    error: string | null;
    saved: boolean;
    submit: () => void;
}

export const ACCOUNT_SQL =
    "SELECT id, name, timezone, locale, billing_email, gst_hst_number, qst_number, brand FROM businesses LIMIT 1";

/** Account-settings view-model: seed the form from the synced `businesses` row, PATCH the changes.
 *  The saved row flows back via sync, so the form reflects the server on the next render. */
export function useAccountForm(api: ApiLike): AccountForm {
    const row = useQuery<AccountRow>(ACCOUNT_SQL).data[0] ?? null;
    const { busy, error, setError, run } = useAsyncAction();
    const [fields, setFields] = useState<AccountFields | null>(null);
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

    const set = (key: keyof AccountFields, value: string): void => {
        setSaved(false);
        setFields((f) => (f === null ? f : { ...f, [key]: value }));
    };

    const submit = (): void => {
        if (fields === null) return;
        if (fields.name.trim().length === 0) {
            setError(strings.account.nameRequired);
            return;
        }
        // Send `brand` only when it changed, so the mobile Account screen (no brand UI) doesn't
        // overwrite it with empty values.
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
            errorMessage: strings.account.saveError,
        });
    };

    const logoSrc = (apiBase: string): string | null =>
        fields !== null && fields.logo_file_id !== ""
            ? mediaUrl(apiBase, fields.logo_file_id)
            : legacyLogoUrl;

    return { fields, businessId: row?.id ?? null, logoSrc, set, busy, error, saved, submit };
}
