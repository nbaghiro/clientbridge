import {
    type ClientListRow,
    type ClientSegment,
    type ClientSelection,
    type SubjectKind,
    canManagePayments,
    formatDate,
    kindWord,
    nextVisitLabel,
    strings,
    useClientDirectory,
    useClientRecord,
    useClientSelection,
    formatParts,
    BUSINESS_CURRENCY,
    useBusinessZone,
    usePeoplePhotos,
    useSubjectKind,
    openTask,
} from "@clientbridge/app-core";
import {
    Avatar,
    Badge,
    ListPage,
    Button,
    Checkbox,
    confirm,
    Icon,
    LoadFailed,
    Money,
    Notice,
    Panel,
    Skeleton,
    TextField,
    PageFrame,
} from "@clientbridge/ui";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import {
    type ClientDialog,
    ClientDialogs,
    ClientRecordView,
    RecordFacts,
} from "../components/ClientRecord";
import { ClientHistory } from "../components/ClientHistory";
import { ClientSubjects } from "../components/ClientSubjects";
import { useWide } from "../components/ScheduleGrid";
import { api } from "../lib/api";
import { useRole, useViewer } from "../lib/auth";
import { useLinkIntent, useOpenLink } from "../lib/links";

const r = strings.clients.record;
const t = strings.clients.tidy;

const VIEWS = ["history", "subjects"] as const;
type View = (typeof VIEWS)[number];

export function Clients() {
    const { clientId, view } = useParams();
    if (clientId !== undefined && VIEWS.includes(view as View))
        return <ClientPage clientId={clientId} view={view as View} />;
    return <ClientList />;
}

