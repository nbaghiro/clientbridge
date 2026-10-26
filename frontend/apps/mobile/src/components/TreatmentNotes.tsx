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

/** A submitted form's questions and answers, as the client or practitioner gave them. */
function AnswerList({ response }: { response: FormAnswers }) {
    const zone = useBusinessZone();
    return <KeyValueList layout="stack" rows={answerRows(response, zone)} />;
}

function NoteCard({
    note,
    visit = false,
    onAmend,
}: {
    note: TreatmentNote;
    visit?: boolean;
    onAmend?: (() => void) | undefined;
}) {
    const zone = useBusinessZone();
    return (
        <Panel style={styles.card}>
            <View style={styles.head}>
                <View style={styles.flex}>
                    <Text style={styles.title}>{note.form_name}</Text>
                    {visit ? <Text style={styles.muted}>{noteVisit(note, zone)}</Text> : null}
                    <Text style={styles.muted}>{noteByline(note, zone)}</Text>
                </View>
                {onAmend !== undefined ? (
                    <Button size="sm" variant="link" onPress={onAmend}>
                        {f.amendNote}
                    </Button>
                ) : null}
            </View>
            <AnswerList response={note} />
        </Panel>
    );
}

function NoteSheet({
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
        <Modal onClose={onClose} size="xl">
            <ScrollView contentContainerStyle={styles.sheet}>
                <SheetHeader title={start === null ? f.treatmentNote : f.amendTitle} />
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
                <Text style={styles.muted}>{f.noteFinalHint}</Text>
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
                        {form.busy ? f.savingNote : f.saveNote}
                    </Button>
                </View>
            </ScrollView>
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
        <DetailSection title={f.treatmentNotes}>
            <View style={styles.actions}>
                <Button
                    size="sm"
                    variant="outline"
                    icon="plus"
                    onPress={() => {
                        setWriting({ start: null });
                    }}
                >
                    {f.writeNote}
                </Button>
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
                ) : null}
            </View>
            {notes.notes?.length === 0 ? <Text style={styles.muted}>{f.noNotes}</Text> : null}
            {notes.notes?.map((n) => (
                <NoteCard
                    key={n.id}
                    note={n}
                    onAmend={() => {
                        setWriting({ start: n });
                    }}
                />
            ))}
            <Text style={styles.muted}>{f.notesPrivate}</Text>
            {notes.error !== null ? <Notice tone="danger">{notes.error}</Notice> : null}
            {writing !== null ? (
                <NoteSheet
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
            {notes.notes === null ? (
                <View style={styles.actions}>
                    <Button
                        size="sm"
                        variant="outline"
                        icon="lock"
                        busy={notes.busy}
                        onPress={notes.show}
                    >
                        {notes.busy ? f.loadingNotes : f.showNotes}
                    </Button>
                </View>
            ) : notes.notes.length === 0 ? (
                <Text style={styles.muted}>{f.noNotes}</Text>
            ) : (
                notes.notes.map((n) => <NoteCard key={n.id} note={n} visit />)
            )}
            {notes.error !== null ? <Notice tone="danger">{notes.error}</Notice> : null}
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
