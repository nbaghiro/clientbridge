import {
    type ClassRoster,
    type ClassSession,
    strings,
    useClassBoard,
    formatParts,
    firstName,
    kindWord,
    useSubjectKind,
} from "@clientbridge/app-core";
import {
    Avatar,
    Button,
    Empty,
    Icon,
    ListRow,
    LoadFailed,
    Meter,
    Modal,
    Notice,
    SearchField,
    Skeleton,
    Tabs,
    TextField,
} from "@clientbridge/ui";
import { INTENT_COLORS, cssVar } from "@clientbridge/tokens";
import { useState } from "react";

import { ProgramBoard } from "../components/ProgramBoard";
import { ProgramForm } from "../components/ProgramForm";
import { RosterAttendee } from "../components/RosterAttendee";
import { ScheduleFrame } from "../components/ScheduleViews";
import { SummaryStrip } from "../components/SummaryStrip";
import { api } from "../lib/api";
import { useOpenLink } from "../lib/links";

const s = strings.classes;

type ClassView = "sessions" | "programs";

export function Classes() {
    const board = useClassBoard(api);
    const roster = board.roster;
    const open = useOpenLink();
    const [messaging, setMessaging] = useState(false);
    const [sent, setSent] = useState<string | null>(null);
    const [view, setView] = useState<ClassView>("sessions");
    const [scheduling, setScheduling] = useState(false);
    const [scheduled, setScheduled] = useState<string | null>(null);
    const days = groupByDay(board.sessions);

    return (
        <ScheduleFrame
            active="classes"
            actions={
                <div className="flex items-center gap-2">
                    <Tabs
                        variant="pill"
                        label={s.title}
                        items={[
                            { key: "sessions", label: s.sessionsTab },
                            { key: "programs", label: strings.programs.tab },
                        ]}
                        active={view}
                        onSelect={setView}
                    />
                    {view === "programs" ? (
                        <Button
                            icon="plus"
                            onPress={() => {
                                setScheduled(null);
                                setScheduling(true);
                            }}
                        >
                            {strings.programs.newProgram}
                        </Button>
                    ) : (
                        <Button
                            icon="plus"
                            onPress={() => {
                                open("booking");
                            }}
                        >
                            {strings.bookings.newBooking}
                        </Button>
                    )}
                </div>
            }
        >
            {scheduling ? (
                <ProgramForm
                    onClose={() => {
                        setScheduling(false);
                    }}
                    onDone={(name) => {
                        setScheduling(false);
                        setScheduled(strings.programs.created(name));
                    }}
                />
            ) : null}
            {view === "programs" ? (
                <ProgramBoard
                    notice={scheduled}
                    onSchedule={() => {
                        setScheduling(true);
                    }}
                />
            ) : (
                <div className="relative flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-card">
                    {board.load.hasData && board.sessions.length === 0 ? null : (
                        <SummaryStrip items={board.summary} />
                    )}
                    {sent !== null ? (
                        <Notice tone="success" banner className="rounded-none">
                            {sent}
                        </Notice>
                    ) : null}
                    {board.load.state === "loading" ? (
                        <div className="min-h-0 flex-1 p-5">
                            <Skeleton variant="row" count={4} label={s.loading} />
                        </div>
                    ) : board.load.state === "error" ? (
                        <div className="min-h-0 flex-1 p-5">
                            <LoadFailed
                                message={s.loadError}
                                onRetry={board.load.retry}
                                retrying={board.load.retrying}
                            />
                        </div>
                    ) : board.sessions.length === 0 ? (
                        <div className="flex justify-center px-5 py-12">
                            <div className="w-[360px]">
                                <Empty
                                    variant="card"
                                    icon="users"
                                    message={s.emptyClasses}
                                    body={s.emptyClassesBody}
                                    actions={
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onPress={() => {
                                                open("catalog");
                                            }}
                                        >
                                            {strings.pos.desk.addCatalog}
                                        </Button>
                                    }
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="flex min-h-0 flex-1">
                            <nav
                                aria-label={s.upcoming}
                                className="w-72 shrink-0 overflow-y-auto border-r border-line"
                            >
                                {days.map((group) => (
                                    <div key={group.day}>
                                        <h2 className="sticky top-0 z-10 border-b border-line-soft bg-head px-4 py-1.5 text-xs font-semibold text-muted">
                                            {group.day}
                                        </h2>
                                        {group.sessions.map((x) => (
                                            <SessionRow
                                                key={x.slotId}
                                                x={x}
                                                on={x.slotId === board.selected}
                                                onPress={() => {
                                                    board.select(x.slotId);
                                                }}
                                            />
                                        ))}
                                    </div>
                                ))}
                            </nav>
                            <div className="min-w-0 flex-1 overflow-y-auto">
                                {roster === null ? (
                                    <Empty message={s.emptyRoster} />
                                ) : (
                                    <RosterPanel
                                        roster={roster}
                                        onMessage={() => {
                                            setSent(null);
                                            setMessaging(true);
                                        }}
                                    />
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {messaging && roster !== null ? (
                <Modal
                    size="sm"
                    onClose={() => {
                        setMessaging(false);
                    }}
                >
                    <MessageClass
                        title={s.messageClassTitle(roster.session.name, roster.session.when)}
                        hint={s.messageClassHint(roster.session.booked)}
                        busy={board.messaging}
                        error={board.messageError}
                        onSend={(body) => {
                            board.messageClass(body, (n) => {
                                setSent(s.messageSent(n));
                                setMessaging(false);
                            });
                        }}
                        onCancel={() => {
                            setMessaging(false);
                        }}
                    />
                </Modal>
            ) : null}
        </ScheduleFrame>
    );
}

function groupByDay(
    sessions: readonly ClassSession[],
): { day: string; sessions: ClassSession[] }[] {
    const groups: { day: string; sessions: ClassSession[] }[] = [];
    for (const x of sessions) {
        const last = groups.at(-1);
        if (last?.day === x.day) last.sessions.push(x);
        else groups.push({ day: x.day, sessions: [x] });
    }
    return groups;
}

// Laid out like a calendar card: a status bar on the left and the service colour as a dot.
function SessionRow({ x, on, onPress }: { x: ClassSession; on: boolean; onPress: () => void }) {
    const tone = INTENT_COLORS[x.intent];
    return (
        <button
            type="button"
            aria-current={on || undefined}
            onClick={onPress}
            className={`flex w-full gap-3 border-b border-line-soft px-4 py-3 text-left transition ${
                on ? "bg-accent-weak" : "hover:bg-bg"
            }`}
        >
            <span
                aria-hidden
                className="w-[3px] shrink-0 self-stretch rounded-full"
                style={{ backgroundColor: cssVar(tone.line) }}
            />
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                    {x.color !== null ? (
                        <span
                            aria-hidden
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: x.color }}
                        />
                    ) : null}
                    <span className="truncate text-sm font-semibold text-ink">{x.name}</span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted">
                    {formatParts([x.time, firstName(x.staffName)])}
                </span>
                <span className="mt-2 block">
                    <Meter
                        units
                        size="sm"
                        labelPosition="hidden"
                        value={x.booked}
                        max={x.capacity}
                        overflow={x.waitlist}
                        intent={x.full ? "warning" : "accent"}
                        label={s.seatsBooked(x.booked, x.capacity)}
                    />
                </span>
                <span
                    className={`mt-1.5 block text-xs font-medium ${
                        x.full ? "text-warn" : x.booked === 0 ? "text-muted" : "text-accent"
                    }`}
                >
                    {x.seatsLabel}
                </span>
                {x.room !== null ? (
                    <span className="mt-0.5 block text-xs text-muted">{x.room}</span>
                ) : null}
            </span>
        </button>
    );
}

function MessageClass({
    title,
    hint,
    busy,
    error,
    onSend,
    onCancel,
}: {
    title: string;
    hint: string;
    busy: boolean;
    error: string | null;
    onSend: (body: string) => void;
    onCancel: () => void;
}) {
    const [body, setBody] = useState("");
    return (
        <div className="space-y-4">
            <div>
                <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
                <p className="mt-1 text-sm text-muted">{hint}</p>
            </div>
            <TextField
                label={s.messageClassLabel}
                multiline
                rows={4}
                value={body}
                onChange={setBody}
                placeholder={s.messageClassPlaceholder}
                autoFocus
            />
            {error !== null ? <Notice tone="danger">{error}</Notice> : null}
            <div className="flex justify-end gap-2">
                <Button variant="outline" onPress={onCancel}>
                    {s.messageClassCancel}
                </Button>
                <Button
                    busy={busy}
                    disabled={body.trim() === ""}
                    onPress={() => {
                        onSend(body);
                    }}
                    icon="send"
                >
                    {s.messageClassSend}
                </Button>
            </div>
        </div>
    );
}

function RosterPanel({ roster, onMessage }: { roster: ClassRoster; onMessage: () => void }) {
    const kind = useSubjectKind();
    const x = roster.session;
    return (
        <section>
            <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-4">
                <div className="flex min-w-0 items-center gap-3">
                    <Icon name="users" size={24} className="shrink-0 text-ink-soft" />
                    <div className="min-w-0">
                        <h2 className="truncate font-display text-lg font-bold text-ink">
                            {x.name}
                        </h2>
                        <p className="truncate text-sm text-muted">{s.with(x.when, x.staffName)}</p>
                    </div>
                </div>
                <div className="flex items-start gap-4">
                    <div className="w-48">
                        <Meter
                            units
                            labelPosition="below"
                            value={x.booked}
                            max={x.capacity}
                            overflow={x.waitlist}
                            intent={x.full ? "warning" : "accent"}
                            label={formatParts([
                                s.seatsBooked(x.booked, x.capacity),
                                s.checkedIn(x.checkedIn, x.booked),
                            ])}
                        />
                    </div>
                    <Button variant="outline" size="sm" onPress={onMessage}>
                        {s.messageClass}
                    </Button>
                </div>
            </header>

            <div className="flex flex-wrap items-center gap-3 border-b border-line-soft bg-head px-5 py-3">
                {roster.programNote !== null ? (
                    <p className="min-w-[220px] flex-1 text-sm text-muted">{roster.programNote}</p>
                ) : (
                    <div className="relative min-w-[220px] flex-1">
                        <SearchField
                            value={roster.query}
                            onChange={roster.setQuery}
                            placeholder={s.addPlaceholder(kindWord(kind))}
                        />
                        {roster.matches.length > 0 ? (
                            <div className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-line bg-surface shadow-card">
                                {roster.matches.map((m) => (
                                    <ListRow
                                        key={m.key}
                                        density="compact"
                                        leading={<Avatar name={m.avatar} size="sm" />}
                                        title={m.title}
                                        meta={x.full ? s.waitlist : s.add}
                                        onPress={() => {
                                            roster.add(m.key);
                                        }}
                                    />
                                ))}
                            </div>
                        ) : null}
                    </div>
                )}
                <Button
                    variant="outline"
                    size="sm"
                    disabled={!roster.started}
                    busy={roster.busy}
                    onPress={roster.checkInAll}
                >
                    {s.checkInAll}
                </Button>
            </div>
            {roster.notice !== null ? (
                <div className="px-5 pt-3">
                    <Notice tone="info" banner>
                        {roster.notice}
                    </Notice>
                </div>
            ) : null}
            {!roster.started ? (
                <p className="px-5 pt-3 text-xs text-muted">{s.startsLater}</p>
            ) : null}

            <h3 className="px-5 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-muted">
                {s.roster}
            </h3>
            {roster.attendees.length === 0 ? (
                <p className="px-5 py-6 text-center text-sm text-muted">{s.emptyRoster}</p>
            ) : (
                <ul className="divide-y divide-line-soft">
                    {roster.attendees.map((a) => (
                        <RosterAttendee
                            key={a.key}
                            a={a}
                            started={roster.started}
                            actions={roster}
                        />
                    ))}
                </ul>
            )}

            {roster.programNote !== null ? null : (
                <div className="mt-2 border-t border-line">
                    <div className="flex items-baseline justify-between px-5 pb-1 pt-4">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                            {s.waitlist}
                        </h3>
                        <span className="text-xs text-muted">{s.waitlistHint}</span>
                    </div>
                    {roster.waitlist.length === 0 ? (
                        <p className="px-5 pb-5 pt-2 text-sm text-muted">{s.emptyWaitlist}</p>
                    ) : (
                        <ol className="divide-y divide-line-soft">
                            {roster.waitlist.map((w, i) => (
                                <li key={w.key} className="flex items-center gap-3 px-5 py-2.5">
                                    <span className="w-5 text-right text-xs tabular-nums text-muted">
                                        {i + 1}
                                    </span>
                                    <Avatar name={w.subjectName} size="sm" />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-medium text-ink">
                                            {w.subjectName}
                                            {strings.common.separator}
                                            <span className="font-normal text-muted">
                                                {w.clientName}
                                            </span>
                                        </span>
                                    </span>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onPress={() => {
                                            roster.promote(w.key);
                                        }}
                                    >
                                        {s.promote}
                                    </Button>
                                </li>
                            ))}
                        </ol>
                    )}
                </div>
            )}
            {roster.error !== null ? (
                <div className="px-5 pb-4">
                    <Notice tone="danger">{roster.error}</Notice>
                </div>
            ) : null}
        </section>
    );
}
