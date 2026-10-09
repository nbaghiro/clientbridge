import {
    type BookingActions,
    type BookingDetail,
    type ComposerSlot,
    type LifecycleAction,
    type ScheduleBoard,
    type ScheduleEvent,
    canCollectDeposit,
    checkoutMethods,
    formatFullDate,
    formatMoney,
    savedCardLabel,
    strings,
    useBookingAddons,
    useBookingComposer,
    useCollectDeposit,
    useNewMessage,
    useReschedule,
    useSavedCards,
    useStationPicker,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    ActivityTimeline,
    Avatar,
    Badge,
    Button,
    ChargeSheet,
    Choice,
    DateStrip,
    DetailSection,
    Empty,
    Icon,
    KeyValueList,
    ListRow,
    Modal,
    Notice,
    SearchField,
    StatusPill,
    TextField,
    TimeSlotPicker,
    Toggle,
} from "@clientbridge/ui";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { api } from "../lib/api";
import { useViewer } from "../lib/auth";

const c = theme.colors;
const s = strings.bookings;
const k = strings.classes;

function DepositDue({ event }: { event: ScheduleEvent }) {
    const viewer = useViewer();
    const [collecting, setCollecting] = useState(false);
    const cards = useSavedCards(event.clientId ?? "");
    const deposit = useCollectDeposit(
        api,
        event,
        () => {
            setCollecting(false);
        },
        cards.at(0)?.id,
    );
    if (!event.depositRequired || event.depositStatus !== "pending") return null;
    const amount = formatMoney(event.depositAmountCents);
    return (
        <View style={styles.due}>
            <View style={styles.rowGap}>
                <Icon name="dollar" size={16} color={c.warnFg} />
                <Text style={styles.dueTitle}>{s.depositDueTitle(amount)}</Text>
            </View>
            {collecting ? (
                <ChargeSheet
                    checkout={deposit.checkout}
                    methods={checkoutMethods(cards)}
                    amountLabel={amount}
                    submitLabel={s.collectAmount(amount)}
                    busyLabel={s.collecting}
                    onSubmit={deposit.submit}
                    onCancel={() => {
                        setCollecting(false);
                    }}
                />
            ) : (
                <>
                    <Text style={styles.dueBody}>{s.depositDueBody}</Text>
                    {canCollectDeposit(event, viewer) ? (
                        <View style={styles.dueActions}>
                            <Button
                                size="sm"
                                grow
                                onPress={() => {
                                    setCollecting(true);
                                }}
                            >
                                {s.collectNow}
                            </Button>
                        </View>
                    ) : null}
                </>
            )}
        </View>
    );
}

function Addons({ event }: { event: ScheduleEvent }) {
    const addons = useBookingAddons(api, event, useViewer());
    if (addons.addons.length === 0) return null;
    return (
        <DetailSection title={s.detailAddons}>
            <View style={styles.card}>
                {addons.addons.map((a, i) => (
                    <View key={a.id} style={[styles.cardRow, i > 0 && styles.divider]}>
                        <Icon name="bag" size={15} color={c.muted} />
                        <Text
                            style={[styles.flex, styles.addon]}
                            numberOfLines={1}
                        >{`${String(a.quantity)} × ${a.description}`}</Text>
                        <Text style={styles.money}>
                            {formatMoney(a.quantity * a.unit_amount_cents)}
                        </Text>
                        {addons.canEdit ? (
                            <Button
                                style={{ alignSelf: "center" }}
                                size="sm"
                                variant="link"
                                onPress={() => {
                                    addons.remove(a.id);
                                }}
                            >
                                {s.addonRemove}
                            </Button>
                        ) : null}
                    </View>
                ))}
            </View>
            <Text style={styles.hint}>{s.addonsTotal(formatMoney(addons.totalCents))}</Text>
            {addons.canInvoice ? (
                <View style={styles.invoice}>
                    <Button
                        size="sm"
                        variant="outline"
                        busy={addons.busy}
                        onPress={addons.createInvoice}
                    >
                        {s.invoiceVisit}
                    </Button>
                </View>
            ) : addons.invoiceId !== null ? (
                <Text style={styles.hint}>{s.visitInvoiced}</Text>
            ) : null}
            {addons.error !== null ? <Notice tone="danger">{addons.error}</Notice> : null}
        </DetailSection>
    );
}

