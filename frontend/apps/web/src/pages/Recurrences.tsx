import {
    type ChangeScope,
    type SeriesRecord,
    occurrenceRow,
    strings,
    useSeriesList,
    useSeriesRecord,
} from "@clientbridge/app-core";
import {
    Avatar,
    Badge,
    Button,
    Choice,
    Empty,
    Icon,
    ListRow,
    LoadFailed,
    Modal,
    Notice,
    OccurrenceList,
    SearchField,
    Select,
    Skeleton,
    Toggle,
} from "@clientbridge/ui";
import { type ReactNode, useState } from "react";

import { ScheduleViews } from "../components/ScheduleViews";
import { SeriesComposer } from "../components/SeriesComposer";
import { api } from "../lib/api";
import { useLinkIntent } from "../lib/links";

const s = strings.recurrences;

const SCOPES: { key: ChangeScope; label: string }[] = [
    { key: "one", label: s.scopeOne },
    { key: "following", label: s.scopeFollowing },
    { key: "all", label: s.scopeAll },
];

export function Recurrences() {
    const list = useSeriesList();
    const [picked, setPicked] = useState<string | null>(null);
    const [composing, setComposing] = useState(false);
    useLinkIntent({
        onCreate: () => {
            setComposing(true);
        },
        onOpen: setPicked,
    });
    const openId = picked ?? list.rows[0]?.id ?? null;

    return (
        <div className="flex h-full">
            <section className="flex w-[300px] shrink-0 flex-col border-r border-line bg-surface xl:w-[380px]">
                <header className="space-y-3 border-b border-line px-5 pb-4 pt-6">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <h1 className="font-display text-2xl font-bold text-ink">
                                {s.listTitle}
                            </h1>
                            <p className="text-sm text-muted">{s.listSubtitle(list.counts.all)}</p>
                        </div>
                        <Button
                            size="sm"
                            icon="plus"
                            onPress={() => {
                                setComposing(true);
                            }}
                        >
                            {s.newShort}
                        </Button>
                    </div>
                    <ScheduleViews active="series" />
                    <SearchField value={list.q} onChange={list.setQ} placeholder={s.search} />
                    <Choice
                        label={s.filterAll}
                        options={[
                            { key: "all", label: s.filterAll },
                            {
                                key: "attention",
                                label: `${s.filterAttention} · ${String(list.counts.attention)}`,
                            },
                            {
                                key: "ending",
                                label: `${s.filterEnding} · ${String(list.counts.ending)}`,
                            },
                        ]}
                        value={list.filter}
                        onChange={list.setFilter}
                    />
                </header>
                <div className="flex-1 overflow-y-auto">
                    {list.load.state === "loading" ? (
                        <div className="p-5">
                            <Skeleton variant="row" count={5} label={s.loading} />
                        </div>
                    ) : list.load.state === "error" ? (
                        <div className="p-5">
                            <LoadFailed
                                message={s.loadError}
                                onRetry={list.load.retry}
                                retrying={list.load.retrying}
                            />
                        </div>
                    ) : list.load.state === "empty" ? (
                        <div className="p-5">
                            <Empty
                                icon="repeat"
                                message={s.emptyListTitle}
                                body={s.emptyList}
                                actions={
                                    <Button
                                        size="sm"
                                        onPress={() => {
                                            setComposing(true);
                                        }}
                                    >
                                        {s.newSeries}
                                    </Button>
                                }
                            />
                        </div>
                    ) : list.rows.length === 0 ? (
                        <div className="p-5">
                            <Empty message={s.emptySearch} />
                        </div>
                    ) : (
                        <div className="divide-y divide-line-soft">
                            {list.rows.map((r) => (
                                <ListRow
                                    key={r.id}
                                    selected={r.id === openId}
                                    leading={
                                        <span
                                            aria-hidden
                                            className="h-9 w-1 shrink-0 rounded-full bg-accent"
                                            style={
                                                r.serviceColor !== null
                                                    ? { backgroundColor: r.serviceColor }
                                                    : undefined
                                            }
                                        />
                                    }
                                    title={[r.petName, r.clientName].filter(Boolean).join(" · ")}
                                    detail={`${r.pattern} · ${r.nextLabel}`}
                                    meta={
                                        r.attention > 0 ? (
                                            <Badge
                                                label={s.needsDecision(r.attention)}
                                                intent="danger"
                                            />
                                        ) : r.ending ? (
                                            <Badge label={s.endingSoon} intent="warning" />
                                        ) : (
                                            r.progress
                                        )
                                    }
                                    onPress={() => {
                                        setPicked(r.id);
                                    }}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </section>
            <section className="min-w-0 flex-1 overflow-y-auto">
                {openId === null || !list.load.hasData ? (
                    <div className="flex h-full items-center justify-center">
                        <Empty message={s.selectSeries} />
                    </div>
                ) : (
                    <Record key={openId} id={openId} />
                )}
            </section>
            {composing ? (
                <Modal
                    size="xl"
                    onClose={() => {
                        setComposing(false);
                    }}
                >
                    <SeriesComposer
                        onDone={() => {
                            setComposing(false);
                        }}
                    />
                </Modal>
            ) : null}
        </div>
    );
}

function Record({ id }: { id: string }) {
    const rec = useSeriesRecord(api, id);
    const [dialog, setDialog] = useState<"change" | "cancel" | null>(null);
    if (rec === null) return null;
    const r = rec.summary;
    const upcoming = rec.dates.filter((d) => !d.past);
    const past = rec.dates.filter((d) => d.past);

    return (
        <div className="mx-auto max-w-3xl space-y-6 px-8 py-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                    <p className="text-sm text-muted">{r.serviceName}</p>
                    <h2 className="font-display text-xl font-bold text-ink">
                        {[r.petName, r.clientName].filter(Boolean).join(" · ")}
                    </h2>
                    <p className="mt-1 flex items-center gap-2 text-sm text-ink-soft">
                        <Icon name="repeat" size={15} />
                        {r.pattern}
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        disabled={rec.canceled || upcoming.length === 0}
                        onPress={() => {
                            setDialog("cancel");
                        }}
                    >
                        {s.cancelSeries}
                    </Button>
                    <Button
                        disabled={rec.canceled || upcoming.length === 0}
                        onPress={() => {
                            setDialog("change");
                        }}
                    >
                        {s.changeSeries}
                    </Button>
                </div>
            </div>

            {rec.canceled ? (
                <Notice tone="success" banner>
                    {s.canceledNote}
                </Notice>
            ) : null}
            {rec.saved !== null ? (
                <Notice tone="success" banner>
                    {rec.saved}
                </Notice>
            ) : null}
            {rec.error !== null && dialog === null ? (
                <Notice tone="danger">{rec.error}</Notice>
            ) : null}

            <div className="grid grid-cols-2 gap-4 rounded-lg border border-line bg-surface px-5 py-4 shadow-card xl:grid-cols-3">
                <Fact label={s.next} value={r.nextLabel} />
                <Fact
                    label={s.with}
                    value={
                        <span className="flex items-center gap-2">
                            <Avatar name={r.staffName} size="sm" />
                            {r.staffName}
                        </span>
                    }
                />
                <div className="col-span-2 min-w-0 xl:col-span-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted">
                        {s.colProgress}
                    </p>
                    <p className="mt-1 text-sm font-medium text-ink">{r.progress}</p>
                    {r.ratio !== null ? (
                        <div
                            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg"
                            role="progressbar"
                            aria-valuenow={Math.round(r.ratio * 100)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                        >
                            <div
                                className="h-full rounded-full bg-accent"
                                style={{ width: `${String(Math.round(r.ratio * 100))}%` }}
                            />
                        </div>
                    ) : null}
                    <p className="mt-1 text-xs text-muted">{r.endsLabel}</p>
                </div>
            </div>

            <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
                <header className="border-b border-line px-5 py-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                        {s.upcoming}
                    </h3>
                </header>
                <div className="px-4">
                    {upcoming.length === 0 ? (
                        <p className="py-6 text-center text-sm text-muted">{s.noneLeft}</p>
                    ) : (
                        <OccurrenceList
                            label={s.upcoming}
                            rows={upcoming.map((o) => occurrenceRow(o))}
                        />
                    )}
                </div>
                {past.length > 0 ? (
                    <>
                        <header className="border-y border-line bg-head px-5 py-2">
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                                {s.history}
                            </h3>
                        </header>
                        <div className="px-4">
                            <OccurrenceList
                                label={s.history}
                                rows={past.map((o) => occurrenceRow(o))}
                            />
                        </div>
                    </>
                ) : null}
            </section>

            {dialog === "change" ? (
                <ChangeDialog
                    rec={rec}
                    onClose={() => {
                        setDialog(null);
                    }}
                />
            ) : null}
            {dialog === "cancel" ? (
                <Modal
                    size="md"
                    onClose={() => {
                        setDialog(null);
                    }}
                >
                    <div className="space-y-4">
                        <h2 className="font-display text-lg font-bold text-ink">{s.cancelTitle}</h2>
                        <p className="text-sm text-ink-soft">{rec.cancelSummary}</p>
                        <Toggle
                            label={s.notifyClient}
                            value={rec.cancelNotify}
                            onChange={rec.setCancelNotify}
                        />
                        <div className="flex justify-end gap-2">
                            <Button
                                variant="quiet"
                                onPress={() => {
                                    setDialog(null);
                                }}
                            >
                                {s.keepSeries}
                            </Button>
                            <Button
                                variant="danger"
                                busy={rec.busy}
                                onPress={() => {
                                    rec.cancelSeries();
                                    setDialog(null);
                                }}
                            >
                                {s.confirmCancel}
                            </Button>
                        </div>
                    </div>
                </Modal>
            ) : null}
        </div>
    );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
            <div className="mt-1 truncate text-sm font-medium text-ink">{value}</div>
        </div>
    );
}

function ChangeDialog({ rec, onClose }: { rec: SeriesRecord; onClose: () => void }) {
    return (
        <Modal size="lg" onClose={onClose}>
            <div className="space-y-4">
                <div>
                    <h2 className="font-display text-lg font-bold text-ink">{s.changeSeries}</h2>
                    <p className="text-sm text-muted">{rec.summary.pattern}</p>
                </div>
                <div className="space-y-1.5">
                    <p className="text-sm font-medium text-ink-soft">{s.scope}</p>
                    <Choice
                        layout="segmented"
                        label={s.scope}
                        options={SCOPES}
                        value={rec.scope}
                        onChange={rec.setScope}
                    />
                </div>
                <div className="grid grid-cols-3 gap-3">
                    <Select
                        label={s.newDay}
                        value={rec.weekday}
                        options={rec.weekdayOptions}
                        onChange={rec.setWeekday}
                    />
                    <Select
                        label={s.newTime}
                        value={rec.time}
                        options={rec.timeOptions}
                        onChange={rec.setTime}
                    />
                    <Select
                        label={s.newWith}
                        value={rec.staffId}
                        options={rec.staffOptions}
                        onChange={rec.setStaffId}
                    />
                </div>
                <div className="rounded-md border border-line bg-bg">
                    <p className="border-b border-line px-4 py-2.5 text-sm font-medium text-ink">
                        {rec.changeSummary}
                    </p>
                    {rec.changed ? (
                        <div className="max-h-64 overflow-y-auto px-3">
                            <OccurrenceList
                                label={s.preview}
                                rows={rec.preview.map((o) => occurrenceRow(o))}
                            />
                        </div>
                    ) : null}
                </div>
                <div className="flex justify-end gap-2">
                    <Button variant="quiet" onPress={onClose}>
                        {s.cancel}
                    </Button>
                    <Button
                        busy={rec.busy}
                        disabled={!rec.changed}
                        onPress={() => {
                            rec.saveChange();
                            onClose();
                        }}
                    >
                        {s.saveChange}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
