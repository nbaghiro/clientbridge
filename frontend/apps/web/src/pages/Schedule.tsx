import {
    calendarColumns,
    type CalendarEvent,
    type CalendarView,
    canCollectDeposit,
    checkoutMethods,
    combineDayAndTime,
    dateKey,
    dayBounds,
    depositStatusIntent,
    eventLabel,
    formatFullDate,
    formatHour,
    formatMoney,
    formatMonthYear,
    formatRangeLabel,
    formatTime,
    formatWeekday,
    groupByDay,
    groupByStaff,
    layoutDay,
    minutesSinceMidnight,
    monthMatrix,
    RECUR_FREQUENCIES,
    type RecurFrequency,
    rescheduleByDrag,
    sameDay,
    staffLabel,
    type StaffRow,
    startOfDay,
    statusIntent,
    strings,
    useBookingAddons,
    useBookingForm,
    useScheduleView,
    useCancelBooking,
    useCollectDeposit,
    useSavedCards,
    useStaff,
} from "@clientbridge/app-core";
import {
    Button,
    ChargeSheet,
    Choice,
    DetailSection,
    DetailView,
    Modal,
    Money,
    Notice,
    Select,
    StatusPill,
    TextField,
    Toggle,
} from "@clientbridge/ui";
import { INTENT_COLORS, cssVar } from "@clientbridge/tokens";
import {
    type CSSProperties,
    type SubmitEvent,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
    useLayoutEffect,
    useRef,
    useState,
} from "react";

import { api } from "../lib/api";
import { useViewer } from "../lib/auth";

const HOUR_PX = 48;
const MIN_HOUR_PX = 44;

const VIEWS: { key: CalendarView; label: string }[] = [
    { key: "day", label: strings.bookings.viewDay },
    { key: "week", label: strings.bookings.viewWeek },
    { key: "month", label: strings.bookings.viewMonth },
    { key: "staff", label: strings.bookings.viewStaff },
    { key: "agenda", label: strings.bookings.viewAgenda },
];

interface Lane {
    key: string;
    header: ReactNode;
    dayStart: Date;
    events: CalendarEvent[];
    isToday: boolean;
}

function statusStyle(s: string): CSSProperties {
    const tone = INTENT_COLORS[statusIntent(s)];
    return {
        backgroundColor: cssVar(tone.soft),
        color: cssVar(tone.ink),
        borderColor: cssVar(tone.line),
    };
}

const dotStyle = (s: string): CSSProperties => ({
    backgroundColor: cssVar(INTENT_COLORS[statusIntent(s)].line),
});