function Station({ event }: { event: ScheduleEvent }) {
    const [saved, setSaved] = useState(false);
    const picker = useStationPicker(api, event, () => {
        setSaved(true);
    });
    if (event.kind !== "visit" || event.bookingId === null || picker.options.length === 0)
        return null;
    if (event.status !== "confirmed" && event.status !== "pending") return null;
    return (
        <DetailSection title={k.pickTitle}>
            <Text style={styles.hint}>{k.pickSubtitle}</Text>
            <Choice
                layout="cards"
                label={k.pickTitle}
                options={[
                    { key: "", label: s.stationNone },
                    ...picker.options.map((o) => ({
                        key: o.key,
                        label: o.label,
                        hint: o.hint,
                        disabled: o.disabled,
                    })),
                ]}
                value={picker.value}
                onChange={(key) => {
                    setSaved(false);
                    picker.setValue(key);
                }}
            />
            {picker.changed && !saved ? (
                <View style={styles.invoice}>
                    <Button size="sm" busy={picker.busy} onPress={picker.save}>
                        {k.saveStation}
                    </Button>
                </View>
            ) : null}
            {picker.error !== null ? <Notice tone="danger">{picker.error}</Notice> : null}
        </DetailSection>
    );
}

export function BookingBody({ detail }: { detail: BookingDetail }) {
    const e = detail.event;
    const { client, pet } = detail;
    const [messaging, setMessaging] = useState(false);
    const cards = useSavedCards(client?.id ?? "");
    const card = cards.find((x) => x.preferred === 1) ?? cards[0];
    return (
        <View style={styles.body}>
            <View style={styles.statusLine}>
                <StatusPill
                    style={{ alignSelf: "center" }}
                    status={s.statusLabel(e.status)}
                    intent={e.intent}
                    asWritten
                />
                <Text style={styles.timing}>{detail.timing}</Text>
            </View>
            <View style={styles.facts}>
                <KeyValueList
                    rows={[
                        {
                            label: s.detailWhen,
                            value: `${formatFullDate(e.start)}\n${e.timeLabel}`,
                        },
                        { label: s.detailWith, value: e.staffName },
                        ...(e.resourceName !== null
                            ? [{ label: s.detailWhere, value: e.resourceName }]
                            : []),
                        ...(detail.depositLine !== null
                            ? [
                                  {
                                      label: s.detailDeposit,
                                      value: detail.depositLine,
                                      intent: detail.depositIntent,
                                  },
                              ]
                            : []),
                        ...(detail.series !== null
                            ? [{ label: s.detailSeries, value: detail.series }]
                            : []),
                    ]}
                />
            </View>
            <DepositDue event={e} />
            {client ? (
                <DetailSection
                    title={s.detailClient}
                    action={
                        <Button
                            size="sm"
                            variant="quiet"
                            icon="message"
                            onPress={() => {
                                setMessaging(true);
                            }}
                        >
                            {s.message}
                        </Button>
                    }
                >
                    <View style={styles.card}>
                        <View style={styles.cardRow}>
                            <Avatar name={client.name} />
                            <View style={styles.flex}>
                                <View style={styles.rowGap}>
                                    <Text style={styles.name} numberOfLines={1}>
                                        {client.name}
                                    </Text>
                                    {detail.tags.slice(0, 1).map((t) => (
                                        <Badge
                                            style={{ alignSelf: "center" }}
                                            key={t}
                                            label={t}
                                            intent="accent"
                                        />
                                    ))}
                                </View>
                                <Text style={styles.sub} numberOfLines={1}>
                                    {detail.clientLine}
                                </Text>
                            </View>
                        </View>
                        {pet ? (
                            <View style={[styles.cardRow, styles.divider]}>
                                <Avatar name={pet.name} size="sm" />
                                <View style={styles.flex}>
                                    <Text style={styles.petName}>{pet.name}</Text>
                                    {detail.petLine !== null ? (
                                        <Text style={styles.sub} numberOfLines={1}>
                                            {detail.petLine}
                                        </Text>
                                    ) : null}
                                </View>
                                {pet.temperament !== null ? (
                                    <Badge
                                        style={{ alignSelf: "center" }}
                                        label={pet.temperament}
                                        intent={detail.petNervous ? "warning" : "neutral"}
                                    />
                                ) : null}
                            </View>
                        ) : null}
                        <View style={[styles.cardRow, styles.divider]}>
                            <Icon name="card" size={15} color={c.muted} />
                            <Text style={styles.sub}>
                                {card ? s.cardOnFile(savedCardLabel(card)) : s.noCard}
                            </Text>
                        </View>
                    </View>
                    {messaging ? (
                        <MessageSheet
                            clientId={client.id}
                            name={client.name}
                            onClose={() => {
                                setMessaging(false);
                            }}
                        />
                    ) : null}
                </DetailSection>
            ) : null}
            {e.kind === "class" ? (
                <DetailSection title={s.classSeats(e.bookedCount, e.capacity)}>
                    <View style={styles.card}>
                        {detail.roster.map((r, i) => (
                            <View key={r.id} style={[styles.cardRow, i > 0 && styles.divider]}>
                                <Avatar name={r.pet === "" ? r.name : r.pet} size="sm" />
                                <Text style={[styles.flex, styles.petName]} numberOfLines={1}>
                                    {r.pet === "" ? r.name : `${r.pet} · ${r.name}`}
                                </Text>
                                {r.waiting ? (
                                    <Badge
                                        style={{ alignSelf: "center" }}
                                        label={s.waitlist}
                                        intent="neutral"
                                    />
                                ) : r.unpaid ? (
                                    <Badge
                                        style={{ alignSelf: "center" }}
                                        label={s.unpaid}
                                        intent="warning"
                                    />
                                ) : null}
                            </View>
                        ))}
                    </View>
                </DetailSection>
            ) : null}
            {detail.notes.length > 0 ? (
                <DetailSection title={s.detailNotes}>
                    {detail.notes.map((n) => (
                        <Text key={n.id} style={styles.note}>
                            {n.body}
                        </Text>
                    ))}
                </DetailSection>
            ) : null}
            {e.bookingId !== null ? <Addons event={e} /> : null}
            <Station event={e} />
            {detail.history.length > 0 ? (
                <DetailSection title={s.detailHistory}>
                    <ActivityTimeline entries={detail.history} />
                </DetailSection>
            ) : null}
        </View>
    );
}

