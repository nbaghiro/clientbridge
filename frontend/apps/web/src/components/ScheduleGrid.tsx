import {
    type BookingDraft,
    type DaySummary,
    type MoveEvent,
    type MovePlan,
    type PlacedEvent,
    type ScheduleBlock,
    type ScheduleBoard,
    type ScheduleEvent,
    blockSpan,
    eventFlags,
    eventLabelFor,
    formatHour,
    formatMoney,
    formatTime,
    hourMarks,
    planMove,
    strings,
    formatParts,
    BUSINESS_CURRENCY,
    useBusinessZone,
    formatTimeRange,
    useCrewJob,
    dateKey,
    draftWindow,
    formatShortDay,
    minutesInto,
    minuteTop,
    offHourSpans,
    placeEvents,
} from "@clientbridge/app-core";
import {
    Button,
    CalendarEventCard,
    Icon,
    IconButton,
    KeyValueList,
    Modal,
    Notice,
} from "@clientbridge/ui";
import { INTENT_COLORS, cssVar } from "@clientbridge/tokens";
import {
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import { api } from "../lib/api";
import { SummaryStrip } from "./SummaryStrip";

const s = strings.bookings;

export const GUTTER_PX = 68;

/** Fits the hour height to the space the grid has, never below `min` (then the grid scrolls). */
export function useHourHeight(
    hours: number,
    min = 52,
): [(el: HTMLDivElement | null) => void, number] {
    // A callback ref, since the grid mounts only after the board has loaded.
    const [el, setEl] = useState<HTMLDivElement | null>(null);
    const [px, setPx] = useState(64);
    useLayoutEffect(() => {
        if (!el) return undefined;
        const measure = (): void => {
            setPx(Math.max(min, (el.clientHeight - 8) / hours));
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => {
            ro.disconnect();
        };
    }, [el, hours, min]);
    return [setEl, px];
}

export function useWide(query = "(min-width: 1280px)"): boolean {
    const [wide, setWide] = useState(() => window.matchMedia(query).matches);
    useLayoutEffect(() => {
        const mq = window.matchMedia(query);
        const on = (): void => {
            setWide(mq.matches);
        };
        mq.addEventListener("change", on);
        return () => {
            mq.removeEventListener("change", on);
        };
    }, [query]);
    return wide;
}

/** The header every Schedule view shares, so the view switch and New booking never move. */
export function CalendarToolbar({ board }: { board: ScheduleBoard }) {
    return (
        <header className="flex min-w-0 items-center gap-2 border-b border-line px-5 py-3">
            <Button variant="outline" size="sm" onPress={board.goToday}>
                {s.today}
            </Button>
            <div className="flex items-center">
                <IconButton
                    size="sm"
                    label={s.prev}
                    icon="chevronLeft"
                    onPress={() => {
                        board.shift(-1);
                    }}
                />
                <IconButton
                    size="sm"
                    label={s.next}
                    icon="chevronRight"
                    onPress={() => {
                        board.shift(1);
                    }}
                />
            </div>
            <h2 className="truncate font-display text-lg font-bold text-ink">{board.label}</h2>
        </header>
    );
}

export function DaySummaryBar({
    summary,
    waiting = false,
}: {
    summary: DaySummary;
    waiting?: boolean;
}) {
    const items = [
        { label: s.booked, value: s.bookings(summary.visits, summary.classes) },
        { label: s.expected, value: formatMoney(summary.expectedCents, BUSINESS_CURRENCY) },
        {
            label: s.openTime,
            value: s.hoursOpen(summary.openMin / 60),
        },
        { label: s.chairTime, value: s.utilization(summary.utilization) },
    ].map((it) => (waiting ? { ...it, value: s.dash } : it));
    return <SummaryStrip items={items} />;
}

const LEGEND = [
    {
        intent: "accent",
        get label() {
            return s.legendConfirmed;
        },
    },
    {
        intent: "warning",
        get label() {
            return s.legendPending;
        },
    },
    {
        intent: "success",
        get label() {
            return s.legendCompleted;
        },
    },
    {
        intent: "danger",
        get label() {
            return s.legendNoShow;
        },
    },
] as const;

export function StatusLegend() {
    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            {LEGEND.map((l) => (
                <span key={l.intent} className="flex items-center gap-1.5">
                    <span
                        className="h-2.5 w-2.5 rounded-sm border-l-2"
                        style={{
                            backgroundColor: cssVar(INTENT_COLORS[l.intent].soft),
                            borderColor: cssVar(INTENT_COLORS[l.intent].line),
                        }}
                    />
                    {l.label}
                </span>
            ))}
            <span className="flex items-center gap-1.5">
                <Icon name="move" size={13} />
                {s.dragHint}
            </span>
        </div>
    );
}

export function TimeGutter({
    startHour,
    endHour,
    hourPx,
}: {
    startHour: number;
    endHour: number;
    hourPx: number;
}) {
    return (
        <div
            className="relative shrink-0"
            style={{ width: GUTTER_PX, height: (endHour - startHour) * hourPx }}
        >
            {hourMarks(startHour, endHour).map((h, i) => (
                <span
                    key={h}
                    className="absolute right-2 -translate-y-1/2 text-[11px] text-muted"
                    style={{ top: i * hourPx }}
                >
                    {i === 0 ? "" : formatHour(h)}
                </span>
            ))}
        </div>
    );
}

export function HourLines({
    startHour,
    endHour,
    hourPx,
}: {
    startHour: number;
    endHour: number;
    hourPx: number;
}) {
    return (
        <>
            {hourMarks(startHour, endHour).map((h, i) => (
                <div
                    key={h}
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0"
                    style={{ top: i * hourPx, height: hourPx }}
                >
                    <div className="border-t border-line/70" />
                    <div
                        className="border-t border-dashed border-line-soft"
                        style={{ marginTop: hourPx / 2 - 1 }}
                    />
                </div>
            ))}
        </>
    );
}

const HATCH = {
    backgroundColor: "var(--bg)",
    backgroundImage:
        "repeating-linear-gradient(135deg, var(--border-soft) 0 1px, transparent 1px 8px)",
};

export function OffHours({
    spans,
    pxPerMin,
}: {
    spans: { from: number; to: number }[];
    pxPerMin: number;
}) {
    return (
        <>
            {spans.map((sp) => (
                <div
                    key={sp.from}
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0"
                    style={{
                        ...HATCH,
                        top: sp.from * pxPerMin,
                        height: (sp.to - sp.from) * pxPerMin,
                    }}
                />
            ))}
        </>
    );
}

export function BlockCard({
    block,
    startHour,
    endHour,
    pxPerMin,
    dayStart,
}: {
    block: ScheduleBlock;
    startHour: number;
    endHour: number;
    pxPerMin: number;
    dayStart: Date;
}) {
    const zone = useBusinessZone();
    const span = blockSpan(block, dayStart, startHour, endHour, pxPerMin, zone);
    if (span === null) return null;
    const { top, height } = span;
    const away = block.kind !== "break";
    const job = block.kind === "job" ? (block.bookingId ?? null) : null;
    return (
        <div
            className={`pointer-events-none absolute inset-x-1 overflow-hidden rounded-md border px-2 py-1 text-xs ${
                away ? "border-line text-muted" : "border-line-soft bg-surface2 text-muted"
            }`}
            style={{ top, height: Math.max(18, height - 2), ...(away ? HATCH : {}) }}
        >
            <span className="flex items-center gap-1 font-medium text-ink-soft">
                <Icon name={job !== null ? "users" : away ? "moon" : "clock"} size={12} />
                <span className="truncate">{block.label}</span>
            </span>
            {height > 34 ? (
                <span className="mt-0.5 block">
                    {formatTimeRange(block.start, block.end, zone)}
                </span>
            ) : null}
            {job !== null && height > 52 ? <JobDetails bookingId={job} /> : null}
        </div>
    );
}

function JobDetails({ bookingId }: { bookingId: string }) {
    const [open, setOpen] = useState(false);
    return (
        <span className="pointer-events-auto mt-0.5 block">
            <Button
                size="sm"
                variant="link"
                onPress={() => {
                    setOpen(true);
                }}
            >
                {s.crewJob}
            </Button>
            {open ? (
                <JobModal
                    bookingId={bookingId}
                    onClose={() => {
                        setOpen(false);
                    }}
                />
            ) : null}
        </span>
    );
}

function JobModal({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
    const { job, loading, error } = useCrewJob(api, bookingId);
    return (
        <Modal open onClose={onClose} size="sm">
            <div className="space-y-3 p-5">
                <h2 className="text-base font-semibold text-ink">{job?.title ?? s.crewJob}</h2>
                {loading ? <p className="text-sm text-muted">{strings.common.loading}</p> : null}
                {error !== null ? <Notice tone="danger">{error}</Notice> : null}
                {job !== null ? (
                    <KeyValueList
                        layout="stack"
                        rows={job.facts.map((f) => ({ label: f.label, value: f.value }))}
                    />
                ) : null}
            </div>
        </Modal>
    );
}

/** The current time across the lanes; with a label it sits in the hour gutter to the left. */
export function NowLine({ top, label }: { top: number; label?: string }) {
    return (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 z-20" style={{ top }}>
            <div className="relative border-t-2 border-danger">
                <span className="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-danger" />
                {label !== undefined ? (
                    <span className="absolute -top-[9px] right-full mr-1.5 whitespace-nowrap rounded bg-danger px-1 text-[10px] font-semibold leading-4 text-surface">
                        {label}
                    </span>
                ) : null}
            </div>
        </div>
    );
}

// Drag: pointer maths on web; where a move lands and whether it's allowed come from app-core.
interface DragState {
    id: string;
    mode: "move" | "resize";
    dy: number;
    laneShift: number;
    plan: MovePlan;
}

export function useGridDrag({
    pxPerMin,
    laneWidth,
    laneIds,
    board,
    mover,
}: {
    pxPerMin: number;
    laneWidth: () => number;
    laneIds: readonly string[];
    board: ScheduleBoard;
    mover: MoveEvent;
}) {
    const [drag, setDrag] = useState<DragState | null>(null);
    const origin = useRef<{
        x: number;
        y: number;
        moved: boolean;
        lane: number;
        mode: "move" | "resize";
    } | null>(null);
    const justDragged = useRef(false);
    const ctx = {
        avail: board.avail,
        events: board.weekEvents,
        staff: board.staff,
        rooms: board.rooms,
    };

    const compute = (
        event: ScheduleEvent,
        lane: number,
        mode: "move" | "resize",
        dx: number,
        dy: number,
    ): DragState => {
        const w = laneWidth();
        const laneShift =
            mode === "resize" || w === 0
                ? 0
                : Math.max(-lane, Math.min(laneIds.length - 1 - lane, Math.round(dx / w)));
        const staffId = laneIds[lane + laneShift] ?? event.staffId;
        const plan = planMove(event, dy / pxPerMin, staffId, ctx, board.now, mode);
        return { id: event.id, mode, dy, laneShift, plan };
    };

    const bind = (event: ScheduleEvent, lane: number) => {
        const canDrag =
            event.bookingId !== null &&
            (event.status === "confirmed" || event.status === "pending");
        return {
            onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
                if (!canDrag || e.button !== 0) return;
                const resize = (e.target as HTMLElement).dataset.handle === "resize";
                // The handle sits on the bottom edge, so the first move already leaves the card.
                if (resize) e.currentTarget.setPointerCapture(e.pointerId);
                origin.current = {
                    x: e.clientX,
                    y: e.clientY,
                    moved: false,
                    lane,
                    mode: resize ? "resize" : "move",
                };
            },
            onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
                const o = origin.current;
                if (!o) return;
                const dx = e.clientX - o.x;
                const dy = e.clientY - o.y;
                if (!o.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
                // Capture only once it's a drag, so a plain click still reaches the card.
                if (!o.moved) e.currentTarget.setPointerCapture(e.pointerId);
                o.moved = true;
                const next = compute(event, o.lane, o.mode, dx, dy);
                mover.check(event, next.plan);
                setDrag(next);
            },
            onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
                const o = origin.current;
                origin.current = null;
                if (!o?.moved) return;
                justDragged.current = true;
                window.setTimeout(() => {
                    justDragged.current = false;
                }, 0);
                const final = compute(event, o.lane, o.mode, e.clientX - o.x, e.clientY - o.y);
                setDrag(null);
                if (
                    final.plan.start.getTime() === event.start.getTime() &&
                    final.plan.end.getTime() === event.end.getTime() &&
                    final.plan.staffId === event.staffId
                )
                    return;
                mover.move(event, final.plan);
            },
            onPointerCancel: () => {
                origin.current = null;
                setDrag(null);
            },
            canDrag,
        };
    };

    return { drag, bind, clickAllowed: () => !justDragged.current };
}

