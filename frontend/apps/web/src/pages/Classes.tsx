import { type ClassRoster, type RosterEntry, strings, useClassBoard } from "@clientbridge/app-core";
import {
    Avatar,
    Badge,
    Button,
    Empty,
    Icon,
    ListRow,
    LoadFailed,
    Meter,
    Modal,
    Notice,
    PageHeader,
    SearchField,
    Skeleton,
    StatusPill,
    TextField,
} from "@clientbridge/ui";
import { tint } from "@clientbridge/tokens";
import { useState } from "react";

import { ScheduleViews } from "../components/ScheduleViews";
import { api } from "../lib/api";

const s = strings.classes;

export function Classes() {
    const board = useClassBoard(api);
    const roster = board.roster;
    const [messaging, setMessaging] = useState(false);
    const [sent, setSent] = useState<string | null>(null);

    return (
        <div className="mx-auto max-w-6xl space-y-6 px-8 py-8">
            <PageHeader
                title={s.title}
                subtitle={s.subtitle}
                actions={
                    <>
                        <ScheduleViews active="classes" />
                        <Button
                            variant="outline"
                            disabled={roster === null}
                            onPress={() => {
                                setSent(null);
                                setMessaging(true);
                            }}
                        >
                            {s.messageClass}
                        </Button>
                    </>
                }
            />
            {sent !== null ? <Notice tone="success">{sent}</Notice> : null}
            {board.load.state === "loading" ? (
                <div className="rounded-lg border border-line bg-surface p-5 shadow-card">
                    <Skeleton variant="row" count={4} label={s.loading} />
                </div>
            ) : board.load.state === "error" ? (
                <LoadFailed
                    variant="card"
                    message={s.loadError}
                    onRetry={board.load.retry}
                    retrying={board.load.retrying}
                />
            ) : board.sessions.length === 0 ? (
                <Empty
                    variant="card"
                    icon="users"
                    message={s.emptyClasses}
                    body={s.emptyClassesBody}
                />
            ) : (
                <div className="grid items-start gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
                    <nav
                        aria-label={s.upcoming}
                        className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-1"
                    >
                        <h2 className="col-span-full text-xs font-semibold uppercase tracking-wide text-muted">
                            {s.upcoming}
                        </h2>
                        {board.sessions.map((x) => {
                            const on = x.slotId === board.selected;
                            return (
                                <button
                                    key={x.slotId}
                                    type="button"
                                    aria-current={on || undefined}
                                    onClick={() => {
                                        board.select(x.slotId);
                                    }}
                                    className={`w-full rounded-lg border p-3.5 text-left transition ${
                                        on
                                            ? "border-accent bg-accent-weak"
                                            : "border-line bg-surface hover:bg-bg"
                                    }`}
                                >
                                    <span className="block truncate text-sm font-semibold text-ink">{`${x.day} · ${x.name}`}</span>
                                    <span className="mt-0.5 block truncate text-xs text-muted">
                                        {x.time} · {x.staffName.split(" ")[0]}
                                    </span>
                                    <span className="mt-2.5 block">
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
                                            x.full
                                                ? "text-warn"
                                                : x.booked === 0
                                                  ? "text-muted"
                                                  : "text-accent"
                                        }`}
                                    >
                                        {x.seatsLabel}
                                    </span>
                                </button>
                            );
                        })}
                    </nav>
                    {roster === null ? (
                        <Empty message={s.emptyRoster} />
                    ) : (
                        <RosterPanel roster={roster} />
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
        </div>
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

function RosterPanel({ roster }: { roster: ClassRoster }) {
    const x = roster.session;
    return (
        <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
            <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-4">
                <div className="flex min-w-0 items-center gap-3">
                    <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent-weak text-accent"
                        style={
                            x.color !== null
                                ? { backgroundColor: tint(x.color, 12), color: x.color }
                                : undefined
                        }
                    >
                        <Icon name="users" size={20} />
                    </span>
                    <div className="min-w-0">
                        <h2 className="truncate font-display text-lg font-bold text-ink">
                            {x.name}
                        </h2>
                        <p className="truncate text-sm text-muted">
                            {x.when} · {s.with(x.staffName, x.roomName)}
                        </p>
                    </div>
                </div>
                <div className="w-48">
                    <Meter
                        units
                        labelPosition="below"
                        value={x.booked}
                        max={x.capacity}
                        overflow={x.waitlist}
                        intent={x.full ? "warning" : "accent"}
                        label={`${s.seatsBooked(x.booked, x.capacity)} · ${s.checkedIn(x.checkedIn, x.booked)}`}
                    />
                </div>
            </header>

            <div className="flex flex-wrap items-center gap-3 border-b border-line-soft bg-head px-5 py-3">
                <div className="relative min-w-[220px] flex-1">
                    <SearchField
                        value={roster.query}
                        onChange={roster.setQuery}
                        placeholder={s.addPlaceholder}
                    />
                    {roster.matches.length > 0 ? (
                        <div className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-line bg-surface shadow-card">
                            {roster.matches.map((m) => (
                                <ListRow
                                    key={m.clientId}
                                    density="compact"
                                    leading={
                                        <Avatar name={m.pet === "" ? m.name : m.pet} size="sm" />
                                    }
                                    title={m.pet === "" ? m.name : `${m.pet} · ${m.name}`}
                                    meta={x.full ? s.waitlist : s.add}
                                    onPress={() => {
                                        roster.add(m.clientId);
                                    }}
                                />
                            ))}
                        </div>
                    ) : null}
                </div>
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
                        <Attendee key={a.key} a={a} roster={roster} />
                    ))}
                </ul>
            )}

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
                                <Avatar name={w.petName} size="sm" />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-medium text-ink">
                                        {w.petName} ·{" "}
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
            {roster.error !== null ? (
                <div className="px-5 pb-4">
                    <Notice tone="danger">{roster.error}</Notice>
                </div>
            ) : null}
        </section>
    );
}

function Attendee({ a, roster }: { a: RosterEntry; roster: ClassRoster }) {
    return (
        <li className="flex items-center gap-3 px-5 py-3">
            <Avatar name={a.petName} />
            <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm">
                    <span className="font-semibold text-ink">{a.petName}</span>
                    {a.petName !== a.clientName ? (
                        <span className="truncate text-muted">{a.clientName}</span>
                    ) : null}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <span className="truncate">{a.petDetail}</span>
                    {a.note !== null ? <Badge label={a.note} intent="warning" /> : null}
                    {a.paid ? null : <Badge label={s.unpaid} intent="danger" />}
                </p>
            </div>
            {a.status === "confirmed" && roster.started ? null : (
                <StatusPill status={a.statusLabel} intent={a.intent} asWritten />
            )}
            <div className="flex justify-end gap-1.5">
                {a.status === "confirmed" && roster.started ? (
                    <>
                        <Button
                            size="sm"
                            variant="quiet"
                            onPress={() => {
                                roster.noShow(a.key);
                            }}
                        >
                            {s.noShow}
                        </Button>
                        <Button
                            size="sm"
                            onPress={() => {
                                roster.checkIn(a.key);
                            }}
                        >
                            {s.checkIn}
                        </Button>
                    </>
                ) : a.status === "checked_in" || a.status === "no_show" ? (
                    <Button
                        size="sm"
                        variant="link"
                        onPress={() => {
                            roster.undo(a.key);
                        }}
                    >
                        {s.undo}
                    </Button>
                ) : null}
            </div>
        </li>
    );
}