/** Lifecycle buttons; a no-show or cancel shows its consequence in place before it goes through. */
export function BookingActionBar({
    actions,
    onReschedule,
}: {
    actions: BookingActions;
    onReschedule?: () => void;
}) {
    const [asking, setAsking] = useState<LifecycleAction | null>(null);
    if (asking !== null) {
        const noShow = asking === "no_show";
        return (
            <View style={styles.ask}>
                <Text style={styles.askTitle}>{noShow ? s.noShowTitle : s.cancelTitle}</Text>
                <Text style={styles.sub}>{noShow ? actions.noShowNote : actions.cancelNote}</Text>
                {actions.error !== null ? <Notice tone="danger">{actions.error}</Notice> : null}
                <View style={styles.askRow}>
                    <Button
                        grow
                        variant="outline"
                        onPress={() => {
                            setAsking(null);
                        }}
                    >
                        {s.keepVisit}
                    </Button>
                    <Button
                        grow
                        variant="danger"
                        busy={actions.busy}
                        onPress={() => {
                            actions.run(asking);
                        }}
                    >
                        {actions.busy ? s.working : noShow ? s.confirmNoShow : s.confirmCancel}
                    </Button>
                </View>
            </View>
        );
    }
    if (!actions.canComplete && !actions.canNoShow && !actions.canCancel) return null;
    return (
        <View style={styles.ask}>
            <View style={styles.askRow}>
                {actions.canComplete ? (
                    <Button
                        grow
                        busy={actions.pending === "complete"}
                        onPress={() => {
                            actions.run("complete");
                        }}
                    >
                        {actions.pending === "complete" ? s.working : s.complete}
                    </Button>
                ) : null}
                {actions.canNoShow ? (
                    <Button
                        grow
                        variant="outline"
                        onPress={() => {
                            setAsking("no_show");
                        }}
                    >
                        {s.noShow}
                    </Button>
                ) : null}
                {actions.canReschedule && onReschedule ? (
                    <Button grow variant="outline" onPress={onReschedule}>
                        {s.reschedule}
                    </Button>
                ) : null}
                {actions.canCancel ? (
                    <Button
                        grow
                        variant="quiet"
                        onPress={() => {
                            setAsking("cancel");
                        }}
                    >
                        {s.cancel}
                    </Button>
                ) : null}
            </View>
            {actions.error !== null ? <Notice tone="danger">{actions.error}</Notice> : null}
        </View>
    );
}

