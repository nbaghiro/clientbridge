import {
    type AgendaItem,
    type AttentionItem,
    type SetupProgress,
    type TeamDay,
    type TodayActions,
    type TodayView,
    strings,
    useFlash,
    visitAction,
    visitActionLabel,
    arrivalWords,
    usePeoplePhotos,
    useSubjectKind,
    formatList,
    formatParts,
    formatMonthDay,
    formatMoney,
    BUSINESS_CURRENCY,
    useBusinessZone,
} from "@clientbridge/app-core";
import {
    Avatar,
    Badge,
    Button,
    Empty,
    Icon,
    ListRow,
    Meter,
    Panel,
    Skeleton,
    StatusPill,
} from "@clientbridge/ui";
import { Fragment } from "react";

import { useOpenLink } from "../lib/links";

const t = strings.today;

export interface Kpi {
    label: string;
    value: string;
    hint: string;
    tone?: "ink" | "success" | undefined;
}

export function KpiStrip({ items }: { items: Kpi[] }) {
    return (
        <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-surface shadow-card lg:grid-cols-4 lg:divide-x lg:divide-line-soft">
            {items.map((k, i) => (
                <div
                    key={k.label}
                    className={`px-5 py-4 ${i < 2 ? "border-b border-line-soft lg:border-b-0" : ""} ${i % 2 === 0 ? "border-r border-line-soft lg:border-r-0" : ""}`}
                >
                    <p className="text-xs font-medium text-muted">{k.label}</p>
                    <p
                        className={`mt-1 font-display text-2xl font-bold tabular-nums ${k.tone === "success" ? "text-success" : "text-ink"}`}
                    >
                        {k.value}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted">{k.hint}</p>
                </div>
            ))}
        </div>
    );
}

export function KpiStripLoading() {
    return (
        <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
            <Skeleton variant="stat" count={4} columns={4} label={t.loading} />
        </div>
    );
}

function StateTag({ item }: { item: AgendaItem }) {
    const kind = useSubjectKind();
    if (item.checkedIn && item.state !== "done")
        return <StatusPill status={arrivalWords(kind).done} intent="success" />;
    if (item.departed && item.state !== "done")
        return <StatusPill status={t.onTheWay} intent="accent" />;
    if (item.state === "now") return <StatusPill status={t.stateNow} intent="success" />;
    if (item.state === "next")
        return <StatusPill status={formatParts([t.stateNext, item.startsIn])} intent="accent" />;
    if (item.state === "no_show") return <StatusPill status={t.stateNoShow} intent="danger" />;
    if (item.depositDue) return <StatusPill status={t.depositDue} intent="warning" />;
    return null;
}

function VisitButton({ item, actions }: { item: AgendaItem; actions: TodayActions }) {
    const openLink = useOpenLink();
    const kind = useSubjectKind();
    const action = visitAction(item, kind);
    if (action === "checkout")
        return (
            <Button
                size="sm"
                onPress={() => {
                    openLink("checkout", item.bookingId);
                }}
            >
                {t.checkout}
            </Button>
        );
    if (
        (action === "depart" || action === "checkIn") &&
        (item.state === "next" || item.departed) &&
        item.bookingId !== null
    ) {
        const id = item.bookingId;
        return (
            <Button
                size="sm"
                variant="outline"
                busy={actions.busyKey === id}
                onPress={() => {
                    if (action === "depart") actions.depart(id);
                    else actions.checkIn(id);
                }}
            >
                {visitActionLabel(action, kind)}
            </Button>
        );
    }
    return null;
}

function AgendaRow({
    item,
    showStaff,
    actions,
}: {
    item: AgendaItem;
    showStaff: boolean;
    actions: TodayActions;
}) {
    const done = item.state === "done";
    return (
        <li
            className={`flex items-center gap-4 px-5 py-3 ${item.state === "now" ? "bg-ok-bg/40" : ""}`}
        >
            <div
                className={`w-[84px] shrink-0 whitespace-nowrap text-right ${done ? "text-muted" : "text-ink"}`}
            >
                <div className="text-sm font-semibold">{item.time}</div>
                <div className="text-[11px] text-muted">{item.endTime}</div>
            </div>
            <span
                className="h-10 w-1 shrink-0 rounded-full bg-accent"
                style={{
                    backgroundColor: item.color ?? undefined,
                    opacity: done ? 0.35 : 1,
                }}
            />
            <div className="min-w-0 flex-1">
                <div
                    className={`flex items-center gap-2 truncate text-sm font-semibold ${done ? "text-muted" : "text-ink"}`}
                >
                    {done ? (
                        <span className="text-success">
                            <Icon name="check" size={15} />
                        </span>
                    ) : null}
                    <span className="truncate">{item.clientName}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 truncate text-xs text-muted">
                    <span className="truncate">{item.serviceName}</span>
                    {showStaff ? (
                        <>
                            <span aria-hidden>·</span>
                            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                                <span
                                    className="h-2 w-2 rounded-full bg-muted"
                                    style={{ backgroundColor: item.staffColor ?? undefined }}
                                />
                                {item.staffName}
                            </span>
                        </>
                    ) : null}
                </div>
            </div>
            <div className="hidden shrink-0 sm:block">
                <StateTag item={item} />
            </div>
            <div className="w-[92px] shrink-0 text-right">
                <VisitButton item={item} actions={actions} />
            </div>
        </li>
    );
}

