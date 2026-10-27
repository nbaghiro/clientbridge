import { useBusinessQuery as useQuery } from "../hooks";
import { personMedia, usePeoplePhotos } from "./files";
import { afterReview, outgoing } from "./previews";

import { useMemo, useState } from "react";

import { formatLongDate, parseTimestamp, readDate, useBusinessZone } from "../datetime";
import { formatList, formatPhone } from "../format";
import { type Load, useAsyncAction } from "../hooks";
import { type ClientRow, useClients } from "./clients";
import { type PublicFormField, optionPair } from "./publicForm";
import { useReplicaLoad } from "./sync";
import { strings } from "../strings";
import type { Intent, KeyValueRow, SelectOption } from "../ui";
import { type ApiLike, failureMessage, newIdempotencyKey } from "../api";

const FIELD_TYPE_LABEL: Record<string, string> = {
    get text() {
        return strings.forms.fieldTypeText;
    },
    get longtext() {
        return strings.forms.fieldTypeLongtext;
    },
    get email() {
        return strings.forms.fieldTypeEmail;
    },
    get phone() {
        return strings.forms.fieldTypePhone;
    },
    get number() {
        return strings.forms.fieldTypeNumber;
    },
    get currency() {
        return strings.forms.fieldTypeCurrency;
    },
    get date() {
        return strings.forms.fieldTypeDate;
    },
    get time() {
        return strings.forms.fieldTypeTime;
    },
    get select() {
        return strings.forms.fieldTypeSelect;
    },
    get multiselect() {
        return strings.forms.fieldTypeMultiselect;
    },
    get checkbox() {
        return strings.forms.fieldTypeCheckbox;
    },
    get address() {
        return strings.forms.fieldTypeAddress;
    },
    get rating() {
        return strings.forms.fieldTypeRating;
    },
    get file() {
        return strings.forms.fieldTypeFile;
    },
    get image() {
        return strings.forms.fieldTypeImage;
    },
    get signature() {
        return strings.forms.fieldTypeSignature;
    },
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

// one statement reads the form and its questions together, so the editor never opens on half a sync
export const FORM_DRAFT_SQL = `
SELECT f.name, f.require_signature, f.send_on, f.active,
       (SELECT json_group_array(json_object('id', q.id, 'input', q.input, 'name', q.name,
                 'label', q.label, 'help', q.help, 'required', q.required, 'options', q.options,
                 'position', q.position))
          FROM (SELECT * FROM fields WHERE form_id = f.id ORDER BY position) q) AS questions
FROM forms f WHERE f.id = ?`;

interface FormDraftRow {
    name: string;
    require_signature: number;
    send_on: string;
    active: number;
    questions: string;
}

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
    const draft = useQuery<FormDraftRow>(FORM_DRAFT_SQL, [formId]);
    if (formId === NEW_FORM) return EMPTY_DRAFT;
    const form = draft.data[0];
    return form === undefined ? null : toFormDraft(form);
}