/** Pick another person, day and open time; the same check as a drag on web decides what's open. */
export function RescheduleSheet({ event, onClose }: { event: ScheduleEvent; onClose: () => void }) {
    const r = useReschedule(api, event, onClose);
    return (
        <Modal size="xl" onClose={onClose}>
            <Text style={styles.sheetTitle}>{s.rescheduleTitle}</Text>
            <Text
                style={styles.sub}
                numberOfLines={1}
            >{`${event.headline} · ${event.timeLabel}`}</Text>
            <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetBody}>
                <Text style={styles.label}>{s.rescheduleWith}</Text>
                <Choice
                    label={s.rescheduleWith}
                    layout="segmented"
                    options={r.staffOptions}
                    value={r.staffId}
                    onChange={r.setStaffId}
                />
                <DateStrip
                    label={s.rescheduleDay}
                    days={r.days}
                    value={r.day}
                    onChange={r.setDay}
                    onPrev={() => {
                        r.shiftWeek(-1);
                    }}
                    onNext={() => {
                        r.shiftWeek(1);
                    }}
                    prevLabel={s.prev}
                    nextLabel={s.next}
                />
                {r.open === 0 ? (
                    <Empty message={s.noTimes} />
                ) : (
                    <TimeSlotPicker
                        label={s.rescheduleTimes}
                        groups={r.groups}
                        value={r.value}
                        onChange={r.setValue}
                        columns={4}
                    />
                )}
                {r.error !== null ? <Notice tone="danger">{r.error}</Notice> : null}
            </ScrollView>
            <Text style={styles.hint}>{s.rescheduleNotice}</Text>
            <View style={styles.sheetFoot}>
                <Button full busy={r.busy} disabled={r.value === null} onPress={r.submit}>
                    {r.busy
                        ? s.rescheduling
                        : r.target !== null
                          ? s.rescheduleTo(r.target)
                          : s.reschedule}
                </Button>
            </View>
        </Modal>
    );
}

function MessageSheet({
    clientId,
    name,
    onClose,
}: {
    clientId: string;
    name: string;
    onClose: () => void;
}) {
    const m = useNewMessage(api, onClose, clientId);
    return (
        <Modal size="lg" onClose={onClose}>
            <View style={styles.sheetBody}>
                <Text style={styles.sheetTitle}>{s.messageTitle(name)}</Text>
                <Choice
                    label={s.messageChannel}
                    layout="segmented"
                    options={[
                        { key: "sms", label: s.messageSms },
                        { key: "email", label: s.messageEmail },
                    ]}
                    value={m.channel}
                    onChange={m.setChannel}
                />
                {m.smsBlocked ? (
                    <Notice tone="danger">{strings.messaging.smsBlockedNew}</Notice>
                ) : null}
                <TextField
                    label={s.messageBody}
                    multiline
                    rows={4}
                    value={m.body}
                    onChange={m.setBody}
                    placeholder={s.messagePlaceholder}
                    disabled={m.smsBlocked}
                />
                {m.error !== null ? <Notice tone="danger">{m.error}</Notice> : null}
                <Button full busy={m.busy} disabled={m.smsBlocked} onPress={m.submit} icon="send">
                    {s.messageSend}
                </Button>
            </View>
        </Modal>
    );
}

