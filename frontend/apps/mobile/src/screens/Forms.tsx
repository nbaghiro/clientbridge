import {
    type EditorField,
    type FormDraft,
    type FormEditor,
    NEW_FORM,
    editorTypes,
    fieldTypeLabel,
    formSendLabel,
    hasOptions,
    strings,
    useFormDraft,
    useFormEditor,
    useFormLibrary,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Badge,
    Button,
    Choice,
    Empty,
    Field,
    FormQuestion,
    IconButton,
    ListRow,
    Loading,
    Modal,
    Notice,
    Tabs,
    TextField,
    Toggle,
} from "@clientbridge/ui";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { Loaded } from "../components/Loaded";
import { SendToClientSheet } from "../components/SendToClient";
import { api } from "../lib/api";

const c = theme.colors;
const s = strings.forms.page;
const f = strings.publicForm;

type Tab = "questions" | "preview" | "settings";
const TABS: { key: Tab; label: string }[] = [
    { key: "questions", label: s.questions },
    { key: "preview", label: s.preview },
    { key: "settings", label: s.sendWhen },
];

export function Forms() {
    const [openId, setOpenId] = useState<string | null>(null);
    if (openId === null) return <FormList onOpen={setOpenId} />;
    return (
        <EditorSource
            key={openId}
            formId={openId}
            onBack={() => {
                setOpenId(null);
            }}
            onCreated={setOpenId}
        />
    );
}

function FormList({ onOpen }: { onOpen: (id: string) => void }) {
    const library = useFormLibrary();
    return (
        <ScrollView contentContainerStyle={styles.body}>
            <View style={styles.top}>
                <Text style={styles.subtitle}>{s.subtitle}</Text>
                <Button
                    size="sm"
                    icon="plus"
                    onPress={() => {
                        onOpen(NEW_FORM);
                    }}
                >
                    {s.newForm}
                </Button>
            </View>
            <Loaded load={library.load} loading={s.loading} failed={s.loadError}>
                {library.forms.length === 0 ? (
                    <Empty
                        variant="card"
                        icon="note"
                        message={s.noFormsTitle}
                        body={s.empty}
                        actions={
                            <Button
                                onPress={() => {
                                    onOpen(NEW_FORM);
                                }}
                            >
                                {s.newForm}
                            </Button>
                        }
                    />
                ) : (
                    <View style={styles.list}>
                        {library.forms.map((form) => {
                            const send = formSendLabel(form);
                            return (
                                <ListRow
                                    key={form.id}
                                    title={form.name}
                                    detail={`${s.fields(form.field_count)} · ${
                                        form.submitted > 0
                                            ? s.responses(form.submitted)
                                            : s.noResponsesYet
                                    }`}
                                    meta={<Badge label={send.label} intent={send.intent} />}
                                    onPress={() => {
                                        onOpen(form.id);
                                    }}
                                />
                            );
                        })}
                    </View>
                )}
            </Loaded>
        </ScrollView>
    );
}

function EditorSource({
    formId,
    onBack,
    onCreated,
}: {
    formId: string;
    onBack: () => void;
    onCreated: (id: string) => void;
}) {
    const draft = useFormDraft(formId);
    if (draft === null) return <Loading />;
    return <Editor formId={formId} initial={draft} onBack={onBack} onCreated={onCreated} />;
}