function ClientList() {
    const photos = usePeoplePhotos();
    const zone = useBusinessZone();
    const kind = useSubjectKind();
    const dir = useClientDirectory();
    const manager = canManagePayments(useRole());
    const [openId, setOpenId] = useState<string | null>(null);
    const [dialog, setDialog] = useState<ClientDialog | null>(null);
    const [selecting, setSelecting] = useState(false);
    const [merged, setMerged] = useState<string | null>(null);
    const sel = useClientSelection(api, dir.all);
    const wide = useWide();
    useLinkIntent({ onOpen: setOpenId });
    const grid =
        kind === null
            ? selecting
                ? "grid grid-cols-[28px_2fr_1.6fr] items-center gap-3"
                : manager
                  ? "grid grid-cols-[2.2fr_1.2fr_0.9fr] items-center gap-4"
                  : "grid grid-cols-[2.2fr_1.2fr] items-center gap-4"
            : selecting
              ? "grid grid-cols-[28px_2fr_1.2fr_1.6fr] items-center gap-3"
              : manager
                ? "grid grid-cols-[2.2fr_1.2fr_1.2fr_0.9fr] items-center gap-4"
                : "grid grid-cols-[2.2fr_1.4fr_1.2fr] items-center gap-4";
    const ids = dir.rows.map((c) => c.id);
    const allOn = ids.length > 0 && ids.every((id) => sel.isSelected(id));

    const none = dir.load.hasData && dir.counts.active + dir.counts.archived === 0;
    const add = (): void => {
        setDialog({ kind: "client", id: null });
    };
    const dialogs = (
        <ClientDialogs
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
    );

    const record =
        openId !== null ? (
            <ClientRecordView
                key={openId}
                visible
                variant={wide ? "inline" : "drawer"}
                clientId={openId}
                manager={manager}
                onClose={() => {
                    setOpenId(null);
                }}
                onDialog={setDialog}
            />
        ) : null;

    return (
        <PageFrame>
            <div className="flex items-start gap-6">
                <section className="min-w-0 flex-1">
                    <ListPage<ClientListRow, ClientSegment>
                        title={strings.clients.title}
                        summary={
                            dir.load.hasData && !none
                                ? strings.clients.edit.listSummary(
                                      dir.counts.active,
                                      dir.counts.archived,
                                  )
                                : undefined
                        }
                        action={
                            none
                                ? undefined
                                : {
                                      label: strings.clients.add,
                                      onPress: add,
                                  }
                        }
                        accessory={
                            dir.load.ready && !none ? (
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
                            dir.load.ready && !none
                                ? {
                                      items: [
                                          {
                                              key: "active",
                                              label: strings.clients.edit.segmentActive(
                                                  dir.counts.active,
                                              ),
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
                            dir.load.ready && !none
                                ? {
                                      value: dir.q,
                                      onChange: dir.setQ,
                                      placeholder: r.searchPlaceholder(kindWord(kind)),
                                  }
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
                            none ? undefined : (
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
                                    {kind !== null ? (
                                        <span>{strings.subjects.many(kind)}</span>
                                    ) : null}
                                    <span>{selecting ? r.colTags : r.colNext}</span>
                                    {manager && !selecting ? (
                                        <span className="text-right">{r.colBalance}</span>
                                    ) : null}
                                </div>
                            )
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
                        selectedKey={openId ?? undefined}
                        empty={
                            dir.load.state === "empty"
                                ? {
                                      icon: "clients",
                                      message: r.emptyTitle,
                                      body: r.emptyBody,
                                      actions: (
                                          <Button
                                              onPress={() => {
                                                  add();
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
                                    <Avatar name={c.name} src={photos.client(c.id)} />
                                    <div className="min-w-0">
                                        <div className="truncate font-medium text-ink">
                                            {c.name}
                                        </div>
                                        <div className="truncate text-xs text-muted">
                                            {c.phoneLabel || strings.clients.dash}
                                        </div>
                                    </div>
                                </div>
                                {kind !== null ? (
                                    <span className="truncate text-sm text-ink-soft">
                                        {c.subjects || strings.clients.dash}
                                    </span>
                                ) : null}
                                {selecting ? (
                                    <span className="flex min-w-0 flex-wrap gap-1">
                                        {c.tags.map((tag) => (
                                            <Badge key={tag} label={tag} intent="neutral" />
                                        ))}
                                    </span>
                                ) : (
                                    <span
                                        className={
                                            c.next === null
                                                ? "text-sm text-muted"
                                                : "text-sm text-ink-soft"
                                        }
                                    >
                                        {nextVisitLabel(c.next, zone)}
                                    </span>
                                )}
                                {manager && !selecting ? (
                                    <span className="text-right text-sm">
                                        {c.balanceCents > 0 ? (
                                            <Money
                                                currency={BUSINESS_CURRENCY}
                                                cents={c.balanceCents}
                                                tone="danger"
                                            />
                                        ) : (
                                            <span className="text-muted">
                                                {strings.clients.dash}
                                            </span>
                                        )}
                                    </span>
                                ) : null}
                            </div>
                        )}
                    />
                </section>
                {wide && record !== null ? (
                    <aside
                        aria-label={r.pane}
                        className="sticky top-8 flex h-[calc(100vh-4rem)] w-[380px] shrink-0 flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-card xl:w-[420px]"
                    >
                        {record}
                    </aside>
                ) : (
                    record
                )}
            </div>

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
            {dialogs}
            {merged !== null ? (
                <div className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2">
                    <Notice tone="success" banner>
                        {t.merged(merged)}
                    </Notice>
                </div>
            ) : null}
        </PageFrame>
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

function viewTitle(view: View, kind: SubjectKind | null): string {
    return view === "history"
        ? strings.clients.history.title
        : strings.subjects.many(kindWord(kind));
}

function ClientPage({ clientId, view }: { clientId: string; view: View }) {
    const photos = usePeoplePhotos();
    const zone = useBusinessZone();
    const kind = useSubjectKind();
    const viewer = useViewer();
    const manager = canManagePayments(useRole());
    const { load, record } = useClientRecord(api, clientId, viewer?.staffId ?? null);
    const open = useOpenLink();
    const c = record?.client;

    return (
        <PageFrame>
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
                        <Avatar name={c.name} src={photos.client(c.id)} size="lg" />
                        <div className="min-w-0 flex-1">
                            <h1 className="truncate font-display text-2xl font-bold text-ink">
                                {c.name}
                            </h1>
                            <p className="text-sm text-muted">
                                {formatParts([
                                    viewTitle(view, kind),
                                    c.phoneLabel,
                                    strings.clients.history.since(formatDate(c.since, zone)),
                                ])}
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
                                    openTask({ kind: "booking", clientId: c.id });
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
                        {view === "subjects" && kind !== null ? (
                            <ClientSubjects clientId={clientId} kind={kind} />
                        ) : null}
                    </div>
                </>
            )}
        </PageFrame>
    );
}
