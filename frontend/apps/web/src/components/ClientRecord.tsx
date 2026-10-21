import {
    type ClientListRow,
    type ClientNote,
    type ClientRecord,
    type SubjectRow,
    formatDate,
    formatRelativeTime,
    formatTime,
    formatWeekday,
    savedCardLabel,
    subjectSummary,
    subjectTemperament,
    strings,
    useClientRecord,
    useNoteActions,
    visitPill,
    formatParts,
    formatList,
    BUSINESS_CURRENCY,
    useBusinessZone,
    usePeoplePhotos,
    useSubjectKind,
} from "@clientbridge/app-core";
import {
    ActionMenu,
    Avatar,
    Badge,
    Button,
    confirm,
    DetailSection,
    DetailView,
    IconButton,
    KeyValueList,
    ListRow,
    LoadFailed,
    Money,
    Notice,
    Skeleton,
    StatusPill,
} from "@clientbridge/ui";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { ClientEditorDialog } from "./ClientEditor";
import { NoteDialog } from "./ClientHistory";
import { ClientMergeDialog } from "./ClientMerge";
import { ClientWallet } from "./ClientWallet";
import { SubjectDialog } from "./ClientSubjects";
import { api } from "../lib/api";
import { useViewer } from "../lib/auth";
import { useOpenLink } from "../lib/links";

const r = strings.clients.record;

export type ClientDialog =
    | { kind: "client"; id: string | null }
    | { kind: "subject"; clientId: string; subject: SubjectRow | null }
    | { kind: "note"; clientId: string; subjects: readonly SubjectRow[] }
    | { kind: "merge"; a: ClientListRow; b: ClientListRow };

export function ClientDialogs({
    dialog,
    directory,
    onOpenClient,
    onMerged,
    onClose,
}: {
    dialog: ClientDialog | null;
    directory: readonly ClientListRow[];
    onOpenClient: (id: string) => void;
    onMerged: (name: string) => void;
    onClose: () => void;
}) {
    if (dialog === null) return null;
    switch (dialog.kind) {
        case "client":
            return (
                <ClientEditorDialog
                    key={dialog.id ?? "new"}
                    directory={directory}
                    clientId={dialog.id}
                    onOpen={onOpenClient}
                    onClose={onClose}
                />
            );
        case "subject":
            return (
                <SubjectDialog
                    key={dialog.subject?.id ?? "new"}
                    clientId={dialog.clientId}
                    subject={dialog.subject}
                    onClose={onClose}
                />
            );
        case "note":
            return (
                <NoteDialog
                    clientId={dialog.clientId}
                    subjects={dialog.subjects}
                    onClose={onClose}
                />
            );
        case "merge":
            return (
                <ClientMergeDialog
                    a={dialog.a}
                    b={dialog.b}
                    onClose={onClose}
                    onMerged={onMerged}
                />
            );
    }
}

function RecordActions({
    record,
    manager,
    onEdit,
}: {
    record: ClientRecord;
    manager: boolean;
    onEdit: () => void;
}) {
    const open = useOpenLink();
    const navigate = useNavigate();
    return (
        <div className="flex flex-1 flex-wrap gap-2">
            <Button
                size="sm"
                onPress={() => {
                    open("booking");
                }}
            >
                {r.book}
            </Button>
            <Button
                size="sm"
                variant="outline"
                onPress={() => {
                    open("message", record.client.id);
                }}
            >
                {r.message}
            </Button>
            {manager ? (
                <Button
                    size="sm"
                    variant="outline"
                    onPress={() => {
                        open("invoice");
                    }}
                >
                    {r.invoice}
                </Button>
            ) : null}
            <Button
                size="sm"
                variant="quiet"
                icon="history"
                onPress={() => {
                    const done = navigate(`/clients/${record.client.id}/history`);
                    if (done) done.catch(() => undefined);
                }}
            >
                {r.history}
            </Button>
            <Button size="sm" variant="quiet" icon="edit" onPress={onEdit}>
                {r.editShort}
            </Button>
        </div>
    );
}

export function RecordFacts({ record, manager }: { record: ClientRecord; manager: boolean }) {
    const zone = useBusinessZone();
    const c = record.client;
    return (
        <KeyValueList
            layout="stack"
            columns={2}
            rows={[
                ...(manager
                    ? [
                          {
                              label: r.lifetime,
                              value: <Money currency={BUSINESS_CURRENCY} cents={c.lifetimeCents} />,
                          },
                          {
                              label: r.balance,
                              value:
                                  c.balanceCents > 0 ? (
                                      <Money currency={BUSINESS_CURRENCY} cents={c.balanceCents} />
                                  ) : (
                                      r.settled
                                  ),
                              intent: c.balanceCents > 0 ? ("warning" as const) : undefined,
                          },
                      ]
                    : []),
                { label: r.visits, value: String(record.visits) },
                { label: r.since, value: formatDate(c.since, zone) },
            ]}
        />
    );
}

