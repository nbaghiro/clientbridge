import { useBusinessQuery as useQuery } from "../hooks";

import { useMemo, useState } from "react";

import { type Load, useAsyncAction } from "../hooks";
import { useClients } from "./clients";
import { type PublicFormField, optionPair } from "./publicForm";
import { useReplicaLoad } from "./sync";
import { strings } from "../strings";
import type { Intent } from "../ui";
import { type ApiLike, newIdempotencyKey } from "../api";

const FIELD_TYPE_LABEL: Record<string, string> = {
    text: strings.forms.fieldTypeText,
    longtext: strings.forms.fieldTypeLongtext,
    email: strings.forms.fieldTypeEmail,
    phone: strings.forms.fieldTypePhone,
    number: strings.forms.fieldTypeNumber,
    currency: strings.forms.fieldTypeCurrency,
    date: strings.forms.fieldTypeDate,
    time: strings.forms.fieldTypeTime,
    select: strings.forms.fieldTypeSelect,
    multiselect: strings.forms.fieldTypeMultiselect,
    checkbox: strings.forms.fieldTypeCheckbox,
    address: strings.forms.fieldTypeAddress,
    rating: strings.forms.fieldTypeRating,
    file: strings.forms.fieldTypeFile,
    image: strings.forms.fieldTypeImage,
    signature: strings.forms.fieldTypeSignature,
};

export function hasOptions(input: string): boolean {
    return input === "select" || input === "multiselect";
}

interface FormSummary {
    id: string;
    name: string;
    require_signature: number;
    active: number;
    send_on: string;
    field_count: number;
    submitted: number;
    waiting: number;
    last_submitted_at: string | null;
}

export const FORM_LIBRARY_SQL = `
SELECT f.id, f.name, f.require_signature, f.active, f.send_on,
       (SELECT COUNT(*) FROM fields x WHERE x.form_id = f.id) AS field_count,
       (SELECT COUNT(*) FROM responses r WHERE r.form_id = f.id AND r.status = 'submitted')
           AS submitted,
       (SELECT COUNT(*) FROM responses r WHERE r.form_id = f.id AND r.status = 'draft') AS waiting,
       (SELECT MAX(r.submitted_at) FROM responses r WHERE r.form_id = f.id) AS last_submitted_at
FROM forms f
ORDER BY f.active DESC, f.name COLLATE NOCASE`;

export const FORM_QUESTIONS_SQL = `
SELECT id, input, name, label, help, required, options, position
FROM fields WHERE form_id = ? ORDER BY position`;

interface QuestionRow {
    id: string;
    input: string;
    name: string;
    label: string;
    help: string | null;
    required: number;
    options: string | null;
    position: number;
}

export function useFormLibrary(): { load: Load; forms: FormSummary[] } {
    const forms = useQuery<FormSummary>(FORM_LIBRARY_SQL);
    return { load: useReplicaLoad([forms], forms.data.length === 0), forms: forms.data };
}

export function formSendLabel(form: FormSummary): { label: string; intent: Intent } {
    const p = strings.forms;
    if (form.active !== 1) return { label: p.draft, intent: "warning" };
    return form.send_on === "booking"
        ? { label: p.sendsOnBooking, intent: "success" }
        : { label: p.sendsManually, intent: "accent" };
}

export function fieldTypeLabel(input: string): string {
    return FIELD_TYPE_LABEL[input] ?? input;
}

const EDITOR_FIELD_TYPES: readonly string[] = [
    "text",
    "longtext",
    "email",
    "phone",
    "number",
    "date",
    "select",
    "multiselect",
    "checkbox",
    "file",
];

/** The answer types to offer for a question, keeping an older type it already has. */
export function editorTypes(current: string): readonly string[] {
    return EDITOR_FIELD_TYPES.includes(current)
        ? EDITOR_FIELD_TYPES
        : [...EDITOR_FIELD_TYPES, current];
}

// The editor's id for a form that isn't saved yet.
export const NEW_FORM = "new";

export interface EditorField {
    key: string;
    // Null for a question added in this editor; a saved one keeps its answer key.
    id: string | null;
    input: string;
    label: string;
    help: string;
    required: boolean;
    options: string[];
}

