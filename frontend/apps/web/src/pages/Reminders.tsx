import {
    type ScheduleEvent,
    formatTime,
    formatWeekday,
    strings,
    useReminderSettings,
} from "@clientbridge/app-core";
import {
    Button,
    Checkbox,
    Choice,
    LoadFailed,
    MessageBubble,
    Notice,
    Panel,
    Skeleton,
    Stat,
} from "@clientbridge/ui";
import { useState } from "react";

import { api } from "../lib/api";

const s = strings.reminders;

/** The reminder every visit gets, word for word, and the visits still open at the end of the day. */
export function Reminders() {
    const r = useReminderSettings(api);
    const [channel, setChannel] = useState<"sms" | "email">("sms");

    if (r.load.state === "loading") {
        return (
            <Panel flush>
                <div className="p-5">
                    <Skeleton variant="row" count={5} label={s.loading} />
                </div>
            </Panel>
        );
    }
    if (r.load.state === "error") {
        return (
            <LoadFailed
                variant="card"
                message={s.loadError}
                onRetry={r.load.retry}
                retrying={r.load.retrying}
            />
        );
    }

    return (
        <div className="space-y-6">
            <p className="text-sm text-muted">{s.subtitle}</p>
            <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
                <div className="space-y-6">
                    <Panel title={s.remindersTitle} subtitle={s.remindersHint}>
                        <div className="rounded-md border border-line px-3 py-2.5">
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                                <span className="text-sm font-semibold text-ink">{s.ruleLead}</span>
                                <Checkbox label={s.channelSms} value disabled />
                                <Checkbox label={s.channelEmail} value disabled />
                            </div>
                            <p className="mt-1 text-xs text-muted">{s.channelsHint}</p>
                        </div>
                        <Notice tone="info" banner>
                            {s.rulesFixed}
                        </Notice>
                        <div className="border-t border-line-soft pt-3">
                            <p className="text-sm font-medium text-ink">{s.includeLink}</p>
                            <p className="text-xs text-muted">{s.includeLinkHint}</p>
                        </div>
                    </Panel>
                    <Panel title={s.endOfDayTitle} subtitle={s.endOfDayHint}>
                        <Notice tone="info" banner>
                            {s.autoCloseLater}
                        </Notice>
                        <p className="text-sm font-semibold text-ink">
                            {s.openToday(r.openToday.length)}
                        </p>
                        <OpenVisits visits={r.openToday} r={r} />
                        {r.openEarlier.length > 0 ? (
                            <div className="border-t border-line-soft pt-4">
                                <p className="text-sm font-semibold text-ink">{s.openEarlier}</p>
                                <OpenVisits visits={r.openEarlier} r={r} />
                            </div>
                        ) : r.openToday.length === 0 ? (
                            <p className="text-sm text-muted">{s.noneOpen}</p>
                        ) : null}
                        {r.error !== null ? <Notice tone="danger">{r.error}</Notice> : null}
                    </Panel>
                </div>
                <div className="space-y-6 xl:sticky xl:top-6">
                    <Panel
                        title={s.preview}
                        subtitle={r.preview !== null ? s.previewVisit(r.preview.who) : undefined}
                        actions={
                            <Choice
                                layout="segmented"
                                label={s.preview}
                                options={[
                                    { key: "sms" as const, label: s.channelSms },
                                    { key: "email" as const, label: s.channelEmail },
                                ]}
                                value={channel}
                                onChange={setChannel}
                            />
                        }
                    >
                        {r.previewLoading ? (
                            <Skeleton variant="line" count={3} label={s.loading} />
                        ) : r.preview === null ? (
                            <p className="text-sm text-muted">{s.previewNone}</p>
                        ) : channel === "sms" ? (
                            <div className="rounded-lg bg-bg p-4">
                                <MessageBubble
                                    direction="in"
                                    width="full"
                                    body={r.preview.body}
                                    meta={r.preview.sendsAt}
                                />
                            </div>
                        ) : (
                            <div className="overflow-hidden rounded-lg border border-line">
                                <p className="border-b border-line bg-head px-4 py-2.5 text-sm font-semibold text-ink">
                                    {r.preview.subject}
                                </p>
                                <p className="px-4 py-4 text-sm leading-relaxed text-ink-soft">
                                    {r.preview.body}
                                </p>
                                <p className="border-t border-line px-4 py-2 text-xs text-muted">
                                    {r.preview.sendsAt}
                                </p>
                            </div>
                        )}
                    </Panel>
                    <Panel title={s.deliveryTitle}>
                        <Stat label={s.sent} value={s.sentCount(r.sentWeek)} />
                    </Panel>
                </div>
            </div>
        </div>
    );
}

function OpenVisits({
    visits,
    r,
}: {
    visits: ScheduleEvent[];
    r: ReturnType<typeof useReminderSettings>;
}) {
    if (visits.length === 0) return null;
    return (
        <ul className="divide-y divide-line-soft rounded-md border border-line">
            {visits.map((v) => (
                <li key={v.id} className="flex items-center gap-3 px-3 py-2.5">
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                            {v.headline}
                        </span>
                        <span className="block truncate text-xs text-muted">
                            {`${v.serviceName} · ${formatWeekday(v.start)} ${formatTime(v.start)} · ${v.staffShort}`}
                        </span>
                    </span>
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={r.closing === v.id}
                        onPress={() => {
                            r.close(v, "no_show");
                        }}
                    >
                        {s.noShow}
                    </Button>
                    <Button
                        size="sm"
                        busy={r.closing === v.id}
                        onPress={() => {
                            r.close(v, "completed");
                        }}
                    >
                        {s.complete}
                    </Button>
                </li>
            ))}
        </ul>
    );
}