function Editor({
    formId,
    initial,
    onBack,
    onCreated,
}: {
    formId: string;
    initial: FormDraft;
    onBack: () => void;
    onCreated: (id: string) => void;
}) {
    const editor = useFormEditor(api, formId, initial, onCreated);
    const [sending, setSending] = useState(false);
    const [tab, setTab] = useState<Tab>("questions");
    const selected = editor.fields.find((x) => x.key === editor.selectedKey) ?? null;

    return (
        <View style={styles.screen}>
            <View style={styles.nav}>
                <Button variant="link" icon="chevronLeft" onPress={onBack}>
                    {s.library}
                </Button>
                <View style={styles.navActions}>
                    {formId !== NEW_FORM && !editor.dirty ? (
                        <IconButton
                            icon="send"
                            label={s.send}
                            onPress={() => {
                                setSending(true);
                            }}
                        />
                    ) : null}
                    <Button
                        size="sm"
                        onPress={editor.save}
                        busy={editor.busy}
                        disabled={!editor.dirty}
                    >
                        {editor.saved ? s.saved : s.save}
                    </Button>
                </View>
            </View>
            {sending ? (
                <SendToClientSheet
                    title={s.sendTitle(editor.name)}
                    path="/v1/forms/send"
                    body={{ form_id: formId }}
                    onClose={() => {
                        setSending(false);
                    }}
                />
            ) : null}
            <View style={styles.head}>
                <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
                    {editor.name || s.untitledForm}
                </Text>
                <Text style={styles.meta}>
                    {s.fields(editor.fields.length)} ·{" "}
                    {editor.sendOn === "booking" ? s.sendsOnBooking : s.sendsManually}
                    {editor.dirty ? ` · ${s.unsaved}` : ""}
                </Text>
            </View>
            <Tabs items={TABS} active={tab} onSelect={setTab} variant="pill" />
            {editor.error !== null ? (
                <View style={styles.pad}>
                    <Notice tone="danger" banner>
                        {s.errors[editor.error]}
                    </Notice>
                </View>
            ) : null}
            <ScrollView contentContainerStyle={styles.body}>
                {tab === "questions" ? (
                    <>
                        {editor.fields.length === 0 ? <Empty message={s.emptyFields} /> : null}
                        <View style={styles.list}>
                            {editor.fields.map((field, i) => (
                                <ListRow
                                    key={field.key}
                                    leading={
                                        <View style={styles.num}>
                                            <Text style={styles.numText}>{i + 1}</Text>
                                        </View>
                                    }
                                    title={field.label || s.untitled}
                                    detail={`${fieldTypeLabel(field.input)}${field.required ? ` · ${s.required}` : ""}`}
                                    onPress={() => {
                                        editor.select(field.key);
                                    }}
                                />
                            ))}
                        </View>
                        <Button
                            variant="outline"
                            full
                            icon="plus"
                            onPress={() => {
                                editor.addField("text");
                            }}
                        >
                            {s.addQuestion}
                        </Button>
                    </>
                ) : null}
                {tab === "preview" ? (
                    <View style={styles.card}>
                        <Text style={styles.previewTitle}>{editor.name || s.untitledForm}</Text>
                        {editor.preview.map((q) => (
                            <FormQuestion
                                key={q.id}
                                field={{ ...q, label: q.label || s.untitled }}
                                value={undefined}
                                chooseFileLabel={f.chooseFile}
                                selectPlaceholder={f.selectPlaceholder}
                            />
                        ))}
                        <Button full size="lg" disabled>
                            {f.sendAnswers}
                        </Button>
                    </View>
                ) : null}
                {tab === "settings" ? (
                    <View style={styles.gap}>
                        <TextField
                            label={s.formName}
                            value={editor.name}
                            onChange={editor.setName}
                            surface="surface"
                        />
                        <Field label={s.sendWhen}>
                            <Choice
                                layout="cards"
                                label={s.sendWhen}
                                value={editor.sendOn}
                                onChange={editor.setSendOn}
                                options={[
                                    {
                                        key: "booking",
                                        label: s.sendOnBooking,
                                        hint: s.sendOnBookingHint,
                                    },
                                    { key: "manual", label: s.sendManual, hint: s.sendManualHint },
                                ]}
                            />
                        </Field>
                        <Toggle
                            label={s.requireSignature}
                            hint={s.requireSignatureHint}
                            value={editor.requireSignature}
                            onChange={editor.setRequireSignature}
                        />
                        <Text style={styles.meta}>{s.uploadLimits}</Text>
                    </View>
                ) : null}
            </ScrollView>
            {selected !== null ? (
                <Modal
                    open
                    size="xl"
                    onClose={() => {
                        editor.select(null);
                    }}
                >
                    <ScrollView keyboardShouldPersistTaps="handled">
                        <QuestionControls editor={editor} field={selected} />
                    </ScrollView>
                    <View style={styles.sheetFoot}>
                        <Button
                            variant="danger"
                            icon="trash"
                            onPress={() => {
                                editor.removeField(selected.key);
                            }}
                        >
                            {s.remove}
                        </Button>
                        <Button
                            grow
                            onPress={() => {
                                editor.select(null);
                            }}
                        >
                            {s.done}
                        </Button>
                    </View>
                </Modal>
            ) : null}
        </View>
    );
}

