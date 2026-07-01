import { useQuery } from "@powersync/react";
import { useEffect, useState } from "react";

import { useAsyncAction } from "../hooks/useAsyncAction";
import type { ApiLike } from "../util/api";

interface AccountRow {
    name: string;
    timezone: string;
    locale: string;
    billing_email: string | null;
    gst_hst_number: string | null;
    qst_number: string | null;
}

export interface AccountFields {
    name: string;
    timezone: string;
    locale: string;
    billing_email: string;
    gst_hst_number: string;
    qst_number: string;
}

/** The editable business-profile text fields, shared so web + mobile render the same set + labels. */
export const ACCOUNT_TEXT_FIELDS: {
    key: keyof AccountFields;
    label: string;
    placeholder: string;
}[] = [
    { key: "name", label: "Business name", placeholder: "Birch Bark Pet Care" },
    { key: "timezone", label: "Time zone", placeholder: "America/Toronto" },
    { key: "billing_email", label: "Billing email", placeholder: "you@example.com" },
    { key: "gst_hst_number", label: "GST/HST number", placeholder: "123456789RT0001" },
    { key: "qst_number", label: "QST number", placeholder: "1234567890TQ0001" },
];

/** Supported UI languages (the bilingual EN/FR selector). */
export const LOCALES: { code: string; label: string }[] = [
    { code: "en", label: "English" },
    { code: "fr", label: "Français" },
];

export interface AccountForm {
    fields: AccountFields | null; // null until the synced business row loads
    set: (key: keyof AccountFields, value: string) => void;
    busy: boolean;
    error: string | null;
    saved: boolean;
    submit: () => void;
}

const SQL =
    "SELECT name, timezone, locale, billing_email, gst_hst_number, qst_number FROM businesses LIMIT 1";

/** Account-settings view-model: seed the form from the synced `businesses` row, PATCH the changes.
 *  The saved row flows back via sync, so the form reflects the server on the next render. */
export function useAccountForm(api: ApiLike): AccountForm {
    const row = useQuery<AccountRow>(SQL).data[0] ?? null;
    const { busy, error, setError, run } = useAsyncAction();
    const [fields, setFields] = useState<AccountFields | null>(null);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        if (row !== null && fields === null) {
            setFields({
                name: row.name,
                timezone: row.timezone,
                locale: row.locale,
                billing_email: row.billing_email ?? "",
                gst_hst_number: row.gst_hst_number ?? "",
                qst_number: row.qst_number ?? "",
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
            setError("Business name is required");
            return;
        }
        void run(() => api.patch("/v1/business", fields), {
            onSuccess: () => {
                setSaved(true);
            },
            errorMessage: "Could not save account settings",
        });
    };

    return { fields, set, busy, error, saved, submit };
}
