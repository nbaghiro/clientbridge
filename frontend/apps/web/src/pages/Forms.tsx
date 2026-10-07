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
import {
    Badge,
    Button,
    Choice,
    Empty,
    Field,
    FormQuestion,
    Icon,
    IconButton,
    ListRow,
    Loading,
    Notice,
    Select,
    TextField,
    Toggle,
} from "@clientbridge/ui";
import { useState } from "react";

import { Loaded } from "../components/Loaded";
import { SendToClientDialog } from "../components/SendToClient";
import { api } from "../lib/api";

const s = strings.forms;
const f = strings.publicForm;

export function Forms() {
    const library = useFormLibrary();
    const [picked, setPicked] = useState<string | null>(null);
    const formId = picked ?? library.forms[0]?.id ?? null;
    const newForm = (): void => {
        setPicked(NEW_FORM);
    };

    return (
        <div className="grid items-start gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
            <aside className="hidden xl:block">
                <div className="mb-3 flex items-center justify-between px-1">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                        {s.library}
                    </h2>
                    <Button variant="link" size="sm" icon="plus" onPress={newForm}>
                        {s.newForm}
                    </Button>
                </div>
                <Loaded load={library.load} loading={s.loading} failed={s.loadError} rows={3}>
                    <ul className="space-y-1.5">
                        {library.forms.map((form) => {
                            const send = formSendLabel(form);
                            return (
                                <li key={form.id}>
                                    <ListRow
                                        title={form.name}
                                        selected={form.id === formId}
                                        onPress={() => {
                                            setPicked(form.id);
                                        }}
                                        detail={
                                            <>
                                                <span className="block">
                                                    {s.fields(form.field_count)} ·{" "}
                                                    {form.submitted > 0
                                                        ? s.responses(form.submitted)
                                                        : s.noResponsesYet}
                                                    {form.waiting > 0
                                                        ? ` · ${s.waiting(form.waiting)}`
                                                        : ""}
                                                </span>
                                                <span className="mt-1.5 inline-block">
                                                    <Badge
                                                        label={send.label}
                                                        intent={send.intent}
                                                    />
                                                </span>
                                            </>
                                        }
                                    />
                                </li>
                            );
                        })}
                    </ul>
                </Loaded>
            </aside>
            {formId === null ? (
                <Loaded load={library.load} loading={s.loading} failed={s.loadError}>
                    <Empty
                        variant="card"
                        icon="note"
                        message={s.noFormsTitle}
                        body={s.empty}
                        actions={<Button onPress={newForm}>{s.newForm}</Button>}
                    />
                </Loaded>
            ) : (
                <EditorSource
                    key={formId}
                    formId={formId}
                    picker={
                        <div className="flex items-end gap-3 xl:hidden">
                            <div className="max-w-sm flex-1">
                                <Select
                                    label={s.selectForm}
                                    value={formId}
                                    options={library.forms.map((x) => ({
                                        key: x.id,
                                        label: x.name,
                                    }))}
                                    onChange={setPicked}
                                />
                            </div>
                            <Button variant="outline" icon="plus" onPress={newForm}>
                                {s.newForm}
                            </Button>
                        </div>
                    }
                    onCreated={setPicked}
                />
            )}
        </div>
    );
}

function EditorSource({
    formId,
    picker,
    onCreated,
}: {
    formId: string;
    picker: React.ReactNode;
    onCreated: (id: string) => void;
}) {
    const draft = useFormDraft(formId);
    if (draft === null) return <Loading />;
    return <Editor formId={formId} initial={draft} picker={picker} onCreated={onCreated} />;
}

