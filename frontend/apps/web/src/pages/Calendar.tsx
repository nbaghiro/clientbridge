import {
    type CalendarEvent,
    type Intent,
    type CalendarView,
    RECUR_FREQUENCIES,
    type RecurFrequency,
    type StaffRow,
    addDays,
    canCollectDeposit,
    canManagePayments,
    dateKey,
    dayBounds,
    dayColumns,
    depositStatusIntent,
    eventLabel,
    formatHour,
    formatMoney,
    formatRangeLabel,
    formatTime,
    formatWeekday,
    groupByDay,
    layoutDay,
    minutesSinceMidnight,
    monthMatrix,
    rescheduleByDrag,
    sameDay,
    savedCardLabel,
    staffLabel,
    startOfDay,
    startOfMonth,
    statusIntent,
    useBookingForm,
    useCalendarEvents,
    useCancelBooking,
    useCollectDeposit,
    useCurrentRole,
    useSavedCards,
    useStaff,
    useStripeAccountId,
    weekColumns,
} from "@clientbridge/app-core";
import {
    type FormEvent,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
    useLayoutEffect,
    useRef,
    useState,
} from "react";

import { CardConfirm } from "../components/CardConfirm";
import { StatusPill } from "../components/StatusPill";
import { api } from "../lib/api";
import { getTokens } from "../lib/auth";

const HOUR_PX = 48;
const MIN_HOUR_PX = 44;

const VIEWS: { key: CalendarView; label: string }[] = [
    { key: "day", label: "Day" },
    { key: "week", label: "Week" },
    { key: "month", label: "Month" },
    { key: "staff", label: "Staff" },
    { key: "agenda", label: "Agenda" },
];

interface Lane {
    key: string;
    header: ReactNode;
    dayStart: Date;
    events: CalendarEvent[];
    isToday: boolean;
}

const INTENT_CLASS: Record<Intent, string> = {
    accent: "border-accent bg-accent-weak text-accent-strong",
    success: "border-ok bg-ok-bg text-ok-fg",
    warning: "border-warn bg-warn-bg text-warn-fg",
    danger: "border-danger bg-surface text-danger",
    neutral: "border-line bg-surface text-ink",
};
const statusClass = (s: string): string => INTENT_CLASS[statusIntent(s)];

const INTENT_DOT: Record<Intent, string> = {
    accent: "bg-accent",
    success: "bg-ok",
    warning: "bg-warn",
    danger: "bg-danger",
    neutral: "bg-line",
};
const dotClass = (s: string): string => INTENT_DOT[statusIntent(s)];

function viewColumns(view: CalendarView, anchor: Date): Date[] {
    if (view === "day") return [startOfDay(anchor)];
    if (view === "week") return weekColumns(anchor);
    return dayColumns(anchor, 14);
}

function rangeOf(columns: Date[]): { start: Date; end: Date } {
    const start = columns.at(0) ?? startOfDay(new Date());
    const last = columns.at(-1) ?? start;
    return { start, end: addDays(last, 1) };
}

function shift(view: CalendarView, anchor: Date, dir: 1 | -1): Date {
    if (view === "day" || view === "staff") return addDays(anchor, dir);
    if (view === "month") return startOfMonth(addDays(startOfMonth(anchor), dir * 32));
    if (view === "agenda") return addDays(anchor, dir * 14);
    return addDays(anchor, dir * 7);
}

