import { type NotificationsView, strings } from "@clientbridge/app-core";
import { Button, Choice, Empty, IconButton, ListRow, LoadFailed, Skeleton } from "@clientbridge/ui";
import { useEffect, useRef } from "react";

import { useOpenLink } from "../lib/links";

const t = strings.notifications;

function NotificationList({ view, onOpen }: { view: NotificationsView; onOpen: () => void }) {
    const openLink = useOpenLink();
    if (view.load.state === "loading")
        return <Skeleton variant="row" count={5} label={t.loading} />;
    if (view.load.state === "error") {
        return <LoadFailed onRetry={view.load.retry} retrying={view.load.retrying} />;
    }
    if (view.groups.length === 0) {
        return (
            <Empty
                icon="bell"
                message={view.filter === "unread" ? t.emptyUnread : t.empty}
                body={t.emptyHint}
            />
        );
    }
    return (
        <>
            {view.groups.map((g) => (
                <section key={g.key} aria-label={g.label}>
                    <h3 className="bg-bg/60 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                        {g.label}
                    </h3>
                    <div className="divide-y divide-line-soft">
                        {g.items.map((n) => (
                            <ListRow
                                key={n.id}
                                unread={!n.read}
                                icon={n.icon}
                                intent={n.intent}
                                title={n.title}
                                detail={
                                    <span className="line-clamp-2 whitespace-normal leading-snug">
                                        {n.body}
                                    </span>
                                }
                                meta={n.when}
                                label={
                                    n.read
                                        ? t.readLabel(n.title, n.body)
                                        : t.unreadLabel(n.title, n.body)
                                }
                                onPress={() => {
                                    view.markRead(n.id);
                                    onOpen();
                                    openLink(n.link, n.kind === "invoice_overdue" ? n.refId : null);
                                }}
                            />
                        ))}
                    </div>
                </section>
            ))}
        </>
    );
}

/** The bell and its panel: the last week of what happened, grouped by day, read state per device. */
export function NotificationsPanel({
    view,
    open,
    onToggle,
}: {
    view: NotificationsView;
    open: boolean;
    onToggle: (open: boolean) => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === "Escape") onToggle(false);
        };
        const onDown = (e: MouseEvent): void => {
            if (ref.current !== null && !ref.current.contains(e.target as Node)) onToggle(false);
        };
        window.addEventListener("keydown", onKey);
        window.addEventListener("mousedown", onDown);
        return () => {
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("mousedown", onDown);
        };
    }, [open, onToggle]);

    return (
        <div ref={ref}>
            <IconButton
                icon="bell"
                label={t.title}
                badge={view.unread}
                variant="outline"
                pressed={open}
                onPress={() => {
                    onToggle(!open);
                }}
            />
            {open ? (
                <div
                    role="dialog"
                    aria-label={t.title}
                    className="absolute left-0 top-full z-30 mt-2 flex max-h-[min(640px,calc(100vh-96px))] w-[400px] flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-pop"
                >
                    <div className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
                        <h2 className="font-display text-base font-bold text-ink">{t.title}</h2>
                        <Button
                            size="sm"
                            variant="link"
                            disabled={view.unread === 0}
                            onPress={view.markAllRead}
                        >
                            {t.markAllRead}
                        </Button>
                    </div>
                    <div className="border-b border-line-soft px-4 py-2">
                        <Choice
                            layout="segmented"
                            label={t.filterBy}
                            value={view.filter}
                            onChange={view.setFilter}
                            options={[
                                { key: "all", label: t.all },
                                { key: "unread", label: t.unreadCount(view.unread) },
                            ]}
                        />
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto">
                        <NotificationList
                            view={view}
                            onOpen={() => {
                                onToggle(false);
                            }}
                        />
                    </div>
                </div>
            ) : null}
        </div>
    );
}