/** A positioned visit with its drag handles; the ghost and its verdict render while it's dragged. */
export function GridEvent({
    placed,
    drag,
    bind,
    verdict,
    pxPerMin,
    laneWidth,
    selected,
    onSelect,
    clickAllowed,
}: {
    placed: PlacedEvent;
    drag: DragState | null;
    bind: ReturnType<ReturnType<typeof useGridDrag>["bind"]>;
    verdict: MoveEvent["verdict"];
    pxPerMin: number;
    laneWidth: number;
    selected: boolean;
    onSelect: (e: ScheduleEvent) => void;
    clickAllowed: () => boolean;
}) {
    const zone = useBusinessZone();
    const { event, top, height, leftPct, widthPct } = placed;
    const mine = drag?.id === event.id ? drag : null;
    const compact = height < 30;
    const density = (h: number): "compact" | "regular" | "full" =>
        h < 30 ? "compact" : h < 58 ? "regular" : "full";
    const card = (state: "idle" | "selected" | "dragging" | "refused" | "faded", h: number) => (
        <CalendarEventCard
            headline={event.headline}
            detail={
                event.kind === "class"
                    ? s.classSeats(event.bookedCount, event.capacity)
                    : event.serviceName
            }
            time={density(h) === "full" ? event.timeLabel : formatTime(event.start, zone)}
            intent={event.intent}
            color={event.color}
            density={density(h)}
            flags={eventFlags(event)}
            state={state}
            label={eventLabelFor(event)}
            onPress={() => {
                if (clickAllowed()) onSelect(event);
            }}
        />
    );
    const snapPx = 5 * pxPerMin;
    const ghostTop = mine
        ? mine.mode === "move"
            ? top + Math.round(mine.dy / snapPx) * snapPx
            : top
        : top;
    const ghostH =
        mine?.mode === "resize"
            ? Math.max(15 * pxPerMin, height + Math.round(mine.dy / snapPx) * snapPx)
            : height;
    const key = mine
        ? `${event.id}|${mine.plan.staffId}|${String(mine.plan.start.getTime())}|${String(mine.plan.end.getTime())}`
        : null;
    const server = mine && verdict?.key === key ? verdict : null;
    const refused = mine !== null && (mine.plan.problem !== null || server?.ok === false);
    const message = mine === null ? "" : server?.ok === false ? server.message : mine.plan.message;
    return (
        <>
            <div
                className={`group absolute select-none ${bind.canDrag ? "cursor-grab active:cursor-grabbing" : ""}`}
                style={{
                    top,
                    height,
                    left: `calc(${String(leftPct)}% + 3px)`,
                    width: `calc(${String(widthPct)}% - 6px)`,
                    touchAction: "none",
                }}
                onPointerDown={bind.onPointerDown}
                onPointerMove={bind.onPointerMove}
                onPointerUp={bind.onPointerUp}
                onPointerCancel={bind.onPointerCancel}
                data-testid={`event-${event.id}`}
            >
                {card(mine ? "faded" : selected ? "selected" : "idle", height)}
                {bind.canDrag && !compact ? (
                    <>
                        <span
                            aria-hidden
                            className="pointer-events-none absolute right-1 top-1 hidden rounded bg-surface/80 p-0.5 text-muted group-hover:block"
                        >
                            <Icon name="grip" size={12} />
                        </span>
                        <span
                            data-handle="resize"
                            aria-hidden
                            className="absolute inset-x-0 bottom-0 flex h-2 cursor-ns-resize justify-center"
                        >
                            <span className="pointer-events-none mt-0.5 h-1 w-8 rounded-full group-hover:bg-ink/25" />
                        </span>
                    </>
                ) : null}
            </div>
            {mine ? (
                <div
                    className="pointer-events-none absolute z-30"
                    style={{
                        top: ghostTop,
                        height: ghostH,
                        left: `calc(${String(leftPct)}% + 3px + ${String(mine.laneShift * laneWidth)}px)`,
                        width: `calc(${String(widthPct)}% - 6px)`,
                    }}
                >
                    {card(refused ? "refused" : "dragging", ghostH)}
                    <span
                        role="status"
                        className={`absolute -top-7 left-0 whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold shadow-card ${
                            refused ? "bg-danger text-surface" : "bg-ink text-surface"
                        }`}
                    >
                        {!refused && mine.mode === "move"
                            ? formatParts([mine.plan.label, message])
                            : message}
                    </span>
                </div>
            ) : null}
        </>
    );
}

