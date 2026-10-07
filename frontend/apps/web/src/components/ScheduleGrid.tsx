import {
    type DaySummary,
    type MoveEvent,
    type MovePlan,
    type PlacedEvent,
    type ScheduleBlock,
    type ScheduleBoard,
    type ScheduleEvent,
    eventFlags,
    eventLabelFor,
    formatHour,
    formatMoney,
    formatTime,
    hourMarks,
    minuteTop,
    planMove,
    strings,
} from "@clientbridge/app-core";
import { Button, CalendarEventCard, Icon, IconButton } from "@clientbridge/ui";
import { INTENT_COLORS, cssVar } from "@clientbridge/tokens";
import {
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
    type RefObject,
    useLayoutEffect,
    useRef,
    useState,
} from "react";

const s = strings.bookings;

export const GUTTER_PX = 56;

/** Fits the hour height to the space the grid has, never below `min` (then the grid scrolls). */
export function useHourHeight(
    hours: number,
    min = 52,
    max = 84,
): [RefObject<HTMLDivElement | null>, number] {
    const ref = useRef<HTMLDivElement>(null);
    const [px, setPx] = useState(64);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return undefined;
        const measure = (): void => {
            setPx(Math.max(min, Math.min(max, (el.clientHeight - 8) / hours)));
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => {
            ro.disconnect();
        };
    }, [hours, min, max]);
    return [ref, px];
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

export function CalendarToolbar({
    board,
    onNew,
    leading,
}: {
    board: ScheduleBoard;
    onNew: () => void;
    leading?: ReactNode;
}) {
    return (
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-5 py-3">
            <div className="flex min-w-0 items-center gap-2">
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
                <h1 className="truncate font-display text-lg font-bold text-ink">{board.label}</h1>
            </div>
            <div className="flex items-center gap-2">
                {leading}
                <Button size="sm" icon="plus" onPress={onNew}>
                    {s.newBooking}
                </Button>
            </div>
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
        { label: s.expected, value: formatMoney(summary.expectedCents) },
        {
            label: s.openTime,
            value: s.hoursOpen((summary.openMin / 60).toFixed(1).replace(".0", "")),
        },
        { label: s.chairTime, value: s.utilization(summary.utilization) },
    ].map((it) => (waiting ? { ...it, value: s.dash } : it));
    return (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-line bg-bg/60 px-5 py-2 text-sm">
            {items.map((it) => (
                <span key={it.label} className="flex items-baseline gap-1.5">
                    <span className="text-xs text-muted">{it.label}</span>
                    <span className="font-semibold text-ink">{it.value}</span>
                </span>
            ))}
        </div>
    );
}

const LEGEND = [
    { intent: "accent", label: s.legendConfirmed },
    { intent: "warning", label: s.legendPending },
    { intent: "success", label: s.legendCompleted },
    { intent: "danger", label: s.legendNoShow },
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

export const HATCH = {
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
    const windowStart = new Date(
        dayStart.getFullYear(),
        dayStart.getMonth(),
        dayStart.getDate(),
        startHour,
    );
    const windowEnd = new Date(
        dayStart.getFullYear(),
        dayStart.getMonth(),
        dayStart.getDate(),
        endHour,
    );
    const from = block.start < windowStart ? windowStart : block.start;
    const to = block.end > windowEnd ? windowEnd : block.end;
    if (to <= from) return null;
    const top = minuteTop(from, startHour, pxPerMin);
    const height = minuteTop(to, startHour, pxPerMin) - top;
    const away = block.kind !== "break";
    return (
        <div
            className={`pointer-events-none absolute inset-x-1 overflow-hidden rounded-md border px-2 py-1 text-xs ${
                away ? "border-line text-muted" : "border-line-soft bg-surface2 text-muted"
            }`}
            style={{ top, height: Math.max(18, height - 2), ...(away ? HATCH : {}) }}
        >
            <span className="flex items-center gap-1 font-medium text-ink-soft">
                <Icon name={away ? "moon" : "clock"} size={12} />
                <span className="truncate">{block.label}</span>
            </span>
            {height > 34 ? (
                <span className="mt-0.5 block">{`${formatTime(block.start)} – ${formatTime(block.end)}`}</span>
            ) : null}
        </div>
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
    const ctx = { avail: board.avail, events: board.weekEvents, staff: board.staff };

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
            time={density(h) === "full" ? event.timeLabel : formatTime(event.start)}
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
                        {!refused && mine.mode === "move" ? `${mine.plan.label} · ` : ""}
                        {message}
                    </span>
                </div>
            ) : null}
        </>
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
