import {
    type FormAnswers,
    type ScheduleEvent,
    type TreatmentNote,
    answerRows,
    canKeepNotes,
    noteByline,
    noteVisit,
    strings,
    useBusinessZone,
    useClientForms,
    useTreatmentNoteForm,
    useTreatmentNotes,
} from "@clientbridge/app-core";
import {
    Button,
    DetailSection,
    FormQuestion,
    KeyValueList,
    Modal,
    Notice,
    Select,
} from "@clientbridge/ui";
import { useState } from "react";

import { api } from "../lib/api";
import { useViewer } from "../lib/auth";

const f = strings.forms;

/** A submitted form's questions and answers, as the client or practitioner gave them. */
function AnswerList({ response }: { response: FormAnswers }) {
    const zone = useBusinessZone();
    return <KeyValueList layout="stack" rows={answerRows(response, zone)} />;
}

function NoteCard({
    note,
    visit,
    onAmend,
}: {
    note: TreatmentNote;
    visit?: boolean;
    onAmend?: (() => void) | undefined;
}) {
    const zone = useBusinessZone();
    return (
        <li className="space-y-2 rounded-md border border-line bg-surface px-4 py-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{note.form_name}</p>
                    <p className="text-xs text-muted">
                        {visit === true ? noteVisit(note, zone) : noteByline(note, zone)}
                    </p>
                    {visit === true ? (
                        <p className="text-xs text-muted">{noteByline(note, zone)}</p>
                    ) : null}
                </div>
                {onAmend !== undefined ? (
                    <Button size="sm" variant="link" onPress={onAmend}>
                        {f.amendNote}
                    </Button>
                ) : null}
            </div>
            <AnswerList response={note} />
        </li>
    );
}

