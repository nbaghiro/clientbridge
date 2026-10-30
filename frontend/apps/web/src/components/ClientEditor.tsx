import {
    type ClientEditor,
    type ClientListRow,
    type DuplicateMatch,
    type SubjectField,
    type SubjectKind,
    canManagePayments,
    strings,
    useClientEditor,
    usePeoplePhotos,
} from "@clientbridge/app-core";
import {
    Avatar,
    Button,
    confirm,
    Modal,
    Notice,
    TagInput,
    TextField,
    Toggle,
} from "@clientbridge/ui";

import { api } from "../lib/api";
import { PersonPhoto } from "./PersonPhoto";
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
    const photos = usePeoplePhotos();
    return (
        <div
            role="status"
            className="flex items-start gap-3 rounded-md border border-warn-bg bg-warn-bg/50 p-3"
        >
            <Avatar name={match.client.name} src={photos.client(match.client.id)} />
            <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">
                    {match.phoneTaken
                        ? s.phoneTakenTitle(match.client.name)
                        : s.duplicateTitle(match.client.name)}
                </p>
                <p className="mt-0.5 text-xs text-ink-soft">
                    {match.phoneTaken ? s.phoneTakenBody : s.duplicateBody}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted">{match.client.phoneLabel}</p>
                <div className="mt-2 flex gap-2">
                    <Button size="sm" onPress={onOpen}>
                        {s.duplicateOpen}
                    </Button>
                    {match.phoneTaken ? null : (
                        <Button size="sm" variant="quiet" onPress={onIgnore}>
                            {s.duplicateKeep}
                        </Button>
                    )}
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
            <TextField
                label={s.phoneLabel}
                type="tel"
                required
                value={draft.phone}
                onChange={(v) => {
                    set("phone", v);
                }}
                placeholder={s.phonePlaceholder}
                hint={s.phoneHint}
                error={errors.phone}
                autoComplete="tel"
            />
            {errors.contact !== undefined ? <Notice tone="danger">{errors.contact}</Notice> : null}
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
                    hint={editor.textsStopped ?? editor.consentNote ?? s.consentHint}
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
/** A new client's first subject: its name and the one detail their kind leads with. */
function FirstSubjectFields({
    editor,
    first,
}: {
    editor: ClientEditor;
    first: { kind: SubjectKind; detail: SubjectField };
}) {
    const sj = strings.subjects;
    return (
        <fieldset className="space-y-3 border-t border-line-soft pt-4">
            <legend className="sr-only">{sj.first(first.kind)}</legend>
            <div>
                <p className="text-sm font-semibold text-ink">{sj.first(first.kind)}</p>
                <p className="text-xs text-muted">{sj.firstHint(first.kind)}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                    label={sj.firstName(first.kind)}
                    optional
                    value={editor.draft.subjectName}
                    onChange={(v) => {
                        editor.set("subjectName", v);
                    }}
                    placeholder={sj.firstNamePlaceholder(first.kind)}
                />
                <TextField
                    label={first.detail.label}
                    optional
                    value={editor.draft.subjectDetail}
                    onChange={(v) => {
                        editor.set("subjectDetail", v);
                    }}
                    placeholder={sj.firstDetailPlaceholder(first.kind)}
                />
            </div>
        </fieldset>
    );
}

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
    const photos = usePeoplePhotos();
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
                    {editor.client !== null ? (
                        <Avatar
                            name={editor.client.name}
                            src={photos.client(editor.client.id)}
                            size="sm"
                        />
                    ) : null}
                </div>
                <div className="-mx-6 mt-4 max-h-[calc(100vh-13rem)] space-y-4 overflow-y-auto px-6 pb-1">
                    {editor.client !== null ? (
                        <PersonPhoto
                            owner={{ kind: "client", id: editor.client.id }}
                            name={editor.client.name}
                        />
                    ) : null}
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
                    {editor.firstSubject !== null ? (
                        <FirstSubjectFields editor={editor} first={editor.firstSubject} />
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
