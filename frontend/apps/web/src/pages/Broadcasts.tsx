import {
    type BroadcastDraft,
    type BroadcastItem,
    type BroadcastSeed,
    type Channel,
    broadcastIntent,
    broadcastWhen,
    formatDate,
    parseTimestamp,
    strings,
    useBroadcastActions,
    useBroadcastDraft,
    useBroadcastsHome,
    dateKey,
} from "@clientbridge/app-core";
import {
    Avatar,
    Button,
    Choice,
    DetailSection,
    DetailView,
    Empty,
    Field,
    Icon,
    KeyValueList,
    ListPage,
    MessageBubble,
    Notice,
    Panel,
    Stat,
    StatusPill,
    TextField,
    confirm,
    DateTimeField,
} from "@clientbridge/ui";
import { useState } from "react";

import { Loaded } from "../components/Loaded";
import { api } from "../lib/api";
import { useOpenLink } from "../lib/links";

const s = strings.broadcasts;
const CHANNELS: { key: Channel; label: string }[] = [
    { key: "sms", label: s.channels.sms ?? "" },
    { key: "email", label: s.channels.email ?? "" },
];
const ALL = "__all";
const grid =
    "grid grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1.5fr)_minmax(0,1fr)] items-center gap-4";

const dateOf = (value: string): string => (value === "" ? "" : formatDate(parseTimestamp(value)));