/** The visit being booked, drawn where it would land: drag it to another member or time. */
export function DraftCard({
    draft,
    lane,
    lanes,
    top,
    height,
    pxPerMin,
    laneWidth,
    onPlace,
}: {
    draft: BookingDraft;
    lane: number;
    lanes: number;
    top: number;
    height: number;
    pxPerMin: number;
    laneWidth: () => number;
    onPlace: (lane: number, start: Date) => void;
}) {
    const origin = useRef<{ x: number; y: number; lane: number; start: Date; last: string } | null>(
        null,
    );
    const card = useRef<HTMLDivElement>(null);
    const startMs = draft.start.getTime();
    useLayoutEffect(() => {
        // a draft placed from the form can land below the fold, late in the day
        if (origin.current === null) card.current?.scrollIntoView({ block: "nearest" });
    }, [startMs, lane]);
    const at = (e: ReactPointerEvent<HTMLElement>): void => {
        const o = origin.current;
        if (!o) return;
        const w = laneWidth();
        const shift = w === 0 ? 0 : Math.round((e.clientX - o.x) / w);
        const target = Math.max(0, Math.min(lanes - 1, o.lane + shift));
        const minutes = Math.round((e.clientY - o.y) / pxPerMin / 15) * 15;
        const key = `${String(target)}|${String(minutes)}`;
        if (key === o.last) return;
        o.last = key;
        onPlace(target, new Date(+o.start + minutes * 60_000));
    };
    return (
        <div
            ref={card}
            data-testid="draft"
            className="absolute z-20 cursor-grab touch-none select-none px-[3px] active:cursor-grabbing"
            style={{
                top,
                height,
                left: `${String((lane * 100) / lanes)}%`,
                width: `${String(100 / lanes)}%`,
            }}
            onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                origin.current = {
                    x: e.clientX,
                    y: e.clientY,
                    lane,
                    start: draft.start,
                    last: "0|0",
                };
            }}
            onPointerMove={at}
            onPointerUp={() => {
                origin.current = null;
            }}
            onPointerCancel={() => {
                origin.current = null;
            }}
        >
            <CalendarEventCard
                headline={draft.headline}
                detail={draft.detail}
                time={height < 58 ? draft.startLabel : draft.timeLabel}
                intent="accent"
                density={height < 30 ? "compact" : height < 58 ? "regular" : "full"}
                state={draft.problem === null ? "draft" : "refused"}
                label={draft.label}
            />
            {draft.problem !== null ? (
                <span
                    role="status"
                    className="pointer-events-none absolute -top-7 left-0 whitespace-nowrap rounded-md bg-danger px-2 py-1 text-xs font-semibold text-surface shadow-card"
                >
                    {draft.problem}
                </span>
            ) : null}
        </div>
    );
}

