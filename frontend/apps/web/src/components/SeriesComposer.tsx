import {
    type SeriesEnd,
    type SeriesFrequency,
    occurrenceRow,
    strings,
    useSeriesComposer,
} from "@clientbridge/app-core";
import {
    Button,
    Choice,
    Empty,
    Icon,
    Notice,
    OccurrenceList,
    PageHeader,
    Panel,
    Select,
    Stepper,
    Toggle,
    DateField,
} from "@clientbridge/ui";

import { api } from "../lib/api";
import { useViewer } from "../lib/auth";
import { useOpenLink } from "../lib/links";

const s = strings.recurrences;

const FREQS: { key: SeriesFrequency; label: string }[] = [
    { key: "week", label: s.weekly },
    { key: "month", label: s.monthly },
];
const ENDS: { key: SeriesEnd; label: string }[] = [
    { key: "count", label: s.endCount },
    { key: "until", label: s.endUntil },
];

/** A new repeating booking with every date checked before booking; finishing returns to the list. */
export function SeriesComposer({ onDone }: { onDone?: () => void }) {
    const f = useSeriesComposer(api, useViewer());
    const openLink = useOpenLink();
    return (
        <div className="mx-auto max-w-6xl space-y-6 px-8 py-8">
            <PageHeader title={s.newTitle} subtitle={s.newSubtitle} />
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
                <div className="space-y-6">
                    <Panel>
                        <Select
                            label={s.client}
                            value={f.clientId}
                            options={[{ key: "", label: s.pickClient }, ...f.clientOptions]}
                            onChange={f.setClientId}
                            hint={f.petName !== null ? s.pet(f.petName) : undefined}
                        />
                        <Select
                            label={s.service}
                            value={f.itemId}
                            options={[{ key: "", label: s.pickService }, ...f.serviceOptions]}
                            onChange={f.setItemId}
                        />
                        <Select
                            label={s.with}
                            value={f.staffId}
                            options={f.staffOptions}
                            onChange={f.setStaffId}
                        />
                        <div className="grid grid-cols-2 gap-3">
                            <DateField
                                label={s.firstVisit}
                                value={f.firstDay}
                                onChange={f.setFirstDay}
                            />
                            <Select
                                label={s.time}
                                value={f.time}
                                options={f.timeOptions}
                                onChange={f.setTime}
                            />
                        </div>
                    </Panel>
                    <Panel title={s.repeats}>
                        <Choice
                            layout="segmented"
                            label={s.repeats}
                            options={FREQS}
                            value={f.frequency}
                            onChange={f.setFrequency}
                        />
                        <div className="flex items-center gap-3 text-sm text-ink-soft">
                            <span className="w-14">{s.every}</span>
                            <Stepper
                                label={s.every}
                                value={f.interval}
                                min={1}
                                max={12}
                                onChange={f.setInterval}
                            />
                            <span>
                                {f.frequency === "week"
                                    ? s.weeksUnit(f.interval)
                                    : s.monthsUnit(f.interval)}
                            </span>
                        </div>
                        <div className="space-y-2 border-t border-line-soft pt-3">
                            <p className="text-sm font-medium text-ink-soft">{s.ends}</p>
                            <Choice
                                layout="segmented"
                                label={s.ends}
                                options={ENDS}
                                value={f.end}
                                onChange={f.setEnd}
                            />
                            {f.end === "count" ? (
                                <div className="flex items-center gap-3 pt-1 text-sm text-ink-soft">
                                    <Stepper
                                        label={s.endCountSuffix}
                                        value={f.count}
                                        min={2}
                                        max={60}
                                        onChange={f.setCount}
                                    />
                                    <span>{s.endCountSuffix}</span>
                                </div>
                            ) : (
                                <div className="max-w-xs pt-1">
                                    <DateField
                                        label={s.lastDate}
                                        value={f.until}
                                        min={f.firstDay}
                                        onChange={f.setUntil}
                                    />
                                </div>
                            )}
                            <p className="pt-1 text-xs text-muted">{s.endNeeded}</p>
                        </div>
                        <div className="border-t border-line-soft pt-3">
                            <Toggle
                                label={s.oneConfirmation}
                                hint={s.oneConfirmationHint}
                                value={f.oneConfirmation}
                                onChange={f.setOneConfirmation}
                            />
                        </div>
                    </Panel>
                </div>

                {f.done ? (
                    <Panel>
                        <div className="py-6 text-center">
                            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-ok-bg text-ok-fg">
                                <Icon name="check" size={24} />
                            </span>
                            <h2 className="mt-4 font-display text-xl font-bold text-ink">
                                {s.doneTitle}
                            </h2>
                            <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
                                {f.done.oneConfirmation
                                    ? s.doneBody(f.done.created, f.done.clientName)
                                    : s.doneBodyEach(f.done.created)}
                            </p>
                            {f.done.skipped > 0 ? (
                                <p className="mt-2 text-sm text-warn">
                                    {s.doneSkipped(f.done.skipped)}
                                </p>
                            ) : null}
                            <p className="mt-3 text-sm font-medium text-ink-soft">{f.pattern}</p>
                            <div className="mt-5 flex justify-center gap-2">
                                <Button variant="outline" onPress={f.reset}>
                                    {s.bookAnother}
                                </Button>
                                <Button
                                    onPress={
                                        onDone ??
                                        (() => {
                                            openLink("schedule");
                                        })
                                    }
                                >
                                    {onDone ? s.backToList : s.viewSchedule}
                                </Button>
                            </div>
                        </div>
                    </Panel>
                ) : (
                    <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-card lg:sticky lg:top-6">
                        <header className="border-b border-line px-5 py-4">
                            <h2 className="font-display text-base font-bold text-ink">{s.dates}</h2>
                            {f.summary !== "" ? (
                                <p className="mt-0.5 text-sm text-ink-soft">{f.summary}</p>
                            ) : null}
                            <p className="mt-0.5 text-xs text-muted">{s.datesHint}</p>
                        </header>
                        <div className="max-h-[440px] overflow-y-auto px-4">
                            {f.ready ? (
                                <OccurrenceList
                                    label={s.dates}
                                    rows={f.occurrences.map(occurrenceRow)}
                                    onAction={(key, action) => {
                                        f.resolve(key, action === "shift" ? "shift" : "skip");
                                    }}
                                />
                            ) : (
                                <div className="py-6">
                                    <Empty icon="repeat" message={s.datesHint} />
                                </div>
                            )}
                        </div>
                        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-head px-5 py-3">
                            <div className="min-w-0 text-sm">
                                <p className="font-medium text-ink">
                                    {s.countsLine(
                                        f.counts.booked,
                                        f.counts.moved,
                                        f.counts.skipped,
                                    )}
                                </p>
                                {f.counts.open > 0 ? (
                                    <p className="text-xs text-warn">{s.resolveFirst}</p>
                                ) : null}
                                {f.error !== null ? <Notice tone="danger">{f.error}</Notice> : null}
                            </div>
                            <Button busy={f.busy} disabled={!f.canSubmit} onPress={f.submit}>
                                {f.busy ? s.booking : s.book(f.counts.booked)}
                            </Button>
                        </footer>
                    </section>
                )}
            </div>
        </div>
    );
}
