import {
    type ClientListRow,
    type ClientNote,
    type ClientRecord,
    type ClientSegment,
    type ClientSelection,
    type SubjectRow,
    canManagePayments,
    formatDate,
    formatRelativeTime,
    formatTime,
    formatWeekday,
    nextVisitLabel,
    petSummary,
    savedCardLabel,
    strings,
    useClientDirectory,
    useClientRecord,
    useClientSelection,
    useNoteActions,
    visitPill,
} from "@clientbridge/app-core";
import {
    ActionMenu,
    Avatar,
    Badge,
    Button,
    Checkbox,
    confirm,
    DetailSection,
    DetailView,
    Icon,
    IconButton,
    KeyValueList,
    ListPage,
    ListRow,
    LoadFailed,
    Money,
    Notice,
    Panel,
    Skeleton,
    StatusPill,
    TextField,
} from "@clientbridge/ui";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { ClientEditorDialog } from "../components/ClientEditor";
import { ClientHistory, NoteDialog } from "../components/ClientHistory";
import { ClientMergeDialog } from "../components/ClientMerge";
import { ClientPets, PetDialog } from "../components/ClientPets";
import { ClientWallet } from "../components/ClientWallet";
import { api } from "../lib/api";
import { useRole, useViewer } from "../lib/auth";
import { useLinkIntent, useOpenLink } from "../lib/links";

const r = strings.clients.record;
const t = strings.clients.tidy;

type Dialog =
    | { kind: "client"; id: string | null }
    | { kind: "pet"; clientId: string; pet: SubjectRow | null }
    | { kind: "note"; clientId: string; pets: readonly SubjectRow[] }
    | { kind: "merge"; a: ClientListRow; b: ClientListRow };

const VIEWS = ["history", "pets", "payment-methods"] as const;
type View = (typeof VIEWS)[number];

export function Clients() {
    const { clientId, view } = useParams();
    if (clientId !== undefined && VIEWS.includes(view as View))
        return <ClientPage clientId={clientId} view={view as View} />;
    return <ClientList />;
}

