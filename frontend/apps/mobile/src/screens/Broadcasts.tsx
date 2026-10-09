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
import { theme } from "@clientbridge/tokens/native";
import {
    Avatar,
    Button,
    Choice,
    Empty,
    Field,
    KeyValueList,
    ListRow,
    MessageBubble,
    Modal,
    Notice,
    ProgressSteps,
    Stat,
    StatusPill,
    TextField,
    confirm,
    DateTimeField,
} from "@clientbridge/ui";
import { useState } from "react";
import { ScrollView, Share, StyleSheet, Text, View } from "react-native";

import { Loaded } from "../components/Loaded";
import { api } from "../lib/api";

const c = theme.colors;
const s = strings.broadcasts;
const CHANNELS: { key: Channel; label: string }[] = [
    { key: "sms", label: s.channels.sms ?? "" },
    { key: "email", label: s.channels.email ?? "" },
];
const ALL = "__all";
type Step = "audience" | "message" | "review";
const STEPS: Step[] = ["audience", "message", "review"];

const dateOf = (value: string): string => (value === "" ? "" : formatDate(parseTimestamp(value)));

const shareCsv = (_filename: string, content: string): void => {
    Share.share({ message: content }).catch(() => undefined);
};

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
    return <Home onCompose={setComposing} />;
}

function Home({ onCompose }: { onCompose: (seed: BroadcastSeed) => void }) {
    const home = useBroadcastsHome();
    const actions = useBroadcastActions(api, shareCsv);
    const [open, setOpen] = useState<BroadcastItem | null>(null);
    const cancelSend = (item: BroadcastItem): void => {
        confirm({
            title: s.cancelScheduleTitle,
            message: s.cancelScheduleBody,
            confirmLabel: s.cancelSchedule,
            cancelLabel: s.keepScheduled,
            destructive: true,
        })
            .then((ok) => {
                if (ok) {
                    actions.cancel(item.id);
                    setOpen(null);
                }
            })
            .catch(() => undefined);
    };
    return (
        <ScrollView contentContainerStyle={styles.body}>
            <View style={styles.top}>
                <Text style={styles.subtitle}>{s.subtitle}</Text>
                <Button
                    style={{ alignSelf: "center" }}
                    size="sm"
                    icon="plus"
                    onPress={() => {
                        onCompose({ name: "", body: "", tags: [], channel: "sms" });
                    }}
                >
                    {s.newBroadcast}
                </Button>
            </View>
            {actions.error !== null ? <Notice tone="danger">{actions.error}</Notice> : null}
            {actions.exported !== null ? <Notice tone="success">{s.exportShared}</Notice> : null}
            <Loaded load={home.load} loading={s.loading} failed={s.loadError}>
                <View style={styles.stats}>
                    <View style={styles.flex}>
                        <Stat label={s.reachText} value={String(home.reach.sms)} />
                    </View>
                    <View style={styles.flex}>
                        <Stat label={s.reachEmail} value={String(home.reach.email)} />
                    </View>
                    <View style={styles.flex}>
                        <Stat
                            label={s.reachOut}
                            value={String(home.reach.optedOut)}
                            tone={home.reach.optedOut > 0 ? "danger" : "ink"}
                        />
                    </View>
                </View>
                {home.broadcasts.length === 0 ? (
                    <Empty message={s.noBroadcasts} />
                ) : (
                    <View style={styles.list}>
                        {home.broadcasts.map((x) => (
                            <ListRow
                                key={x.id}
                                title={x.name}
                                detail={`${s.audienceTags(x.tags)} · ${broadcastWhen(x)}`}
                                meta={
                                    <StatusPill
                                        status={s.status[x.status] ?? x.status}
                                        intent={broadcastIntent(x.status)}
                                        asWritten
                                    />
                                }
                                onPress={() => {
                                    setOpen(x);
                                }}
                            />
                        ))}
                    </View>
                )}
                <View style={styles.sectionHead}>
                    <Text style={styles.sectionTitle}>{s.optOutsTitle}</Text>
                    <Button
                        style={{ alignSelf: "center" }}
                        size="sm"
                        variant="outline"
                        busy={actions.busy}
                        onPress={actions.exportLog}
                    >
                        {s.exportLog}
                    </Button>
                </View>
                <Text style={styles.meta}>{s.optOutsSubtitle}</Text>
                {home.optOuts.length === 0 ? <Empty message={s.noOptOuts} /> : null}
                {home.optOuts.map((o) => (
                    <View key={`${o.clientId}-${o.channel}`} style={styles.row}>
                        <Avatar name={o.name} size="sm" />
                        <View style={styles.flex}>
                            <Text style={styles.rowName}>{o.name}</Text>
                            <Text style={styles.meta}>
                                {s.consentSource(o.source, dateOf(o.at))}
                            </Text>
                        </View>
                        <StatusPill
                            style={{ alignSelf: "center" }}
                            status={s.consentChannel[o.channel] ?? o.channel}
                            intent="danger"
                            asWritten
                        />
                    </View>
                ))}
                <Text style={[styles.sectionTitle, styles.gapTop]}>{s.impliedTitle}</Text>
                <Text style={styles.meta}>{s.impliedSubtitle}</Text>
                {home.implied.length === 0 ? <Empty message={s.noImplied} /> : null}
                {home.implied.map((o) => (
                    <View key={`${o.clientId}-${o.channel}`} style={styles.row}>
                        <Avatar name={o.name} size="sm" />
                        <View style={styles.flex}>
                            <Text style={styles.rowName}>{o.name}</Text>
                            <Text style={styles.meta}>
                                {s.consentChannel[o.channel]} · {s.endsOn(dateOf(o.expires))}
                            </Text>
                        </View>
                    </View>
                ))}
            </Loaded>
            {open !== null ? (
                <Modal
                    open
                    size="xl"
                    onClose={() => {
                        setOpen(null);
                    }}
                >
                    <ScrollView contentContainerStyle={styles.gap}>
                        <Text style={styles.title}>{open.name}</Text>
                        <Text style={styles.meta}>
                            {s.viaChannel(s.channels[open.channel] ?? open.channel)} ·{" "}
                            {broadcastWhen(open)}
                        </Text>
                        <KeyValueList
                            layout="stack"
                            columns={2}
                            rows={[
                                { label: s.statRecipients, value: String(open.recipient_count) },
                                { label: s.statLeftOut, value: String(open.excluded_count) },
                                { label: s.statDelivered, value: String(open.delivered_count) },
                                { label: s.statOptOuts, value: String(open.opt_out_count) },
                            ]}
                        />
                        <Text style={styles.message}>{open.body}</Text>
                        {open.status === "scheduled" ? (
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
                                    setOpen(null);
                                    onCompose({
                                        name: s.copyOf(open.name),
                                        body: open.body ?? "",
                                        tags: open.tags,
                                        channel: open.channel === "email" ? "email" : "sms",
                                    });
                                }}
                            >
                                {s.duplicate}
                            </Button>
                        )}
                    </ScrollView>
                </Modal>
            ) : null}
        </ScrollView>
    );
}