function AgendaList({
    view,
    actions,
    showStaff = true,
}: {
    view: TodayView;
    actions: TodayActions;
    showStaff?: boolean;
}) {
    const firstUpcoming = view.agenda.findIndex(
        (a) => a.state !== "done" && a.state !== "no_show" && a.state !== "now",
    );
    return (
        <ul className="divide-y divide-line-soft">
            {view.agenda.map((item, i) => (
                <Fragment key={item.id}>
                    {i === firstUpcoming ? (
                        <li
                            aria-label={t.nowLine(view.nowLabel)}
                            className="relative flex items-center gap-3 px-5 py-1.5"
                        >
                            <span className="w-[84px] shrink-0 whitespace-nowrap text-right text-[11px] font-semibold text-danger">
                                {t.nowLine(view.nowLabel)}
                            </span>
                            <span className="h-2 w-2 shrink-0 rounded-full bg-danger" />
                            <span className="h-px flex-1 bg-danger/60" />
                        </li>
                    ) : null}
                    <AgendaRow item={item} showStaff={showStaff} actions={actions} />
                </Fragment>
            ))}
        </ul>
    );
}

function QuietDay({ bookingLink }: { bookingLink: string | null }) {
    const openLink = useOpenLink();
    const [copied, flash] = useFlash();
    return (
        <Empty
            icon="calendar"
            message={t.quietTitle}
            body={t.quietBody}
            actions={
                <>
                    <Button
                        size="sm"
                        icon="plus"
                        onPress={() => {
                            openLink("booking");
                        }}
                    >
                        {t.newBooking}
                    </Button>
                    {bookingLink === null ? null : (
                        <Button
                            size="sm"
                            variant="outline"
                            icon={copied ? "check" : "link"}
                            onPress={() => {
                                navigator.clipboard.writeText(bookingLink).catch(() => undefined);
                                flash();
                            }}
                        >
                            {copied ? t.linkCopied : t.shareBookingPage}
                        </Button>
                    )}
                </>
            }
        />
    );
}

export function SchedulePanel({
    view,
    actions,
    loading,
    bookingLink,
}: {
    view: TodayView;
    actions: TodayActions;
    loading: boolean;
    bookingLink: string | null;
}) {
    const openLink = useOpenLink();
    return (
        <Panel
            flush
            title={t.schedule}
            actions={
                <Button
                    size="sm"
                    variant="link"
                    onPress={() => {
                        openLink("schedule");
                    }}
                >
                    {t.openSchedule}
                </Button>
            }
        >
            {loading ? (
                <Skeleton variant="row" count={6} label={t.loading} />
            ) : view.agenda.length === 0 ? (
                <QuietDay bookingLink={bookingLink} />
            ) : (
                <AgendaList view={view} actions={actions} />
            )}
        </Panel>
    );
}

export function AttentionPanel({
    title,
    items,
    actions,
    loading,
    empty,
}: {
    title: string;
    items: AttentionItem[];
    actions: TodayActions;
    loading: boolean;
    empty: string;
}) {
    const openLink = useOpenLink();
    return (
        <Panel
            flush
            title={title}
            actions={items.length > 0 ? <Badge label={items.length} variant="count" /> : undefined}
        >
            {loading ? (
                <Skeleton variant="row" count={3} label={t.loading} />
            ) : items.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted">{empty}</p>
            ) : (
                <div className="divide-y divide-line-soft">
                    {items.map((a) => {
                        const sent = actions.sent.has(a.key);
                        return (
                            <ListRow
                                key={a.key}
                                icon={a.icon}
                                intent={a.intent}
                                title={a.title}
                                detail={a.detail}
                                density="compact"
                                onPress={() => {
                                    if (a.act === "send") actions.send(a);
                                    else openLink(a.target, a.refId);
                                }}
                                meta={
                                    <span
                                        className={`text-xs font-medium ${sent ? "text-success" : "text-accent"}`}
                                    >
                                        {sent
                                            ? t.sent
                                            : actions.busyKey === a.key
                                              ? strings.common.busyEllipsis
                                              : a.action}
                                    </span>
                                }
                            />
                        );
                    })}
                </div>
            )}
        </Panel>
    );
}

