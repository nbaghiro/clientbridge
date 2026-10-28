import {
    type FormAnswers,
    type ScheduleEvent,
    type VisitRecord,
    answerRows,
    canKeepRecords,
    recordByline,
    recordVisit,
    strings,
    useBusinessZone,
    useClientForms,
    useVisitRecordForm,
    useVisitRecords,
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
const v = strings.visitRecords;

/** A form's questions and answers, as the client or practitioner gave them. */
function AnswerList({ response }: { response: Pick<FormAnswers, "fields" | "answers"> }) {
    const zone = useBusinessZone();
    return <KeyValueList layout="stack" rows={answerRows(response, zone)} />;
}

function RecordCard({
    record,
    visit,
    onAmend,
}: {
    record: VisitRecord;
    visit?: boolean;
    onAmend?: (() => void) | undefined;
}) {
    const zone = useBusinessZone();
    return (
        <li className="space-y-2 rounded-md border border-line bg-surface px-4 py-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{record.form_name}</p>
                    <p className="text-xs text-muted">
                        {visit === true ? recordVisit(record, zone) : recordByline(record, zone)}
                    </p>
                    {visit === true ? (
                        <p className="text-xs text-muted">{recordByline(record, zone)}</p>
                    ) : null}
                </div>
                {onAmend !== undefined ? (
                    <Button size="sm" variant="link" onPress={onAmend}>
                        {v.amend}
                    </Button>
                ) : null}
            </div>
            <AnswerList response={record} />
        </li>
    );
}

function RecordDialog({
    bookingId,
    start,
    onSaved,
    onClose,
}: {
    bookingId: string;
    start: VisitRecord | null;
    onSaved: (record: VisitRecord) => void;
    onClose: () => void;
}) {
    const zone = useBusinessZone();
    const form = useVisitRecordForm(api, bookingId, onSaved, start);
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
                    {start === null ? v.newTitle : v.amendTitle}
                </h2>
                {start === null ? (
                    <Select
                        label={v.form}
                        options={form.forms}
                        value={form.formId === "" ? undefined : form.formId}
                        onChange={form.setFormId}
                        placeholder={v.formMissing}
                    />
                ) : (
                    <Notice tone="info">{v.amendHint}</Notice>
                )}
                {form.fields.map((q) => (
                    <FormQuestion
                        key={q.id}
                        zone={zone}
                        field={q}
                        value={form.answers[q.name]}
                        onChange={(answer) => {
                            form.setAnswer(q.name, answer);
                        }}
                        chooseFileLabel={strings.publicForm.chooseFile}
                        selectPlaceholder={strings.publicForm.selectPlaceholder}
                    />
                ))}
                <p className="text-xs text-muted">{v.finalHint}</p>
                {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
                <div className="flex justify-end gap-2">
                    <Button variant="outline" onPress={onClose}>
                        {strings.common.cancel}
                    </Button>
                    <Button submit busy={form.busy} disabled={form.formId === ""}>
                        {form.busy ? v.saving : v.save}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}

/** The visit's records: written by its practitioner or a manager, and read on request. */
export function BookingVisitRecords({ event }: { event: ScheduleEvent }) {
    const viewer = useViewer();
    const bookingId = event.bookingId ?? "";
    const records = useVisitRecords(api, { bookingId });
    const [writing, setWriting] = useState<{ start: VisitRecord | null } | null>(null);
    if (bookingId === "" || !canKeepRecords(viewer, event.staffId)) return null;
    return (
        <DetailSection
            title={v.title}
            action={
                <Button
                    size="sm"
                    variant="quiet"
                    icon="plus"
                    onPress={() => {
                        setWriting({ start: null });
                    }}
                >
                    {v.write}
                </Button>
            }
        >
            {records.records === null ? (
                <Button
                    size="sm"
                    variant="outline"
                    icon="lock"
                    busy={records.busy}
                    onPress={records.show}
                >
                    {records.busy ? v.loading : v.show}
                </Button>
            ) : records.records.length === 0 ? (
                <p className="text-sm text-muted">{v.empty}</p>
            ) : (
                <ul className="space-y-2">
                    {records.records.map((n) => (
                        <RecordCard
                            key={n.id}
                            record={n}
                            onAmend={() => {
                                setWriting({ start: n });
                            }}
                        />
                    ))}
                </ul>
            )}
            <p className="text-xs text-muted">{v.private}</p>
            {records.error !== null ? <Notice tone="danger">{records.error}</Notice> : null}
            {writing !== null ? (
                <RecordDialog
                    bookingId={bookingId}
                    start={writing.start}
                    onSaved={(record) => {
                        if (records.records !== null) records.add(record);
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

/** A client's submitted forms for managers, and the records of their visits the viewer may read. */
export function ClientFormsSection({ clientId, manager }: { clientId: string; manager: boolean }) {
    const forms = useClientForms(api, clientId);
    const records = useVisitRecords(api, { clientId });
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
            {records.records === null ? (
                <Button
                    size="sm"
                    variant="outline"
                    icon="lock"
                    busy={records.busy}
                    onPress={records.show}
                >
                    {records.busy ? v.loading : v.show}
                </Button>
            ) : records.records.length === 0 ? (
                <p className="text-sm text-muted">{v.empty}</p>
            ) : (
                <ul className="space-y-2">
                    {records.records.map((n) => (
                        <RecordCard key={n.id} record={n} visit />
                    ))}
                </ul>
            )}
            {records.error !== null ? <Notice tone="danger">{records.error}</Notice> : null}
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