function NoteItem({ note, manager }: { note: ClientNote; manager: boolean }) {
    const zone = useBusinessZone();
    const actions = useNoteActions(api);
    const [menu, setMenu] = useState(false);
    const can = manager || note.mine;
    return (
        <li className="flex items-start gap-2 rounded-md bg-warn-bg/60 px-3 py-2 text-sm leading-relaxed text-ink-soft">
            <div className="min-w-0 flex-1">
                <p className="whitespace-pre-line">{note.body}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    {strings.clients.history.by(
                        note.author,
                        formatRelativeTime(note.at.toISOString(), zone),
                    )}
                    {note.subjectName !== null ? (
                        <Badge label={note.subjectName} intent="neutral" />
                    ) : null}
                    {note.pinned ? <Badge label={r.pinned} intent="warning" /> : null}
                </p>
                {actions.error !== null ? <Notice tone="danger">{actions.error}</Notice> : null}
            </div>
            {can ? (
                <div className="relative">
                    <IconButton
                        icon="more"
                        size="sm"
                        label={strings.clients.history.editNote}
                        onPress={() => {
                            setMenu(true);
                        }}
                    />
                    <ActionMenu
                        open={menu}
                        placement="below-end"
                        onClose={() => {
                            setMenu(false);
                        }}
                        items={[
                            {
                                key: "pin",
                                label: note.pinned
                                    ? strings.clients.history.unpin
                                    : strings.clients.history.pinNote,
                                hint: strings.clients.history.pinHint,
                                icon: "pushpin",
                            },
                            {
                                key: "delete",
                                label: strings.clients.history.deleteNote,
                                icon: "trash",
                            },
                        ]}
                        onSelect={(k) => {
                            setMenu(false);
                            if (k === "pin") {
                                actions.togglePin(note);
                                return;
                            }
                            confirm({
                                title: strings.clients.history.deleteNoteTitle,
                                message: strings.clients.history.deleteNoteBody,
                                confirmLabel: strings.clients.history.deleteNote,
                                destructive: true,
                            })
                                .then((ok) => {
                                    if (ok) actions.remove(note);
                                })
                                .catch(() => undefined);
                        }}
                    />
                </div>
            ) : null}
        </li>
    );
}