export function Calendar() {
    const [view, setView] = useState<CalendarView>("week");
    const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));
    const [booking, setBooking] = useState(false);
    const [detail, setDetail] = useState<CalendarEvent | null>(null);

    const isMonth = view === "month";
    const isStaff = view === "staff";
    const now = new Date();
    const matrix = monthMatrix(anchor);
    const dateCols = isStaff ? [] : isMonth ? matrix.flat() : viewColumns(view, anchor);
    const { start, end } = isStaff
        ? { start: startOfDay(anchor), end: addDays(startOfDay(anchor), 1) }
        : rangeOf(isMonth ? matrix.flat() : dateCols);
    const events = useCalendarEvents(start, end);
    const staff = useStaff();

    const lanes: Lane[] = isStaff
        ? staff.map((s) => ({
              key: s.id,
              header: <StaffHeader staff={s} />,
              dayStart: startOfDay(anchor),
              events: events.filter((e) => e.staffId === s.id),
              isToday: sameDay(anchor, now),
          }))
        : dateCols.map((day) => ({
              key: day.toISOString(),
              header: <DayHeader day={day} now={now} />,
              dayStart: startOfDay(day),
              events,
              isToday: sameDay(day, now),
          }));

    const label = isStaff
        ? anchor.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" })
        : isMonth
          ? anchor.toLocaleDateString("en-CA", { month: "long", year: "numeric" })
          : formatRangeLabel(dateCols);

    return (
        <div className="flex h-full flex-col p-6">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
                <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-3">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => {
                                setAnchor(startOfDay(new Date()));
                            }}
                            className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-bg"
                        >
                            Today
                        </button>
                        <div className="flex items-center">
                            <button
                                onClick={() => {
                                    setAnchor((a) => shift(view, a, -1));
                                }}
                                className="rounded-lg p-1.5 text-muted hover:bg-bg hover:text-ink"
                                aria-label="Previous"
                            >
                                <Chevron dir="left" />
                            </button>
                            <button
                                onClick={() => {
                                    setAnchor((a) => shift(view, a, 1));
                                }}
                                className="rounded-lg p-1.5 text-muted hover:bg-bg hover:text-ink"
                                aria-label="Next"
                            >
                                <Chevron dir="right" />
                            </button>
                        </div>
                        <h1 className="text-lg font-semibold text-ink">{label}</h1>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex rounded-lg border border-line p-0.5">
                            {VIEWS.map((v) => (
                                <button
                                    key={v.key}
                                    onClick={() => {
                                        setView(v.key);
                                    }}
                                    className={`rounded-md px-3 py-1 text-sm font-medium ${
                                        view === v.key
                                            ? "bg-accent text-accent-ink"
                                            : "text-muted hover:text-ink"
                                    }`}
                                >
                                    {v.label}
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={() => {
                                setBooking(true);
                            }}
                            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:bg-accent-strong"
                        >
                            + New booking
                        </button>
                    </div>
                </header>

                {view === "agenda" ? (
                    <AgendaView columns={dateCols} events={events} onEventClick={setDetail} />
                ) : isMonth ? (
                    <MonthView
                        matrix={matrix}
                        anchor={anchor}
                        events={events}
                        onEventClick={setDetail}
                    />
                ) : (
                    <TimeGrid lanes={lanes} allEvents={events} onEventClick={setDetail} />
                )}

                {booking ? (
                    <AddBookingModal
                        anchor={anchor}
                        onClose={() => {
                            setBooking(false);
                        }}
                    />
                ) : null}
                {detail ? (
                    <EventDetail
                        event={detail}
                        onClose={() => {
                            setDetail(null);
                        }}
                    />
                ) : null}
            </div>
        </div>
    );
}

function DayHeader({ day, now }: { day: Date; now: Date }) {
    const today = sameDay(day, now);
    return (
        <>
            <div className="text-xs font-medium uppercase text-muted">{formatWeekday(day)}</div>
            <div className={`text-lg font-semibold ${today ? "text-accent" : "text-ink"}`}>
                {day.getDate()}
            </div>
        </>
    );
}

function StaffHeader({ staff }: { staff: StaffRow }) {
    return (
        <div className="flex items-center justify-center gap-1.5 px-1">
            {staff.color !== null ? (
                <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: staff.color }}
                />
            ) : null}
            <span className="truncate text-sm font-medium text-ink">{staffLabel(staff)}</span>
        </div>
    );
}

