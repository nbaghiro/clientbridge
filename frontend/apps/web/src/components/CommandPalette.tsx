import {
    DESTINATIONS,
    DESTINATION_TARGET,
    type DestinationKey,
    type IconName,
    type SearchHit,
    type SearchKind,
    type Viewer,
    highlight,
    strings,
    useGlobalSearch,
} from "@clientbridge/app-core";
import {
    Button,
    Choice,
    Empty,
    ListRow,
    LoadFailed,
    Modal,
    SearchField,
    Skeleton,
    StatusPill,
} from "@clientbridge/ui";

import { useOpenLink } from "../lib/links";

const GO_ICON: Record<DestinationKey, IconName> = {
    today: "today",
    schedule: "calendar",
    clients: "clients",
    payments: "invoices",
    inbox: "inbox",
};

const s = strings.search;

function Highlighted({ text, q }: { text: string; q: string }) {
    return (
        <>
            {highlight(text, q).map((p, i) =>
                p.match ? (
                    <mark
                        key={i}
                        className="rounded-sm bg-accent-weak px-px font-semibold text-accent-strong"
                    >
                        {p.text}
                    </mark>
                ) : (
                    <span key={i}>{p.text}</span>
                ),
            )}
        </>
    );
}

function HitRow({
    hit,
    q,
    active,
    onPress,
}: {
    hit: SearchHit;
    q: string;
    active: boolean;
    onPress: () => void;
}) {
    return (
        <ListRow
            density="compact"
            selected={active}
            icon={hit.icon}
            intent={hit.kind === "actions" ? "accent" : "neutral"}
            leading={
                hit.color !== null && hit.kind !== "actions" ? (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface2">
                        <span
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: hit.color }}
                        />
                    </span>
                ) : undefined
            }
            label={`${hit.title}, ${hit.detail}`}
            title={<Highlighted text={hit.title} q={q} />}
            detail={<Highlighted text={hit.detail} q={hit.kind === "actions" ? "" : q} />}
            meta={
                hit.meta !== null && hit.metaIntent !== null ? (
                    <StatusPill status={hit.meta} intent={hit.metaIntent} />
                ) : hit.meta !== null ? (
                    <span
                        className={
                            hit.kind === "actions"
                                ? "rounded border border-line bg-bg px-1.5 py-0.5 font-mono text-[11px]"
                                : "text-sm font-medium text-ink"
                        }
                    >
                        {hit.meta}
                    </span>
                ) : undefined
            }
            onPress={onPress}
        />
    );
}

function SectionTitle({ children }: { children: string }) {
    return (
        <h3 className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">
            {children}
        </h3>
    );
}

