import {
    type OwnerToday,
    type TodayActions,
    bookingPageUrl,
    canManagePayments,
    formatMoney,
    formatPhone,
    strings,
    useOwnerToday,
    useSetupProgress,
    useStaffToday,
    useTodayActions,
    visitAction,
} from "@clientbridge/app-core";
import {
    Avatar,
    Button,
    Empty,
    Icon,
    KeyValueList,
    ListRow,
    LoadFailed,
    Notice,
    Panel,
    Skeleton,
    StatusPill,
} from "@clientbridge/ui";
import { Fragment, type ReactNode } from "react";

import {
    AttentionPanel,
    FilingCard,
    GettingStarted,
    KpiStrip,
    KpiStripLoading,
    SchedulePanel,
    TeamPanel,
} from "../components/TodayParts";
import { config } from "../config";
import { api } from "../lib/api";
import { useViewer } from "../lib/auth";
import { useOpenLink } from "../lib/links";

const t = strings.today;

export function Today() {
    const viewer = useViewer();
    if (viewer === null) return null;
    return canManagePayments(viewer.role) ? <OwnerTodayPage /> : <StaffTodayPage />;
}

function Header({
    view,
    children,
}: {
    view: { dateLabel: string; greeting: string };
    children?: ReactNode;
}) {
    return (
        <header className="flex flex-wrap items-end justify-between gap-4">
            <div>
                <p className="text-sm font-medium text-muted">{view.dateLabel}</p>
                <h1 className="mt-0.5 font-display text-2xl font-bold text-ink">{view.greeting}</h1>
            </div>
            {children}
        </header>
    );
}

function MoneyStrip({ today }: { today: OwnerToday }) {
    const { view, money, moneyLoad } = today;
    if (moneyLoad.state === "loading") return <KpiStripLoading />;
    if (moneyLoad.state === "error")
        return (
            <div className="rounded-lg border border-line bg-surface shadow-card">
                <LoadFailed
                    message={t.numbersError}
                    body={t.numbersErrorBody}
                    onRetry={moneyLoad.retry}
                    retrying={moneyLoad.retrying}
                />
            </div>
        );
    return (
        <KpiStrip
            items={[
                {
                    label: t.booked,
                    value: String(view.agenda.length),
                    hint: t.bookedHint(view.done, view.remaining),
                },
                { label: t.expected, value: formatMoney(view.expectedCents), hint: t.expectedHint },
                {
                    label: t.collected,
                    value: formatMoney(money.collectedCents),
                    hint: t.collectedHint(money.paymentCount),
                    tone: "success",
                },
                {
                    label: t.awaiting,
                    value: formatMoney(money.awaitingCents),
                    hint: t.awaitingHint(money.awaitingCount),
                },
            ]}
        />
    );
}

