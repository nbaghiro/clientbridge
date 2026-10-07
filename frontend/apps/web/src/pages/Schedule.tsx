import {
    type ComposerSlot,
    type DayColumn,
    type ScheduleEvent,
    formatTime,
    minuteTop,
    offHourSpans,
    placeEvents,
    strings,
    useBookingActions,
    useBookingDetail,
    useBookingStart,
    useMoveEvent,
    useScheduleBoard,
} from "@clientbridge/app-core";
import {
    Avatar,
    Button,
    DetailView,
    Empty,
    Icon,
    IconButton,
    LoadFailed,
    Modal,
    Skeleton,
} from "@clientbridge/ui";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";

import { BookingActionBar, BookingBody, BookingHeading } from "../components/BookingPanel";
import { BookingComposer, RescheduleDialog } from "../components/BookingComposer";
import {
    BlockCard,
    CalendarToolbar,
    DaySummaryBar,
    GUTTER_PX,
    GridEvent,
    HATCH,
    HourLines,
    NowLine,
    OffHours,
    SlotHover,
    StatusLegend,
    TimeGutter,
    Toast,
    useGridDrag,
    useHourHeight,
    useWide,
} from "../components/ScheduleGrid";
import { ScheduleRail } from "../components/ScheduleRail";
import { ScheduleViews } from "../components/ScheduleViews";
import { api } from "../lib/api";
import { useViewer } from "../lib/auth";
import { useLinkIntent } from "../lib/links";

const s = strings.bookings;

