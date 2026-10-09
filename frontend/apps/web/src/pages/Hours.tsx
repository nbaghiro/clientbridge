import {
    type AwayEntry,
    type AwayLength,
    type TeamHoursMember,
    type WeekCell,
    formatTime,
    formatWeekday,
    strings,
    useTeamWeek,
    useTimeOffForm,
    useWeekEditor,
} from "@clientbridge/app-core";
import {
    Avatar,
    Badge,
    Button,
    Choice,
    Empty,
    Icon,
    IconButton,
    Loading,
    LoadFailed,
    Modal,
    Notice,
    Panel,
    Select,
    Skeleton,
    TextField,
    WeeklyHoursEditor,
    DateField,
} from "@clientbridge/ui";
import { type SubmitEvent, useState } from "react";

import { api } from "../lib/api";
import { useViewer } from "../lib/auth";

const s = strings.hours;

/** The team's week at a glance with each person's hours, time off and closures, edited in dialogs. */
export function Hours() {
    const viewer = useViewer();
    const week = useTeamWeek(api, viewer);
    const [editing, setEditing] = useState<TeamHoursMember | null>(null);
    const [adding, setAdding] = useState<"time_off" | "closure" | null>(null);
    const waiting = week.load.state === "loading" || week.load.state === "error";

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="font-display text-lg font-semibold text-ink">{s.title}</h2>
                    <p className="mt-1 text-sm text-muted">
                        {week.canClose ? s.subtitle : s.ownOnly}
                    </p>
                </div>
                <div className="flex gap-2">
                    {week.canClose ? (
                        <Button
                            variant="outline"
                            onPress={() => {
                                setAdding("closure");
                            }}
                        >
                            {s.addClosure}
                        </Button>
                    ) : null}
                    <Button
                        onPress={() => {
                            setAdding("time_off");
                        }}
                    >
                        {s.addTimeOff}
                    </Button>
                </div>
            </div>

            <Panel
                flush
                title={s.teamHoursTitle}
                actions={
                    <div className="flex items-center gap-1">
                        <IconButton
                            icon="chevronLeft"
                            label={s.prevWeek}
                            size="sm"
                            onPress={() => {
                                week.shift(-1);
                            }}
                        />
                        <span className="min-w-[150px] text-center text-sm font-medium text-ink-soft">
                            {week.label}
                        </span>
                        <IconButton
                            icon="chevronRight"
                            label={s.nextWeek}
                            size="sm"
                            onPress={() => {
                                week.shift(1);
                            }}
                        />
                    </div>
                }
            >
                {week.load.state === "loading" ? (
                    <div className="p-5">
                        <Skeleton variant="row" count={3} label={s.loading} />
                    </div>
                ) : week.load.state === "error" ? (
                    <LoadFailed
                        message={s.loadError}
                        onRetry={week.load.retry}
                        retrying={week.load.retrying}
                    />
                ) : week.members.length === 0 ? (
                    <Empty icon="clock" message={s.noStaff} />
                ) : (
                    <div role="table" aria-label={s.teamHoursTitle} className="text-sm">
                        <div
                            role="row"
                            className="grid grid-cols-[minmax(170px,1.6fr)_repeat(7,minmax(0,1fr))] border-b border-line bg-head"
                        >
                            <span
                                role="columnheader"
                                className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted"
                            >
                                {s.teamMember}
                            </span>
                            {week.days.map((d) => (
                                <span
                                    key={d.key}
                                    role="columnheader"
                                    className={`border-l border-line-soft px-2 py-2 text-center ${d.closure ? "bg-danger-bg/40" : ""}`}
                                >
                                    <span
                                        className={`block text-[11px] font-semibold uppercase tracking-wide ${d.isToday ? "text-accent" : "text-muted"}`}
                                    >
                                        {d.weekday}
                                    </span>
                                    <span
                                        className={`block text-sm font-semibold tabular-nums ${d.isToday ? "text-accent" : "text-ink"}`}
                                    >
                                        {d.dayNumber}
                                    </span>
                                </span>
                            ))}
                        </div>
                        {week.members.map((m) => (
                            <button
                                key={m.id}
                                type="button"
                                role="row"
                                aria-label={s.rowLabel(m.name)}
                                disabled={!m.editable}
                                onClick={() => {
                                    setEditing(m);
                                }}
                                className="grid w-full grid-cols-[minmax(170px,1.6fr)_repeat(7,minmax(0,1fr))] border-b border-line-soft text-left transition last:border-b-0 enabled:hover:bg-bg"
                            >
                                <span
                                    role="cell"
                                    className="flex min-w-0 items-center gap-3 px-4 py-3"
                                >
                                    <Avatar name={m.name} color={m.color} size="sm" />
                                    <span className="min-w-0">
                                        <span className="block truncate font-medium text-ink">
                                            {m.name}
                                        </span>
                                        <span className="block truncate text-xs text-muted">
                                            {m.weeklyHours > 0
                                                ? s.perWeek(m.weeklyHours)
                                                : s.noHours}
                                        </span>
                                    </span>
                                </span>
                                {m.cells.map((cell, i) => (
                                    <span
                                        key={week.days[i]?.key ?? i}
                                        role="cell"
                                        className={`border-l border-line-soft p-1.5 ${week.days[i]?.closure ? "bg-danger-bg/40" : ""}`}
                                    >
                                        <Cell cell={cell} />
                                    </span>
                                ))}
                            </button>
                        ))}
                    </div>
                )}
                {week.load.state === "empty" ? (
                    <Empty
                        icon="clock"
                        message={s.emptyHours}
                        body={s.emptyHoursBody}
                        actions={
                            <Button
                                size="sm"
                                onPress={() => {
                                    setEditing(week.members[0] ?? null);
                                }}
                            >
                                {s.setHours}
                            </Button>
                        }
                    />
                ) : null}
            </Panel>

            {week.removeError !== null ? <Notice tone="danger">{week.removeError}</Notice> : null}
            {waiting ? null : (
                <div className="grid gap-6 lg:grid-cols-2">
                    <AwayPanel
                        title={s.timeOffTitle}
                        subtitle={s.timeOffHint}
                        entries={week.timeOff}
                        empty={s.noTimeOff}
                        removing={week.removing}
                        onRemove={week.removeAway}
                        person
                    />
                    <AwayPanel
                        title={s.closuresTitle}
                        subtitle={s.closuresHint}
                        entries={week.closures}
                        empty={s.noClosures}
                        removing={week.removing}
                        onRemove={week.canClose ? week.removeAway : null}
                    />
                </div>
            )}

            {editing !== null ? (
                <HoursModal
                    member={editing}
                    onClose={() => {
                        setEditing(null);
                    }}
                />
            ) : null}
            {adding !== null ? (
                <TimeOffModal
                    staffId={adding === "closure" ? "" : (viewer?.staffId ?? "")}
                    onClose={() => {
                        setAdding(null);
                    }}
                />
            ) : null}
        </div>
    );
}

