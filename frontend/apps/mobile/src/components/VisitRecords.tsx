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
import { theme } from "@clientbridge/tokens/native";
import {
    Button,
    DetailSection,
    FormQuestion,
    KeyValueList,
    Modal,
    Notice,
    Panel,
    Select,
    SheetHeader,
} from "@clientbridge/ui";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { api } from "../lib/api";
import { useViewer } from "../lib/auth";

const c = theme.colors;
const f = strings.forms;
const v = strings.visitRecords;

/** A form's questions and answers, as the client or practitioner gave them. */
function AnswerList({ response }: { response: Pick<FormAnswers, "fields" | "answers"> }) {
    const zone = useBusinessZone();
    return <KeyValueList layout="stack" rows={answerRows(response, zone)} />;
}

function RecordCard({
    record,
    visit = false,
    onAmend,
}: {
    record: VisitRecord;
    visit?: boolean;
    onAmend?: (() => void) | undefined;
}) {
    const zone = useBusinessZone();
    return (
        <Panel style={styles.card}>
            <View style={styles.head}>
                <View style={styles.flex}>
                    <Text style={styles.title}>{record.form_name}</Text>
                    {visit ? <Text style={styles.muted}>{recordVisit(record, zone)}</Text> : null}
                    <Text style={styles.muted}>{recordByline(record, zone)}</Text>
                </View>
                {onAmend !== undefined ? (
                    <Button size="sm" variant="link" onPress={onAmend}>
                        {v.amend}
                    </Button>
                ) : null}
            </View>
            <AnswerList response={record} />
        </Panel>
    );
}

function RecordSheet({
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
        <Modal onClose={onClose} size="xl">
            <ScrollView contentContainerStyle={styles.sheet}>
                <SheetHeader title={start === null ? v.newTitle : v.amendTitle} />
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
                <Text style={styles.muted}>{v.finalHint}</Text>
                {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
                <View style={styles.actions}>
                    <Button variant="outline" grow onPress={onClose}>
                        {strings.common.cancel}
                    </Button>
                    <Button
                        grow
                        busy={form.busy}
                        disabled={form.formId === ""}
                        onPress={form.submit}
                    >
                        {form.busy ? v.saving : v.save}
                    </Button>
                </View>
            </ScrollView>
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
        <DetailSection title={v.title}>
            <View style={styles.actions}>
                <Button
                    size="sm"
                    variant="outline"
                    icon="plus"
                    onPress={() => {
                        setWriting({ start: null });
                    }}
                >
                    {v.write}
                </Button>
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
                ) : null}
            </View>
            {records.records?.length === 0 ? <Text style={styles.muted}>{v.empty}</Text> : null}
            {records.records?.map((n) => (
                <RecordCard
                    key={n.id}
                    record={n}
                    onAmend={() => {
                        setWriting({ start: n });
                    }}
                />
            ))}
            <Text style={styles.muted}>{v.private}</Text>
            {records.error !== null ? <Notice tone="danger">{records.error}</Notice> : null}
            {writing !== null ? (
                <RecordSheet
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
            {manager && forms.forms.length === 0 ? (
                <Text style={styles.muted}>{f.noClientForms}</Text>
            ) : null}
            {manager
                ? forms.forms.map((x) => (
                      <View key={x.id} style={styles.row}>
                          <View style={styles.flex}>
                              <Text style={styles.title} numberOfLines={1}>
                                  {x.name}
                              </Text>
                              <Text style={styles.muted}>{x.submittedAt}</Text>
                          </View>
                          <Button
                              size="sm"
                              variant="link"
                              onPress={() => {
                                  forms.view(x.id);
                              }}
                          >
                              {f.viewAnswers}
                          </Button>
                      </View>
                  ))
                : null}
            {records.records === null ? (
                <View style={styles.actions}>
                    <Button
                        size="sm"
                        variant="outline"
                        icon="lock"
                        busy={records.busy}
                        onPress={records.show}
                    >
                        {records.busy ? v.loading : v.show}
                    </Button>
                </View>
            ) : records.records.length === 0 ? (
                <Text style={styles.muted}>{v.empty}</Text>
            ) : (
                records.records.map((n) => <RecordCard key={n.id} record={n} visit />)
            )}
            {records.error !== null ? <Notice tone="danger">{records.error}</Notice> : null}
            {forms.error !== null ? <Notice tone="danger">{forms.error}</Notice> : null}
            {open !== null ? (
                <Modal onClose={forms.close} size="xl">
                    <ScrollView contentContainerStyle={styles.sheet}>
                        <SheetHeader title={open.form_name} />
                        <AnswerList response={open} />
                        <Button variant="outline" onPress={forms.close}>
                            {strings.common.close}
                        </Button>
                    </ScrollView>
                </Modal>
            ) : null}
        </DetailSection>
    );
}

const styles = StyleSheet.create({
    card: { gap: 8, marginTop: 8 },
    head: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
    row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
    flex: { flex: 1, minWidth: 0 },
    title: { color: c.ink, fontFamily: theme.fonts.ui, fontSize: 14, fontWeight: "600" },
    muted: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 12, marginTop: 4 },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
    sheet: { gap: 14, paddingBottom: 24 },
});
