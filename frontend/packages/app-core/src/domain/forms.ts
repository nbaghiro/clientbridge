import { usePowerSync, useQuery } from "@powersync/react";
import { useState } from "react";

import { useAsyncAction } from "../hooks/useAsyncAction";
import { useBusinessId } from "../hooks/primitives";
import { strings } from "../strings";
import type { ApiLike } from "../util/api";
import { newIdempotencyKey, newRowId } from "../util/primitives";

export interface FormRow {
    id: string;
    name: string;
    require_signature: number;
    active: number;
}

const FORMS_SQL =
    "SELECT id, name, require_signature, active FROM forms ORDER BY active DESC, name COLLATE NOCASE";

export function useForms(): FormRow[] {
    return useQuery<FormRow>(FORMS_SQL).data;
}

export function activeForms(rows: FormRow[]): FormRow[] {
    return rows.filter((f) => f.active === 1);
}

export interface FormFieldRow {
    id: string;
    form_id: string;
    type: string;
    name: string;
    label: string;
    required: number;
    position: number;
}

const FORM_FIELDS_SQL =
    "SELECT id, form_id, type, name, label, required, position FROM form_fields WHERE form_id = ? ORDER BY position";

export function useFormFields(formId: string): FormFieldRow[] {
    return useQuery<FormFieldRow>(FORM_FIELDS_SQL, [formId]).data;
}

export interface FormResponseResult {
    id: string;
    business_id: string;
    form_id: string;
    client_id: string | null;
    status: string;
    token: string;
    submitted_at: string | null;
}

export function sendForm(
    api: ApiLike,
    input: { form_id: string; client_id: string },
): Promise<FormResponseResult> {
    return api.post<FormResponseResult>(
        "/v1/forms/send",
        { form_id: input.form_id, client_id: input.client_id },
        { idempotencyKey: newIdempotencyKey() },
    );
}

export interface SendFormForm {
    formId: string;
    setFormId: (v: string) => void;
    clientId: string;
    setClientId: (v: string) => void;
    busy: boolean;
    error: string | null;
    submit: () => void;
}

/** Shared "send form" form: pick a form + client, then POST the send command. */
export function useSendFormForm(api: ApiLike, onSent: () => void): SendFormForm {
    const [formId, setFormId] = useState("");
    const [clientId, setClientId] = useState("");
    const { busy, error, setError, run } = useAsyncAction();

    const submit = (): void => {
        if (formId === "") {
            setError(strings.bookingForms.selectForm);
            return;
        }
        if (clientId === "") {
            setError(strings.bookingForms.selectClient);
            return;
        }
        run(() => sendForm(api, { form_id: formId, client_id: clientId }), {
            onSuccess: () => {
                setFormId("");
                setClientId("");
                onSent();
            },
            errorMessage: strings.bookingForms.sendFormError,
        });
    };

    return { formId, setFormId, clientId, setClientId, busy, error, submit };
}

/** Field types the minimal builder offers (a subset that renders cleanly on the public fill page). */
export const BUILDER_FIELD_TYPES = [
    "text",
    "longtext",
    "email",
    "phone",
    "number",
    "date",
    "select",
    "multiselect",
    "checkbox",
] as const;

export const FIELD_TYPE_LABEL: Record<string, string> = {
    text: strings.bookingForms.fieldTypeText,
    longtext: strings.bookingForms.fieldTypeLongtext,
    email: strings.bookingForms.fieldTypeEmail,
    phone: strings.bookingForms.fieldTypePhone,
    number: strings.bookingForms.fieldTypeNumber,
    currency: strings.bookingForms.fieldTypeCurrency,
    date: strings.bookingForms.fieldTypeDate,
    time: strings.bookingForms.fieldTypeTime,
    select: strings.bookingForms.fieldTypeSelect,
    multiselect: strings.bookingForms.fieldTypeMultiselect,
    checkbox: strings.bookingForms.fieldTypeCheckbox,
    address: strings.bookingForms.fieldTypeAddress,
    rating: strings.bookingForms.fieldTypeRating,
    file: strings.bookingForms.fieldTypeFile,
    image: strings.bookingForms.fieldTypeImage,
    signature: strings.bookingForms.fieldTypeSignature,
};