function ClientList() {
    const dir = useClientDirectory();
    const manager = canManagePayments(useRole());
    const [openId, setOpenId] = useState<string | null>(null);
    const [dialog, setDialog] = useState<Dialog | null>(null);
    const [selecting, setSelecting] = useState(false);
    const [merged, setMerged] = useState<string | null>(null);
    const sel = useClientSelection(api, dir.all);
    useLinkIntent({
        onCreate: () => {
            setDialog({ kind: "client", id: null });
        },
        onOpen: setOpenId,
    });
    const grid = selecting
        ? "grid grid-cols-[28px_2fr_1.2fr_1.6fr] items-center gap-3"
        : manager
          ? "grid grid-cols-[2.2fr_1.2fr_1.2fr_0.9fr] items-center gap-4"
          : "grid grid-cols-[2.2fr_1.4fr_1.2fr] items-center gap-4";
    const ids = dir.rows.map((c) => c.id);
    const allOn = ids.length > 0 && ids.every((id) => sel.isSelected(id));

    return (
        <div className="mx-auto max-w-6xl px-8 py-8">
            <ListPage<ClientListRow, ClientSegment>
                title={strings.clients.title}
                summary={
                    dir.load.hasData
                        ? strings.clients.edit.listSummary(dir.counts.active, dir.counts.archived)
                        : undefined
                }
                action={{
                    label: strings.clients.add,
                    onPress: () => {
                        setDialog({ kind: "client", id: null });
                    },
                }}
                accessory={
                    dir.load.ready ? (
                        <Button
                            variant={selecting ? "outline" : "quiet"}
                            icon="check"
                            onPress={() => {
                                setSelecting(!selecting);
                                sel.clear();
                            }}
                        >
                            {selecting ? strings.common.done : t.select}
                        </Button>
                    ) : undefined
                }
                segments={
                    dir.load.ready
                        ? {
                              items: [
                                  {
                                      key: "active",
                                      label: strings.clients.edit.segmentActive(dir.counts.active),
                                  },
                                  {
                                      key: "archived",
                                      label: strings.clients.edit.segmentArchived(
                                          dir.counts.archived,
                                      ),
                                  },
                              ],
                              active: dir.segment,
                              onSelect: dir.setSegment,
                          }
                        : undefined
                }
                search={
                    dir.load.ready
                        ? { value: dir.q, onChange: dir.setQ, placeholder: r.searchPlaceholder }
                        : undefined
                }
                banner={
                    sel.done !== null ? (
                        <Notice tone="success" banner>
                            {sel.done}
                        </Notice>
                    ) : undefined
                }
                state={
                    dir.load.state === "loading" || dir.load.state === "error"
                        ? dir.load.state
                        : undefined
                }
                onRetry={dir.load.retry}
                head={
                    <div className={grid}>
                        {selecting ? (
                            <Checkbox
                                label={t.selectAll}
                                hideLabel
                                value={allOn}
                                mixed={!allOn && sel.selected.length > 0}
                                onChange={() => {
                                    if (sel.selected.length > 0) sel.clear();
                                    else sel.setAll(ids);
                                }}
                            />
                        ) : null}
                        <span>{r.colClient}</span>
                        <span>{r.colPets}</span>
                        <span>{selecting ? r.colTags : r.colNext}</span>
                        {manager && !selecting ? (
                            <span className="text-right">{r.colBalance}</span>
                        ) : null}
                    </div>
                }
                rows={dir.rows}
                rowKey={(c) => c.id}
                onRowPress={
                    selecting
                        ? undefined
                        : (c) => {
                              setOpenId(c.id);
                          }
                }
                empty={
                    dir.load.state === "empty"
                        ? {
                              icon: "clients",
                              message: r.emptyTitle,
                              body: r.emptyBody,
                              actions: (
                                  <Button
                                      onPress={() => {
                                          setDialog({ kind: "client", id: null });
                                      }}
                                  >
                                      {strings.clients.add}
                                  </Button>
                              ),
                          }
                        : dir.segment === "archived" && dir.q === ""
                          ? strings.clients.edit.emptyArchived
                          : strings.clients.emptySearch
                }
                renderRow={(c) => (
                    <div className={grid}>
                        {selecting ? (
                            <Checkbox
                                label={c.name}
                                hideLabel
                                value={sel.isSelected(c.id)}
                                onChange={() => {
                                    sel.toggle(c.id);
                                }}
                            />
                        ) : null}
                        <div className="flex min-w-0 items-center gap-3">
                            <Avatar name={c.name} />
                            <div className="min-w-0">
                                <div className="truncate font-medium text-ink">{c.name}</div>
                                <div className="truncate text-xs text-muted">
                                    {c.phoneLabel || (c.email ?? strings.clients.dash)}
                                </div>
                            </div>
                        </div>
                        <span className="truncate text-sm text-ink-soft">
                            {c.pets || strings.clients.dash}
                        </span>
                        {selecting ? (
                            <span className="flex min-w-0 flex-wrap gap-1">
                                {c.tags.map((tag) => (
                                    <Badge key={tag} label={tag} intent="neutral" />
                                ))}
                            </span>
                        ) : (
                            <span
                                className={
                                    c.next === null ? "text-sm text-muted" : "text-sm text-ink-soft"
                                }
                            >
                                {nextVisitLabel(c.next)}
                            </span>
                        )}
                        {manager && !selecting ? (
                            <span className="text-right text-sm">
                                {c.balanceCents > 0 ? (
                                    <Money cents={c.balanceCents} tone="danger" />
                                ) : (
                                    <span className="text-muted">{strings.clients.dash}</span>
                                )}
                            </span>
                        ) : null}
                    </div>
                )}
            />

            {selecting && sel.selected.length > 0 ? (
                <SelectionBar
                    sel={sel}
                    manager={manager}
                    onMerge={() => {
                        const [a, b] = sel.selected.map((id) => dir.all.find((c) => c.id === id));
                        if (a !== undefined && b !== undefined) setDialog({ kind: "merge", a, b });
                    }}
                />
            ) : null}

            {openId !== null ? (
                <RecordPanel
                    clientId={openId}
                    manager={manager}
                    onClose={() => {
                        setOpenId(null);
                    }}
                    onDialog={setDialog}
                />
            ) : null}
            <Dialogs
                dialog={dialog}
                directory={dir.all}
                onOpenClient={(id) => {
                    setDialog(null);
                    setOpenId(id);
                }}
                onMerged={(name) => {
                    setDialog(null);
                    sel.clear();
                    setSelecting(false);
                    setMerged(name);
                }}
                onClose={() => {
                    setDialog(null);
                }}
            />
            {merged !== null ? (
                <div className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2">
                    <Notice tone="success" banner>
                        {t.merged(merged)}
                    </Notice>
                </div>
            ) : null}
        </div>
    );
}

