import {
    type ClientHistoryFilter,
    type NoteComposer as Composer,
    type SubjectRow,
    formatRelativeTime,
    strings,
    toTimeline,
    useClientHistory,
    useNoteComposer,
} from "@clientbridge/app-core";
import {
    ActivityTimeline,
    Badge,
    Button,
    Choice,
    Empty,
    Field,
    Icon,
    LoadFailed,
    Modal,
    Notice,
    Panel,
    Skeleton,
    TextField,
    Toggle,
} from "@clientbridge/ui";

import type { ReactNode } from "react";

import { api } from "../lib/api";
import { useViewer } from "../lib/auth";

const s = strings.clients.history;

/** Note box with who or which pet it is about, and whether it is pinned to every booking. */
function NoteComposer({ composer: c, pets }: { composer: Composer; pets: readonly SubjectRow[] }) {
    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                c.submit();
            }}
            className="space-y-3"
        >
            <TextField
                multiline
                rows={3}
                name={s.notePlaceholder}
                value={c.body}
                onChange={c.setBody}
                placeholder={s.notePlaceholder}
                surface="bg"
            />
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                {pets.length > 0 ? (
                    <Field label={s.about}>
                        <Choice
                            label={s.about}
                            options={[
                                { key: "client", label: s.aboutClient },
                                ...pets.map((p) => ({ key: p.id, label: p.name })),
                            ]}
                            value={c.about}
                            onChange={c.setAbout}
                        />
                    </Field>
                ) : null}
                <div className="self-end pb-1.5">
                    <Toggle
                        label={s.pin}
                        hint={s.pinHint}
                        value={c.pinned}
                        onChange={c.setPinned}
                    />
                </div>
                <span className="flex-1" />
                <div className="self-end">
                    <Button submit busy={c.busy} disabled={c.body.trim() === ""}>
                        {c.busy ? s.savingNote : s.saveNote}
                    </Button>
                </div>
            </div>
            {c.error !== null ? <Notice tone="danger">{c.error}</Notice> : null}
        </form>
    );
}

/** The same note box in a dialog, for adding a note from the client record. */
export function NoteDialog({
    clientId,
    pets,
    onClose,
}: {
    clientId: string;
    pets: readonly SubjectRow[];
    onClose: () => void;
}) {
    const composer = useNoteComposer(api, clientId, onClose);
    return (
        <Modal onClose={onClose} size="lg">
            <h2 className="mb-4 font-display text-lg font-bold text-ink">
                {strings.clients.record.addNoteTitle}
            </h2>
            <NoteComposer composer={composer} pets={pets} />
            <div className="mt-4 flex justify-end">
                <Button variant="quiet" onPress={onClose}>
                    {strings.common.cancel}
                </Button>
            </div>
        </Modal>
    );
}

/** One client's history: a timeline with filters, the note box, and pinned notes beside it. */
export function ClientHistory({ clientId, aside }: { clientId: string; aside?: ReactNode }) {
    const viewer = useViewer();
    const h = useClientHistory(clientId, viewer?.staffId ?? null);
    const composer = useNoteComposer(api, clientId);
    const now = new Date();

    return (
        <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
            <div className="min-w-0 space-y-5">
                {h.load.state === "loading" ? (
                    <Panel flush>
                        <Skeleton variant="row" count={5} label={s.loading} />
                    </Panel>
                ) : null}
                {h.load.state === "error" ? (
                    <Panel flush>
                        <LoadFailed
                            message={s.loadError}
                            onRetry={h.load.retry}
                            retrying={h.load.retrying}
                        />
                    </Panel>
                ) : null}
                {h.load.hasData ? (
                    <Panel>
                        <NoteComposer composer={composer} pets={h.pets} />
                    </Panel>
                ) : null}
                {h.load.state === "empty" ? (
                    <Panel flush>
                        <Empty icon="history" message={s.emptyTitle} body={s.empty} />
                    </Panel>
                ) : null}
                {h.load.ready ? (
                    <Choice<ClientHistoryFilter>
                        label={s.title}
                        options={h.filters.map((f) => ({
                            key: f.key,
                            label: s.withCount(f.label, f.hint),
                        }))}
                        value={h.filter}
                        onChange={h.setFilter}
                    />
                ) : null}
                {h.filter === "all" && h.upcoming.length > 0 ? (
                    <section>
                        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                            {s.upcoming}
                        </h2>
                        <div className="rounded-lg border border-accent-line bg-surface p-4">
                            <ActivityTimeline entries={h.upcoming.map(toTimeline)} />
                        </div>
                    </section>
                ) : null}
                {h.load.ready && h.groups.length === 0 ? (
                    <div className="rounded-lg border border-line bg-surface">
                        <Empty message={h.total === 0 ? s.empty : s.emptyFilter} />
                    </div>
                ) : null}
                {h.groups.map((g) => (
                    <section key={g.key}>
                        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                            {g.label}
                        </h2>
                        <div className="rounded-lg border border-line bg-surface p-4 shadow-card">
                            <ActivityTimeline entries={g.entries.map(toTimeline)} />
                        </div>
                    </section>
                ))}
                {h.hasOlder ? (
                    <Button full variant="outline" onPress={h.showOlder}>
                        {s.loadOlder}
                    </Button>
                ) : null}
            </div>
            <aside className="space-y-5">
                {h.pinned.length > 0 ? (
                    <section className="rounded-lg border border-warn-bg bg-warn-bg/50 p-4">
                        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-warn-fg">
                            <Icon name="alert" size={14} />
                            {s.headsUp}
                        </h2>
                        <ul className="mt-2 space-y-2">
                            {h.pinned.map((n) => (
                                <li key={n.id} className="text-sm leading-relaxed text-ink">
                                    {n.body}
                                    <span className="mt-1 flex items-center gap-2 text-xs text-muted">
                                        {s.by(
                                            n.author,
                                            formatRelativeTime(n.at.toISOString(), now),
                                        )}
                                        {n.pet !== null ? (
                                            <Badge label={n.pet} intent="neutral" />
                                        ) : null}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </section>
                ) : null}
                {aside}
            </aside>
        </div>
    );
}