function download(filename: string, content: string): void {
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export function Broadcasts() {
    const [composing, setComposing] = useState<BroadcastSeed | null>(null);
    if (composing !== null)
        return (
            <Composer
                seed={composing}
                onDone={() => {
                    setComposing(null);
                }}
            />
        );
    return (
        <BroadcastsHome
            onCompose={(seed) => {
                setComposing(seed);
            }}
        />
    );
}

function BroadcastsHome({ onCompose }: { onCompose: (seed: BroadcastSeed) => void }) {
    const home = useBroadcastsHome();
    const actions = useBroadcastActions(api, download);
    const [openId, setOpenId] = useState<string | null>(null);
    const open = home.broadcasts.find((x) => x.id === openId) ?? null;
    const duplicate = (item: BroadcastItem): void => {
        setOpenId(null);
        onCompose({
            name: s.copyOf(item.name),
            body: item.body ?? "",
            tags: item.tags,
            channel: item.channel === "email" ? "email" : "sms",
        });
    };
    const cancelSend = (item: BroadcastItem): void => {
        confirm({
            title: s.cancelScheduleTitle,
            message: s.cancelScheduleBody,
            confirmLabel: s.cancelSchedule,
            cancelLabel: s.keepScheduled,
            destructive: true,
        })
            .then((ok) => {
                if (ok) actions.cancel(item.id);
            })
            .catch(() => undefined);
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-4">
                <p className="text-sm text-muted">{s.subtitle}</p>
                <Button
                    icon="plus"
                    onPress={() => {
                        onCompose({ name: "", body: "", tags: [], channel: "sms" });
                    }}
                >
                    {s.newBroadcast}
                </Button>
            </div>
            {actions.error !== null ? <Notice tone="danger">{actions.error}</Notice> : null}
            {actions.exported !== null ? (
                <Notice tone="success">{s.exported(actions.exported)}</Notice>
            ) : null}
            <Loaded load={home.load} loading={s.loading} failed={s.loadError}>
                <div className="space-y-6">
                    <div className="grid grid-cols-3 gap-4">
                        <Stat
                            label={s.reachText}
                            value={String(home.reach.sms)}
                            hint={s.reachOf(home.reach.total)}
                        />
                        <Stat
                            label={s.reachEmail}
                            value={String(home.reach.email)}
                            hint={s.reachOf(home.reach.total)}
                        />
                        <Stat
                            label={s.reachOut}
                            value={String(home.reach.optedOut)}
                            tone={home.reach.optedOut > 0 ? "danger" : "ink"}
                            hint={s.reachOf(home.reach.total)}
                        />
                    </div>
                    <ListPage
                        head={
                            <div className={grid}>
                                <span>{s.colBroadcast}</span>
                                <span>{s.colAudience}</span>
                                <span>{s.colResult}</span>
                                <span className="text-right">{s.colWhen}</span>
                            </div>
                        }
                        rows={home.broadcasts}
                        rowKey={(x) => x.id}
                        onRowPress={(x) => {
                            setOpenId(x.id);
                        }}
                        empty={s.noBroadcasts}
                        renderRow={(x) => (
                            <div className={grid}>
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="truncate font-medium text-ink">
                                            {x.name}
                                        </span>
                                        <StatusPill
                                            status={s.status[x.status] ?? x.status}
                                            intent={broadcastIntent(x.status)}
                                            asWritten
                                        />
                                    </div>
                                    <div className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                                        <Icon
                                            name={x.channel === "sms" ? "phoneDevice" : "mail"}
                                            size={12}
                                        />
                                        {s.viaChannel(s.channels[x.channel] ?? x.channel)}
                                    </div>
                                </div>
                                <div className="min-w-0">
                                    <div className="truncate text-sm text-ink-soft">
                                        {s.audienceTags(x.tags)}
                                    </div>
                                    <div className="text-xs text-muted">
                                        {s.recipientsLine(x.recipient_count, x.excluded_count)}
                                    </div>
                                </div>
                                {x.status === "sent" ? (
                                    <div className="min-w-0">
                                        <div className="truncate text-sm text-ink-soft">
                                            {s.delivered(x.delivered_count)}
                                        </div>
                                        <div className="truncate text-xs text-muted">
                                            {[
                                                s.replies(x.reply_count),
                                                x.opt_out_count > 0
                                                    ? s.optOutsCount(x.opt_out_count)
                                                    : null,
                                            ]
                                                .filter((v) => v !== null)
                                                .join(" · ")}
                                        </div>
                                    </div>
                                ) : (
                                    <span className="text-sm text-muted">—</span>
                                )}
                                <div className="text-right text-sm text-ink-soft">
                                    {broadcastWhen(x)}
                                </div>
                            </div>
                        )}
                    />
                    <div className="grid gap-6 lg:grid-cols-2">
                        <Panel
                            title={s.optOutsTitle}
                            subtitle={s.optOutsSubtitle}
                            flush
                            actions={
                                <Button
                                    size="sm"
                                    variant="outline"
                                    busy={actions.busy}
                                    onPress={actions.exportLog}
                                >
                                    {s.exportLog}
                                </Button>
                            }
                        >
                            {home.optOuts.length === 0 ? (
                                <Empty message={s.noOptOuts} />
                            ) : (
                                <ul className="divide-y divide-line-soft">
                                    {home.optOuts.map((o) => (
                                        <li
                                            key={`${o.clientId}-${o.channel}`}
                                            className="flex items-center gap-3 px-4 py-2.5"
                                        >
                                            <Avatar name={o.name} size="sm" />
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-sm font-medium text-ink">
                                                    {o.name}
                                                </div>
                                                <div className="truncate text-xs text-muted">
                                                    {s.consentSource(o.source, dateOf(o.at))}
                                                </div>
                                            </div>
                                            <StatusPill
                                                status={s.consentChannel[o.channel] ?? o.channel}
                                                intent="danger"
                                                asWritten
                                            />
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </Panel>
                        <Panel title={s.impliedTitle} subtitle={s.impliedSubtitle} flush>
                            {home.implied.length === 0 ? (
                                <Empty message={s.noImplied} />
                            ) : (
                                <ul className="divide-y divide-line-soft">
                                    {home.implied.map((o) => (
                                        <li
                                            key={`${o.clientId}-${o.channel}`}
                                            className="flex items-center gap-3 px-4 py-2.5"
                                        >
                                            <Avatar name={o.name} size="sm" />
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-sm font-medium text-ink">
                                                    {o.name}
                                                </div>
                                                <div className="truncate text-xs text-muted">
                                                    {s.consentChannel[o.channel]} ·{" "}
                                                    {s.endsOn(dateOf(o.expires))}
                                                </div>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </Panel>
                    </div>
                </div>
            </Loaded>
            {open !== null ? (
                <DetailView
                    open
                    title={open.name}
                    subtitle={`${s.viaChannel(s.channels[open.channel] ?? open.channel)} · ${broadcastWhen(open)}`}
                    status={{
                        status: s.status[open.status] ?? open.status,
                        intent: broadcastIntent(open.status),
                    }}
                    onClose={() => {
                        setOpenId(null);
                    }}
                    actions={
                        open.status === "scheduled" ? (
                            <Button
                                variant="danger"
                                busy={actions.busy}
                                onPress={() => {
                                    cancelSend(open);
                                }}
                            >
                                {s.cancelSchedule}
                            </Button>
                        ) : (
                            <Button
                                variant="outline"
                                onPress={() => {
                                    duplicate(open);
                                }}
                            >
                                {s.duplicate}
                            </Button>
                        )
                    }
                >
                    <DetailSection title={s.resultsTitle}>
                        <KeyValueList
                            layout="stack"
                            columns={open.status === "sent" ? 3 : 2}
                            rows={[
                                { label: s.statRecipients, value: String(open.recipient_count) },
                                { label: s.statLeftOut, value: String(open.excluded_count) },
                                ...(open.status === "sent"
                                    ? [
                                          {
                                              label: s.statDelivered,
                                              value: String(open.delivered_count),
                                          },
                                          { label: s.statReplies, value: String(open.reply_count) },
                                          {
                                              label: s.statOptOuts,
                                              value: String(open.opt_out_count),
                                          },
                                      ]
                                    : []),
                            ]}
                        />
                    </DetailSection>
                    <DetailSection title={s.colAudience}>
                        <p className="text-sm text-ink-soft">{s.audienceTags(open.tags)}</p>
                    </DetailSection>
                    <DetailSection title={s.messageTitle}>
                        <p className="whitespace-pre-wrap rounded-md border border-line bg-bg px-4 py-3 text-sm leading-relaxed text-ink-soft">
                            {open.body}
                            <span className="mt-2 block text-xs text-muted">
                                {open.channel === "sms" ? s.optOutSms : s.optOutEmail}
                            </span>
                        </p>
                    </DetailSection>
                </DetailView>
            ) : null}
        </div>
    );
}

function Composer({ seed, onDone }: { seed: BroadcastSeed; onDone: () => void }) {
    const draft = useBroadcastDraft(api, seed);
    const n = draft.load.hasData ? draft.audience.recipients.length : 0;
    const send = (): void => {
        if (draft.schedule === "later") {
            draft.submit();
            return;
        }
        confirm({ title: s.confirmTitle(n), message: s.confirmBody, confirmLabel: s.confirmSend })
            .then((ok) => {
                if (ok) draft.submit();
            })
            .catch(() => undefined);
    };

    if (draft.sent !== null)
        return (
            <div className="mx-auto max-w-lg py-16 text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-ok-bg text-ok-fg">
                    <Icon name={draft.sent.scheduled ? "clock" : "check"} size={22} />
                </span>
                <h2 className="mt-4 font-display text-2xl font-bold text-ink">
                    {draft.sent.scheduled ? s.scheduledTitle : s.sentTitle}
                </h2>
                <p className="mt-2 text-sm text-muted">{s.sentBody(draft.sent.count)}</p>
                <div className="mt-6 flex justify-center gap-2">
                    <Button variant="outline" onPress={draft.reset}>
                        {s.newAnother}
                    </Button>
                    <Button onPress={onDone}>{s.sentDone}</Button>
                </div>
            </div>
        );

    return (
        <div>
            <Button variant="link" icon="chevronLeft" onPress={onDone}>
                {s.back}
            </Button>
            <h2 className="mt-2 font-display text-xl font-bold text-ink">{s.newBroadcast}</h2>
            <div className="mt-5 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_340px]">
                <div className="space-y-5">
                    <Panel>
                        <div className="space-y-4">
                            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                                <TextField
                                    label={s.nameLabel}
                                    hint={s.nameHint}
                                    value={draft.name}
                                    onChange={draft.setName}
                                    placeholder={s.namePlaceholder}
                                />
                                <Field label={s.channelPick}>
                                    <Choice
                                        layout="segmented"
                                        label={s.channelPick}
                                        options={CHANNELS}
                                        value={draft.channel}
                                        onChange={draft.setChannel}
                                    />
                                </Field>
                            </div>
                            <AudiencePicker draft={draft} />
                        </div>
                    </Panel>
                    <Panel>
                        <div className="space-y-3">
                            <TextField
                                label={s.messageLabel}
                                multiline
                                rows={5}
                                value={draft.body}
                                onChange={draft.setBody}
                                placeholder={s.messagePlaceholder}
                                hint={
                                    draft.channel === "sms"
                                        ? s.smsCount(draft.segments.chars, draft.segments.segments)
                                        : undefined
                                }
                            />
                            <OptOutLine channel={draft.channel} />
                        </div>
                    </Panel>
                    <Panel>
                        <div className="space-y-3">
                            <Field label={s.whenLabel}>
                                <Choice
                                    layout="segmented"
                                    label={s.whenLabel}
                                    options={[
                                        { key: "now", label: s.sendNow },
                                        { key: "later", label: s.sendLater },
                                    ]}
                                    value={draft.schedule}
                                    onChange={draft.setSchedule}
                                />
                            </Field>
                            {draft.schedule === "later" ? (
                                <DateTimeField
                                    className="max-w-md"
                                    label={s.sendAtLabel}
                                    min={dateKey(new Date())}
                                    value={draft.sendAt}
                                    onChange={draft.setSendAt}
                                />
                            ) : null}
                        </div>
                    </Panel>
                    {draft.error !== null ? (
                        <Notice tone="danger" banner>
                            {draft.error}
                        </Notice>
                    ) : null}
                    <div className="flex justify-end gap-2">
                        <Button variant="quiet" onPress={onDone}>
                            {s.cancel}
                        </Button>
                        <Button size="lg" busy={draft.busy} disabled={n === 0} onPress={send}>
                            {draft.schedule === "later" ? s.scheduleFor(n) : s.sendTo(n)}
                        </Button>
                    </div>
                </div>
                <aside className="space-y-5 lg:sticky lg:top-6">
                    <Panel title={s.audienceLabel}>
                        <Loaded load={draft.load} loading={s.loading} failed={s.loadError} rows={2}>
                            <AudienceSummary draft={draft} />
                        </Loaded>
                    </Panel>
                    <Panel title={s.previewLabel}>
                        <MessagePreview draft={draft} />
                    </Panel>
                </aside>
            </div>
        </div>
    );
}

function AudiencePicker({ draft }: { draft: BroadcastDraft }) {
    return (
        <Field label={s.audienceLabel}>
            <Choice
                label={s.audienceLabel}
                options={[
                    { key: ALL, label: s.everyone },
                    ...draft.audience.allTags.map((t) => ({
                        key: t.tag,
                        label: s.tagChip(t.tag, t.count),
                    })),
                ]}
                value={draft.tags.length === 0 ? [ALL] : draft.tags}
                onChange={(k) => {
                    if (k === ALL) draft.clearTags();
                    else draft.toggleTag(k);
                }}
            />
        </Field>
    );
}

function AudienceSummary({ draft }: { draft: BroadcastDraft }) {
    const openLink = useOpenLink();
    const a = draft.audience;
    if (a.matched === 0)
        return (
            <Empty
                icon="users"
                message={s.noAudience}
                body={s.noAudienceBody}
                actions={
                    <Button
                        size="sm"
                        variant="outline"
                        onPress={() => {
                            openLink("clients");
                        }}
                    >
                        {s.openClients}
                    </Button>
                }
            />
        );
    return (
        <div>
            <div className="flex items-baseline gap-2">
                <span className="font-display text-4xl font-bold tabular-nums text-ink">
                    {a.recipients.length}
                </span>
                <span className="text-sm text-muted">{s.recipientsWord(a.recipients.length)}</span>
            </div>
            <p className="mt-1 text-xs text-muted">
                {s.matched(a.matched)}
                {a.excluded.length > 0 ? ` · ${s.leftOut(a.excluded.length)}` : ""}
            </p>
            {a.excluded.length > 0 ? (
                <>
                    <ul className="mt-4 max-h-72 divide-y divide-line-soft overflow-y-auto rounded-md border border-line">
                        {a.excluded.map((x) => (
                            <li key={x.id} className="flex items-center gap-2.5 px-3 py-2">
                                <Avatar name={x.name} size="sm" />
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium text-ink">
                                        {x.name}
                                    </div>
                                    <div className="text-xs text-muted">
                                        <span
                                            className={
                                                x.reason === "opted_out"
                                                    ? "font-medium text-danger-fg"
                                                    : "font-medium text-ink-soft"
                                            }
                                        >
                                            {s.reasons[x.reason]}
                                        </span>
                                        {x.detail !== "" ? ` · ${x.detail}` : ""}
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                    <p className="mt-3 flex gap-2 text-xs leading-relaxed text-muted">
                        <span className="mt-0.5">
                            <Icon name="shield" size={14} />
                        </span>
                        {s.leftOutHelp}
                    </p>
                </>
            ) : null}
        </div>
    );
}

function MessagePreview({ draft }: { draft: BroadcastDraft }) {
    if (draft.channel === "sms")
        return (
            <div className="rounded-xl border border-line bg-bg px-4 pb-4 pt-3">
                <p className="mb-3 text-center text-[11px] text-muted">{draft.business}</p>
                <MessageBubble body={draft.preview} direction="in" width="full" />
            </div>
        );
    return (
        <div className="overflow-hidden rounded-md border border-line bg-surface text-sm">
            <div className="space-y-0.5 border-b border-line bg-bg px-4 py-2.5 text-xs text-muted">
                <div className="font-semibold text-ink-soft">{draft.business}</div>
                <div className="truncate font-medium text-ink">
                    {draft.name || s.namePlaceholder}
                </div>
            </div>
            <p className="whitespace-pre-wrap px-4 py-3 leading-relaxed text-ink-soft">
                {draft.preview}
            </p>
        </div>
    );
}

function OptOutLine({ channel }: { channel: Channel }) {
    return (
        <div className="flex items-start gap-2 rounded-md border border-dashed border-line bg-bg px-3 py-2 text-xs text-muted">
            <span className="mt-0.5">
                <Icon name="lock" size={13} />
            </span>
            <span>
                <span className="font-medium text-ink-soft">
                    {channel === "sms" ? s.optOutSms : s.optOutEmail}
                </span>
                <span className="block">{s.optOutNote}</span>
            </span>
        </div>
    );
}