function QuestionControls({ editor, field }: { editor: FormEditor; field: EditorField }) {
    const update = (patch: Partial<Omit<EditorField, "key" | "id">>): void => {
        editor.updateField(field.key, patch);
    };
    const options = field.options.length > 0 ? field.options : ["", ""];
    const index = editor.fields.findIndex((x) => x.key === field.key);
    return (
        <View style={styles.gap}>
            <TextField
                label={s.questionLabel}
                value={field.label}
                onChange={(v) => {
                    update({ label: v });
                }}
                placeholder={s.questionPlaceholder}
            />
            <Field label={s.type}>
                <Choice
                    label={s.type}
                    value={field.input}
                    options={editorTypes(field.input).map((t) => ({
                        key: t,
                        label: fieldTypeLabel(t),
                    }))}
                    onChange={(v) => {
                        update({
                            input: v,
                            options:
                                hasOptions(v) && field.options.length === 0
                                    ? ["", ""]
                                    : field.options,
                        });
                    }}
                />
            </Field>
            {hasOptions(field.input) ? (
                <Field label={s.optionsLabel}>
                    <View style={styles.gap}>
                        {options.map((o, i) => (
                            <View key={i} style={styles.option}>
                                <View style={styles.flex}>
                                    <TextField
                                        name={s.optionPlaceholder(i + 1)}
                                        value={o}
                                        placeholder={s.optionPlaceholder(i + 1)}
                                        onChange={(v) => {
                                            update({
                                                options: options.map((x, j) => (j === i ? v : x)),
                                            });
                                        }}
                                    />
                                </View>
                                <IconButton
                                    icon="x"
                                    label={s.removeOption(i + 1)}
                                    disabled={options.length <= 2}
                                    onPress={() => {
                                        update({ options: options.filter((_, j) => j !== i) });
                                    }}
                                />
                            </View>
                        ))}
                        <Button
                            variant="link"
                            onPress={() => {
                                update({ options: [...options, ""] });
                            }}
                        >
                            {s.addOption}
                        </Button>
                        {editor.problemKey === field.key ? (
                            <Notice tone="danger">{s.errors["options-missing"]}</Notice>
                        ) : null}
                    </View>
                </Field>
            ) : null}
            {field.input === "file" ? <Text style={styles.meta}>{s.uploadLimits}</Text> : null}
            <TextField
                label={s.helpLabel}
                optional
                value={field.help}
                onChange={(v) => {
                    update({ help: v });
                }}
                placeholder={s.helpPlaceholder}
            />
            <Toggle
                label={s.required}
                value={field.required}
                onChange={(v) => {
                    update({ required: v });
                }}
            />
            <View style={styles.option}>
                <IconButton
                    icon="chevronUp"
                    label={s.moveUp}
                    disabled={index === 0}
                    onPress={() => {
                        editor.moveField(field.key, -1);
                    }}
                />
                <IconButton
                    icon="chevronDown"
                    label={s.moveDown}
                    disabled={index === editor.fields.length - 1}
                    onPress={() => {
                        editor.moveField(field.key, 1);
                    }}
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    body: { padding: 16, paddingBottom: 40, gap: 12 },
    top: { flexDirection: "row", alignItems: "center", gap: 12 },
    subtitle: { flex: 1, color: c.muted, fontSize: 13 },
    nav: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    navActions: { flexDirection: "row", alignItems: "center", gap: 8 },
    head: { paddingHorizontal: 16, paddingBottom: 10 },
    title: { color: c.ink, fontSize: 24, fontWeight: "700" },
    meta: { color: c.muted, fontSize: 13, marginTop: 3, lineHeight: 18 },
    pad: { paddingHorizontal: 16, paddingTop: 8 },
    list: {
        backgroundColor: c.surface,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        overflow: "hidden",
    },
    card: {
        backgroundColor: c.surface,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        padding: 16,
        gap: 14,
    },
    previewTitle: { color: c.ink, fontSize: 19, fontWeight: "700" },
    num: {
        width: 24,
        height: 24,
        borderRadius: 6,
        backgroundColor: c.bg,
        alignItems: "center",
        justifyContent: "center",
    },
    numText: { color: c.muted, fontSize: 12, fontWeight: "700" },
    gap: { gap: 12 },
    option: { flexDirection: "row", alignItems: "center", gap: 8 },
    flex: { flex: 1 },
    sheetFoot: { flexDirection: "row", gap: 10, paddingTop: 14 },
});