function Cell({ cell }: { cell: WeekCell }) {
    if (cell.kind === "closed") {
        return (
            <span
                className="flex h-full min-h-9 flex-col items-center justify-center gap-0.5 rounded-md text-danger"
                title={cell.label}
            >
                <Icon name="lock" size={14} />
                <span className="max-w-full truncate text-[11px] font-medium">{cell.label}</span>
            </span>
        );
    }
    if (cell.kind === "away") {
        return (
            <span
                className="flex h-full min-h-9 flex-col items-center justify-center gap-0.5 rounded-md bg-warn-bg px-1 text-warn"
                title={cell.label}
            >
                <Icon name="moon" size={13} />
                <span className="max-w-full truncate text-[11px] font-medium">{cell.label}</span>
            </span>
        );
    }
    if (cell.kind === "off" || cell.kind === "unset") {
        return (
            <span className="flex h-full min-h-9 items-center justify-center text-xs text-muted">
                {cell.kind === "off" ? s.off : strings.bookings.dash}
            </span>
        );
    }
    return (
        <span className="flex h-full min-h-9 flex-col items-center justify-center rounded-md bg-accent-weak px-1 text-accent-strong">
            <span className="whitespace-nowrap text-[11px] font-semibold xl:text-xs">
                {cell.label}
            </span>
            {cell.partial !== null ? (
                <span className="max-w-full truncate text-[10px] text-warn" title={cell.partial}>
                    {cell.partial}
                </span>
            ) : null}
        </span>
    );
}

