import {
    type ClientEditor,
    type ClientListRow,
    type DuplicateMatch,
    canManagePayments,
    strings,
    useClientEditor,
} from "@clientbridge/app-core";
import {
    Avatar,
    Button,
    Choice,
    confirm,
    Field,
    Modal,
    Notice,
    TagInput,
    TextField,
    Toggle,
} from "@clientbridge/ui";

import { api } from "../lib/api";
import { useRole } from "../lib/auth";

const s = strings.clients.edit;

function DuplicateCard({
    match,
    onOpen,
    onIgnore,
}: {
    match: DuplicateMatch;
    onOpen: () => void;
    onIgnore: () => void;
}) {
    return (
        <div
            role="status"
            className="flex items-start gap-3 rounded-md border border-warn-bg bg-warn-bg/50 p-3"
        >
            <Avatar name={match.client.name} />
            <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">
                    {s.duplicateTitle(match.client.name)}
                </p>
                <p className="mt-0.5 text-xs text-ink-soft">
                    {s.duplicateBody(match.reasons.join(s.and))}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted">
                    {[match.client.phoneLabel, match.client.email].filter(Boolean).join(" · ")}
                </p>
                <div className="mt-2 flex gap-2">
                    <Button size="sm" onPress={onOpen}>
                        {s.duplicateOpen}
                    </Button>
                    <Button size="sm" variant="quiet" onPress={onIgnore}>
                        {s.duplicateKeep}
                    </Button>
                </div>
            </div>
        </div>
    );
}

function ClientFields({ editor }: { editor: ClientEditor }) {
    const { draft, set, errors } = editor;
    return (
        <div className="space-y-4">
            <TextField
                label={s.nameLabel}
                required
                value={draft.name}
                onChange={(v) => {
                    set("name", v);
                }}
                placeholder={s.namePlaceholder}
                error={errors.name}
                autoComplete="name"
                autoFocus={editor.mode === "add"}
            />
            <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                    label={s.phoneLabel}
                    type="tel"
                    value={draft.phone}
                    onChange={(v) => {
                        set("phone", v);
                    }}
                    placeholder={s.phonePlaceholder}
                    hint={s.phoneHint}
                    error={errors.phone}
                    autoComplete="tel"
                />
                <TextField
                    label={s.emailLabel}
                    type="email"
                    value={draft.email}
                    onChange={(v) => {
                        set("email", v);
                    }}
                    placeholder={s.emailPlaceholder}
                    error={errors.email}
                    autoComplete="email"
                />
            </div>
            {errors.contact !== undefined ? <Notice tone="danger">{errors.contact}</Notice> : null}
            <Field label={s.channelLabel}>
                <Choice
                    layout="segmented"
                    label={s.channelLabel}
                    options={[
                        { key: "sms", label: s.channelText },
                        { key: "email", label: s.channelEmail },
                    ]}
                    value={draft.channel}
                    onChange={(v) => {
                        set("channel", v);
                    }}
                />
            </Field>
            <TagInput
                label={s.tagsLabel}
                tags={draft.tags}
                suggestions={editor.tagSuggestions}
                onAdd={(t) => {
                    set("tags", [...draft.tags, t]);
                }}
                onRemove={(t) => {
                    set(
                        "tags",
                        draft.tags.filter((x) => x !== t),
                    );
                }}
                placeholder={s.tagsPlaceholder}
            />
            <div className="rounded-md border border-line bg-bg px-3 py-2.5">
                <Toggle
                    label={s.consentLabel}
                    hint={editor.consentNote ?? s.consentHint}
                    value={draft.consent}
                    onChange={(v) => {
                        set("consent", v);
                    }}
                />
            </div>
        </div>
    );
}

/** The one add and edit form, in a dialog; every client screen opens this. */
export function ClientEditorDialog({
    directory,
    clientId,
    onOpen,
    onClose,
}: {
    directory: readonly ClientListRow[];
    clientId: string | null;
    onOpen: (id: string) => void;
    onClose: () => void;
}) {
    const editor = useClientEditor(api, directory, clientId, (id) => {
        if (clientId === null) onOpen(id);
        else onClose();
    });
    const manager = canManagePayments(useRole());
    const dup = editor.duplicates[0];
    const askArchive = (): void => {
        if (editor.client === null) return;
        confirm({
            title: s.archiveTitle(editor.client.name),
            message: s.archiveBody,
            confirmLabel: s.archiveConfirm,
            destructive: true,
        })
            .then((ok) => {
                if (ok) editor.archive();
            })
            .catch(() => undefined);
    };

    return (
        <Modal onClose={onClose} size="lg">
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    editor.submit();
                }}
            >
                <div className="flex items-start justify-between gap-3">
                    <h2 className="font-display text-lg font-bold text-ink">
                        {editor.mode === "add" ? s.addTitle : s.editTitle}
                    </h2>
                    {editor.client !== null ? <Avatar name={editor.client.name} size="sm" /> : null}
                </div>
                <div className="-mx-6 mt-4 max-h-[calc(100vh-13rem)] space-y-4 overflow-y-auto px-6 pb-1">
                    {editor.archivedNote !== null ? (
                        <div className="flex items-center justify-between gap-3 rounded-md bg-warn-bg px-3 py-2.5 text-sm text-warn-fg">
                            <span>{editor.archivedNote}</span>
                            {manager ? (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    busy={editor.busy}
                                    onPress={editor.restore}
                                >
                                    {s.restore}
                                </Button>
                            ) : null}
                        </div>
                    ) : null}
                    {dup !== undefined ? (
                        <DuplicateCard
                            match={dup}
                            onOpen={() => {
                                onOpen(dup.client.id);
                            }}
                            onIgnore={editor.ignoreDuplicates}
                        />
                    ) : null}
                    <ClientFields editor={editor} />
                    {editor.mode === "add" ? (
                        <fieldset className="space-y-3 border-t border-line-soft pt-4">
                            <legend className="sr-only">{s.petSection}</legend>
                            <div>
                                <p className="text-sm font-semibold text-ink">{s.petSection}</p>
                                <p className="text-xs text-muted">{s.petSectionHint}</p>
                            </div>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <TextField
                                    label={s.petName}
                                    optional
                                    value={editor.draft.petName}
                                    onChange={(v) => {
                                        editor.set("petName", v);
                                    }}
                                    placeholder={s.petNamePlaceholder}
                                />
                                <TextField
                                    label={s.petBreed}
                                    optional
                                    value={editor.draft.petBreed}
                                    onChange={(v) => {
                                        editor.set("petBreed", v);
                                    }}
                                    placeholder={s.petBreedPlaceholder}
                                />
                            </div>
                        </fieldset>
                    ) : null}
                </div>
                {editor.error !== null ? (
                    <div className="mt-3">
                        <Notice tone="danger" banner>
                            {editor.error}
                        </Notice>
                    </div>
                ) : null}
                <div className="mt-5 flex items-center gap-2 border-t border-line-soft pt-4">
                    {editor.client !== null && editor.archivedNote === null && manager ? (
                        <Button variant="quiet" onPress={askArchive}>
                            {s.archive}
                        </Button>
                    ) : null}
                    <span className="flex-1" />
                    <Button variant="quiet" onPress={onClose}>
                        {strings.common.cancel}
                    </Button>
                    <Button
                        submit
                        busy={editor.busy}
                        disabled={editor.mode === "edit" && !editor.dirty}
                    >
                        {editor.mode === "add"
                            ? editor.busy
                                ? s.adding
                                : s.add
                            : editor.busy
                              ? s.saving
                              : s.save}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
