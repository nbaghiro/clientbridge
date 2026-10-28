import { useBusinessQuery as useQuery } from "../hooks";

import { useMemo, useRef, useState } from "react";

import { formatLongDate, formatTime, parseTimestamp } from "../datetime";
import { formatParts } from "../format";
import { useAsyncAction } from "../hooks";
import type { Viewer } from "./auth";
import { useFormQuestions } from "./forms";
import { canManagePayments } from "./payments";
import { type FormAnswer, type PublicFormField, isAnswered } from "./publicForm";
import { strings } from "../strings";
import type { SelectOption } from "../ui";
import { type ApiLike, type Attempt, attemptKey, failureMessage } from "../api";

/** A record staff wrote on a visit with a form; final once written, and never on a device. */
export interface VisitRecord {
    id: string;
    form_id: string;
    form_name: string;
    client_id: string | null;
    booking_id: string;
    visit_at: string;
    service: string;
    written_at: string;
    fields: PublicFormField[];
    answers: Record<string, unknown>;
    author_staff_id: string | null;
    author_name: string | null;
    amends: string | null;
}

// Questions a record can't answer: a record has no upload or signing step.
const UNANSWERABLE = ["file", "image", "signature"];

/** Who wrote a record and when, and whether it corrects an earlier one. */
export function recordByline(record: VisitRecord, zone: string): string {
    const at = parseTimestamp(record.written_at);
    return formatParts([
        record.author_name,
        strings.visitRecords.writtenAt(formatLongDate(at, zone), formatTime(at, zone)),
        record.amends === null ? null : strings.visitRecords.amendment,
    ]);
}

/** The visit a record was written on: "60 minute massage · October 7, 2026". */
export function recordVisit(record: VisitRecord, zone: string): string {
    return formatParts([record.service, formatLongDate(parseTimestamp(record.visit_at), zone)]);
}

export const RECORD_FORMS_SQL = `
SELECT id, name FROM forms
WHERE active = 1 AND send_on = 'manual'
ORDER BY name COLLATE NOCASE`;

/** Who may write and read the records of a visit: its practitioner, or an owner or admin. */
export function canKeepRecords(viewer: Viewer | null, staffId: string | null): boolean {
    return viewer !== null && (canManagePayments(viewer.role) || viewer.staffId === staffId);
}

interface VisitRecordForm {
    forms: SelectOption<string>[];
    formId: string;
    setFormId: (id: string) => void;
    fields: PublicFormField[];
    answers: Record<string, FormAnswer>;
    setAnswer: (name: string, value: FormAnswer) => void;
    amends: string | null;
    busy: boolean;
    error: string | null;
    submit: () => void;
}

/** Fill in a manually sent form on a visit; the record is saved as final, or amends `start`. */
export function useVisitRecordForm(
    api: ApiLike,
    bookingId: string,
    onSaved: (record: VisitRecord) => void,
    start: VisitRecord | null = null,
): VisitRecordForm {
    const forms = useQuery<{ id: string; name: string }>(RECORD_FORMS_SQL).data;
    const [chosen, setChosen] = useState(start?.form_id ?? "");
    const formId = chosen === "" ? (forms[0]?.id ?? "") : chosen;
    const questions = useFormQuestions(formId);
    const fields = useMemo(
        () =>
            (start !== null && start.form_id === formId ? start.fields : questions).filter(
                (f) => !UNANSWERABLE.includes(f.input),
            ),
        [start, formId, questions],
    );
    const [answers, setAnswers] = useState<Record<string, FormAnswer>>(() =>
        start === null ? {} : (start.answers as Record<string, FormAnswer>),
    );
    const key = useRef<Attempt | null>(null);
    const { busy, error, setError, run } = useAsyncAction();
    const v = strings.visitRecords;
    return {
        forms: forms.map((x) => ({ key: x.id, label: x.name })),
        formId,
        setFormId: (id) => {
            setChosen(id);
            setAnswers({});
            setError(null);
        },
        fields,
        answers,
        setAnswer: (name, value) => {
            setAnswers((a) => ({ ...a, [name]: value }));
            setError(null);
        },
        amends: start?.id ?? null,
        busy,
        error,
        submit: () => {
            if (formId === "") {
                setError(v.formMissing);
                return;
            }
            const missing = fields.find((x) => x.required && !isAnswered(answers[x.name]));
            if (missing !== undefined) {
                setError(strings.publicForm.answerRequired(missing.label));
                return;
            }
            const known = new Set(fields.map((x) => x.name));
            const body = {
                form_id: formId,
                booking_id: bookingId,
                answers: Object.fromEntries(
                    Object.entries(answers).filter(([name, a]) => known.has(name) && isAnswered(a)),
                ),
                amends: start?.id ?? null,
            };
            run(
                async () => {
                    const record = await api.post<VisitRecord>("/v1/visit-records", body, {
                        idempotencyKey: attemptKey(key, body),
                    });
                    onSaved(record);
                },
                { errorMessage: (e) => failureMessage(e, v.saveError) },
            );
        },
    };
}

export interface VisitRecords {
    records: VisitRecord[] | null;
    busy: boolean;
    error: string | null;
    // Each read is recorded, so records load only when someone asks to see them.
    show: () => void;
    add: (record: VisitRecord) => void;
}

/** A visit's records, or every record on a client's visits, loaded on request. */
export function useVisitRecords(
    api: ApiLike,
    target: { bookingId: string } | { clientId: string },
): VisitRecords {
    const [records, setRecords] = useState<VisitRecord[] | null>(null);
    const { busy, error, run } = useAsyncAction();
    const query =
        "bookingId" in target
            ? `booking_id=${encodeURIComponent(target.bookingId)}`
            : `client_id=${encodeURIComponent(target.clientId)}`;
    return {
        records,
        busy,
        error,
        show: () => {
            run(
                async () => {
                    const out = await api.get<{ records: VisitRecord[] }>(
                        `/v1/visit-records?${query}`,
                    );
                    setRecords(out.records);
                },
                { errorMessage: (e) => failureMessage(e, strings.visitRecords.loadError) },
            );
        },
        add: (record) => {
            setRecords((list) => [...(list ?? []), record]);
        },
    };
}
