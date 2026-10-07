import { useState } from "react";

import { useAsyncAction } from "../hooks";
import { strings } from "../strings";
import { type PublicBrand, usePublicResource } from "./publicResource";

export interface PublicFormField {
    id: string;
    input: string;
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

class PublicFormError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = "PublicFormError";
    }
}

interface PublicFormClient {
    getForm: (token: string) => Promise<PublicForm>;
    submit(token: string, answers: Record<string, FormAnswer>): Promise<PublicForm>;
    upload(token: string, file: Blob): Promise<string>; // returns a file_id to store as the answer
}

/** Answers are keyed by each field's `name`. */
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
                throw new PublicFormError(put.status, strings.publicForm.fileUploadFailedDetail);
            return meta.file_id;
        },
    };
}

/** Mirrors the server's required-answer check. */
function isAnswerMissing(value: FormAnswer | undefined): boolean {
    if (value === undefined) return true;
    if (typeof value === "string") return value.trim().length === 0;
    if (Array.isArray(value)) return value.length === 0;
    return !value;
}

/** Options may be strings, numbers or `{value,label}` objects. */
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

type PublicFormStatus = "loading" | "not-found" | "error" | "done" | "ready";

interface PublicFormFill {
    status: PublicFormStatus;
    form: PublicForm | null;
    answers: Record<string, FormAnswer>;
    setAnswer: (name: string, value: FormAnswer) => void;
    uploadFor: (name: string, file: Blob) => void;
    submit: () => void;
    busy: boolean;
    error: string | null;
    setError: (message: string | null) => void;
    retry: () => void;
}

export function usePublicFormFill(forms: PublicFormClient, token: string): PublicFormFill {
    const {
        status: load,
        data: form,
        setData: setForm,
        retry,
    } = usePublicResource(forms.getForm, token);
    const [answers, setAnswers] = useState<Record<string, FormAnswer>>({});
    const { busy, error, setError, run } = useAsyncAction();

    const status: PublicFormStatus = load !== "ready" ? load : form?.completed ? "done" : "ready";

    const setAnswer = (name: string, value: FormAnswer): void => {
        setAnswers((a) => ({ ...a, [name]: value }));
        setError(null);
    };

    const uploadFor = (name: string, file: Blob): void => {
        run(
            async () => {
                setAnswer(name, await forms.upload(token, file));
            },
            { errorMessage: strings.publicForm.fileUploadError },
        );
    };

    const submit = (): void => {
        const missing = form?.fields.find((f) => f.required && isAnswerMissing(answers[f.name]));
        if (missing !== undefined) {
            setError(strings.publicForm.answerRequired(missing.label));
            return;
        }
        run(
            async () => {
                setForm(await forms.submit(token, answers));
            },
            { errorMessage: strings.publicForm.submitAnswersError },
        );
    };

    return { status, form, answers, setAnswer, uploadFor, submit, busy, error, setError, retry };
}

const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const UPLOAD_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/heic"];

/** Mirrors the server's upload limit so the client hears about it before the upload starts. */
function uploadProblem(file: { size: number; type: string }): string | null {
    if (!UPLOAD_TYPES.includes(file.type)) return strings.publicForm.uploadWrongType;
    if (file.size > UPLOAD_MAX_BYTES) return strings.publicForm.uploadTooBig;
    return null;
}

export function isAnswered(value: FormAnswer | undefined): boolean {
    return !isAnswerMissing(value);
}

interface FormUploads {
    fileNames: Record<string, string>;
    upload: (fieldName: string, file: Blob, name: string) => void;
}

/** Checks the limit first and shows the problem instead of uploading. */
export function useFormUploads(fill: PublicFormFill): FormUploads {
    const [fileNames, setFileNames] = useState<Record<string, string>>({});
    return {
        fileNames,
        upload: (fieldName, file, name) => {
            const problem = uploadProblem(file);
            if (problem !== null) {
                fill.setError(problem);
                return;
            }
            setFileNames((m) => ({ ...m, [fieldName]: name }));
            fill.uploadFor(fieldName, file);
        },
    };
}