/** New booking as one scrolling sheet: who, what, with whom, then only the times that are open. */
export function BookingComposerSheet({
    slot,
    board,
    onClose,
}: {
    slot: ComposerSlot;
    board: ScheduleBoard;
    onClose: () => void;
}) {
    const form = useBookingComposer(
        api,
        slot,
        { avail: board.avail, events: board.weekEvents, staff: board.staff },
        onClose,
    );
    return (
        <Modal size="xl" onClose={onClose}>
            <Text style={styles.sheetTitle}>{s.composerTitle}</Text>
            <ScrollView
                style={styles.sheetScroll}
                contentContainerStyle={styles.sheetBody}
                keyboardShouldPersistTaps="handled"
            >
                <Text style={styles.label}>{s.composerClient}</Text>
                {form.client ? (
                    <View style={styles.picked}>
                        <Avatar name={form.client.name} size="sm" />
                        <View style={styles.flex}>
                            <Text style={styles.name}>{form.client.name}</Text>
                            <Text style={styles.sub}>
                                {form.pets.map((p) => p.name).join(", ")}
                            </Text>
                        </View>
                        <Button
                            style={{ alignSelf: "center" }}
                            size="sm"
                            variant="link"
                            onPress={() => {
                                form.pickClient(null);
                            }}
                        >
                            {s.composerChange}
                        </Button>
                    </View>
                ) : (
                    <>
                        <SearchField
                            value={form.query}
                            onChange={form.setQuery}
                            placeholder={s.composerClientSearch}
                        />
                        <View style={styles.card}>
                            {form.matches.slice(0, 4).map((m) => (
                                <ListRow
                                    key={m.client.id}
                                    density="compact"
                                    leading={<Avatar name={m.client.name} size="sm" />}
                                    title={m.client.name}
                                    detail={m.pets.join(", ")}
                                    onPress={() => {
                                        form.pickClient(m.client.id);
                                    }}
                                />
                            ))}
                        </View>
                    </>
                )}
                {form.pets.length > 1 ? (
                    <Choice
                        label={s.composerPet}
                        options={form.pets.map((p) => ({ key: p.id, label: p.name }))}
                        value={form.petId}
                        onChange={form.setPetId}
                    />
                ) : null}

                <Text style={styles.label}>{s.composerService}</Text>
                <Choice
                    label={s.composerService}
                    layout="cards"
                    options={form.services.map((i) => ({
                        key: i.id,
                        label: i.name,
                        hint: `${String(i.duration_min ?? 60)} min · ${formatMoney(i.price_cents ?? 0)}`,
                    }))}
                    value={form.item?.id ?? null}
                    onChange={form.setItemId}
                />

                <Text style={styles.label}>{s.composerWith}</Text>
                <Choice
                    label={s.composerWith}
                    layout="segmented"
                    options={form.staffOptions.map((o) => ({
                        key: o.id,
                        label: o.name.split(" ")[0] ?? o.name,
                    }))}
                    value={form.staffId}
                    onChange={form.setStaffId}
                />

                <Text style={styles.label}>{s.composerDate}</Text>
                <DateStrip
                    label={s.composerDate}
                    days={form.days}
                    value={form.day}
                    onChange={form.setDay}
                />
                {form.slotGroups.length === 0 ? (
                    <Empty message={s.noTimes} />
                ) : (
                    <TimeSlotPicker
                        label={s.composerTime}
                        groups={form.slotGroups}
                        value={form.time}
                        onChange={form.setTime}
                        columns={4}
                    />
                )}
                {form.problem !== null ? <Notice tone="danger">{form.problem}</Notice> : null}

                <Toggle
                    label={s.composerRepeat}
                    hint={
                        form.repeat
                            ? `${s.everyWeeks(form.every)} · ${s.composerBookSeries(form.count)}`
                            : undefined
                    }
                    value={form.repeat}
                    onChange={form.setRepeat}
                />
                {form.repeat ? null : (
                    <TextField
                        label={s.composerNote}
                        optional
                        multiline
                        rows={2}
                        value={form.note}
                        onChange={form.setNote}
                        placeholder={s.composerNotePlaceholder}
                    />
                )}
                <Toggle label={s.composerConfirm} value={form.notify} onChange={form.setNotify} />
                {form.depositLine !== null ? (
                    <Notice tone="info" banner>
                        {form.depositLine}
                    </Notice>
                ) : null}
                {form.notice !== null ? <Notice tone="success">{form.notice}</Notice> : null}
                {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
            </ScrollView>
            <View style={styles.sheetFoot}>
                {form.notice !== null ? (
                    <Button full onPress={onClose}>
                        {s.close}
                    </Button>
                ) : (
                    <Button full busy={form.busy} disabled={!form.canSubmit} onPress={form.submit}>
                        {form.busy
                            ? s.composerBooking
                            : form.repeat
                              ? s.composerBookSeries(form.count)
                              : s.composerBook}
                    </Button>
                )}
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    body: { gap: 4 },
    statusLine: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
    timing: { color: c.muted, fontSize: 13, fontWeight: "600" },
    facts: {
        backgroundColor: c.bg,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        paddingHorizontal: 14,
        marginBottom: 8,
    },
    due: {
        backgroundColor: c.warnBg,
        borderRadius: theme.radius,
        padding: 14,
        gap: 6,
        marginBottom: 8,
    },
    dueTitle: { color: c.warnFg, fontSize: 14, fontWeight: "700" },
    dueBody: { color: c.inkSoft, fontSize: 13, lineHeight: 18 },
    dueActions: { flexDirection: "row", gap: 8, marginTop: 4 },
    card: {
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: theme.radius,
        marginTop: 8,
        overflow: "hidden",
    },
    cardRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    divider: { borderTopWidth: 1, borderTopColor: c.borderSoft },
    flex: { flex: 1, minWidth: 0 },
    rowGap: { flexDirection: "row", alignItems: "center", gap: 6 },
    name: { color: c.ink, fontSize: 15, fontWeight: "600", flexShrink: 1 },
    petName: { color: c.ink, fontSize: 14, fontWeight: "600" },
    sub: { color: c.muted, fontSize: 13, marginTop: 1 },
    note: {
        backgroundColor: c.warnBg,
        color: c.inkSoft,
        fontSize: 14,
        lineHeight: 20,
        padding: 10,
        borderRadius: theme.radius,
        marginTop: 8,
    },
    addon: { color: c.ink, fontSize: 14 },
    money: { color: c.ink, fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },
    hint: { color: c.muted, fontSize: 12, marginTop: 6 },
    invoice: { marginTop: 8, flexDirection: "row" },
    ask: { flex: 1, gap: 8 },
    askTitle: { color: c.ink, fontSize: 15, fontWeight: "700" },
    askRow: { flexDirection: "row", gap: 8 },
    sheetTitle: { color: c.ink, fontSize: 20, fontWeight: "700" },
    sheetScroll: { flex: 1, marginTop: 8 },
    sheetBody: { gap: 12, paddingBottom: 12 },
    sheetFoot: { paddingTop: 10 },
    label: { color: c.inkSoft, fontSize: 13, fontWeight: "600", marginTop: 6 },
    picked: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        padding: 10,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.accent,
        backgroundColor: c.accentWeak,
    },
});