export function TeamPanel({ team }: { team: TeamDay[] }) {
    const photos = usePeoplePhotos();
    return (
        <Panel flush title={t.team}>
            <ul className="divide-y divide-line-soft">
                {team.map((m) => (
                    <li key={m.staffId} className="flex items-center gap-3 px-4 py-2.5">
                        <Avatar
                            name={m.name}
                            src={photos.staff(m.staffId)}
                            size="sm"
                            color={m.color}
                        />
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-ink">{m.name}</div>
                            <div className="truncate text-xs text-muted">
                                {m.hours ?? t.teamOff}
                            </div>
                        </div>
                        <span className="text-xs text-muted">{t.teamCount(m.bookings)}</span>
                    </li>
                ))}
            </ul>
        </Panel>
    );
}

export function FilingCard({
    setAsideCents,
    filingDue,
    filingDays,
}: {
    setAsideCents: number;
    filingDue: Date | null;
    filingDays: number | null;
}) {
    const zone = useBusinessZone();
    return (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-line bg-surface px-4 py-3 shadow-card">
            <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{t.setAside}</p>
                <p className="mt-0.5 truncate text-xs text-muted">
                    {filingDue === null || filingDays === null
                        ? t.notRegistered
                        : filingDays < 0
                          ? t.filingLate(formatMonthDay(filingDue, zone))
                          : t.filing(formatMonthDay(filingDue, zone), filingDays)}
                </p>
            </div>
            <span className="shrink-0 text-base font-semibold tabular-nums text-ink">
                {formatMoney(setAsideCents, BUSINESS_CURRENCY)}
            </span>
        </div>
    );
}

/** A new business's first days: what is left before clients can book, each with a way in. */
/** A new account's main card: the next step first, the rest compact, finished steps on one line. */
export function SetupGuide({ setup }: { setup: SetupProgress }) {
    const openLink = useOpenLink();
    const pending = setup.steps.filter((x) => !x.done);
    const done = setup.steps.filter((x) => x.done);
    const [next, ...later] = pending;
    return (
        <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
            <header className="px-6 pt-5">
                <div className="flex items-baseline justify-between gap-4">
                    <h2 className="font-display text-lg font-bold text-ink">
                        {strings.business.getSetUp.gettingStarted}
                    </h2>
                    <span className="text-sm text-muted">
                        {strings.business.getSetUp.progress(setup.done, setup.total)}
                    </span>
                </div>
                <div className="mt-3">
                    <Meter
                        value={setup.done}
                        max={setup.total}
                        label={strings.business.getSetUp.progress(setup.done, setup.total)}
                        labelPosition="hidden"
                    />
                </div>
            </header>
            {next !== undefined ? (
                <div className="mx-6 mt-5 flex flex-wrap items-center gap-4 rounded-lg border border-accent-line bg-accent-weak/50 p-5">
                    <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-accent">{t.guideNext}</p>
                        <p className="mt-1 text-base font-semibold text-ink">{next.label}</p>
                        <p className="mt-0.5 text-sm text-muted">{next.hint}</p>
                    </div>
                    <Button
                        onPress={() => {
                            openLink(next.target);
                        }}
                    >
                        {strings.business.getSetUp.start}
                    </Button>
                </div>
            ) : null}
            {later.length > 0 ? (
                <ul className="mt-3 divide-y divide-line-soft px-6">
                    {later.map((x) => (
                        <li key={x.key} className="flex items-center gap-4 py-3.5">
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-ink">{x.label}</p>
                                <p className="mt-0.5 text-xs text-muted">{x.hint}</p>
                            </div>
                            <Button
                                size="sm"
                                variant="outline"
                                onPress={() => {
                                    openLink(x.target);
                                }}
                            >
                                {strings.business.getSetUp.start}
                            </Button>
                        </li>
                    ))}
                </ul>
            ) : null}
            {done.length > 0 ? (
                <p className="mt-3 flex items-start gap-2 border-t border-line-soft px-6 py-4 text-sm text-muted">
                    <Icon name="check" size={16} className="mt-0.5 shrink-0 text-success" />
                    {t.guideDone(formatList(done.map((x) => x.label)))}
                </p>
            ) : (
                <div className="h-5" />
            )}
        </section>
    );
}

/** The day's schedule while nothing has been booked yet: one line and the booking link. */
export function QuietSchedule({ bookingLink }: { bookingLink: string | null }) {
    const openLink = useOpenLink();
    const [copied, flash] = useFlash();
    return (
        <Panel
            title={t.schedule}
            actions={
                <Button
                    size="sm"
                    variant="link"
                    onPress={() => {
                        openLink("schedule");
                    }}
                >
                    {t.openSchedule}
                </Button>
            }
        >
            <p className="text-sm text-muted">{t.guideNothingToday}</p>
            {bookingLink === null ? null : (
                <Button
                    className="mt-3"
                    size="sm"
                    variant="outline"
                    icon={copied ? "check" : "link"}
                    onPress={() => {
                        navigator.clipboard.writeText(bookingLink).catch(() => undefined);
                        flash();
                    }}
                >
                    {copied ? t.linkCopied : t.shareBookingPage}
                </Button>
            )}
        </Panel>
    );
}
