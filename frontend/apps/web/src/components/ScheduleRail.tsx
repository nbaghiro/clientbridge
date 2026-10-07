import {
    type ScheduleBoard,
    type ScheduleEvent,
    eventFlags,
    eventLabelFor,
    formatTime,
    needsClosing,
    strings,
    upNext,
    useBookingActions,
} from "@clientbridge/app-core";
import {
    Avatar,
    Button,
    CalendarEventCard,
    DateStrip,
    Icon,
    ListRow,
    Skeleton,
} from "@clientbridge/ui";

import { api } from "../lib/api";

const s = strings.bookings;

function RailHeading({ children, count }: { children: string; count?: number }) {
    return (
        <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
            {children}
            {count !== undefined && count > 0 ? (
                <span className="rounded-full bg-bg px-1.5 text-[11px] text-ink-soft">{count}</span>
            ) : null}
        </h3>
    );
}

function QuickClose({
    event,
    now,
    onOpen,
}: {
    event: ScheduleEvent;
    now: Date;
    onOpen: (e: ScheduleEvent) => void;
}) {
    const actions = useBookingActions(api, event, now);
    return (
        <div className="space-y-2 rounded-md border border-line p-2">
            <div className="h-14">
                <CalendarEventCard
                    headline={event.headline}
                    detail={`${event.serviceName} · ${event.staffShort}`}
                    time={event.timeLabel}
                    intent={event.intent}
                    color={event.color}
                    flags={eventFlags(event)}
                    label={eventLabelFor(event)}
                    onPress={() => {
                        onOpen(event);
                    }}
                />
            </div>
            {actions.canComplete ? (
                <div className="flex gap-2">
                    <Button
                        size="sm"
                        grow
                        busy={actions.pending === "complete"}
                        onPress={() => {
                            actions.run("complete");
                        }}
                    >
                        {s.complete}
                    </Button>
                    <Button
                        size="sm"
                        grow
                        variant="outline"
                        onPress={() => {
                            onOpen(event);
                        }}
                    >
                        {s.noShow}
                    </Button>
                </div>
            ) : null}
        </div>
    );
}

/** The right rail when nothing is selected: jump to a day, what's on now, what to close, the team's day. */
export function ScheduleRail({ board }: { board: ScheduleBoard }) {
    const day = board.focus;
    const inProgress = day.events.filter((e) => e.inProgress);
    const toClose = needsClosing(day.events);
    const next = day.isToday ? upNext(day.events, board.now, 4) : day.events.slice(0, 8);
    const waiting = board.load.state === "loading" || board.load.state === "error";
    return (
        <div className="space-y-6 px-5 py-5">
            <section>
                <RailHeading>{s.railJump}</RailHeading>
                <DateStrip
                    label={s.railJump}
                    days={board.week}
                    value={day.key}
                    onChange={(key) => {
                        const hit = board.week.find((d) => d.key === key);
                        if (hit) board.setAnchor(hit.date);
                    }}
                />
            </section>

            {board.load.state === "loading" ? (
                <Skeleton variant="line" count={5} label={s.loading} />
            ) : null}
            {waiting ? null : (
                <>
                    {inProgress.length > 0 ? (
                        <section>
                            <RailHeading count={inProgress.length}>{s.railInProgress}</RailHeading>
                            <div className="space-y-2">
                                {inProgress.map((e) => (
                                    <QuickClose
                                        key={e.id}
                                        event={e}
                                        now={board.now}
                                        onOpen={(x) => {
                                            board.select(x.id);
                                        }}
                                    />
                                ))}
                            </div>
                        </section>
                    ) : null}

                    {toClose.length > 0 ? (
                        <section>
                            <RailHeading count={toClose.length}>{s.railToClose}</RailHeading>
                            <div className="space-y-2">
                                {toClose.map((e) => (
                                    <QuickClose
                                        key={e.id}
                                        event={e}
                                        now={board.now}
                                        onOpen={(x) => {
                                            board.select(x.id);
                                        }}
                                    />
                                ))}
                            </div>
                        </section>
                    ) : null}

                    <section>
                        <RailHeading count={next.length}>
                            {day.isToday ? s.railUpNext : s.dayVisits}
                        </RailHeading>
                        {next.length === 0 ? (
                            <p className="text-sm text-muted">
                                {day.isToday ? s.railNothingNext : s.noBookings}
                            </p>
                        ) : (
                            <div className="divide-y divide-line-soft">
                                {next.map((e) => (
                                    <ListRow
                                        key={e.id}
                                        density="compact"
                                        leading={
                                            <span className="flex items-center gap-3">
                                                <span className="w-[68px] shrink-0 whitespace-nowrap text-[13px] font-semibold text-ink">
                                                    {formatTime(e.start)}
                                                </span>
                                                <span
                                                    className="h-8 w-1 shrink-0 rounded-full"
                                                    style={{
                                                        backgroundColor: e.color ?? undefined,
                                                    }}
                                                />
                                            </span>
                                        }
                                        title={e.headline}
                                        detail={`${e.serviceName} · ${e.staffShort}`}
                                        meta={
                                            e.depositRequired && e.depositStatus === "pending" ? (
                                                <Icon
                                                    name="dollar"
                                                    size={15}
                                                    label={s.legendPending}
                                                />
                                            ) : undefined
                                        }
                                        onPress={() => {
                                            board.select(e.id);
                                        }}
                                    />
                                ))}
                            </div>
                        )}
                    </section>

                    <section>
                        <RailHeading>{day.isToday ? s.railTeam : s.groupTeam}</RailHeading>
                        <ul className="space-y-3">
                            {day.lanes.map((l) => (
                                <li key={l.id} className="flex items-center gap-3">
                                    <Avatar name={l.name} size="sm" color={l.color} />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-baseline justify-between gap-2">
                                            <span className="truncate text-sm font-medium text-ink">
                                                {l.name}
                                            </span>
                                            <span className="shrink-0 text-xs tabular-nums text-muted">
                                                {l.hours
                                                    ? s.utilization(Math.round(l.utilization * 100))
                                                    : s.off}
                                            </span>
                                        </div>
                                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg">
                                            <div
                                                className="h-full rounded-full"
                                                style={{
                                                    width: `${String(Math.round(l.utilization * 100))}%`,
                                                    backgroundColor: l.color ?? undefined,
                                                }}
                                            />
                                        </div>
                                        <div className="mt-0.5 text-xs text-muted">
                                            {l.hoursLabel}
                                        </div>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </section>
                </>
            )}
        </div>
    );
}
