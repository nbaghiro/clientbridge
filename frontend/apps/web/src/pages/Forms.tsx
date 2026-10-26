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
    useBusinessZone,
} from "@clientbridge/app-core";
import {
    Badge,
    Button,
    Empty,
    Field,
    FormQuestion,
    Icon,
    IconButton,
    ListPage,
    ListRow,
    Loading,
    Modal,
    Notice,
    Panel,
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

const GRID = "grid grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.2fr)] items-center gap-4";

export function Forms() {
    const library = useFormLibrary();
    const [picked, setPicked] = useState<string | null>(null);
    const newForm = (): void => {
        setPicked(NEW_FORM);
    };
    const none = library.load.hasData && library.forms.length === 0;

    return (
        <div className="space-y-6">
            {picked !== null ? (
                <Modal
                    variant="drawer"
                    size="xl"
                    onClose={() => {
                        setPicked(null);
                    }}
                >
                    <EditorSource key={picked} formId={picked} onCreated={setPicked} />
                </Modal>
            ) : null}
            <div className="flex items-center justify-between gap-4">
                <p className="text-sm text-muted">{s.subtitle}</p>
                {none ? null : (
                    <Button size="sm" icon="plus" onPress={newForm}>
                        {s.newForm}
                    </Button>
                )}
            </div>
            <Loaded load={library.load} loading={s.loading} failed={s.loadError}>
                <ListPage
                    head={
                        none ? undefined : (
                            <div className={GRID}>
                                <span>{s.colForm}</span>
                                <span>{s.sendWhen}</span>
                                <span>{s.colAnswers}</span>
                            </div>
                        )
                    }
                    rows={library.forms}
                    rowKey={(form) => form.id}
                    onRowPress={(form) => {
                        setPicked(form.id);
                    }}
                    empty={{
                        message: s.noFormsTitle,
                        body: s.empty,
                        icon: "note",
                        actions: (
                            <Button size="sm" icon="plus" onPress={newForm}>
                                {s.newForm}
                            </Button>
                        ),
                    }}
                    renderRow={(form) => {
                        const send = formSendLabel(form);
                        return (
                            <div className={GRID}>
                                <div className="min-w-0">
                                    <div className="truncate font-medium text-ink">{form.name}</div>
                                    <div className="text-xs text-muted">
                                        {s.fields(form.field_count)}
                                    </div>
                                </div>
                                <div>
                                    <Badge label={send.label} intent={send.intent} />
                                </div>
                                <div className="flex min-w-0 items-center gap-2 text-sm text-ink-soft">
                                    <span className="truncate">
                                        {form.submitted > 0
                                            ? s.responses(form.submitted)
                                            : s.noResponsesYet}
                                    </span>
                                    {form.waiting > 0 ? (
                                        <Badge label={s.waiting(form.waiting)} intent="warning" />
                                    ) : null}
                                </div>
                            </div>
                        );
                    }}
                />
            </Loaded>
        </div>
    );
}

function EditorSource({ formId, onCreated }: { formId: string; onCreated: (id: string) => void }) {
    const draft = useFormDraft(formId);
    if (draft === null) return <Loading />;
    return <Editor formId={formId} initial={draft} onCreated={onCreated} />;
}

function Editor({
    formId,
    initial,
    onCreated,
}: {
    formId: string;
    initial: FormDraft;
    onCreated: (id: string) => void;
}) {
    const zone = useBusinessZone();
    const editor = useFormEditor(api, formId, initial, onCreated);
    const [sending, setSending] = useState(false);

    return (
        <>
            <header className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex min-w-0 items-baseline gap-3">
                    <h2 className="truncate font-display text-xl font-bold text-ink">
                        {editor.name || s.untitledForm}
                    </h2>
                    <SaveState editor={editor} />
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        size="sm"
                        variant="outline"
                        icon="send"
                        disabled={formId === NEW_FORM || editor.dirty}
                        onPress={() => {
                            setSending(true);
                        }}
                    >
                        {s.send}
                    </Button>
                    <Button
                        size="sm"
                        onPress={editor.save}
                        busy={editor.busy}
                        disabled={!editor.dirty}
                    >
                        {editor.busy ? s.saving : s.save}
                    </Button>
                </div>
            </header>
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
            <div className="mt-5 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
                <div className="space-y-6">
                    {editor.error !== null ? (
                        <Notice tone="danger" banner>
                            {s.errors[editor.error]}
                        </Notice>
                    ) : null}
                    <Panel>
                        <div className="grid gap-4 md:grid-cols-2">
                            <TextField
                                label={s.formName}
                                value={editor.name}
                                onChange={editor.setName}
                                surface="surface"
                            />
                            <Select
                                label={s.sendWhen}
                                value={editor.sendOn}
                                onChange={editor.setSendOn}
                                surface="surface"
                                hint={
                                    editor.sendOn === "booking"
                                        ? s.sendOnBookingHint
                                        : s.sendManualHint
                                }
                                options={[
                                    { key: "booking", label: s.sendOnBooking },
                                    { key: "manual", label: s.sendManual },
                                ]}
                            />
                        </div>
                        <Toggle
                            label={s.requireSignature}
                            hint={s.requireSignatureHint}
                            value={editor.requireSignature}
                            onChange={editor.setRequireSignature}
                        />
                    </Panel>
                    <Panel
                        flush
                        title={s.questions}
                        subtitle={s.fields(editor.fields.length)}
                        actions={
                            <Button
                                size="sm"
                                variant="outline"
                                icon="plus"
                                onPress={() => {
                                    editor.addField("text");
                                }}
                            >
                                {s.addQuestion}
                            </Button>
                        }
                    >
                        {editor.fields.length === 0 ? (
                            <Empty message={s.emptyFields} />
                        ) : (
                            <ol className="divide-y divide-line-soft">
                                {editor.fields.map((field, i) => {
                                    const open = field.key === editor.selectedKey;
                                    return (
                                        <li
                                            key={field.key}
                                            className={open ? "bg-accent-weak/30" : ""}
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
                                                <div className="border-t border-line-soft bg-surface p-4">
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
                    </Panel>
                </div>
                <aside className="lg:sticky lg:top-0">
                    <Panel title={s.preview}>
                        <h3 className="font-display text-lg font-bold text-ink">
                            {editor.name || s.untitledForm}
                        </h3>
                        <div className="mt-4 space-y-1">
                            {editor.preview.map((q) => (
                                <div key={q.id} className="py-2.5">
                                    <FormQuestion
                                        zone={zone}
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
                    </Panel>
                </aside>
            </div>
        </>
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