function Editor({
    formId,
    initial,
    picker,
    onCreated,
}: {
    formId: string;
    initial: FormDraft;
    picker: React.ReactNode;
    onCreated: (id: string) => void;
}) {
    const editor = useFormEditor(api, formId, initial, onCreated);
    const [sending, setSending] = useState(false);

    return (
        <div className="min-w-0 space-y-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
                {picker}
                <div className="ml-auto flex items-center gap-3">
                    <SaveState editor={editor} />
                    <Button
                        variant="outline"
                        icon="send"
                        disabled={formId === NEW_FORM || editor.dirty}
                        onPress={() => {
                            setSending(true);
                        }}
                    >
                        {s.send}
                    </Button>
                    <Button onPress={editor.save} busy={editor.busy} disabled={!editor.dirty}>
                        {editor.busy ? s.saving : s.save}
                    </Button>
                </div>
            </div>
            {sending ? (
                <SendToClientDialog
                    title={s.sendTitle(editor.name)}
                    path="/v1/forms/send"
                    body={{ form_id: formId }}
                    onClose={() => {
                        setSending(false);
                    }}
                />
            ) : null}
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                <div className="min-w-0 space-y-5">
                    {editor.error !== null ? (
                        <Notice tone="danger" banner>
                            {s.errors[editor.error]}
                        </Notice>
                    ) : null}
                    <section className="space-y-4 rounded-lg border border-line bg-surface p-5 shadow-card">
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
                    </section>
                    <section>
                        <div className="mb-2 flex items-baseline justify-between">
                            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                                {s.questions}
                            </h2>
                            <span className="text-xs text-muted">
                                {s.fields(editor.fields.length)}
                            </span>
                        </div>
                        {editor.fields.length === 0 ? (
                            <Empty variant="card" message={s.emptyFields} />
                        ) : (
                            <ol className="space-y-2">
                                {editor.fields.map((field, i) => {
                                    const open = field.key === editor.selectedKey;
                                    return (
                                        <li
                                            key={field.key}
                                            className={`rounded-lg border bg-surface ${open ? "border-accent shadow-card" : "border-line"}`}
                                        >
                                            <ListRow
                                                density="compact"
                                                leading={
                                                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-bg text-xs font-semibold text-muted">
                                                        {i + 1}
                                                    </span>
                                                }
                                                title={field.label || s.untitled}
                                                detail={fieldTypeLabel(field.input)}
                                                meta={
                                                    field.required ? (
                                                        <Badge
                                                            label={s.required}
                                                            intent="neutral"
                                                        />
                                                    ) : undefined
                                                }
                                                selected={open}
                                                onPress={() => {
                                                    editor.select(open ? null : field.key);
                                                }}
                                                trailing={
                                                    <OrderButtons
                                                        editor={editor}
                                                        field={field}
                                                        index={i}
                                                    />
                                                }
                                            />
                                            {open ? (
                                                <div className="border-t border-line-soft p-4">
                                                    <QuestionControls
                                                        editor={editor}
                                                        field={field}
                                                    />
                                                </div>
                                            ) : null}
                                        </li>
                                    );
                                })}
                            </ol>
                        )}
                        <div className="mt-3">
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
                        </div>
                    </section>
                </div>
                <aside className="min-w-0">
                    <div className="sticky top-6">
                        <div className="mb-2 flex items-center gap-1.5 text-muted">
                            <Icon name="eye" size={14} />
                            <h2 className="text-xs font-semibold uppercase tracking-wide">
                                {s.preview}
                            </h2>
                        </div>
                        <div className="max-h-[calc(100vh-14rem)] overflow-y-auto rounded-lg border border-line bg-surface p-6 shadow-card">
                            <h3 className="font-display text-lg font-bold text-ink">
                                {editor.name || s.untitledForm}
                            </h3>
                            <div className="mt-4 space-y-1">
                                {editor.preview.map((q) => (
                                    <div
                                        key={q.id}
                                        className={`-mx-3 rounded-md px-3 py-2.5 ${q.id === editor.selectedKey ? "bg-accent-weak/60 ring-1 ring-accent-line" : ""}`}
                                    >
                                        <FormQuestion
                                            field={{ ...q, label: q.label || s.untitled }}
                                            value={undefined}
                                            chooseFileLabel={f.chooseFile}
                                            selectPlaceholder={f.selectPlaceholder}
                                        />
                                    </div>
                                ))}
                            </div>
                            <div className="mt-6">
                                <Button full size="lg" disabled>
                                    {f.sendAnswers}
                                </Button>
                            </div>
                        </div>
                    </div>
                </aside>
            </div>
        </div>
    );
}

function SaveState({ editor }: { editor: FormEditor }) {
    if (editor.dirty) return <span className="text-sm text-warn-fg">{s.unsaved}</span>;
    if (editor.saved)
        return (
            <span className="flex items-center gap-1 text-sm text-ok-fg">
                <Icon name="check" size={15} />
                {s.saved}
            </span>
        );
    return null;
}

function QuestionControls({ editor, field }: { editor: FormEditor; field: EditorField }) {
    const update = (patch: Partial<Omit<EditorField, "key" | "id">>): void => {
        editor.updateField(field.key, patch);
    };
    const options = field.options.length > 0 ? field.options : ["", ""];
    return (
        <div className="space-y-4">
            <TextField
                label={s.questionLabel}
                value={field.label}
                onChange={(v) => {
                    update({ label: v });
                }}
                placeholder={s.questionPlaceholder}
                surface="surface"
                autoFocus={field.label === ""}
            />
            <Select
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
                            hasOptions(v) && field.options.length === 0 ? ["", ""] : field.options,
                    });
                }}
            />
            {hasOptions(field.input) ? (
                <Field label={s.optionsLabel}>
                    <div className="space-y-2">
                        {options.map((o, i) => (
                            <div key={i} className="flex items-center gap-2">
                                <div className="flex-1">
                                    <TextField
                                        name={s.optionPlaceholder(i + 1)}
                                        value={o}
                                        placeholder={s.optionPlaceholder(i + 1)}
                                        surface="surface"
                                        onChange={(v) => {
                                            update({
                                                options: options.map((x, j) => (j === i ? v : x)),
                                            });
                                        }}
                                    />
                                </div>
                                <IconButton
                                    icon="x"
                                    label={s.removeOption(i + 1)}
                                    disabled={options.length <= 2}
                                    onPress={() => {
                                        update({ options: options.filter((_, j) => j !== i) });
                                    }}
                                />
                            </div>
                        ))}
                        <Button
                            variant="link"
                            size="sm"
                            onPress={() => {
                                update({ options: [...options, ""] });
                            }}
                        >
                            {s.addOption}
                        </Button>
                        {editor.problemKey === field.key ? (
                            <Notice tone="danger">{s.errors["options-missing"]}</Notice>
                        ) : null}
                    </div>
                </Field>
            ) : null}
            {field.input === "file" ? (
                <p className="rounded-md bg-bg px-3 py-2 text-xs text-muted">{s.uploadLimits}</p>
            ) : null}
            <TextField
                label={s.helpLabel}
                optional
                value={field.help}
                onChange={(v) => {
                    update({ help: v });
                }}
                placeholder={s.helpPlaceholder}
                surface="surface"
            />
            <Toggle
                label={s.required}
                value={field.required}
                onChange={(v) => {
                    update({ required: v });
                }}
            />
        </div>
    );
}

function OrderButtons({
    editor,
    field,
    index,
}: {
    editor: FormEditor;
    field: EditorField;
    index: number;
}) {
    return (
        <div className="flex items-center gap-0.5">
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
            <IconButton
                icon="trash"
                label={s.remove}
                onPress={() => {
                    editor.removeField(field.key);
                }}
            />
        </div>
    );
}
