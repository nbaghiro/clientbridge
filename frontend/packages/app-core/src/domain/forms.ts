import { usePowerSync, useQuery } from "@powersync/react";
import { useEffect, useState } from "react";

import { useAsyncAction } from "../hooks/useAsyncAction";
import { useBusinessId } from "../hooks/primitives";
import { strings } from "../strings";
import type { ApiLike } from "../util/api";
import { newIdempotencyKey, newRowId } from "../util/primitives";
import type { PublicBrand } from "./publicBrand";

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
        void run(() => sendForm(api, { form_id: formId, client_id: clientId }), {
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
        void run(
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

export interface PublicFormField {
    id: string;
    type: string;
    name: string;
    label: string;
    help: string | null;
    required: boolean;
    options: unknown[];
    validation: Record<string, unknown>;
    position: number;
}

export interface PublicForm {
    form_name: string;
    business_name: string;
    brand: PublicBrand;
    completed: boolean;
    fields: PublicFormField[];
}

/** A form answer value: a string (most fields), a string list (multiselect), or a boolean (checkbox). */
export type FormAnswer = string | string[] | boolean;

export class PublicFormError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = "PublicFormError";
    }
}

export interface PublicFormClient {
    getForm(token: string): Promise<PublicForm>;
    submit(token: string, answers: Record<string, FormAnswer>): Promise<PublicForm>;
    upload(token: string, file: Blob): Promise<string>; // returns a file_id to store as the answer
}

/** Build a form-fill client bound to the API origin (web `VITE_API_URL`), mirroring
 *  `createPublicPayClient`. Answers are keyed by each field's `name`. */
export function createPublicFormClient(baseUrl: string): PublicFormClient {
    const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
        const res = await fetch(`${baseUrl}${path}`, init);
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new PublicFormError(res.status, text || res.statusText);
        }
        return (await res.json()) as T;
    };

    return {
        getForm: (token) => request<PublicForm>(`/form/${encodeURIComponent(token)}`),
        submit: (token, answers) =>
            request<PublicForm>(`/form/${encodeURIComponent(token)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ answers }),
            }),
        upload: async (token, file) => {
            const meta = await request<{ file_id: string; upload_url: string }>(
                `/form/${encodeURIComponent(token)}/upload`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ content_type: file.type || null, size: file.size }),
                },
            );
            const headers: Record<string, string> = {};
            if (file.type) headers["Content-Type"] = file.type;
            const put = await fetch(meta.upload_url, { method: "PUT", headers, body: file });
            if (!put.ok)
                throw new PublicFormError(put.status, strings.bookingForms.fileUploadFailedDetail);
            return meta.file_id;
        },
    };
}

/** File-capture field types — now uploadable on the public fill page via the upload endpoint, the
 *  answer being the resulting file_id. */
export function isFileField(type: string): boolean {
    return type === "file" || type === "image" || type === "signature";
}

/** Whether a required answer is present (empty string / empty list / unchecked all count as missing),
 *  mirroring the server's `_validate`. */
export function isAnswerMissing(value: FormAnswer | undefined): boolean {
    if (value === undefined) return true;
    if (typeof value === "string") return value.trim().length === 0;
    if (Array.isArray(value)) return value.length === 0;
    return !value;
}

/** Normalize one entry of a select/multiselect field's `options` (a string, a number/bool, or a
 *  `{value,label}` object) into a `{value,label}` pair for rendering. */
export function optionPair(option: unknown): { value: string; label: string } {
    if (typeof option === "string") return { value: option, label: option };
    if (typeof option === "number" || typeof option === "boolean") {
        const s = String(option);
        return { value: s, label: s };
    }
    if (typeof option === "object" && option !== null) {
        const o = option as { value?: unknown; label?: unknown };
        const value = typeof o.value === "string" ? o.value : "";
        const label = typeof o.label === "string" ? o.label : value;
        return { value, label };
    }
    return { value: "", label: "" };
}

export type PublicFormStatus = "loading" | "not-found" | "error" | "done" | "ready";

export interface PublicFormFill {
    status: PublicFormStatus;
    form: PublicForm | null;
    answers: Record<string, FormAnswer>;
    setAnswer: (name: string, value: FormAnswer) => void;
    uploadFor: (name: string, file: Blob) => void;
    submit: () => void;
    busy: boolean;
    error: string | null;
    setError: (message: string | null) => void;
}

/** View-model for the public form-fill page: load the form, track answers by field name, upload
 *  file-fields, validate required fields, and submit. The field inputs render per-platform. */
export function usePublicFormFill(forms: PublicFormClient, token: string): PublicFormFill {
    const [form, setForm] = useState<PublicForm | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [answers, setAnswers] = useState<Record<string, FormAnswer>>({});
    const { busy, error, setError, run } = useAsyncAction();

    useEffect(() => {
        let live = true;
        setLoading(true);
        forms
            .getForm(token)
            .then((f) => {
                if (live) setForm(f);
            })
            .catch((err: unknown) => {
                if (!live) return;
                if (err instanceof PublicFormError && err.status === 404) setNotFound(true);
                else setLoadError(true);
            })
            .finally(() => {
                if (live) setLoading(false);
            });
        return () => {
            live = false;
        };
    }, [forms, token]);

    const status: PublicFormStatus = loading
        ? "loading"
        : notFound
          ? "not-found"
          : loadError || form === null
            ? "error"
            : form.completed
              ? "done"
              : "ready";

    const setAnswer = (name: string, value: FormAnswer): void => {
        setAnswers((a) => ({ ...a, [name]: value }));
        setError(null);
    };

    const uploadFor = (name: string, file: Blob): void => {
        void run(
            async () => {
                setAnswer(name, await forms.upload(token, file));
            },
            { errorMessage: strings.bookingForms.fileUploadError },
        );
    };

    const submit = (): void => {
        const missing = form?.fields.find((f) => f.required && isAnswerMissing(answers[f.name]));
        if (missing !== undefined) {
            setError(strings.bookingForms.answerRequired(missing.label));
            return;
        }
        void run(
            async () => {
                setForm(await forms.submit(token, answers));
            },
            { errorMessage: strings.bookingForms.submitAnswersError },
        );
    };

    return { status, form, answers, setAnswer, uploadFor, submit, busy, error, setError };
}