export function ClientRecordView({
    visible,
    variant = "drawer",
    clientId,
    manager,
    onClose,
    onDialog,
}: {
    visible: boolean;
    variant?: "drawer" | "inline";
    clientId: string;
    manager: boolean;
    onClose: () => void;
    onDialog: (d: ClientDialog) => void;
}) {
    const photos = usePeoplePhotos();
    const zone = useBusinessZone();
    const kind = useSubjectKind();
    const viewer = useViewer();
    const { load, record } = useClientRecord(api, clientId, viewer?.staffId ?? null);
    const [pane, setPane] = useState<"record" | "wallet">("record");
    const navigate = useNavigate();
    const go = (path: string): void => {
        const done = navigate(path);
        if (done) done.catch(() => undefined);
    };
    if (record === null) {
        return (
            <DetailView
                open={visible}
                variant={variant}
                title={strings.clients.title}
                onClose={onClose}
            >
                {load.state === "error" ? (
                    <LoadFailed
                        message={r.loadError}
                        onRetry={load.retry}
                        retrying={load.retrying}
                    />
                ) : load.state === "empty" ? (
                    <p className="text-sm text-muted">{r.goneBody}</p>
                ) : (
                    <Skeleton variant="stat" count={4} columns={2} label={r.loadingRecord} />
                )}
            </DetailView>
        );
    }
    const c = record.client;
    const now = new Date();
    if (pane === "wallet")
        return (
            <DetailView
                open={visible}
                variant={variant}
                title={c.name}
                subtitle={strings.clients.wallet.title}
                leading={<Avatar name={c.name} src={photos.client(c.id)} size="lg" />}
                onClose={onClose}
            >
                <div>
                    <Button
                        size="sm"
                        variant="link"
                        icon="chevronLeft"
                        onPress={() => {
                            setPane("record");
                        }}
                    >
                        {r.backToRecord}
                    </Button>
                </div>
                <ClientWallet clientId={c.id} />
            </DetailView>
        );
    return (
        <DetailView
            open={visible}
            variant={variant}
            title={c.name}
            subtitle={formatParts([
                c.phoneLabel,
                formatList(
                    record.subjects.map((x) => x.name),
                    "unit",
                ),
            ])}
            status={c.archived ? { status: r.archived, intent: "warning" } : undefined}
            leading={<Avatar name={c.name} src={photos.client(c.id)} size="lg" />}
            onClose={onClose}
            actions={
                <RecordActions
                    record={record}
                    manager={manager}
                    onEdit={() => {
                        onDialog({ kind: "client", id: c.id });
                    }}
                />
            }
        >
            {c.tags.length > 0 || c.email !== null ? (
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                    {c.tags.map((tag) => (
                        <Badge key={tag} label={tag} intent="accent" />
                    ))}
                    <span>{formatParts([c.email, r.prefers(c.channel)])}</span>
                </div>
            ) : null}
            {record.textsStopped !== null ? (
                <Notice tone="info" banner>
                    {record.textsStopped}
                </Notice>
            ) : null}
            <div className="rounded-md border border-line bg-bg px-4 py-3">
                <RecordFacts record={record} manager={manager} />
            </div>
            {kind !== null ? (
                <DetailSection
                    title={strings.subjects.many(kind)}
                    action={
                        <span className="flex gap-3">
                            {record.subjects.length > 0 ? (
                                <Button
                                    size="sm"
                                    variant="link"
                                    onPress={() => {
                                        go(`/clients/${c.id}/subjects`);
                                    }}
                                >
                                    {strings.subjects.many(kind)}
                                </Button>
                            ) : null}
                            <Button
                                size="sm"
                                variant="link"
                                onPress={() => {
                                    onDialog({ kind: "subject", clientId: c.id, subject: null });
                                }}
                            >
                                {strings.subjects.add(kind)}
                            </Button>
                        </span>
                    }
                >
                    {record.subjects.length === 0 ? (
                        <p className="text-sm text-muted">{strings.subjects.none(kind)}</p>
                    ) : null}
                    <div className="grid gap-2">
                        {record.subjects.map((subject) => {
                            const temperament = subjectTemperament(kind, subject.attributes);
                            return (
                                <div
                                    key={subject.id}
                                    className="overflow-hidden rounded-md border border-line bg-bg"
                                >
                                    <ListRow
                                        density="compact"
                                        leading={<Avatar name={subject.name} size="sm" />}
                                        title={subject.name}
                                        detail={subjectSummary(kind, subject.attributes, zone)}
                                        meta={
                                            temperament !== null ? (
                                                <Badge
                                                    label={temperament.label}
                                                    intent={
                                                        temperament.nervous ? "warning" : "neutral"
                                                    }
                                                />
                                            ) : undefined
                                        }
                                        label={strings.subjects.editNamed(subject.name)}
                                        onPress={() => {
                                            onDialog({ kind: "subject", clientId: c.id, subject });
                                        }}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </DetailSection>
            ) : null}
            <DetailSection title={r.upcoming}>
                {record.upcoming.length === 0 ? (
                    <p className="text-sm text-muted">{r.noUpcoming}</p>
                ) : (
                    <ul className="divide-y divide-line-soft rounded-md border border-line">
                        {record.upcoming.slice(0, 3).map((v) => {
                            const pill = visitPill(v, now);
                            return (
                                <li key={v.id} className="flex items-center gap-3 px-3 py-2.5">
                                    <span
                                        className="h-8 w-1 rounded-full bg-accent"
                                        style={
                                            v.color === null
                                                ? undefined
                                                : { backgroundColor: v.color }
                                        }
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-sm font-medium text-ink">
                                            {v.service}
                                        </div>
                                        <div className="text-xs text-muted">
                                            {formatParts([
                                                formatWeekday(v.start, zone),
                                                formatDate(v.start, zone),
                                                formatTime(v.start, zone),
                                                v.staffName,
                                            ])}
                                        </div>
                                    </div>
                                    {pill !== null ? (
                                        <StatusPill status={pill.label} intent={pill.intent} />
                                    ) : null}
                                </li>
                            );
                        })}
                    </ul>
                )}
                {record.lastVisitAt !== null ? (
                    <p className="mt-2 text-xs text-muted">
                        {r.lastVisit(formatDate(record.lastVisitAt, zone))}
                    </p>
                ) : null}
            </DetailSection>
            <DetailSection
                title={r.notes}
                action={
                    <Button
                        size="sm"
                        variant="link"
                        onPress={() => {
                            onDialog({ kind: "note", clientId: c.id, subjects: record.subjects });
                        }}
                    >
                        {r.addNote}
                    </Button>
                }
            >
                {record.notes.length === 0 ? (
                    <p className="text-sm text-muted">{r.noNotes}</p>
                ) : null}
                <ul className="space-y-2">
                    {record.notes.map((n) => (
                        <NoteItem key={n.id} note={n} manager={manager} />
                    ))}
                </ul>
            </DetailSection>
            {manager ? (
                <DetailSection
                    title={r.wallet}
                    action={
                        <Button
                            size="sm"
                            variant="link"
                            onPress={() => {
                                setPane("wallet");
                            }}
                        >
                            {r.manageWallet}
                        </Button>
                    }
                >
                    <div className="divide-y divide-line-soft rounded-md border border-line">
                        {record.methods.length === 0 ? (
                            <p className="px-3 py-2.5 text-sm text-muted">{r.noCards}</p>
                        ) : null}
                        {record.methods.map((m) => (
                            <div
                                key={m.id}
                                className="flex items-center justify-between px-3 py-2.5 text-sm"
                            >
                                <span className="text-ink">{savedCardLabel(m)}</span>
                                {m.preferred === 1 ? (
                                    <Badge label={strings.clients.wallet.default} intent="accent" />
                                ) : null}
                            </div>
                        ))}
                        {record.plans.map((p) => (
                            <div
                                key={p.id}
                                className="flex items-center justify-between px-3 py-2.5 text-sm"
                            >
                                <span className="text-ink">{p.name}</span>
                                <span className="text-xs text-muted">{p.detail}</span>
                            </div>
                        ))}
                    </div>
                </DetailSection>
            ) : null}
        </DetailView>
    );
}