/** ⌘K: one search over this device's replica, grouped by kind, that doubles as a launcher. */
export function CommandPalette({
    viewer,
    onClose,
}: {
    viewer: Viewer | null;
    onClose: () => void;
}) {
    const search = useGlobalSearch(viewer);
    const openLink = useOpenLink();
    const open = (hit: SearchHit | undefined): void => {
        if (hit === undefined) return;
        search.remember(search.q);
        onClose();
        openLink(hit.target, hit.refId);
    };
    const scopes = search.scopes.map((k) => ({
        key: k.key,
        label: k.label,
        hint: k.count === null ? undefined : String(k.count),
        disabled: k.count === 0,
    }));
    const q = search.q.trim();

    return (
        <Modal onClose={onClose} size="lg" framed={false}>
            <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
                <h2 className="sr-only">{strings.navigation.search}</h2>
                <SearchField
                    size="lg"
                    autoFocus
                    value={search.q}
                    onChange={search.setQ}
                    placeholder={s.placeholder}
                    onKey={(k) => {
                        if (k === "down") search.move(1);
                        if (k === "up") search.move(-1);
                        if (k === "escape") onClose();
                        if (k === "enter") open(search.flat[search.active]);
                    }}
                    trailing={
                        <kbd className="rounded border border-line bg-bg px-1.5 py-0.5 font-mono text-[11px] text-muted">
                            {s.esc}
                        </kbd>
                    }
                />
                <div className="border-y border-line-soft px-4 py-2.5">
                    <Choice<SearchKind | "all">
                        options={scopes}
                        value={search.scope}
                        onChange={search.setScope}
                        label={s.filters}
                    />
                </div>
                <div className="max-h-[420px] overflow-y-auto py-1">
                    {search.load.state === "loading" ? (
                        <Skeleton variant="row" count={5} label={s.loading} />
                    ) : search.load.state === "error" ? (
                        <LoadFailed
                            message={s.loadError}
                            body={s.loadErrorBody}
                            onRetry={search.load.retry}
                            retrying={search.load.retrying}
                        />
                    ) : q === "" ? (
                        <>
                            {search.load.state === "empty" && search.recent.length === 0 ? (
                                <Empty
                                    icon="search"
                                    message={s.nothingYet}
                                    body={s.nothingYetBody}
                                />
                            ) : null}
                            {search.recent.length > 0 ? (
                                <section>
                                    <div className="flex items-center justify-between pr-3">
                                        <SectionTitle>{s.recent}</SectionTitle>
                                        <Button
                                            size="sm"
                                            variant="link"
                                            onPress={search.clearRecent}
                                        >
                                            {s.clearRecent}
                                        </Button>
                                    </div>
                                    {search.recent.map((r) => (
                                        <ListRow
                                            key={r}
                                            density="compact"
                                            icon="history"
                                            title={r}
                                            label={s.recentSearch(r)}
                                            onPress={() => {
                                                search.setQ(r);
                                            }}
                                        />
                                    ))}
                                </section>
                            ) : null}
                            <section>
                                <SectionTitle>{s.jumpTo}</SectionTitle>
                                {DESTINATIONS.map((d) => (
                                    <ListRow
                                        key={d.key}
                                        density="compact"
                                        icon={GO_ICON[d.key]}
                                        title={d.label}
                                        onPress={() => {
                                            onClose();
                                            openLink(DESTINATION_TARGET[d.key]);
                                        }}
                                    />
                                ))}
                            </section>
                            <section>
                                <SectionTitle>{s.actions}</SectionTitle>
                                {search.actions.slice(0, 4).map((a) => (
                                    <ListRow
                                        key={a.key}
                                        density="compact"
                                        icon={a.icon}
                                        intent="accent"
                                        title={a.label}
                                        detail={a.hint}
                                        onPress={() => {
                                            onClose();
                                            openLink(a.target);
                                        }}
                                        meta={
                                            <span className="rounded border border-line bg-bg px-1.5 py-0.5 font-mono text-[11px]">
                                                {a.shortcut}
                                            </span>
                                        }
                                    />
                                ))}
                            </section>
                        </>
                    ) : search.total === 0 ? (
                        <>
                            <Empty icon="search" message={s.noResults(q)} body={s.noResultsHint} />
                            {search.flat.map((hit) => (
                                <HitRow
                                    key={hit.id}
                                    hit={hit}
                                    q={search.q}
                                    active
                                    onPress={() => {
                                        open(hit);
                                    }}
                                />
                            ))}
                        </>
                    ) : (
                        search.groups.map((g) => (
                            <section key={g.kind}>
                                <div className="flex items-center justify-between pr-3">
                                    <SectionTitle>{g.label}</SectionTitle>
                                    {g.total > g.hits.length ? (
                                        <Button
                                            size="sm"
                                            variant="link"
                                            onPress={() => {
                                                search.setScope(g.kind);
                                            }}
                                        >
                                            {s.seeAll(g.total)}
                                        </Button>
                                    ) : null}
                                </div>
                                {g.hits.map((hit) => (
                                    <HitRow
                                        key={hit.id}
                                        hit={hit}
                                        q={search.q}
                                        active={search.flat[search.active]?.id === hit.id}
                                        onPress={() => {
                                            open(hit);
                                        }}
                                    />
                                ))}
                            </section>
                        ))
                    )}
                </div>
                <div className="flex items-center gap-4 whitespace-nowrap border-t border-line-soft bg-bg/60 px-4 py-2 text-[11px] text-muted">
                    <span>
                        <kbd className="font-mono">↑↓</kbd> {s.navigate}
                    </span>
                    <span>
                        <kbd className="font-mono">↵</kbd> {s.open}
                    </span>
                    <span>
                        <kbd className="font-mono">{s.esc}</kbd> {s.close}
                    </span>
                    <span className="ml-auto truncate">{s.offline}</span>
                </div>
            </div>
        </Modal>
    );
}