function SelectionBar({
    sel,
    manager,
    onMerge,
}: {
    sel: ClientSelection;
    manager: boolean;
    onMerge: () => void;
}) {
    const [tagging, setTagging] = useState(false);
    const n = sel.selected.length;
    const askArchive = (): void => {
        confirm({
            title: t.archiveTitle(n),
            message: t.archiveBody,
            confirmLabel: t.archiveConfirm,
            destructive: true,
        })
            .then((ok) => {
                if (ok) sel.archive();
            })
            .catch(() => undefined);
    };
    return (
        <div className="sticky bottom-6 z-10 mt-4 flex justify-center">
            <div className="relative flex items-center gap-1 rounded-xl border border-line bg-surface p-1.5 pl-4 shadow-card">
                <span className="pr-3 text-sm font-semibold text-ink">{t.selected(n)}</span>
                <Button
                    variant={tagging ? "outline" : "quiet"}
                    icon="tag"
                    onPress={() => {
                        setTagging(!tagging);
                    }}
                >
                    {t.tag}
                </Button>
                {manager ? (
                    <>
                        <Button
                            variant="quiet"
                            icon="copy"
                            disabled={!sel.canMerge}
                            label={sel.canMerge ? t.mergeSelected : t.mergeNeedsTwo}
                            onPress={onMerge}
                        >
                            {t.mergeSelected}
                        </Button>
                        <Button
                            variant="quiet"
                            icon="box"
                            busy={sel.archiving}
                            onPress={askArchive}
                        >
                            {t.archive}
                        </Button>
                    </>
                ) : null}
                <span className="mx-1 h-6 w-px bg-line" />
                <Button variant="quiet" onPress={sel.clear}>
                    {t.clear}
                </Button>
                {tagging ? (
                    <TagPopover
                        sel={sel}
                        onDone={() => {
                            setTagging(false);
                        }}
                    />
                ) : null}
            </div>
            {sel.error !== null && !tagging ? (
                <div className="absolute bottom-full mb-2">
                    <Notice tone="danger" banner>
                        {sel.error}
                    </Notice>
                </div>
            ) : null}
        </div>
    );
}

function TagPopover({ sel, onDone }: { sel: ClientSelection; onDone: () => void }) {
    const [draft, setDraft] = useState("");
    const n = sel.selected.length;
    return (
        <div
            role="dialog"
            aria-label={t.applyTags(n)}
            className="absolute bottom-full left-0 mb-2 w-80 overflow-hidden rounded-lg border border-line bg-surface shadow-card"
        >
            <p className="border-b border-line-soft px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted">
                {t.applyTags(n)}
            </p>
            <ul className="max-h-64 space-y-2 overflow-y-auto px-4 py-3">
                {sel.tagState.map((tag) => {
                    const pending = sel.pendingTags[tag.tag];
                    const on = pending ?? tag.on === n;
                    const mixed = pending === undefined && tag.on > 0 && tag.on < n;
                    return (
                        <li key={tag.tag} className="flex items-center justify-between gap-3">
                            <Checkbox
                                label={tag.tag}
                                value={on}
                                mixed={mixed}
                                onChange={() => {
                                    sel.toggleTag(tag.tag);
                                }}
                            />
                            <span className="text-xs text-muted">
                                {mixed
                                    ? t.onSome(tag.on, n)
                                    : on && pending === undefined
                                      ? t.onAll
                                      : t.clientsCount(tag.count)}
                            </span>
                        </li>
                    );
                })}
            </ul>
            <form
                className="flex gap-2 border-t border-line-soft px-4 py-3"
                onSubmit={(e) => {
                    e.preventDefault();
                    sel.addTag(draft);
                    setDraft("");
                }}
            >
                <TextField
                    size="sm"
                    name={t.newTag}
                    placeholder={t.newTag}
                    value={draft}
                    onChange={setDraft}
                />
                <Button size="sm" variant="outline" submit disabled={draft.trim() === ""}>
                    {strings.clients.addShort}
                </Button>
            </form>
            {sel.error !== null ? (
                <div className="px-4 pb-2">
                    <Notice tone="danger">{sel.error}</Notice>
                </div>
            ) : null}
            <div className="flex justify-end gap-2 border-t border-line bg-bg px-4 py-2.5">
                <Button size="sm" variant="quiet" onPress={onDone}>
                    {strings.common.cancel}
                </Button>
                <Button
                    size="sm"
                    busy={sel.busy}
                    disabled={Object.keys(sel.pendingTags).length === 0}
                    onPress={sel.apply}
                >
                    {sel.busy ? t.applying : t.apply}
                </Button>
            </div>
        </div>
    );
}