export interface FormDraft {
    name: string;
    requireSignature: boolean;
    sendOn: "booking" | "manual";
    active: boolean;
    fields: EditorField[];
}

const EMPTY_DRAFT: FormDraft = {
    name: "",
    requireSignature: false,
    sendOn: "manual",
    active: true,
    fields: [],
};

function parseOptions(raw: string | null): string[] {
    if (raw === null) return [];
    try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map((o) => optionPair(o).label) : [];
    } catch {
        return [];
    }
}

/** The saved form as an editable draft; null until its questions have loaded. */
export function useFormDraft(formId: string): FormDraft | null {
    const forms = useQuery<FormSummary>(FORM_LIBRARY_SQL);
    const questions = useQuery<QuestionRow>(FORM_QUESTIONS_SQL, [formId]);
    if (formId === NEW_FORM) return EMPTY_DRAFT;
    const form = forms.data.find((f) => f.id === formId);
    if (form === undefined || questions.isLoading) return null;
    return {
        name: form.name,
        requireSignature: form.require_signature === 1,
        sendOn: form.send_on === "booking" ? "booking" : "manual",
        active: form.active === 1,
        fields: questions.data.map((q) => ({
            key: q.id,
            id: q.id,
            input: q.input,
            label: q.label,
            help: q.help ?? "",
            required: q.required === 1,
            options: parseOptions(q.options),
        })),
    };
}

type FormEditorError = "name-missing" | "no-fields" | "options-missing" | "save-failed";

export interface FormEditor {
    name: string;
    setName: (v: string) => void;
    requireSignature: boolean;
    setRequireSignature: (v: boolean) => void;
    sendOn: "booking" | "manual";
    setSendOn: (v: "booking" | "manual") => void;
    fields: EditorField[];
    selectedKey: string | null;
    select: (key: string | null) => void;
    addField: (input: string) => void;
    updateField: (key: string, patch: Partial<Omit<EditorField, "key" | "id">>) => void;
    removeField: (key: string) => void;
    moveField: (key: string, by: -1 | 1) => void;
    preview: PublicFormField[];
    dirty: boolean;
    busy: boolean;
    error: FormEditorError | null;
    problemKey: string | null;
    saved: boolean;
    save: () => void;
}

let draftSeq = 0;

interface SavedForm {
    id: string;
    fields: PublicFormField[];
}

const toEditorField = (q: PublicFormField): EditorField => ({
    key: q.id,
    id: q.id,
    input: q.input,
    label: q.label,
    help: q.help ?? "",
    required: q.required,
    options: q.options.map((o) => optionPair(o).label),
});

