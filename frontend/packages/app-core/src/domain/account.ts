import { useQuery } from "@powersync/react";
import { useEffect, useRef, useState } from "react";

import { useAsyncAction } from "../hooks/useAsyncAction";
import { strings } from "../strings";
import type { ApiLike } from "../util/api";

interface AccountRow {
    name: string;
    timezone: string;
    locale: string;
    billing_email: string | null;
    gst_hst_number: string | null;
    qst_number: string | null;
    brand: string | null; // JSON text in the replica: {logo_url?, primary?, tagline?}
}

export interface AccountFields {
    name: string;
    timezone: string;
    locale: string;
    billing_email: string;
    gst_hst_number: string;
    qst_number: string;
    logo_url: string;
    primary: string;
    tagline: string;
}

interface Brand {
    logo_url: string;
    primary: string;
    tagline: string;
}

function parseBrand(raw: string | null): Brand {
    if (raw === null || raw === "") return { logo_url: "", primary: "", tagline: "" };
    try {
        const b = JSON.parse(raw) as Record<string, unknown>;
        return {
            logo_url: typeof b.logo_url === "string" ? b.logo_url : "",
            primary: typeof b.primary === "string" ? b.primary : "",
            tagline: typeof b.tagline === "string" ? b.tagline : "",
        };
    } catch {
        return { logo_url: "", primary: "", tagline: "" };
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
 * Supported UI languages. English-only for now; adding a second entry re-enables the account
 * language picker (which renders only when more than one locale exists). See strings.ts / CLAUDE.md.
 */
export const LOCALES: { code: string; label: string }[] = [{ code: "en", label: "English" }];

export interface AccountForm {
    fields: AccountFields | null; // null until the synced business row loads
    set: (key: keyof AccountFields, value: string) => void;
    busy: boolean;
    error: string | null;
    saved: boolean;
    submit: () => void;
}

const SQL =
    "SELECT name, timezone, locale, billing_email, gst_hst_number, qst_number, brand FROM businesses LIMIT 1";

/** Account-settings view-model: seed the form from the synced `businesses` row, PATCH the changes.
 *  The saved row flows back via sync, so the form reflects the server on the next render. */
export function useAccountForm(api: ApiLike): AccountForm {
    const row = useQuery<AccountRow>(SQL).data[0] ?? null;
    const { busy, error, setError, run } = useAsyncAction();
    const [fields, setFields] = useState<AccountFields | null>(null);
    const [saved, setSaved] = useState(false);
    const loadedBrand = useRef<Brand>({ logo_url: "", primary: "", tagline: "" });

    useEffect(() => {
        if (row !== null && fields === null) {
            const brand = parseBrand(row.brand);
            loadedBrand.current = brand;
            setFields({
                name: row.name,
                timezone: row.timezone,
                locale: row.locale,
                billing_email: row.billing_email ?? "",
                gst_hst_number: row.gst_hst_number ?? "",
                qst_number: row.qst_number ?? "",
                logo_url: brand.logo_url,
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
        // Only send `brand` when it actually changed, so an untouched brand (always the case on the
        // mobile Account screen, which has no brand UI) is omitted and the server preserves it rather
        // than replacing it with stale/empty values.
        const { logo_url, primary, tagline, ...text } = fields;
        const b = loadedBrand.current;
        const brandChanged =
            logo_url !== b.logo_url || primary !== b.primary || tagline !== b.tagline;
        const body = brandChanged ? { ...text, brand: { logo_url, primary, tagline } } : text;
        void run(() => api.patch("/v1/business", body), {
            onSuccess: () => {
                setSaved(true);
            },
            errorMessage: strings.account.saveError,
        });
    };

    return { fields, set, busy, error, saved, submit };
}
