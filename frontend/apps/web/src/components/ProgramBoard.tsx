import {
    type Enrolment,
    type ProgramBoard as Board,
    formatParts,
    kindWord,
    strings,
    useProgramBoard,
    useSubjectKind,
} from "@clientbridge/app-core";
import {
    Avatar,
    Badge,
    Button,
    Choice,
    Empty,
    ListRow,
    LoadFailed,
    Meter,
    Notice,
    SearchField,
    Skeleton,
    confirm,
} from "@clientbridge/ui";

import { api } from "../lib/api";
import { RosterAttendee } from "./RosterAttendee";

const s = strings.programs;

/** Programs ahead, the selected one's days with each day's roster, and who is enrolled. */
export function ProgramBoard({
    notice,
    onSchedule,
}: {
    notice: string | null;
    onSchedule: () => void;
}) {
    const board = useProgramBoard(api);
    return (
        <div className="relative flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-card">
            {notice !== null ? (
                <Notice tone="success" banner className="rounded-none">
                    {notice}
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
            ) : board.programs.length === 0 ? (
                <div className="flex justify-center px-5 py-12">
                    <div className="w-[360px]">
                        <Empty
                            variant="card"
                            icon="calendar"
                            message={s.emptyTitle}
                            body={s.emptyBody}
                            actions={
                                <Button size="sm" variant="outline" onPress={onSchedule}>
                                    {s.newProgram}
                                </Button>
                            }
                        />
                    </div>
                </div>
            ) : (
                <div className="flex min-h-0 flex-1">
                    <nav
                        aria-label={s.tab}
                        className="w-72 shrink-0 overflow-y-auto border-r border-line"
                    >
                        {board.programs.map((p) => (
                            <ListRow
                                key={p.id}
                                title={p.name}
                                detail={formatParts([p.dates, p.time])}
                                meta={p.seatsLabel}
                                intent={p.intent}
                                selected={p.id === board.selected}
                                onPress={() => {
                                    board.select(p.id);
                                }}
                            />
                        ))}
                    </nav>
                    <div className="min-w-0 flex-1 overflow-y-auto">
                        <ProgramDetail board={board} />
                    </div>
                </div>
            )}
        </div>
    );
}