function TimeGrid({
    lanes,
    allEvents,
    onEventClick,
}: {
    lanes: Lane[];
    allEvents: CalendarEvent[];
    onEventClick: (e: CalendarEvent) => void;
}) {
    const { startHour, endHour } = dayBounds(allEvents);
    const numHours = endHour - startHour;
    const hours = Array.from({ length: numHours }, (_, i) => startHour + i);
    const bodyRef = useRef<HTMLDivElement>(null);
    const [bodyH, setBodyH] = useState(0);
    useLayoutEffect(() => {
        const el = bodyRef.current;
        if (el === null) return;
        const measure = (): void => {
            setBodyH(el.clientHeight);
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => {
            ro.disconnect();
        };
    }, []);
    const hourPx = bodyH > 0 ? Math.max(MIN_HOUR_PX, bodyH / numHours) : HOUR_PX;
    const pxPerMin = hourPx / 60;
    const offsetPx = startHour * 60 * pxPerMin;
    const gridHeight = numHours * hourPx;
    const now = new Date();
    const nowTop = minutesSinceMidnight(now) * pxPerMin - offsetPx;

    const reschedule = (event: CalendarEvent, deltaY: number): void => {
        rescheduleByDrag(api, event, deltaY, pxPerMin);
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex border-b border-line pr-[6px]">
                <div className="w-14 shrink-0" />
                {lanes.map((lane) => (
                    <div
                        key={lane.key}
                        className="min-w-0 flex-1 border-l border-line py-2 text-center"
                    >
                        {lane.header}
                    </div>
                ))}
            </div>

            <div ref={bodyRef} className="flex min-h-0 flex-1 overflow-auto">
                <div className="w-14 shrink-0">
                    {hours.map((h) => (
                        <div
                            key={h}
                            style={{ height: hourPx }}
                            className="relative -top-2 pr-2 text-right text-xs text-muted"
                        >
                            {formatHour(h)}
                        </div>
                    ))}
                </div>
                {lanes.map((lane) => {
                    const positioned = layoutDay(lane.events, {
                        dayStart: lane.dayStart,
                        pxPerMin,
                    });
                    return (
                        <div
                            key={lane.key}
                            className="relative min-w-0 flex-1 border-l border-line"
                            style={{ height: gridHeight }}
                        >
                            {hours.map((h, i) => (
                                <div
                                    key={h}
                                    className="absolute inset-x-0 border-t border-line/60"
                                    style={{ top: i * hourPx }}
                                />
                            ))}
                            {positioned.map((pe) => (
                                <EventBlock
                                    key={pe.event.id}
                                    pe={pe}
                                    offsetPx={offsetPx}
                                    pxPerMin={pxPerMin}
                                    onClick={() => {
                                        onEventClick(pe.event);
                                    }}
                                    onReschedule={reschedule}
                                />
                            ))}
                            {lane.isToday && nowTop >= 0 && nowTop <= gridHeight ? (
                                <div
                                    className="absolute inset-x-0 z-10 border-t-2 border-danger"
                                    style={{ top: nowTop }}
                                />
                            ) : null}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function EventBlock({
    pe,
    offsetPx,
    pxPerMin,
    onClick,
    onReschedule,
}: {
    pe: ReturnType<typeof layoutDay>[number];
    offsetPx: number;
    pxPerMin: number;
    onClick: () => void;
    onReschedule: (event: CalendarEvent, deltaY: number) => void;
}) {
    const { event, topPx, heightPx, leftPct, widthPct } = pe;
    const [dy, setDy] = useState(0);
    const drag = useRef<{ y: number; moved: boolean } | null>(null);
    const canDrag = event.bookingId !== null;
    const snapStep = 5 * pxPerMin;
    const snappedDy = Math.round(dy / snapStep) * snapStep;

    const down = (e: ReactPointerEvent): void => {
        if (!canDrag) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { y: e.clientY, moved: false };
    };
    const move = (e: ReactPointerEvent): void => {
        if (drag.current === null) return;
        const d = e.clientY - drag.current.y;
        if (Math.abs(d) > 3) drag.current.moved = true;
        setDy(d);
    };
    const up = (e: ReactPointerEvent): void => {
        const d = drag.current;
        drag.current = null;
        setDy(0);
        if (d?.moved === true) onReschedule(event, e.clientY - d.y);
        else onClick();
    };

    return (
        <button
            type="button"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            className={`absolute overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-left text-xs ${snappedDy !== 0 ? "z-20 opacity-90 shadow-md" : ""} ${statusClass(event.status)}`}
            style={{
                top: topPx - offsetPx,
                height: heightPx,
                left: `calc(${leftPct}% + 2px)`,
                width: `calc(${widthPct}% - 4px)`,
                transform: `translateY(${snappedDy}px)`,
                cursor: canDrag ? "grab" : "pointer",
                touchAction: "none",
            }}
            title={`${formatTime(event.start)} · ${event.title}${event.subtitle ? ` · ${event.subtitle}` : ""}`}
        >
            <div className="truncate font-medium">{eventLabel(event)}</div>
            {heightPx > 30 ? (
                <div className="truncate opacity-80">
                    {formatTime(event.start)} · {event.title}
                </div>
            ) : null}
        </button>
    );
}

function MonthView({
    matrix,
    anchor,
    events,
    onEventClick,
}: {
    matrix: Date[][];
    anchor: Date;
    events: CalendarEvent[];
    onEventClick: (e: CalendarEvent) => void;
}) {
    const byDay = groupByDay(events);
    const now = new Date();
    const month = anchor.getMonth();
    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
            <div className="grid grid-cols-7 border-b border-line">
                {matrix[0]?.map((d) => (
                    <div
                        key={d.toISOString()}
                        className="py-2 text-center text-xs font-medium uppercase text-muted"
                    >
                        {formatWeekday(d)}
                    </div>
                ))}
            </div>
            <div className="grid flex-1 grid-cols-7 grid-rows-6">
                {matrix.flat().map((d) => {
                    const dayEvents = byDay.get(dateKey(d)) ?? [];
                    const inMonth = d.getMonth() === month;
                    const today = sameDay(d, now);
                    return (
                        <div
                            key={d.toISOString()}
                            className="min-h-0 border-b border-l border-line p-1"
                        >
                            <div
                                className={`mb-1 text-right text-xs ${
                                    today
                                        ? "font-semibold text-accent"
                                        : inMonth
                                          ? "text-ink"
                                          : "text-muted/50"
                                }`}
                            >
                                {d.getDate()}
                            </div>
                            <div className="space-y-0.5">
                                {dayEvents.slice(0, 3).map((e) => (
                                    <button
                                        type="button"
                                        key={e.id}
                                        onClick={() => {
                                            onEventClick(e);
                                        }}
                                        className={`block w-full truncate rounded border-l-2 px-1 text-left text-[11px] ${statusClass(e.status)}`}
                                    >
                                        {formatTime(e.start)} {eventLabel(e)}
                                    </button>
                                ))}
                                {dayEvents.length > 3 ? (
                                    <div className="px-1 text-[11px] text-muted">
                                        +{dayEvents.length - 3} more
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function AgendaView({
    columns,
    events,
    onEventClick,
}: {
    columns: Date[];
    events: CalendarEvent[];
    onEventClick: (e: CalendarEvent) => void;
}) {
    const byDay = groupByDay(events);
    const now = new Date();
    return (
        <div className="min-h-0 flex-1 overflow-auto px-6 py-2">
            {columns.map((day) => {
                const dayEvents = byDay.get(dateKey(day)) ?? [];
                if (dayEvents.length === 0) return null;
                return (
                    <div key={day.toISOString()} className="border-b border-line py-3">
                        <div className="mb-2 text-sm font-semibold text-ink">
                            {sameDay(day, now) ? "Today · " : ""}
                            {day.toLocaleDateString("en-CA", {
                                weekday: "long",
                                month: "long",
                                day: "numeric",
                            })}
                        </div>
                        <div className="space-y-1">
                            {dayEvents
                                .sort((a, b) => a.start.getTime() - b.start.getTime())
                                .map((e) => (
                                    <button
                                        type="button"
                                        key={e.id}
                                        onClick={() => {
                                            onEventClick(e);
                                        }}
                                        className="flex w-full items-center gap-3 rounded-md py-1 text-left hover:bg-bg"
                                    >
                                        <div className="w-20 shrink-0 text-sm text-muted">
                                            {formatTime(e.start)}
                                        </div>
                                        <div
                                            className={`h-2 w-2 shrink-0 rounded-full ${dotClass(e.status)}`}
                                        />
                                        <div className="text-sm font-medium text-ink">
                                            {eventLabel(e)}
                                        </div>
                                        <div className="text-sm text-muted">{e.title}</div>
                                    </button>
                                ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
    return (
        <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
        >
            <path
                d={dir === "left" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function Overlay({ children, onClose }: { children: ReactNode; onClose: () => void }) {
    return (
        <div
            onClick={onClose}
            className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
        >
            <div
                onClick={(e) => {
                    e.stopPropagation();
                }}
                className="w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-lg"
            >
                {children}
            </div>
        </div>
    );
}

const fieldClass =
    "mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none";

function AddBookingModal({ anchor, onClose }: { anchor: Date; onClose: () => void }) {
    const form = useBookingForm(api, onClose);
    const [date, setDate] = useState(() => dateKey(anchor));
    const [time, setTime] = useState("09:00");

    const submit = (e: FormEvent): void => {
        e.preventDefault();
        void form.submit(new Date(`${date}T${time}`));
    };

    return (
        <Overlay onClose={onClose}>
            <form onSubmit={submit} className="space-y-3">
                <h2 className="text-lg font-semibold text-ink">New booking</h2>
                <label className="block">
                    <span className="text-sm text-muted">Client</span>
                    <select
                        value={form.clientId}
                        onChange={(e) => {
                            form.setClientId(e.target.value);
                        }}
                        className={fieldClass}
                    >
                        <option value="">Select a client</option>
                        {form.clients.map((cl) => (
                            <option key={cl.id} value={cl.id}>
                                {cl.name}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="block">
                    <span className="text-sm text-muted">Service</span>
                    <select
                        value={form.itemId}
                        onChange={(e) => {
                            form.setItemId(e.target.value);
                        }}
                        className={fieldClass}
                    >
                        <option value="">Select a service</option>
                        {form.items.map((it) => (
                            <option key={it.id} value={it.id}>
                                {it.name}
                            </option>
                        ))}
                    </select>
                </label>
                {form.staff.length > 1 ? (
                    <label className="block">
                        <span className="text-sm text-muted">Staff</span>
                        <select
                            value={form.effStaff}
                            onChange={(e) => {
                                form.setStaffId(e.target.value);
                            }}
                            className={fieldClass}
                        >
                            {form.staff.map((s) => (
                                <option key={s.id} value={s.id}>
                                    {staffLabel(s)}
                                </option>
                            ))}
                        </select>
                    </label>
                ) : null}
                <div className="flex gap-2">
                    <label className="block flex-1">
                        <span className="text-sm text-muted">Date</span>
                        <input
                            type="date"
                            value={date}
                            onChange={(e) => {
                                setDate(e.target.value);
                            }}
                            className={fieldClass}
                        />
                    </label>
                    <label className="block flex-1">
                        <span className="text-sm text-muted">Time</span>
                        <input
                            type="time"
                            value={time}
                            onChange={(e) => {
                                setTime(e.target.value);
                            }}
                            className={fieldClass}
                        />
                    </label>
                </div>
                <label className="flex items-center gap-2 pt-1 text-sm text-ink">
                    <input
                        type="checkbox"
                        checked={form.repeat}
                        onChange={(e) => {
                            form.setRepeat(e.target.checked);
                        }}
                        className="accent-accent"
                    />
                    Repeat this booking
                </label>
                {form.repeat ? (
                    <div className="flex items-end gap-2">
                        <label className="block w-20">
                            <span className="text-sm text-muted">Every</span>
                            <input
                                type="number"
                                min={1}
                                value={form.interval}
                                onChange={(e) => {
                                    form.setInterval(Number(e.target.value));
                                }}
                                className={fieldClass}
                            />
                        </label>
                        <label className="block flex-1">
                            <span className="text-sm text-muted">Frequency</span>
                            <select
                                value={form.frequency}
                                onChange={(e) => {
                                    form.setFrequency(e.target.value as RecurFrequency);
                                }}
                                className={fieldClass}
                            >
                                {RECUR_FREQUENCIES.map((f) => (
                                    <option key={f.value} value={f.value}>
                                        {f.unit}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="block w-24">
                            <span className="text-sm text-muted">Occurrences</span>
                            <input
                                type="number"
                                min={1}
                                max={60}
                                value={form.count}
                                onChange={(e) => {
                                    form.setCount(Number(e.target.value));
                                }}
                                className={fieldClass}
                            />
                        </label>
                    </div>
                ) : null}
                {form.error !== null ? <p className="text-sm text-danger">{form.error}</p> : null}
                {form.notice !== null ? (
                    <p className="text-sm text-success">{form.notice}</p>
                ) : null}
                <div className="flex justify-end gap-2 pt-1">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:text-ink"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={form.busy}
                        className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink hover:bg-accent-strong disabled:opacity-50"
                    >
                        {form.busy ? "Booking…" : form.repeat ? "Book series" : "Book"}
                    </button>
                </div>
            </form>
        </Overlay>
    );
}

function EventDetail({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
    const { busy, error, cancel } = useCancelBooking(api, event, onClose);
    return (
        <Overlay onClose={onClose}>
            <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h2 className="text-lg font-semibold text-ink">{event.title}</h2>
                        {event.subtitle.length > 0 ? (
                            <p className="text-sm text-muted">{event.subtitle}</p>
                        ) : null}
                    </div>
                    <StatusPill status={event.status} intent={statusIntent(event.status)} />
                </div>
                <p className="text-sm text-ink">
                    {formatTime(event.start)} – {formatTime(event.end)}
                </p>
                {event.depositRequired ? <DepositSection event={event} onClose={onClose} /> : null}
                {error !== null ? <p className="text-sm text-danger">{error}</p> : null}
                <div className="flex justify-end gap-2 pt-1">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:text-ink"
                    >
                        Close
                    </button>
                    {event.bookingId !== null && event.status !== "canceled" ? (
                        <button
                            type="button"
                            onClick={cancel}
                            disabled={busy}
                            className="rounded-lg border border-danger px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger hover:text-surface disabled:opacity-50"
                        >
                            {busy ? "Canceling…" : "Cancel booking"}
                        </button>
                    ) : null}
                </div>
            </div>
        </Overlay>
    );
}

function DepositSection({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
    const role = useCurrentRole(getTokens()?.access_token ?? null);
    const cards = useSavedCards(event.clientId ?? "");
    const deposit = useCollectDeposit(api, event, onClose);
    const stripeAccount = useStripeAccountId() ?? "";
    const [method, setMethod] = useState<string | null>(null);

    if (!canManagePayments(role)) return null;
    const amountLabel = formatMoney(event.depositAmountCents);
    const effMethod = method ?? cards.at(0)?.id ?? "";

    if (deposit.clientSecret !== null) {
        return (
            <div className="rounded-lg border border-line bg-bg p-3">
                <p className="text-sm font-medium text-ink">Collect deposit · {amountLabel}</p>
                <CardConfirm
                    clientSecret={deposit.clientSecret}
                    stripeAccount={stripeAccount}
                    amountLabel={amountLabel}
                    onPaid={deposit.complete}
                    onCancel={deposit.cancel}
                />
            </div>
        );
    }

    return (
        <div className="rounded-lg border border-line bg-bg p-3">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <p className="text-sm font-medium text-ink">Deposit</p>
                    <p className="text-sm text-muted">{amountLabel}</p>
                </div>
                <StatusPill
                    status={event.depositStatus}
                    intent={depositStatusIntent(event.depositStatus)}
                />
            </div>
            {canCollectDeposit(event) ? (
                <div className="mt-3 space-y-2">
                    <select
                        value={effMethod}
                        onChange={(e) => {
                            setMethod(e.target.value);
                        }}
                        className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
                    >
                        <option value="">Pay with a new card</option>
                        {cards.map((card) => (
                            <option key={card.id} value={card.id}>
                                {savedCardLabel(card)}
                            </option>
                        ))}
                    </select>
                    {deposit.error !== null ? (
                        <p className="text-sm text-danger">{deposit.error}</p>
                    ) : null}
                    <button
                        type="button"
                        onClick={() => {
                            deposit.collect(effMethod);
                        }}
                        disabled={deposit.busy}
                        className="w-full rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                    >
                        {deposit.busy ? "Collecting…" : `Collect ${amountLabel}`}
                    </button>
                </div>
            ) : null}
        </div>
    );
}