function Dialogs({
    dialog,
    directory,
    onOpenClient,
    onMerged,
    onClose,
}: {
    dialog: Dialog | null;
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
        case "pet":
            return (
                <PetDialog
                    key={dialog.pet?.id ?? "new"}
                    clientId={dialog.clientId}
                    pet={dialog.pet}
                    onClose={onClose}
                />
            );
        case "note":
            return <NoteDialog clientId={dialog.clientId} pets={dialog.pets} onClose={onClose} />;
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

function RecordFacts({ record, manager }: { record: ClientRecord; manager: boolean }) {
    const c = record.client;
    return (
        <KeyValueList
            layout="stack"
            columns={2}
            rows={[
                ...(manager
                    ? [
                          { label: r.lifetime, value: <Money cents={c.lifetimeCents} /> },
                          {
                              label: r.balance,
                              value:
                                  c.balanceCents > 0 ? <Money cents={c.balanceCents} /> : r.settled,
                              intent: c.balanceCents > 0 ? ("warning" as const) : undefined,
                          },
                      ]
                    : []),
                { label: r.visits, value: String(record.visits) },
                { label: r.since, value: formatDate(c.since) },
            ]}
        />
    );
}

function NoteItem({ note, manager }: { note: ClientNote; manager: boolean }) {
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
                        formatRelativeTime(note.at.toISOString()),
                    )}
                    {note.pet !== null ? <Badge label={note.pet} intent="neutral" /> : null}
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

function RecordPanel({
    clientId,
    manager,
    onClose,
    onDialog,
}: {
    clientId: string;
    manager: boolean;
    onClose: () => void;
    onDialog: (d: Dialog) => void;
}) {
    const viewer = useViewer();
    const { load, record } = useClientRecord(clientId, viewer?.staffId ?? null);
    const navigate = useNavigate();
    const go = (path: string): void => {
        const done = navigate(path);
        if (done) done.catch(() => undefined);
    };
    if (record === null) {
        return (
            <DetailView open title={strings.clients.title} onClose={onClose}>
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
    return (
        <DetailView
            open
            title={c.name}
            subtitle={[c.phoneLabel, record.pets.map((p) => p.name).join(", ")]
                .filter(Boolean)
                .join(" · ")}
            status={c.archived ? { status: r.archived, intent: "warning" } : undefined}
            leading={<Avatar name={c.name} size="lg" />}
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
                    <span>{[c.email, r.prefers(c.channel)].filter(Boolean).join(" · ")}</span>
                </div>
            ) : null}
            <div className="rounded-md border border-line bg-bg px-4 py-3">
                <RecordFacts record={record} manager={manager} />
            </div>
            <DetailSection
                title={r.pets}
                action={
                    <span className="flex gap-3">
                        {record.pets.length > 0 ? (
                            <Button
                                size="sm"
                                variant="link"
                                onPress={() => {
                                    go(`/clients/${c.id}/pets`);
                                }}
                            >
                                {strings.clients.pets.pets}
                            </Button>
                        ) : null}
                        <Button
                            size="sm"
                            variant="link"
                            onPress={() => {
                                onDialog({ kind: "pet", clientId: c.id, pet: null });
                            }}
                        >
                            {r.addPet}
                        </Button>
                    </span>
                }
            >
                {record.pets.length === 0 ? <p className="text-sm text-muted">{r.noPets}</p> : null}
                <div className="grid gap-2">
                    {record.pets.map((pet) => (
                        <div
                            key={pet.id}
                            className="overflow-hidden rounded-md border border-line bg-bg"
                        >
                            <ListRow
                                density="compact"
                                leading={<Avatar name={pet.name} size="sm" />}
                                title={pet.name}
                                detail={petSummary(pet)}
                                meta={
                                    typeof pet.attributes.temperament === "string" ? (
                                        <Badge
                                            label={pet.attributes.temperament}
                                            intent={
                                                pet.attributes.temperament === "anxious" ||
                                                pet.attributes.temperament === "reactive"
                                                    ? "warning"
                                                    : "neutral"
                                            }
                                        />
                                    ) : undefined
                                }
                                label={r.editPetNamed(pet.name)}
                                onPress={() => {
                                    onDialog({ kind: "pet", clientId: c.id, pet });
                                }}
                            />
                        </div>
                    ))}
                </div>
            </DetailSection>
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
                                            {formatWeekday(v.start)} · {formatDate(v.start)} ·{" "}
                                            {formatTime(v.start)}
                                            {v.staffName === null ? "" : ` · ${v.staffName}`}
                                        </div>
                                    </div>
                                    {pill !== null ? (
                                        <StatusPill
                                            status={pill.label}
                                            intent={pill.intent}
                                            asWritten
                                        />
                                    ) : null}
                                </li>
                            );
                        })}
                    </ul>
                )}
                {record.lastVisit !== null ? (
                    <p className="mt-2 text-xs text-muted">
                        {r.lastVisit(formatDate(record.lastVisit.start))}
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
                            onDialog({ kind: "note", clientId: c.id, pets: record.pets });
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
                                go(`/clients/${c.id}/payment-methods`);
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

const VIEW_TITLE: Record<View, string> = {
    history: strings.clients.history.title,
    pets: strings.clients.pets.pets,
    "payment-methods": strings.clients.wallet.title,
};

function ClientPage({ clientId, view }: { clientId: string; view: View }) {
    const viewer = useViewer();
    const manager = canManagePayments(useRole());
    const { load, record } = useClientRecord(clientId, viewer?.staffId ?? null);
    const open = useOpenLink();
    const c = record?.client;

    return (
        <div className="mx-auto max-w-6xl px-8 py-8">
            <Link
                to={`/clients?open=${encodeURIComponent(clientId)}`}
                className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
            >
                <Icon name="chevronLeft" size={16} />
                {r.back}
            </Link>
            {c === undefined ? (
                <div className="mt-6">
                    {load.state === "error" ? (
                        <LoadFailed
                            message={r.loadError}
                            onRetry={load.retry}
                            retrying={load.retrying}
                        />
                    ) : load.state === "empty" ? (
                        <p className="text-sm text-muted">{r.goneBody}</p>
                    ) : (
                        <Skeleton variant="row" count={3} label={r.loadingRecord} />
                    )}
                </div>
            ) : (
                <>
                    <header className="mt-3 flex flex-wrap items-center gap-4">
                        <Avatar name={c.name} size="lg" />
                        <div className="min-w-0 flex-1">
                            <h1 className="truncate font-display text-2xl font-bold text-ink">
                                {c.name}
                            </h1>
                            <p className="text-sm text-muted">
                                {[
                                    VIEW_TITLE[view],
                                    c.phoneLabel,
                                    strings.clients.history.since(formatDate(c.since)),
                                ]
                                    .filter(Boolean)
                                    .join(" · ")}
                            </p>
                        </div>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                onPress={() => {
                                    open("message", c.id);
                                }}
                            >
                                {r.message}
                            </Button>
                            <Button
                                onPress={() => {
                                    open("booking");
                                }}
                            >
                                {r.book}
                            </Button>
                        </div>
                    </header>
                    <div className="mt-6">
                        {view === "history" && record !== null ? (
                            <ClientHistory
                                clientId={clientId}
                                aside={
                                    <Panel>
                                        <RecordFacts record={record} manager={manager} />
                                    </Panel>
                                }
                            />
                        ) : null}
                        {view === "pets" ? <ClientPets clientId={clientId} /> : null}
                        {view === "payment-methods" ? (
                            manager ? (
                                <ClientWallet clientId={clientId} />
                            ) : (
                                <p className="text-sm text-muted">
                                    {strings.clients.wallet.onlyManagers}
                                </p>
                            )
                        ) : null}
                    </div>
                </>
            )}
        </div>
    );
}