function AwayPanel({
    title,
    subtitle,
    entries,
    empty,
    removing,
    onRemove,
    person = false,
}: {
    title: string;
    subtitle: string;
    entries: AwayEntry[];
    empty: string;
    removing: string | null;
    onRemove: ((id: string) => void) | null;
    person?: boolean;
}) {
    return (
        <Panel flush title={title} subtitle={subtitle}>
            {entries.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted">{empty}</p>
            ) : (
                <ul className="divide-y divide-line-soft">
                    {entries.map((a) => (
                        <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                            {person ? (
                                <Avatar name={a.who} size="sm" />
                            ) : (
                                <span className="flex w-7 shrink-0 justify-center text-ink-soft">
                                    <Icon name="lock" size={20} />
                                </span>
                            )}
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium text-ink">
                                    {person ? `${a.who} · ${a.reason}` : a.reason}
                                </span>
                                <span className="block truncate text-xs text-muted">{a.when}</span>
                            </span>
                            {a.affected > 0 ? (
                                <Badge label={s.toMove(a.affected)} intent="warning" />
                            ) : null}
                            {onRemove !== null ? (
                                <IconButton
                                    icon="trash"
                                    size="sm"
                                    disabled={removing === a.id}
                                    label={s.removeLabel(`${a.reason}, ${a.when}`)}
                                    onPress={() => {
                                        onRemove(a.id);
                                    }}
                                />
                            ) : null}
                        </li>
                    ))}
                </ul>
            )}
        </Panel>
    );
}