export function Schedule() {
    const { view, setView, anchor, goToday, shift, events } = useScheduleView<CalendarView>("week");
    const [booking, setBooking] = useState(false);
    const [detail, setDetail] = useState<CalendarEvent | null>(null);

    const isMonth = view === "month";
    const isStaff = view === "staff";
    const now = new Date();
    const matrix = monthMatrix(anchor);
    const dateCols = calendarColumns(view, anchor);
    const staff = useStaff();

    const byStaff = groupByStaff(events);
    const lanes: Lane[] = isStaff
        ? staff.map((s) => ({
              key: s.id,
              header: <StaffHeader staff={s} />,
              dayStart: startOfDay(anchor),
              events: byStaff.get(s.id) ?? [],
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
        ? formatFullDate(anchor)
        : isMonth
          ? formatMonthYear(anchor)
          : formatRangeLabel(dateCols);

    return (
        <div className="flex h-full flex-col p-6">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
                <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-3">
                    <div className="flex items-center gap-3">
                        <Button
                            variant="outline"
                            size="sm"
                            onPress={() => {
                                goToday();
                            }}
                        >
                            {strings.bookings.today}
                        </Button>
                        <div className="flex items-center">
                            <Button
                                variant="quiet"
                                size="sm"
                                label={strings.bookings.prev}
                                onPress={() => {
                                    shift(-1);
                                }}
                            >
                                <Chevron dir="left" />
                            </Button>
                            <Button
                                variant="quiet"
                                size="sm"
                                label={strings.bookings.next}
                                onPress={() => {
                                    shift(1);
                                }}
                            >
                                <Chevron dir="right" />
                            </Button>
                        </div>
                        <h1 className="text-lg font-semibold text-ink">{label}</h1>
                    </div>
                    <div className="flex items-center gap-2">
                        <Choice
                            layout="segmented"
                            label={strings.bookings.viewLabel}
                            options={VIEWS}
                            value={view}
                            onChange={setView}
                        />
                        <Button
                            size="sm"
                            onPress={() => {
                                setBooking(true);
                            }}
                        >
                            {strings.bookings.newBookingButton}
                        </Button>
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
            className={`absolute overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-left text-xs ${snappedDy !== 0 ? "z-20 opacity-90 shadow-md" : ""}`}
            style={{
                ...statusStyle(event.status),
                top: topPx - offsetPx,
                height: heightPx,
                left: `calc(${leftPct}% + 2px)`,
                width: `calc(${widthPct}% - 4px)`,
                transform: `translateY(${snappedDy}px)`,
                cursor: canDrag ? "grab" : "pointer",
                touchAction: "none",
            }}
            title={strings.bookings.eventTooltip(
                formatTime(event.start),
                event.title,
                event.subtitle,
            )}
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
                                        style={statusStyle(e.status)}
                                        className="block w-full truncate rounded-base border-l-2 px-1 text-left text-[11px]"
                                    >
                                        {formatTime(e.start)} {eventLabel(e)}
                                    </button>
                                ))}
                                {dayEvents.length > 3 ? (
                                    <div className="px-1 text-[11px] text-muted">
                                        {strings.bookings.moreCount(dayEvents.length - 3)}
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
                            {sameDay(day, now) ? strings.bookings.todayPrefix : ""}
                            {formatFullDate(day)}
                        </div>
                        <div className="space-y-1">
                            {dayEvents.map((e) => (
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
                                        style={dotStyle(e.status)}
                                        className="h-2 w-2 shrink-0 rounded-full"
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

function AddBookingModal({ anchor, onClose }: { anchor: Date; onClose: () => void }) {
    const form = useBookingForm(api, onClose);
    const [date, setDate] = useState(() => dateKey(anchor));
    const [time, setTime] = useState("09:00");

    const submit = (e: SubmitEvent): void => {
        e.preventDefault();
        form.submit(combineDayAndTime(date, time));
    };

    return (
        <Modal onClose={onClose}>
            <form onSubmit={submit} className="space-y-3">
                <h2 className="text-lg font-semibold text-ink">{strings.bookings.newBooking}</h2>
                <Select
                    label={strings.bookings.client}
                    value={form.clientId}
                    options={[
                        { key: "", label: strings.bookings.selectClient },
                        ...form.clients.map((cl) => ({ key: cl.id, label: cl.name })),
                    ]}
                    onChange={form.setClientId}
                />
                <Select
                    label={strings.bookings.service}
                    value={form.itemId}
                    options={[
                        { key: "", label: strings.bookings.selectService },
                        ...form.items.map((it) => ({ key: it.id, label: it.name })),
                    ]}
                    onChange={form.setItemId}
                />
                {form.staff.length > 1 ? (
                    <Select
                        label={strings.bookings.staff}
                        value={form.effStaff}
                        options={form.staff.map((s) => ({ key: s.id, label: staffLabel(s) }))}
                        onChange={form.setStaffId}
                    />
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                    <TextField
                        label={strings.bookings.date}
                        type="date"
                        value={date}
                        onChange={setDate}
                    />
                    <TextField
                        label={strings.bookings.time}
                        type="time"
                        value={time}
                        onChange={setTime}
                    />
                </div>
                <Toggle
                    label={strings.bookings.repeatBooking}
                    value={form.repeat}
                    onChange={form.setRepeat}
                />
                {form.repeat ? (
                    <div className="grid grid-cols-[5rem_1fr_6rem] items-end gap-2">
                        <TextField
                            label={strings.bookings.every}
                            type="number"
                            value={String(form.interval)}
                            onChange={(v) => {
                                form.setInterval(Number(v));
                            }}
                        />
                        <Select
                            label={strings.bookings.frequency}
                            value={form.frequency}
                            options={RECUR_FREQUENCIES.map((f) => ({
                                key: f.value,
                                label: f.unit,
                            }))}
                            onChange={(f: RecurFrequency) => {
                                form.setFrequency(f);
                            }}
                        />
                        <TextField
                            label={strings.bookings.occurrences}
                            type="number"
                            value={String(form.count)}
                            onChange={(v) => {
                                form.setCount(Number(v));
                            }}
                        />
                    </div>
                ) : null}
                {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
                {form.notice !== null ? <Notice tone="success">{form.notice}</Notice> : null}
                <div className="flex justify-end gap-2 pt-1">
                    <Button variant="quiet" onPress={onClose}>
                        {strings.common.cancel}
                    </Button>
                    <Button submit busy={form.busy}>
                        {form.busy
                            ? strings.bookings.booking
                            : form.repeat
                              ? strings.bookings.bookSeries
                              : strings.bookings.book}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}

function EventDetail({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
    const { busy, error, cancel } = useCancelBooking(api, event, onClose);
    return (
        <DetailView
            open
            title={event.title}
            subtitle={event.subtitle.length > 0 ? event.subtitle : undefined}
            status={{ status: event.status, intent: statusIntent(event.status) }}
            onClose={onClose}
            actions={
                event.bookingId !== null && event.status !== "canceled" ? (
                    <Button variant="danger" onPress={cancel} busy={busy}>
                        {busy ? strings.bookings.canceling : strings.bookings.cancelBooking}
                    </Button>
                ) : undefined
            }
        >
            <p className="text-sm text-ink">
                {formatTime(event.start)} – {formatTime(event.end)}
            </p>
            {event.depositRequired ? <DepositSection event={event} onClose={onClose} /> : null}
            {event.bookingId !== null ? <AddonsSection event={event} /> : null}
            {error !== null ? <Notice tone="danger">{error}</Notice> : null}
        </DetailView>
    );
}

function AddonsSection({ event }: { event: CalendarEvent }) {
    const addons = useBookingAddons(api, event, useViewer());
    if (addons.addons.length === 0) return null;

    return (
        <DetailSection title={strings.bookings.addonsTitle}>
            <p className="text-xs text-muted">{strings.bookings.addonsNote}</p>
            <ul className="mt-2 divide-y divide-line-soft">
                {addons.addons.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
                        <span className="min-w-0 flex-1 truncate text-ink">
                            {a.quantity} × {a.description}
                        </span>
                        <span className="tabular-nums text-ink">
                            {formatMoney(a.quantity * a.unit_amount_cents)}
                        </span>
                        {addons.canEdit ? (
                            <Button
                                variant="danger"
                                size="sm"
                                disabled={addons.busy}
                                onPress={() => {
                                    addons.remove(a.id);
                                }}
                            >
                                {strings.bookings.addonRemove}
                            </Button>
                        ) : null}
                    </li>
                ))}
            </ul>
            {addons.invoiceId !== null ? (
                <p className="mt-2 text-xs text-muted">{strings.bookings.visitInvoiced}</p>
            ) : null}
            {addons.canInvoice ? (
                <div className="mt-3">
                    <Button variant="outline" disabled={addons.busy} onPress={addons.createInvoice}>
                        {strings.bookings.invoiceVisit}
                    </Button>
                </div>
            ) : null}
            {addons.error !== null ? <Notice tone="danger">{addons.error}</Notice> : null}
        </DetailSection>
    );
}

function DepositSection({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
    const viewer = useViewer();
    const cards = useSavedCards(event.clientId ?? "");
    const deposit = useCollectDeposit(api, event, onClose, cards.at(0)?.id);
    const amountLabel = formatMoney(event.depositAmountCents);

    return (
        <DetailSection
            title={strings.bookings.deposit}
            action={
                <StatusPill
                    status={event.depositStatus}
                    intent={depositStatusIntent(event.depositStatus)}
                />
            }
        >
            <Money cents={event.depositAmountCents} />
            {canCollectDeposit(event, viewer) ? (
                <ChargeSheet
                    checkout={deposit.checkout}
                    methods={checkoutMethods(cards)}
                    amountLabel={amountLabel}
                    submitLabel={strings.bookings.collectAmount(amountLabel)}
                    busyLabel={strings.bookings.collecting}
                    onSubmit={deposit.submit}
                    onCancel={onClose}
                />
            ) : null}
        </DetailSection>
    );
}