function NoteDialog({
    bookingId,
    start,
    onSaved,
    onClose,
}: {
    bookingId: string;
    start: TreatmentNote | null;
    onSaved: (note: TreatmentNote) => void;
    onClose: () => void;
}) {
    const zone = useBusinessZone();
    const form = useTreatmentNoteForm(api, bookingId, onSaved, start);
    return (
        <Modal onClose={onClose} size="lg">
            <form
                className="space-y-5"
                onSubmit={(e) => {
                    e.preventDefault();
                    form.submit();
                }}
            >
                <h2 className="font-display text-lg font-bold text-ink">
                    {start === null ? f.treatmentNote : f.amendTitle}
                </h2>
                {start === null ? (
                    <Select
                        label={f.noteForm}
                        options={form.forms}
                        value={form.formId === "" ? undefined : form.formId}
                        onChange={form.setFormId}
                        placeholder={f.noteFormMissing}
                    />
                ) : (
                    <Notice tone="info">{f.amendHint}</Notice>
                )}
                {form.fields.map((q) => (
                    <FormQuestion
                        key={q.id}
                        zone={zone}
                        field={q}
                        value={form.answers[q.name]}
                        onChange={(v) => {
                            form.setAnswer(q.name, v);
                        }}
                        chooseFileLabel={strings.publicForm.chooseFile}
                        selectPlaceholder={strings.publicForm.selectPlaceholder}
                    />
                ))}
                <p className="text-xs text-muted">{f.noteFinalHint}</p>
                {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
                <div className="flex justify-end gap-2">
                    <Button variant="outline" onPress={onClose}>
                        {strings.common.cancel}
                    </Button>
                    <Button submit busy={form.busy} disabled={form.formId === ""}>
                        {form.busy ? f.savingNote : f.saveNote}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}

/** The visit's treatment notes: written by its practitioner or a manager, and read on request. */
export function BookingTreatmentNotes({ event }: { event: ScheduleEvent }) {
    const viewer = useViewer();
    const bookingId = event.bookingId ?? "";
    const notes = useTreatmentNotes(api, { bookingId });
    const [writing, setWriting] = useState<{ start: TreatmentNote | null } | null>(null);
    if (bookingId === "" || !canKeepNotes(viewer, event.staffId)) return null;
    return (
        <DetailSection
            title={f.treatmentNotes}
            action={
                <Button
                    size="sm"
                    variant="quiet"
                    icon="plus"
                    onPress={() => {
                        setWriting({ start: null });
                    }}
                >
                    {f.writeNote}
                </Button>
            }
        >
            {notes.notes === null ? (
                <Button
                    size="sm"
                    variant="outline"
                    icon="lock"
                    busy={notes.busy}
                    onPress={notes.show}
                >
                    {notes.busy ? f.loadingNotes : f.showNotes}
                </Button>
            ) : notes.notes.length === 0 ? (
                <p className="text-sm text-muted">{f.noNotes}</p>
            ) : (
                <ul className="space-y-2">
                    {notes.notes.map((n) => (
                        <NoteCard
                            key={n.id}
                            note={n}
                            onAmend={() => {
                                setWriting({ start: n });
                            }}
                        />
                    ))}
                </ul>
            )}
            <p className="text-xs text-muted">{f.notesPrivate}</p>
            {notes.error !== null ? <Notice tone="danger">{notes.error}</Notice> : null}
            {writing !== null ? (
                <NoteDialog
                    bookingId={bookingId}
                    start={writing.start}
                    onSaved={(note) => {
                        if (notes.notes !== null) notes.add(note);
                        setWriting(null);
                    }}
                    onClose={() => {
                        setWriting(null);
                    }}
                />
            ) : null}
        </DetailSection>
    );
}

/** A client's submitted forms for managers, and the notes on their visits that the viewer may read. */
export function ClientFormsSection({ clientId, manager }: { clientId: string; manager: boolean }) {
    const forms = useClientForms(api, clientId);
    const notes = useTreatmentNotes(api, { clientId });
    const open = forms.open;
    return (
        <DetailSection title={f.clientForms}>
            {manager ? (
                forms.forms.length === 0 ? (
                    <p className="text-sm text-muted">{f.noClientForms}</p>
                ) : (
                    <ul className="divide-y divide-line-soft rounded-md border border-line">
                        {forms.forms.map((x) => (
                            <li
                                key={x.id}
                                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                            >
                                <span className="min-w-0 truncate text-ink">{x.name}</span>
                                <span className="flex items-center gap-3">
                                    <span className="text-xs text-muted">{x.submittedAt}</span>
                                    <Button
                                        size="sm"
                                        variant="link"
                                        onPress={() => {
                                            forms.view(x.id);
                                        }}
                                    >
                                        {f.viewAnswers}
                                    </Button>
                                </span>
                            </li>
                        ))}
                    </ul>
                )
            ) : null}
            {notes.notes === null ? (
                <Button
                    size="sm"
                    variant="outline"
                    icon="lock"
                    busy={notes.busy}
                    onPress={notes.show}
                >
                    {notes.busy ? f.loadingNotes : f.showNotes}
                </Button>
            ) : notes.notes.length === 0 ? (
                <p className="text-sm text-muted">{f.noNotes}</p>
            ) : (
                <ul className="space-y-2">
                    {notes.notes.map((n) => (
                        <NoteCard key={n.id} note={n} visit />
                    ))}
                </ul>
            )}
            {notes.error !== null ? <Notice tone="danger">{notes.error}</Notice> : null}
            {forms.error !== null ? <Notice tone="danger">{forms.error}</Notice> : null}
            {open !== null ? (
                <Modal onClose={forms.close} size="lg">
                    <div className="space-y-4">
                        <h2 className="font-display text-lg font-bold text-ink">
                            {open.form_name}
                        </h2>
                        <AnswerList response={open} />
                        <div className="flex justify-end">
                            <Button variant="outline" onPress={forms.close}>
                                {strings.common.close}
                            </Button>
                        </div>
                    </div>
                </Modal>
            ) : null}
        </DetailSection>
    );
}