/** Saving replaces the name, send rule and ordered questions; a new form comes back with its id. */
export function useFormEditor(
    api: ApiLike,
    formId: string,
    initial: FormDraft,
    onCreated: (id: string) => void,
): FormEditor {
    const [name, setNameRaw] = useState(initial.name);
    const [requireSignature, setSig] = useState(initial.requireSignature);
    const [sendOn, setSendOnRaw] = useState(initial.sendOn);
    const [fields, setFields] = useState<EditorField[]>(initial.fields);
    const [selectedKey, select] = useState<string | null>(null);
    const [dirty, setDirty] = useState(false);
    const [problem, setProblem] = useState<FormEditorError | null>(null);
    const [problemKey, setProblemKey] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);
    const action = useAsyncAction();

    const touch = (): void => {
        setDirty(true);
        setSaved(false);
        setProblem(null);
        setProblemKey(null);
    };

    const preview = useMemo<PublicFormField[]>(
        () =>
            fields.map((f, i) => ({
                id: f.key,
                input: f.input,
                name: f.key,
                label: f.label,
                help: f.help.trim() || null,
                required: f.required,
                options: f.options.filter((o) => o.trim().length > 0),
                validation: {},
                position: i,
            })),
        [fields],
    );

    const save = (): void => {
        if (name.trim().length === 0) {
            setProblem("name-missing");
            return;
        }
        const usable = fields.filter((f) => f.label.trim().length > 0);
        if (usable.length === 0) {
            setProblem("no-fields");
            return;
        }
        const thin = usable.find(
            (f) => hasOptions(f.input) && f.options.filter((o) => o.trim()).length < 2,
        );
        if (thin !== undefined) {
            setProblem("options-missing");
            setProblemKey(thin.key);
            select(thin.key);
            return;
        }
        const body = {
            name: name.trim(),
            require_signature: requireSignature,
            send_on: sendOn,
            active: initial.active,
            fields: usable.map((f) => ({
                id: f.id,
                input: f.input,
                label: f.label.trim(),
                help: f.help.trim() || null,
                required: f.required,
                options: hasOptions(f.input) ? f.options.filter((o) => o.trim()) : [],
            })),
        };
        action.run(
            async () => {
                const out =
                    formId === NEW_FORM
                        ? await api.post<SavedForm>("/v1/forms", body, {
                              idempotencyKey: newIdempotencyKey(),
                          })
                        : await api.patch<SavedForm>(`/v1/forms/${formId}`, body);
                setFields(out.fields.map(toEditorField));
                select(null);
                if (formId === NEW_FORM) onCreated(out.id);
            },
            {
                onSuccess: () => {
                    setDirty(false);
                    setSaved(true);
                },
            },
        );
    };

    return {
        name,
        setName: (v) => {
            touch();
            setNameRaw(v);
        },
        requireSignature,
        setRequireSignature: (v) => {
            touch();
            setSig(v);
        },
        sendOn,
        setSendOn: (v) => {
            touch();
            setSendOnRaw(v);
        },
        fields,
        selectedKey,
        select,
        addField: (input) => {
            touch();
            draftSeq += 1;
            const key = `draft_${String(draftSeq)}`;
            setFields((list) => [
                ...list,
                {
                    key,
                    id: null,
                    input,
                    label: "",
                    help: "",
                    required: false,
                    options: hasOptions(input) ? ["", ""] : [],
                },
            ]);
            select(key);
        },
        updateField: (key, patch) => {
            touch();
            setFields((list) => list.map((f) => (f.key === key ? { ...f, ...patch } : f)));
        },
        removeField: (key) => {
            touch();
            setFields((list) => list.filter((f) => f.key !== key));
            if (selectedKey === key) select(null);
        },
        moveField: (key, by) => {
            touch();
            setFields((list) => {
                const i = list.findIndex((f) => f.key === key);
                const j = i + by;
                if (i < 0 || j < 0 || j >= list.length) return list;
                const next = [...list];
                const [moved] = next.splice(i, 1);
                if (moved !== undefined) next.splice(j, 0, moved);
                return next;
            });
        },
        preview,
        dirty,
        busy: action.busy,
        error: problem ?? (action.error === null ? null : "save-failed"),
        problemKey,
        saved,
        save,
    };
}

export interface SendToClient {
    clients: { key: string; label: string }[];
    clientId: string;
    setClientId: (id: string) => void;
    busy: boolean;
    error: string | null;
    sentTo: string | null;
    send: () => void;
}

/** One link by email, and by text when the client has a number; the server records the request. */
export function useSendToClient(
    api: ApiLike,
    path: "/v1/forms/send" | "/v1/contracts/send",
    body: Record<string, string>,
): SendToClient {
    const clients = useClients();
    const [clientId, setClientIdRaw] = useState("");
    const [sentTo, setSentTo] = useState<string | null>(null);
    const { busy, error, setError, run } = useAsyncAction();
    return {
        clients: clients.map((c) => ({ key: c.id, label: c.name })),
        clientId,
        setClientId: (id) => {
            setClientIdRaw(id);
            setSentTo(null);
            setError(null);
        },
        busy,
        error,
        sentTo,
        send: () => {
            if (clientId === "") {
                setError(strings.forms.pickClient);
                return;
            }
            const name = clients.find((c) => c.id === clientId)?.name ?? "";
            run(
                () =>
                    api.post(
                        path,
                        { ...body, client_id: clientId },
                        { idempotencyKey: newIdempotencyKey() },
                    ),
                {
                    onSuccess: () => {
                        setSentTo(name);
                    },
                    errorMessage: strings.forms.sendFailed,
                },
            );
        },
    };
}