function ProgramDetail({ board }: { board: Board }) {
    const kind = useSubjectKind();
    const p = board.program;
    if (p === null) return null;
    const day = board.day;
    return (
        <section>
            <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-4">
                <div className="min-w-0">
                    <h2 className="truncate font-display text-lg font-bold text-ink">{p.name}</h2>
                    <p className="truncate text-sm text-muted">
                        {formatParts([p.dates, p.time, p.staffName])}
                    </p>
                    <p className="mt-1 text-sm text-ink-soft">
                        {formatParts([s.daysCount(p.days), p.price, s.enrolledCount(p.enrolled)])}
                    </p>
                </div>
                {board.canCancelProgram ? (
                    <Button
                        size="sm"
                        variant="outline"
                        busy={board.busy}
                        onPress={() => {
                            confirm({
                                title: s.cancelProgramTitle(p.name),
                                message: s.cancelProgramBody,
                                confirmLabel: s.cancelProgram,
                                cancelLabel: s.keep,
                                destructive: true,
                            })
                                .then((ok) => {
                                    if (ok) board.cancelProgram();
                                })
                                .catch(() => undefined);
                        }}
                    >
                        {s.cancelProgram}
                    </Button>
                ) : null}
            </header>

            {board.notice !== null ? (
                <div className="px-5 pt-3">
                    <Notice tone="info" banner>
                        {board.notice}
                    </Notice>
                </div>
            ) : null}
            {board.error !== null ? (
                <div className="px-5 pt-3">
                    <Notice tone="danger">{board.error}</Notice>
                </div>
            ) : null}

            <div className="space-y-2 border-b border-line-soft px-5 py-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {s.days}
                </h3>
                <Choice
                    layout="chips"
                    label={s.days}
                    options={board.days.map((d) => ({
                        key: d.slotId,
                        label: d.label,
                        hint: d.seatsLabel,
                    }))}
                    value={day?.slotId ?? null}
                    onChange={board.selectDay}
                />
            </div>

            {day !== null ? (
                <div className="border-b border-line">
                    <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-1 pt-4">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                            {s.dayRoster(day.label)}
                        </h3>
                        <div className="flex items-center gap-3">
                            <div className="w-40">
                                <Meter
                                    units
                                    size="sm"
                                    labelPosition="hidden"
                                    value={day.booked}
                                    max={day.capacity}
                                    intent={day.full ? "warning" : "accent"}
                                    label={strings.classes.seatsBooked(day.booked, day.capacity)}
                                />
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={!day.started}
                                busy={board.busy}
                                onPress={board.checkInAll}
                            >
                                {strings.classes.checkInAll}
                            </Button>
                        </div>
                    </div>
                    {!day.started ? (
                        <p className="px-5 pt-1 text-xs text-muted">{s.startsLater}</p>
                    ) : null}
                    {board.attendees.length === 0 ? (
                        <p className="px-5 py-6 text-center text-sm text-muted">{s.emptyDay}</p>
                    ) : (
                        <ul className="divide-y divide-line-soft">
                            {board.attendees.map((a) => (
                                <RosterAttendee
                                    key={a.key}
                                    a={a}
                                    started={day.started}
                                    actions={board}
                                />
                            ))}
                        </ul>
                    )}
                </div>
            ) : null}

            <div className="px-5 pb-5 pt-4">
                <h3 className="pb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                    {s.enrolments}
                </h3>
                <div className="relative">
                    <SearchField
                        value={board.query}
                        onChange={board.setQuery}
                        placeholder={s.enrolPlaceholder(kindWord(kind))}
                    />
                    {board.matches.length > 0 ? (
                        <div className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-line bg-surface shadow-card">
                            {board.matches.map((m) => (
                                <ListRow
                                    key={m.key}
                                    density="compact"
                                    leading={<Avatar name={m.avatar} size="sm" />}
                                    title={m.title}
                                    meta={s.enrol}
                                    onPress={() => {
                                        board.enrol(m.key);
                                    }}
                                />
                            ))}
                        </div>
                    ) : null}
                </div>
                {board.enrolments.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted">{s.emptyEnrolments}</p>
                ) : (
                    <ul className="mt-2 divide-y divide-line-soft">
                        {board.enrolments.map((e) => (
                            <EnrolmentRow key={e.key} e={e} board={board} />
                        ))}
                    </ul>
                )}
            </div>
        </section>
    );
}

function EnrolmentRow({ e, board }: { e: Enrolment; board: Board }) {
    return (
        <li className="flex items-center gap-3 py-3">
            <Avatar name={e.name} />
            <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm">
                    <span className="font-semibold text-ink">{e.name}</span>
                    {e.name !== e.clientName ? (
                        <span className="truncate text-muted">{e.clientName}</span>
                    ) : null}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <span>{formatParts([e.attending, e.away])}</span>
                    {e.paid ? null : <Badge label={strings.classes.unpaid} intent="danger" />}
                </p>
                {e.pickup !== null ? (
                    <p className="mt-0.5 truncate text-xs text-muted">{e.pickup}</p>
                ) : null}
            </div>
            {e.upcoming ? (
                <Button
                    size="sm"
                    variant="quiet"
                    onPress={() => {
                        confirm({
                            title: s.cancelEnrolmentTitle(e.name),
                            message: s.cancelEnrolmentBody,
                            confirmLabel: s.cancelEnrolment,
                            cancelLabel: s.keep,
                            destructive: true,
                        })
                            .then((ok) => {
                                if (ok) board.cancelEnrolment(e.key);
                            })
                            .catch(() => undefined);
                    }}
                >
                    {s.cancelEnrolment}
                </Button>
            ) : null}
        </li>
    );
}