function toFormDraft(form: FormDraftRow): FormDraft {
    const questions = JSON.parse(form.questions) as QuestionRow[];
    return {
        name: form.name,
        requireSignature: form.require_signature === 1,
        sendOn: form.send_on === "booking" ? "booking" : "manual",
        active: form.active === 1,
        fields: questions.map((q) => ({
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
    clients: SelectOption<string>[];
    clientId: string;
    setClientId: (id: string) => void;
    busy: boolean;
    error: string | null;
    sentTo: string | null;
    send: () => void;
}

/** The client picker's rows: the phone tells two people with the same name apart. */
export function sendOptions(
    clients: ClientRow[],
    photo: (clientId: string) => string | null,
): SelectOption<string>[] {
    return clients.map((c) => {
        const detail = formatPhone(c.phone);
        return {
            key: c.id,
            label: c.name,
            ...(detail === "" ? {} : { detail }),
            media: personMedia(c.name, null, photo(c.id)),
        };
    });
}

/** One link by email, and by text when the client has a number; the server records the request. */
export function useSendToClient(
    api: ApiLike,
    path: "/v1/forms/send" | "/v1/contracts/send",
    body: Record<string, string>,
): SendToClient {
    const photos = usePeoplePhotos();
    const clients = useClients();
    const [clientId, setClientIdRaw] = useState("");
    const [sentTo, setSentTo] = useState<string | null>(null);
    const { busy, error, setError, run } = useAsyncAction();
    return {
        clients: sendOptions(clients, photos.client),
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
            const chosen = clientId;
            afterReview(
                {
                    title: strings.previews.title,
                    confirmLabel: strings.previews.send,
                    load:
                        path === "/v1/forms/send"
                            ? outgoing.formSend(api, body.form_id ?? "", chosen)
                            : outgoing.contractSend(api, body.contract_id ?? "", chosen),
                },
                () => {
                    run(
                        () =>
                            api.post(
                                path,
                                { ...body, client_id: chosen },
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
            );
        },
    };
}

/** A client's submitted form read back with the questions it was answered against. */
export interface FormAnswers {
    id: string;
    form_id: string;
    form_name: string;
    client_id: string | null;
    parent_type: string | null;
    parent_id: string | null;
    submitted_at: string | null;
    fields: PublicFormField[];
    answers: Record<string, unknown>;
    signer_name: string | null;
}

function answerText(field: PublicFormField, value: unknown, zone: string): string {
    const f = strings.forms;
    const label = (v: unknown): string => {
        const match = field.options.map(optionPair).find((o) => o.value === String(v));
        return match?.label ?? String(v);
    };
    if (value === undefined || value === null || value === "") return f.noAnswer;
    if (typeof value === "boolean") return value ? f.answerYes : f.answerNo;
    if (Array.isArray(value))
        return value.length === 0 ? f.noAnswer : formatList(value.map(label), "unit");
    if (field.input === "file" || field.input === "image") return f.answerAttached;
    if (field.input === "date" && typeof value === "string")
        return formatLongDate(readDate(value, zone), zone);
    if (field.input === "select") return label(value);
    return typeof value === "string" ? value : JSON.stringify(value);
}

/** Each question with its answer as read, in the order the form asked them. */
export function answerRows(
    response: Pick<FormAnswers, "fields" | "answers">,
    zone: string,
): KeyValueRow[] {
    return [...response.fields]
        .sort((a, b) => a.position - b.position)
        .map((field) => ({
            label: field.label,
            value: answerText(field, response.answers[field.name], zone),
        }));
}

export const CLIENT_FORMS_SQL = `
SELECT r.id, f.name, r.submitted_at
FROM responses r JOIN forms f ON f.id = r.form_id
WHERE r.client_id = ? AND r.status = 'submitted'
ORDER BY r.submitted_at DESC`;

/** A form's questions as the replica holds them, in order. */
export function useFormQuestions(formId: string): PublicFormField[] {
    const rows = useQuery<QuestionRow>(FORM_QUESTIONS_SQL, [formId]).data;
    return useMemo(
        () =>
            rows.map((q) => ({
                id: q.id,
                input: q.input,
                name: q.name,
                label: q.label,
                help: q.help,
                required: q.required === 1,
                options: parseOptions(q.options),
                position: q.position,
            })),
        [rows],
    );
}

interface ClientForms {
    forms: { id: string; name: string; submittedAt: string }[];
    open: FormAnswers | null;
    busy: boolean;
    error: string | null;
    view: (responseId: string) => void;
    close: () => void;
}

/** A client's submitted forms, such as a health history, and the answers of the one opened. */
export function useClientForms(api: ApiLike, clientId: string): ClientForms {
    const zone = useBusinessZone();
    const rows = useQuery<{ id: string; name: string; submitted_at: string | null }>(
        CLIENT_FORMS_SQL,
        [clientId],
    ).data;
    const [open, setOpen] = useState<FormAnswers | null>(null);
    const { busy, error, setError, run } = useAsyncAction();
    return {
        forms: rows.map((r) => ({
            id: r.id,
            name: r.name,
            submittedAt:
                r.submitted_at === null ? "" : formatLongDate(parseTimestamp(r.submitted_at), zone),
        })),
        open,
        busy,
        error,
        view: (responseId) => {
            run(
                async () => {
                    setOpen(await api.get<FormAnswers>(`/v1/forms/responses/${responseId}`));
                },
                { errorMessage: (e) => failureMessage(e, strings.forms.answersLoadError) },
            );
        },
        close: () => {
            setOpen(null);
            setError(null);
        },
    };
}