/** The hover affordance on an open time: a dashed slot with its start, click to book there. */
export function SlotHover({ top, height, label }: { top: number; height: number; label: string }) {
    return (
        <div
            aria-hidden
            className="pointer-events-none absolute inset-x-1 z-10 flex items-start rounded-md border border-dashed border-accent bg-accent-weak/60 px-2 py-1 text-xs font-medium text-accent"
            style={{ top, height }}
        >
            <Icon name="plus" size={12} />
            <span className="ml-1">{label}</span>
        </div>
    );
}

export function Toast({
    children,
    tone = "ink",
    action,
}: {
    children: ReactNode;
    tone?: "ink" | "danger";
    action?: ReactNode;
}) {
    return (
        <div
            role="status"
            className={`pointer-events-auto absolute bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-lg px-4 py-2.5 text-sm text-surface shadow-lg ${
                tone === "danger" ? "bg-danger" : "bg-ink"
            }`}
        >
            <Icon name={tone === "danger" ? "alert" : "check"} size={16} />
            <span>{children}</span>
            {action}
        </div>
    );
}

/** One person's day, read-only apart from the new booking: tap a free time or drag the draft to move it. */
export function DayPeek({
    board,
    staffId,
    draft,
    onPlace,
}: {
    board: ScheduleBoard;
    staffId: string;
    draft: BookingDraft | null;
    onPlace: (start: Date) => void;
}) {
    const zone = useBusinessZone();
    const laneRef = useRef<HTMLDivElement>(null);
    const day = board.focus;
    const lane = day.lanes.find((l) => l.id === staffId);
    if (lane === undefined) return null;
    const onDay =
        draft !== null && draft.staffId === staffId && dateKey(draft.start, zone) === day.key;
    const { startHour, endHour } = draftWindow(board.window, onDay ? draft : null, day.date, zone);
    const hourPx = 44;
    const pxPerMin = hourPx / 60;
    const at = (min: number): Date => minutesInto(day.date, startHour * 60 + min, zone);
    return (
        <section className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium text-ink-soft">{s.dayOf(lane.short)}</p>
                <p className="text-xs text-muted">{formatShortDay(day.date, zone)}</p>
            </div>
            <div className="max-h-[300px] overflow-y-auto rounded-md border border-line bg-surface">
                <div
                    className="relative flex pt-2"
                    style={{ height: (endHour - startHour) * hourPx + 8 }}
                >
                    <TimeGutter startHour={startHour} endHour={endHour} hourPx={hourPx} />
                    <div
                        ref={laneRef}
                        className="relative min-w-0 flex-1 cursor-pointer border-l border-line"
                        onClick={(e) => {
                            if (e.target !== e.currentTarget) return;
                            onPlace(at(Math.floor(e.nativeEvent.offsetY / pxPerMin / 15) * 15));
                        }}
                    >
                        <OffHours
                            spans={offHourSpans(lane, startHour, endHour, zone)}
                            pxPerMin={pxPerMin}
                        />
                        <HourLines startHour={startHour} endHour={endHour} hourPx={hourPx} />
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
                        {placeEvents(lane.events, day.date, startHour, pxPerMin, zone).map((p) => (
                            <div
                                key={p.event.id}
                                className="pointer-events-none absolute"
                                style={{
                                    top: p.top,
                                    height: p.height,
                                    left: `calc(${String(p.leftPct)}% + 3px)`,
                                    width: `calc(${String(p.widthPct)}% - 6px)`,
                                }}
                            >
                                <CalendarEventCard
                                    headline={p.event.headline}
                                    detail={p.event.serviceName}
                                    time={formatTime(p.event.start, zone)}
                                    intent={p.event.intent}
                                    color={p.event.color}
                                    density={p.height < 30 ? "compact" : "regular"}
                                    flags={eventFlags(p.event)}
                                    state="faded"
                                    label={eventLabelFor(p.event)}
                                />
                            </div>
                        ))}
                        {onDay ? (
                            <DraftCard
                                draft={draft}
                                lane={0}
                                lanes={1}
                                top={minuteTop(draft.start, startHour, pxPerMin, zone)}
                                height={((+draft.end - +draft.start) / 60_000) * pxPerMin}
                                pxPerMin={pxPerMin}
                                laneWidth={() => laneRef.current?.clientWidth ?? 0}
                                onPlace={(_, start) => {
                                    onPlace(start);
                                }}
                            />
                        ) : null}
                        {day.isToday ? (
                            <NowLine top={minuteTop(board.now, startHour, pxPerMin, zone)} />
                        ) : null}
                    </div>
                </div>
            </div>
        </section>
    );
}
