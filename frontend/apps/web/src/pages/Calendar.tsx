import {
    type CalendarEvent,
    type CalendarView,
    addDays,
    dateKey,
    dayBounds,
    dayColumns,
    formatHour,
    formatRangeLabel,
    formatTime,
    formatWeekday,
    groupByDay,
    layoutDay,
    monthMatrix,
    sameDay,
    startOfDay,
    startOfMonth,
    useCalendarEvents,
    weekColumns,
} from "@clientbridge/app-core";
import { useState } from "react";

const HOUR_PX = 48;
const PX_PER_MIN = HOUR_PX / 60;

const VIEWS: { key: CalendarView; label: string }[] = [
    { key: "day", label: "Day" },
    { key: "week", label: "Week" },
    { key: "month", label: "Month" },
    { key: "agenda", label: "Agenda" },
];

const STATUS_CLASS: Record<string, string> = {
    confirmed: "border-accent bg-accent-weak text-accent-strong",
    completed: "border-ok bg-ok-bg text-ok-fg",
    pending: "border-warn bg-warn-bg text-warn-fg",
    no_show: "border-danger bg-surface text-danger",
};
const statusClass = (s: string): string => STATUS_CLASS[s] ?? "border-line bg-surface text-ink";

const STATUS_DOT: Record<string, string> = {
    confirmed: "bg-accent",
    completed: "bg-ok",
    pending: "bg-warn",
    no_show: "bg-danger",
};
const dotClass = (s: string): string => STATUS_DOT[s] ?? "bg-line";

const eventLabel = (e: CalendarEvent): string => (e.subtitle.length > 0 ? e.subtitle : e.title);

function viewColumns(view: CalendarView, anchor: Date): Date[] {
    if (view === "day") return [startOfDay(anchor)];
    if (view === "week") return weekColumns(anchor);
    return dayColumns(anchor, 14); // agenda
}

function rangeOf(columns: Date[]): { start: Date; end: Date } {
    const start = columns.at(0) ?? startOfDay(new Date());
    const last = columns.at(-1) ?? start;
    return { start, end: addDays(last, 1) };
}

function shift(view: CalendarView, anchor: Date, dir: 1 | -1): Date {
    if (view === "day") return addDays(anchor, dir);
    if (view === "month") return startOfMonth(addDays(startOfMonth(anchor), dir * 32));
    if (view === "agenda") return addDays(anchor, dir * 14);
    return addDays(anchor, dir * 7);
}

export function Calendar() {
    const [view, setView] = useState<CalendarView>("week");
    const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));

    const isMonth = view === "month";
    const matrix = monthMatrix(anchor);
    const columns = isMonth ? matrix.flat() : viewColumns(view, anchor);
    const { start, end } = rangeOf(isMonth ? matrix.flat() : columns);
    const events = useCalendarEvents(start, end);

    const label = isMonth
        ? anchor.toLocaleDateString("en-CA", { month: "long", year: "numeric" })
        : formatRangeLabel(columns);

    return (
        <div className="flex h-full flex-col">
            <header className="flex items-center justify-between gap-4 px-6 py-4">
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
                    <button className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:bg-accent-strong">
                        + New booking
                    </button>
                </div>
            </header>

            {view === "agenda" ? (
                <AgendaView columns={columns} events={events} />
            ) : isMonth ? (
                <MonthView matrix={matrix} anchor={anchor} events={events} />
            ) : (
                <TimeGrid columns={columns} events={events} />
            )}
        </div>
    );
}

function TimeGrid({ columns, events }: { columns: Date[]; events: CalendarEvent[] }) {
    const { startHour, endHour } = dayBounds(events);
    const offsetPx = startHour * 60 * PX_PER_MIN;
    const gridHeight = (endHour - startHour) * HOUR_PX;
    const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
    const now = new Date();

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex border-b border-line pr-[6px]">
                <div className="w-14 shrink-0" />
                {columns.map((day) => {
                    const today = sameDay(day, now);
                    return (
                        <div
                            key={day.toISOString()}
                            className="flex-1 border-l border-line py-2 text-center"
                        >
                            <div className="text-xs font-medium uppercase text-muted">
                                {formatWeekday(day)}
                            </div>
                            <div
                                className={`text-lg font-semibold ${today ? "text-accent" : "text-ink"}`}
                            >
                                {day.getDate()}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="flex min-h-0 flex-1 overflow-auto">
                <div className="w-14 shrink-0">
                    {hours.map((h) => (
                        <div
                            key={h}
                            style={{ height: HOUR_PX }}
                            className="relative -top-2 pr-2 text-right text-xs text-muted"
                        >
                            {formatHour(h)}
                        </div>
                    ))}
                </div>
                {columns.map((day) => {
                    const positioned = layoutDay(events, {
                        dayStart: startOfDay(day),
                        pxPerMin: PX_PER_MIN,
                    });
                    const showNow = sameDay(day, now);
                    const nowTop = (now.getHours() * 60 + now.getMinutes()) * PX_PER_MIN - offsetPx;
                    return (
                        <div
                            key={day.toISOString()}
                            className="relative flex-1 border-l border-line"
                            style={{ height: gridHeight }}
                        >
                            {hours.map((h, i) => (
                                <div
                                    key={h}
                                    className="absolute inset-x-0 border-t border-line/60"
                                    style={{ top: i * HOUR_PX }}
                                />
                            ))}
                            {positioned.map((pe) => (
                                <EventBlock key={pe.event.id} pe={pe} offsetPx={offsetPx} />
                            ))}
                            {showNow && nowTop >= 0 && nowTop <= gridHeight ? (
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
}: {
    pe: ReturnType<typeof layoutDay>[number];
    offsetPx: number;
}) {
    const { event, topPx, heightPx, leftPct, widthPct } = pe;
    return (
        <div
            className={`absolute overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-xs ${statusClass(event.status)}`}
            style={{
                top: topPx - offsetPx,
                height: heightPx,
                left: `calc(${leftPct}% + 2px)`,
                width: `calc(${widthPct}% - 4px)`,
            }}
            title={`${formatTime(event.start)} · ${event.title}${event.subtitle ? ` · ${event.subtitle}` : ""}`}
        >
            <div className="truncate font-medium">{eventLabel(event)}</div>
            {heightPx > 30 ? (
                <div className="truncate opacity-80">
                    {formatTime(event.start)} · {event.title}
                </div>
            ) : null}
        </div>
    );
}

function MonthView({
    matrix,
    anchor,
    events,
}: {
    matrix: Date[][];
    anchor: Date;
    events: CalendarEvent[];
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
                                    <div
                                        key={e.id}
                                        className={`truncate rounded border-l-2 px-1 text-[11px] ${statusClass(e.status)}`}
                                    >
                                        {formatTime(e.start)} {eventLabel(e)}
                                    </div>
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

function AgendaView({ columns, events }: { columns: Date[]; events: CalendarEvent[] }) {
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
                                    <div key={e.id} className="flex items-center gap-3 py-1">
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
                                    </div>
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
