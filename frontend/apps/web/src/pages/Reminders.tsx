import {
    type ScheduleEvent,
    strings,
    useReminderSettings,
    useBusinessZone,
    formatParts,
    formatWeekdayTime,
} from "@clientbridge/app-core";
import {
    Button,
    Choice,
    MessageBubble,
    Notice,
    PageHeader,
    Panel,
    Skeleton,
    Stat,
} from "@clientbridge/ui";
import { useState } from "react";

import { api } from "../lib/api";
import { Loaded } from "../components/Loaded";

const s = strings.reminders;

/** The reminder every visit gets, word for word, and the visits still open at the end of the day. */
export function Reminders() {
    const r = useReminderSettings(api);
    const [channel, setChannel] = useState<"sms" | "email">("sms");

    return (
        <div className="space-y-6">
            <PageHeader title={strings.navigation.setupSections.reminders} subtitle={s.subtitle} />
            <Loaded load={r.load} loading={s.loading} failed={s.loadError} rows={5}>
                <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
                    <div className="space-y-6">
                        <Panel title={s.remindersTitle} subtitle={s.remindersHint}>
                            <p className="text-sm text-ink-soft">{s.rule}</p>
                            {r.manageLink ? (
                                <p className="text-sm text-ink-soft">{s.includeLink}</p>
                            ) : null}
                        </Panel>
                        <Panel
                            title={s.endOfDayTitle}
                            subtitle={r.autoComplete ? s.endOfDayAuto : s.endOfDayHint}
                        >
                            <p className="text-sm font-semibold text-ink">
                                {s.openToday(r.openToday.length)}
                            </p>
                            <OpenVisits visits={r.openToday} r={r} />
                            {r.openEarlier.length > 0 ? (
                                <div className="border-t border-line-soft pt-4">
                                    <p className="text-sm font-semibold text-ink">
                                        {s.openEarlier}
                                    </p>
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
                            subtitle={
                                r.preview !== null ? s.previewVisit(r.preview.who) : undefined
                            }
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
            </Loaded>
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
    const zone = useBusinessZone();
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
                            {formatParts([
                                v.serviceName,
                                formatWeekdayTime(v.start, zone),
                                v.staffShort,
                            ])}
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