function Composer({ seed, onDone }: { seed: BroadcastSeed; onDone: () => void }) {
    const draft = useBroadcastDraft(api, seed);
    const [step, setStep] = useState<Step>("audience");
    const index = STEPS.indexOf(step);
    const n = draft.audience.recipients.length;

    if (draft.sent !== null)
        return (
            <View style={styles.done}>
                <Text style={styles.title}>
                    {draft.sent.scheduled ? s.scheduledTitle : s.sentTitle}
                </Text>
                <Text style={styles.meta}>{s.sentBody(draft.sent.count)}</Text>
                <Button onPress={onDone}>{s.sentDone}</Button>
            </View>
        );

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

    return (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Button variant="link" icon="chevronLeft" onPress={onDone}>
                {s.back}
            </Button>
            <ProgressSteps
                label={s.stepOf(index + 1, STEPS.length)}
                steps={STEPS.map((k, i) => ({
                    key: k,
                    label: s.steps[k],
                    state: i < index ? "done" : i === index ? "current" : "todo",
                }))}
            />
            <Text style={styles.meta}>{s.stepOf(index + 1, STEPS.length)}</Text>
            {step === "audience" ? (
                <View style={styles.gap}>
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
                    <AudiencePicker draft={draft} />
                    <Loaded load={draft.load} loading={s.loading} failed={s.loadError} rows={2}>
                        <AudienceSummary draft={draft} />
                    </Loaded>
                </View>
            ) : null}
            {step === "message" ? (
                <View style={styles.gap}>
                    <TextField
                        label={s.messageLabel}
                        multiline
                        rows={6}
                        value={draft.body}
                        onChange={draft.setBody}
                        placeholder={s.messagePlaceholder}
                        hint={
                            draft.channel === "sms"
                                ? s.smsCount(draft.segments.chars, draft.segments.segments)
                                : undefined
                        }
                    />
                    <Notice tone="info" banner>
                        {`${draft.channel === "sms" ? s.optOutSms : s.optOutEmail} ${s.optOutNote}`}
                    </Notice>
                </View>
            ) : null}
            {step === "review" ? (
                <View style={styles.gap}>
                    <Text style={styles.sectionTitle}>{s.previewLabel}</Text>
                    <MessageBubble body={draft.preview} direction="in" width="full" />
                    <Text style={styles.meta}>
                        {s.recipientsLine(n, draft.audience.excluded.length)}
                    </Text>
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
                            label={s.sendAtLabel}
                            min={dateKey(new Date())}
                            value={draft.sendAt}
                            onChange={draft.setSendAt}
                        />
                    ) : null}
                </View>
            ) : null}
            {draft.error !== null ? <Notice tone="danger">{draft.error}</Notice> : null}
            <View style={styles.actions}>
                {index > 0 ? (
                    <View style={styles.flex}>
                        <Button
                            full
                            variant="outline"
                            onPress={() => {
                                setStep(STEPS[index - 1] ?? "audience");
                            }}
                        >
                            {s.stepBack}
                        </Button>
                    </View>
                ) : null}
                <View style={styles.flex}>
                    {step === "review" ? (
                        <Button full busy={draft.busy} disabled={n === 0} onPress={send}>
                            {draft.schedule === "later" ? s.scheduleFor(n) : s.sendTo(n)}
                        </Button>
                    ) : (
                        <Button
                            full
                            onPress={() => {
                                setStep(STEPS[index + 1] ?? "review");
                            }}
                        >
                            {s.next}
                        </Button>
                    )}
                </View>
            </View>
        </ScrollView>
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
    const a = draft.audience;
    if (a.matched === 0) return <Empty message={s.noAudience} body={s.noAudienceBody} />;
    return (
        <View style={styles.card}>
            <Text style={styles.count}>
                {a.recipients.length}{" "}
                <Text style={styles.meta}>{s.recipientsWord(a.recipients.length)}</Text>
            </Text>
            <Text style={styles.meta}>
                {s.matched(a.matched)}
                {a.excluded.length > 0 ? ` · ${s.leftOut(a.excluded.length)}` : ""}
            </Text>
            {a.excluded.slice(0, 8).map((x) => (
                <View key={x.id} style={styles.row}>
                    <Avatar name={x.name} size="sm" />
                    <View style={styles.flex}>
                        <Text style={styles.rowName}>{x.name}</Text>
                        <Text style={styles.meta}>
                            {s.reasons[x.reason]}
                            {x.detail !== "" ? ` · ${x.detail}` : ""}
                        </Text>
                    </View>
                </View>
            ))}
            {a.excluded.length > 0 ? <Text style={styles.meta}>{s.leftOutHelp}</Text> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    body: { padding: 16, paddingBottom: 40, gap: 12 },
    top: { flexDirection: "row", alignItems: "center", gap: 12 },
    subtitle: { flex: 1, color: c.muted, fontSize: 13 },
    stats: { flexDirection: "row", gap: 8 },
    flex: { flex: 1, minWidth: 0 },
    list: {
        backgroundColor: c.surface,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        overflow: "hidden",
    },
    card: {
        backgroundColor: c.surface,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        padding: 14,
        gap: 8,
    },
    sectionHead: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: 10,
    },
    sectionTitle: { color: c.ink, fontSize: 17, fontWeight: "700" },
    gapTop: { marginTop: 10 },
    title: { color: c.ink, fontSize: 20, fontWeight: "700" },
    meta: { color: c.muted, fontSize: 13, lineHeight: 18 },
    message: { color: c.inkSoft, fontSize: 14, lineHeight: 20 },
    row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
    rowName: { color: c.ink, fontSize: 14, fontWeight: "600" },
    gap: { gap: 12 },
    count: { color: c.ink, fontSize: 30, fontWeight: "700" },
    actions: { flexDirection: "row", gap: 10, marginTop: 8 },
    done: { flex: 1, padding: 24, gap: 12, alignItems: "center", justifyContent: "center" },
});