function OwnerTodayPage() {
    const viewer = useViewer();
    const today = useOwnerToday(api, viewer);
    const actions = useTodayActions(api);
    const openLink = useOpenLink();
    const setup = useSetupProgress();
    const bookingLink = setup.slug === null ? null : bookingPageUrl(config.bookUrl, setup.slug);
    const { load, view, money, moneyLoad } = today;
    const firstRun = load.hasData && view.agenda.length === 0 && !setup.complete;
    const loading = load.state === "loading";

    return (
        <div className="mx-auto max-w-6xl px-8 py-8">
            <Header view={view}>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        icon="pos"
                        onPress={() => {
                            openLink("sale");
                        }}
                    >
                        {t.newSale}
                    </Button>
                    <Button
                        icon="plus"
                        onPress={() => {
                            openLink("booking");
                        }}
                    >
                        {t.newBooking}
                    </Button>
                </div>
            </Header>

            {actions.error !== null ? (
                <div className="mt-4">
                    <Notice tone="danger" banner>
                        {actions.error}
                    </Notice>
                </div>
            ) : null}

            {load.state === "error" ? (
                <div className="mt-6">
                    <LoadFailed
                        variant="card"
                        message={t.loadError}
                        body={t.loadErrorBody}
                        onRetry={load.retry}
                        retrying={load.retrying}
                    />
                </div>
            ) : (
                <>
                    <div className="mt-6">
                        {loading ? <KpiStripLoading /> : <MoneyStrip today={today} />}
                    </div>
                    <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
                        <SchedulePanel
                            view={view}
                            actions={actions}
                            loading={loading}
                            bookingLink={bookingLink}
                        />
                        <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-1">
                            {firstRun ? <GettingStarted setup={setup} /> : null}
                            <AttentionPanel
                                title={t.needsYou}
                                items={view.attention}
                                actions={actions}
                                loading={loading}
                                empty={t.allClear}
                            />
                            <div className="space-y-6">
                                {loading || moneyLoad.state !== "ready" ? null : (
                                    <FilingCard
                                        setAsideCents={money.setAsideCents}
                                        filingDue={money.filingDue}
                                        filingDays={money.filingDays}
                                    />
                                )}
                                <TeamPanel team={view.team} />
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

function StaffTodayPage() {
    const viewer = useViewer();
    const { load, view, day } = useStaffToday(viewer);
    const actions = useTodayActions(api);
    const openLink = useOpenLink();
    const next = view.current ?? view.next;
    const loading = load.state === "loading";

    return (
        <div className="mx-auto max-w-6xl px-8 py-8">
            <Header view={view} />
            {load.hasData ? (
                <p className="mt-1 text-sm text-muted">{t.staff.subtitle(view.agenda.length)}</p>
            ) : null}

            {actions.error !== null ? (
                <div className="mt-4">
                    <Notice tone="danger" banner>
                        {actions.error}
                    </Notice>
                </div>
            ) : null}

            {load.state === "error" ? (
                <div className="mt-6">
                    <LoadFailed
                        variant="card"
                        message={t.loadError}
                        body={t.loadErrorBody}
                        onRetry={load.retry}
                        retrying={load.retrying}
                    />
                </div>
            ) : loading ? (
                <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <Panel flush title={t.staff.nextClient}>
                        <Skeleton variant="row" count={4} label={t.loading} />
                    </Panel>
                    <Panel flush>
                        <Skeleton variant="stat" count={2} label={t.loading} />
                    </Panel>
                </div>
            ) : (
                <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <div className="space-y-6">
                        {next === null ? (
                            <Panel flush>
                                <Empty
                                    icon="calendar"
                                    message={
                                        view.agenda.length === 0
                                            ? t.staff.subtitle(0)
                                            : t.staff.noNext
                                    }
                                    body={t.staff.noNextBody}
                                />
                            </Panel>
                        ) : (
                            <NextClient item={next} actions={actions} lastVisit={day.lastVisit} />
                        )}

                        {view.agenda.length === 0 ? null : (
                            <Panel
                                flush
                                title={t.staff.yourDay}
                                subtitle={
                                    day.endsAt === null ? undefined : t.staff.dayEnds(day.endsAt)
                                }
                            >
                                <ul className="divide-y divide-line-soft">
                                    {view.agenda.map((a) => {
                                        const gap = day.gaps.find((g) => g.after === a.id);
                                        return (
                                            <Fragment key={a.id}>
                                                <li className="flex items-center gap-4 px-5 py-3">
                                                    <span className="w-[84px] shrink-0 whitespace-nowrap text-right text-sm font-semibold text-ink">
                                                        {a.time}
                                                    </span>
                                                    <span
                                                        className="h-9 w-1 rounded-full bg-accent"
                                                        style={{
                                                            backgroundColor: a.color ?? undefined,
                                                        }}
                                                    />
                                                    <div className="min-w-0 flex-1">
                                                        <div className="truncate text-sm font-semibold text-ink">
                                                            {a.clientName}
                                                        </div>
                                                        <div className="truncate text-xs text-muted">
                                                            {a.serviceName} · {t.endsAt(a.endTime)}
                                                        </div>
                                                    </div>
                                                    {a === next ? (
                                                        <StatusPill
                                                            status={t.stateNext}
                                                            intent="accent"
                                                            asWritten
                                                        />
                                                    ) : null}
                                                </li>
                                                {gap === undefined ? null : (
                                                    <li className="flex items-center gap-4 bg-bg/60 px-5 py-2">
                                                        <span className="w-[84px]" />
                                                        <span className="flex items-center gap-2 text-xs font-medium text-muted">
                                                            <Icon name="clock" size={14} />
                                                            {t.staff.free(gap.from, gap.to)}
                                                        </span>
                                                    </li>
                                                )}
                                            </Fragment>
                                        );
                                    })}
                                </ul>
                            </Panel>
                        )}
                    </div>

                    <div className="space-y-6">
                        <div className="rounded-lg border border-line bg-surface p-5 shadow-card">
                            <p className="text-xs font-medium text-muted">{t.staff.earnings}</p>
                            <p className="mt-1 font-display text-2xl font-bold tabular-nums text-success">
                                {formatMoney(day.earnedCents)}
                            </p>
                            <p className="mt-0.5 text-xs text-muted">{t.staff.earningsHint}</p>
                            <div className="mt-3 border-t border-line-soft">
                                <KeyValueList
                                    rows={[
                                        { label: t.staff.hours, value: day.hours ?? t.teamOff },
                                        {
                                            label: t.staff.tomorrow,
                                            value: t.teamCount(day.tomorrow),
                                        },
                                    ]}
                                />
                            </div>
                        </div>
                        <Panel flush title={t.staff.messagesForYou}>
                            {view.attention.length === 0 ? (
                                <p className="px-4 py-6 text-center text-sm text-muted">
                                    {t.staff.nothingElse}
                                </p>
                            ) : (
                                view.attention.map((a) => (
                                    <ListRow
                                        key={a.key}
                                        density="compact"
                                        icon={a.icon}
                                        intent={a.intent}
                                        title={a.title}
                                        detail={a.detail}
                                        onPress={() => {
                                            openLink(a.target, a.refId);
                                        }}
                                        meta={
                                            <span className="font-medium text-accent">
                                                {a.action}
                                            </span>
                                        }
                                    />
                                ))
                            )}
                        </Panel>
                    </div>
                </div>
            )}
        </div>
    );
}

function NextClient({
    item,
    actions,
    lastVisit,
}: {
    item: ReturnType<typeof useStaffToday>["view"]["agenda"][number];
    actions: TodayActions;
    lastVisit: string | null;
}) {
    const openLink = useOpenLink();
    const action = visitAction(item);
    return (
        <section
            aria-label={t.staff.nextClient}
            className="overflow-hidden rounded-lg border border-line bg-surface shadow-card"
        >
            <div className="flex items-center justify-between border-b border-line-soft px-5 py-3">
                <h2 className="font-display text-sm font-bold text-ink">{t.staff.nextClient}</h2>
                <StatusPill
                    status={
                        item.checkedIn
                            ? t.checkedIn
                            : item.state === "now"
                              ? t.stateNow
                              : `${item.time} · ${t.inMinutes(item.minutesAway)}`
                    }
                    intent={item.checkedIn || item.state === "now" ? "success" : "accent"}
                    asWritten
                />
            </div>
            <div className="flex flex-wrap items-start gap-5 p-5">
                <Avatar name={item.clientName} size="xl" color={item.color} />
                <div className="min-w-0 flex-1">
                    <h3 className="font-display text-xl font-bold text-ink">{item.clientName}</h3>
                    <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm xl:grid-cols-3">
                        <div>
                            <dt className="text-xs text-muted">{t.staff.service}</dt>
                            <dd className="mt-0.5 font-medium text-ink">{item.serviceName}</dd>
                        </div>
                        <div>
                            <dt className="text-xs text-muted">{t.staff.time}</dt>
                            <dd className="mt-0.5 font-medium text-ink">
                                {item.time} – {item.endTime}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-xs text-muted">{t.staff.client}</dt>
                            <dd className="mt-0.5 font-medium text-ink">{item.clientName}</dd>
                            {item.clientPhone !== null ? (
                                <dd className="text-xs text-muted">
                                    {formatPhone(item.clientPhone)}
                                </dd>
                            ) : null}
                        </div>
                    </dl>
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-line-soft bg-bg/60 px-5 py-3">
                {action === null || item.bookingId === null ? null : (
                    <Button
                        busy={actions.busyKey === item.bookingId}
                        onPress={() => {
                            const id = item.bookingId;
                            if (id === null) return;
                            if (action === "checkout") openLink("checkout", id);
                            else actions.checkIn(id);
                        }}
                    >
                        {action === "checkout" ? t.checkout : t.checkIn}
                    </Button>
                )}
                <Button
                    variant="outline"
                    icon="send"
                    onPress={() => {
                        openLink("message", item.clientId);
                    }}
                >
                    {t.staff.message}
                </Button>
                {lastVisit === null ? null : (
                    <span className="ml-auto text-xs text-muted">
                        {t.staff.lastVisit(lastVisit)}
                    </span>
                )}
            </div>
        </section>
    );
}