export function hasOptions(type: string): boolean {
    return type === "select" || type === "multiselect";
}

export interface DraftField {
    key: string; // local-only list key
    type: string;
    label: string;
    required: boolean;
    options: string; // comma-separated, used when `hasOptions(type)`
}

function newDraftField(): DraftField {
    return { key: crypto.randomUUID(), type: "text", label: "", required: false, options: "" };
}

function slugify(label: string): string {
    return label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function splitOptions(raw: string): string[] {
    return raw
        .split(",")
        .map((o) => o.trim())
        .filter((o) => o.length > 0);
}

export interface FormBuilder {
    name: string;
    setName: (v: string) => void;
    requireSignature: boolean;
    setRequireSignature: (v: boolean) => void;
    fields: DraftField[];
    addField: () => void;
    updateField: (key: string, patch: Partial<Omit<DraftField, "key">>) => void;
    removeField: (key: string) => void;
    busy: boolean;
    error: string | null;
    submit: () => void;
}

/** Minimal form authoring via sync-write: a name + an ordered list of fields, inserted as one
 *  transaction (form first, then its fields) so the FK holds. A full drag-drop builder is a follow. */
export function useFormBuilder(onCreated: () => void): FormBuilder {
    const db = usePowerSync();
    const businessId = useBusinessId();
    const [name, setName] = useState("");
    const [requireSignature, setRequireSignature] = useState(false);
    const [fields, setFields] = useState<DraftField[]>([newDraftField()]);
    const { busy, error, setError, run } = useAsyncAction();

    const addField = (): void => {
        setFields((f) => [...f, newDraftField()]);
    };
    const updateField = (key: string, patch: Partial<Omit<DraftField, "key">>): void => {
        setFields((f) => f.map((field) => (field.key === key ? { ...field, ...patch } : field)));
    };
    const removeField = (key: string): void => {
        setFields((f) => f.filter((field) => field.key !== key));
    };

    const submit = (): void => {
        if (businessId === null) {
            setError(strings.common.stillSyncing);
            return;
        }
        if (name.trim().length === 0) {
            setError(strings.bookingForms.formNameRequired);
            return;
        }
        const usable = fields.filter((f) => f.label.trim().length > 0);
        if (usable.length === 0) {
            setError(strings.bookingForms.addFieldError);
            return;
        }
        const taken = new Set<string>();
        const prepared = usable.map((f, i) => {
            const base = slugify(f.label) || `field_${i + 1}`;
            let key = base;
            let n = 2;
            while (taken.has(key)) key = `${base}_${n++}`;
            taken.add(key);
            const options = hasOptions(f.type) ? splitOptions(f.options) : [];
            return {
                type: f.type,
                fieldName: key,
                label: f.label.trim(),
                required: f.required,
                options,
            };
        });

        const formId = newRowId("frm");
        run(
            async () => {
                await db.writeTransaction(async (tx) => {
                    await tx.execute(
                        "INSERT INTO forms (id, business_id, name, attach_to, require_signature, active) VALUES (?, ?, ?, ?, ?, ?)",
                        [formId, businessId, name.trim(), "[]", requireSignature ? 1 : 0, 1],
                    );
                    for (let i = 0; i < prepared.length; i++) {
                        const f = prepared[i];
                        if (f === undefined) continue;
                        await tx.execute(
                            "INSERT INTO form_fields (id, business_id, form_id, type, name, label, required, options, validation, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                            [
                                newRowId("ff"),
                                businessId,
                                formId,
                                f.type,
                                f.fieldName,
                                f.label,
                                f.required ? 1 : 0,
                                JSON.stringify(f.options),
                                "{}",
                                i,
                            ],
                        );
                    }
                });
            },
            {
                onSuccess: () => {
                    setName("");
                    setRequireSignature(false);
                    setFields([newDraftField()]);
                    onCreated();
                },
                errorMessage: strings.bookingForms.saveFormError,
            },
        );
    };

    return {
        name,
        setName,
        requireSignature,
        setRequireSignature,
        fields,
        addField,
        updateField,
        removeField,
        busy,
        error,
        submit,
    };
}