function HoursModal({ member, onClose }: { member: TeamHoursMember; onClose: () => void }) {
    const editor = useWeekEditor(api, member.id);
    return (
        <Modal onClose={onClose} size="lg">
            <div className="space-y-4">
                <div className="flex items-center gap-3">
                    <Avatar name={member.name} color={member.color} />
                    <div>
                        <h2 className="font-display text-lg font-bold text-ink">
                            {s.editHoursFor(member.name)}
                        </h2>
                        <p className="text-sm text-muted">{s.regularHoursHint}</p>
                    </div>
                </div>
                {!editor.ready ? (
                    <Loading label={s.loading} />
                ) : (
                    <WeeklyHoursEditor
                        days={editor.days}
                        timeOptions={editor.timeOptions}
                        onOpen={editor.setOpen}
                        onTime={editor.setTime}
                        onCopy={editor.copyToWeekdays}
                        copyLabel={s.copyWeekdays}
                        closedLabel={s.closed}
                        toLabel={s.to}
                        hoursLabel={s.dayHours}
                    />
                )}
                {editor.error !== null ? <Notice tone="danger">{editor.error}</Notice> : null}
                {editor.saveMessage ? <Notice tone="info">{editor.saveMessage}</Notice> : null}
                {editor.discardRejected ? (
                    <Button variant="quiet" onPress={editor.discardRejected}>
                        {s.discardChanges}
                    </Button>
                ) : null}
                <div className="flex items-center justify-between gap-2 border-t border-line pt-4">
                    <span className="text-sm text-muted">
                        {s.daysOpen(editor.openDays)} · {s.weekTotal(editor.totalHours)}
                    </span>
                    <div className="flex gap-2">
                        <Button variant="quiet" onPress={onClose}>
                            {s.cancel}
                        </Button>
                        <Button busy={editor.busy} onPress={editor.submit} disabled={!editor.ready}>
                            {editor.busy ? s.saving : s.saveHours}
                        </Button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}

const LENGTHS: { key: AwayLength; label: string }[] = [
    { key: "day", label: s.lengthDay },
    { key: "days", label: s.lengthDays },
    { key: "week", label: s.lengthWeek },
    { key: "part", label: s.lengthPart },
];

/** Time off for one person or a closure for everyone, with the visits it leaves uncovered. */
function TimeOffModal({ staffId, onClose }: { staffId: string; onClose: () => void }) {
    const form = useTimeOffForm(api, useViewer(), onClose, staffId);
    const closure = form.staffId === "";
    const submit = (e: SubmitEvent): void => {
        e.preventDefault();
        form.submit();
    };
    return (
        <Modal onClose={onClose} size="lg">
            <form
                className="space-y-4"
                onSubmit={submit}
                aria-label={closure ? s.addClosure : s.addTimeOff}
            >
                <div>
                    <h2 className="font-display text-lg font-bold text-ink">
                        {closure ? s.addClosure : s.addTimeOff}
                    </h2>
                    <p className="mt-0.5 text-sm text-muted">
                        {closure ? s.closuresHint : s.timeOffHint}
                    </p>
                </div>
                <Select
                    label={s.who}
                    value={form.staffId}
                    options={form.staffOptions}
                    onChange={form.setStaffId}
                />
                <div className="space-y-1.5">
                    <p className="text-sm font-medium text-ink-soft">{s.length}</p>
                    <Choice
                        layout="segmented"
                        label={s.length}
                        options={LENGTHS}
                        value={form.length}
                        onChange={form.setLength}
                    />
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <DateField
                        label={form.length === "days" ? s.firstDay : s.date}
                        value={form.from}
                        onChange={form.setFrom}
                    />
                    {form.length === "days" ? (
                        <DateField
                            label={s.lastDay}
                            value={form.to}
                            min={form.from}
                            onChange={form.setTo}
                        />
                    ) : null}
                    {form.length === "part" ? (
                        <div className="grid grid-cols-2 gap-2">
                            <Select
                                label={s.startTime}
                                value={form.startTime}
                                options={form.timeOptions}
                                onChange={form.setStartTime}
                            />
                            <Select
                                label={s.endTime}
                                value={form.endTime}
                                options={form.timeOptions}
                                onChange={form.setEndTime}
                            />
                        </div>
                    ) : null}
                </div>
                <TextField
                    label={s.reason}
                    value={form.reason}
                    onChange={form.setReason}
                    placeholder={s.reasonPlaceholder}
                    hint={s.reasonHint}
                />

                <div className="rounded-md border border-line bg-bg px-4 py-3">
                    <p className="text-sm font-semibold text-ink">{form.summary}</p>
                    {form.affected.length === 0 ? (
                        <p className="mt-1 text-xs text-muted">{s.nothingBooked}</p>
                    ) : (
                        <>
                            <p className="mt-1 text-xs text-warn">{form.affectedNote}</p>
                            <ul className="mt-2 divide-y divide-line-soft">
                                {form.affected.map((e) => (
                                    <li
                                        key={e.id}
                                        className="flex items-center gap-3 py-1.5 text-sm"
                                    >
                                        <span
                                            aria-hidden
                                            className="h-6 w-1 rounded-full bg-accent"
                                            style={
                                                e.color !== null
                                                    ? { backgroundColor: e.color }
                                                    : undefined
                                            }
                                        />
                                        <span className="w-28 shrink-0 text-muted">
                                            {formatWeekday(e.start)} {formatTime(e.start)}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate text-ink">
                                            {e.headline}
                                        </span>
                                        <span className="truncate text-xs text-muted">
                                            {e.serviceName}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </div>
                {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
                <div className="flex justify-end gap-2">
                    <Button variant="quiet" onPress={onClose}>
                        {s.cancel}
                    </Button>
                    <Button submit busy={form.busy} disabled={!form.canSubmit}>
                        {form.busy ? s.saving : closure ? s.saveClosure : s.saveTimeOff}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