export function Schedule() {
    const viewer = useViewer();
    const mover = useMoveEvent(api);
    const board = useScheduleBoard(viewer, mover.pending);
    const wide = useWide();
    const day = board.focus;
    const { startHour, endHour } = board.window;
    const [gridRef, hourPx] = useHourHeight(endHour - startHour);
    const pxPerMin = hourPx / 60;
    const lanesRef = useRef<HTMLDivElement>(null);
    const [composer, setComposer] = useState<ComposerSlot | null>(null);
    const [hover, setHover] = useState<{ lane: string; min: number } | null>(null);
    const [moving, setMoving] = useState(false);
    const [linked, setLinked] = useState<string | null>(null);
    const detail = useBookingDetail(board.selected, board.now);
    const actions = useBookingActions(api, detail?.event ?? null, board.now);
    const linkedStart = useBookingStart(linked);
    const laneWidth = (): number =>
        (lanesRef.current?.clientWidth ?? 0) / Math.max(1, day.lanes.length);
    const grid = useGridDrag({
        pxPerMin,
        laneWidth,
        laneIds: day.lanes.map((l) => l.id),
        board,
        mover,
    });

    const openSlot = (staffId: string, min: number): void => {
        board.select(null);
        setComposer({
            staffId,
            start: new Date(
                day.date.getFullYear(),
                day.date.getMonth(),
                day.date.getDate(),
                startHour,
                min,
            ),
        });
    };
    const openNew = (): void => {
        const first = day.lanes.find((l) => l.hours) ?? day.lanes[0];
        openSlot(first?.id ?? viewer?.staffId ?? "", Math.max(0, (10 - startHour) * 60));
    };
    useLinkIntent({ onCreate: openNew, onOpen: setLinked });
    const { setAnchor, select: selectId } = board;
    useEffect(() => {
        if (linked === null || linkedStart === null) return;
        setAnchor(linkedStart);
        selectId(linked);
        setLinked(null);
    }, [linked, linkedStart, setAnchor, selectId]);

    const select = (e: ScheduleEvent): void => {
        setComposer(null);
        board.select(e.id);
    };
    const hoverAt = (lane: string) => (e: ReactPointerEvent<HTMLDivElement>) => {
        if (e.target !== e.currentTarget) {
            setHover(null);
            return;
        }
        const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
        setHover({ lane, min: Math.floor(y / pxPerMin / 15) * 15 });
    };

    const waiting = board.load.state === "loading" || board.load.state === "error";
    const closeDetail = (): void => {
        board.select(null);
    };
    const rail = composer ? (
        <BookingComposer
            slot={composer}
            board={board}
            onDone={() => {
                setComposer(null);
            }}
            onCancel={() => {
                setComposer(null);
            }}
        />
    ) : detail ? (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
                <BookingHeading detail={detail} />
                <IconButton size="sm" icon="x" label={s.close} onPress={closeDetail} />
            </div>
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
                <BookingBody detail={detail} narrow />
            </div>
            <div className="border-t border-line px-5 py-3">
                <BookingActionBar
                    actions={actions}
                    onReschedule={() => {
                        setMoving(true);
                    }}
                />
            </div>
        </div>
    ) : (
        <div className="h-full overflow-y-auto">
            <ScheduleRail board={board} />
        </div>
    );

    return (
        <div className="flex h-full min-h-[600px]">
            <section className="flex min-w-0 flex-1 flex-col p-5">
                <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card">
                    <CalendarToolbar
                        board={board}
                        onNew={openNew}
                        leading={<ScheduleViews active="board" />}
                    />
                    <DaySummaryBar summary={board.summary} waiting={waiting} />
                    <LaneHeads day={day} waiting={waiting} />
                    {board.load.state === "loading" ? (
                        <div className="min-h-0 flex-1 p-5">
                            <Skeleton variant="row" count={6} label={s.loading} />
                        </div>
                    ) : board.load.state === "error" ? (
                        <div className="min-h-0 flex-1 p-5">
                            <LoadFailed
                                message={s.loadError}
                                onRetry={board.load.retry}
                                retrying={board.load.retrying}
                            />
                        </div>
                    ) : (
                        <div ref={gridRef} className="min-h-0 flex-1 overflow-y-auto">
                            <div
                                className="relative flex pt-2"
                                style={{ height: (endHour - startHour) * hourPx + 8 }}
                            >
                                <TimeGutter
                                    startHour={startHour}
                                    endHour={endHour}
                                    hourPx={hourPx}
                                />
                                <div ref={lanesRef} className="relative flex min-w-0 flex-1">
                                    {day.closure ? (
                                        <div
                                            className="absolute inset-0 z-10 flex items-center justify-center"
                                            style={HATCH}
                                        >
                                            <div className="rounded-lg border border-line bg-surface px-5 py-3 text-center shadow-card">
                                                <Icon name="lock" size={20} />
                                                <p className="mt-1 text-sm font-semibold text-ink">
                                                    {s.closed(day.closure.label)}
                                                </p>
                                                <p className="text-xs text-muted">
                                                    {s.emptyClosed}
                                                </p>
                                            </div>
                                        </div>
                                    ) : null}
                                    {day.lanes.map((lane, laneIndex) => {
                                        const placed = placeEvents(
                                            lane.events,
                                            day.date,
                                            startHour,
                                            pxPerMin,
                                        );
                                        const hovering =
                                            hover?.lane === lane.id &&
                                            composer === null &&
                                            grid.drag === null;
                                        return (
                                            <div
                                                key={lane.id}
                                                data-testid={`lane-${lane.id}`}
                                                className="relative min-w-0 flex-1 border-l border-line"
                                                onPointerMove={hoverAt(lane.id)}
                                                onPointerLeave={() => {
                                                    setHover(null);
                                                }}
                                                onClick={(e) => {
                                                    if (e.target === e.currentTarget && hover)
                                                        openSlot(lane.id, hover.min);
                                                }}
                                            >
                                                <OffHours
                                                    spans={offHourSpans(lane, startHour, endHour)}
                                                    pxPerMin={pxPerMin}
                                                />
                                                <HourLines
                                                    startHour={startHour}
                                                    endHour={endHour}
                                                    hourPx={hourPx}
                                                />
                                                {lane.blocks.map((b) => (
                                                    <BlockCard
                                                        key={b.id}
                                                        block={b}
                                                        startHour={startHour}
                                                        endHour={endHour}
                                                        pxPerMin={pxPerMin}
                                                        dayStart={day.date}
                                                    />
                                                ))}
                                                {hovering ? (
                                                    <SlotHover
                                                        top={hover.min * pxPerMin}
                                                        height={30 * pxPerMin}
                                                        label={formatTime(
                                                            new Date(
                                                                2000,
                                                                0,
                                                                1,
                                                                startHour,
                                                                hover.min,
                                                            ),
                                                        )}
                                                    />
                                                ) : null}
                                                {placed.map((p) => (
                                                    <GridEvent
                                                        key={p.event.id}
                                                        placed={p}
                                                        drag={grid.drag}
                                                        bind={grid.bind(p.event, laneIndex)}
                                                        verdict={mover.verdict}
                                                        pxPerMin={pxPerMin}
                                                        laneWidth={laneWidth()}
                                                        selected={board.selectedId === p.event.id}
                                                        onSelect={select}
                                                        clickAllowed={grid.clickAllowed}
                                                    />
                                                ))}
                                            </div>
                                        );
                                    })}
                                    {day.isToday ? (
                                        <NowLine
                                            top={minuteTop(board.now, startHour, pxPerMin)}
                                            label={formatTime(board.now)}
                                        />
                                    ) : null}
                                    {day.events.length === 0 && !day.closure ? (
                                        <div className="pointer-events-none absolute inset-x-0 top-24 z-10 flex justify-center">
                                            <div className="pointer-events-auto w-[360px] rounded-lg bg-surface shadow-card">
                                                {day.lanes.some(
                                                    (l) => l.hours !== null || l.unset,
                                                ) ? (
                                                    <Empty
                                                        variant="card"
                                                        icon="calendar"
                                                        message={s.emptyDayTitle}
                                                        body={s.emptyDayWeb}
                                                        actions={
                                                            <Button
                                                                size="sm"
                                                                icon="plus"
                                                                onPress={openNew}
                                                            >
                                                                {s.newBooking}
                                                            </Button>
                                                        }
                                                    />
                                                ) : (
                                                    <Empty
                                                        variant="card"
                                                        icon="moon"
                                                        message={s.nobodyWorking}
                                                        body={s.nobodyWorkingHint}
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    )}
                    <div
                        className="border-t border-line px-5 py-2.5"
                        style={{ paddingLeft: GUTTER_PX + 20 }}
                    >
                        <StatusLegend />
                    </div>
                    {mover.refusal !== null ? (
                        <Toast tone="danger">{`${s.dropRefused}: ${mover.refusal}`}</Toast>
                    ) : null}
                    {mover.last !== null && mover.refusal === null ? (
                        <Toast
                            action={
                                <Button size="sm" variant="link" onPress={mover.undo}>
                                    {s.undo}
                                </Button>
                            }
                        >
                            {s.moved(mover.last.label)}
                        </Toast>
                    ) : null}
                </div>
            </section>

            {wide ? (
                <aside className="flex w-[340px] shrink-0 flex-col border-l border-line bg-surface">
                    {rail}
                </aside>
            ) : null}

            {!wide && detail ? (
                <DetailView
                    open
                    title={detail.event.headline}
                    subtitle={`${detail.event.serviceName} · ${detail.event.timeLabel}`}
                    onClose={closeDetail}
                    actions={
                        <BookingActionBar
                            actions={actions}
                            onReschedule={() => {
                                setMoving(true);
                            }}
                        />
                    }
                >
                    <BookingBody detail={detail} withStatus />
                </DetailView>
            ) : null}
            {moving && detail ? (
                <RescheduleDialog
                    event={detail.event}
                    onClose={() => {
                        setMoving(false);
                    }}
                />
            ) : null}
            {!wide && composer ? (
                <Modal
                    size="lg"
                    framed={false}
                    onClose={() => {
                        setComposer(null);
                    }}
                >
                    <div className="h-[80vh] overflow-hidden rounded-lg bg-surface">
                        <BookingComposer
                            slot={composer}
                            board={board}
                            onDone={() => {
                                setComposer(null);
                            }}
                            onCancel={() => {
                                setComposer(null);
                            }}
                        />
                    </div>
                </Modal>
            ) : null}
        </div>
    );
}

function LaneHeads({ day, waiting }: { day: DayColumn; waiting: boolean }) {
    return (
        <div className="flex border-b border-line">
            <div className="shrink-0" style={{ width: GUTTER_PX }} />
            {day.lanes.map((l) => (
                <div
                    key={l.id}
                    className="flex min-w-0 flex-1 items-center gap-2.5 border-l border-line px-3 py-2.5"
                >
                    <Avatar name={l.name} size="sm" color={l.color} />
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-ink">{l.name}</div>
                        <div className="truncate text-xs text-muted">{l.hoursLabel}</div>
                    </div>
                    {waiting ? null : (
                        <span className="shrink-0 rounded-full bg-bg px-2 py-0.5 text-xs font-medium tabular-nums text-ink-soft">
                            {l.events.length}
                        </span>
                    )}
                </div>
            ))}
        </div>
    );
}
