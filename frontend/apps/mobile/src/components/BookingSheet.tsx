import {
    type BookingActions,
    type BookingComposer,
    type BookingDetail,
    type LifecycleAction,
    type ScheduleEvent,
    canCollectDeposit,
    checkoutMethods,
    formatFullDate,
    formatShortDay,
    formatMoney,
    savedCardLabel,
    strings,
    type Photo,
    useAsyncAction,
    useBookingAddons,
    useBookingPhotos,
    useDeparture,
    usePeoplePhotos,
    useSubjectKind,
    useCollectDeposit,
    useNewMessage,
    useReschedule,
    useSavedCards,
    formatParts,
    formatList,
    BUSINESS_CURRENCY,
    useBusinessZone,
    kindWord,
    arrivalWords,
    canCheckIn,
    useUndoCheckIn,
    itemMedia,
    useNoteComposer,
    useBookingReceipt,
} from "@clientbridge/app-core";
import { SHADOW } from "@clientbridge/tokens";
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
    Skeleton,
    StatusPill,
    TextField,
    TimeSlotPicker,
    Toggle,
    SearchSelect,
    Select,
    IconButton,
} from "@clientbridge/ui";
import {
    launchCameraAsync,
    launchImageLibraryAsync,
    requestCameraPermissionsAsync,
} from "expo-image-picker";
import { useState } from "react";
import {
    Image,
    KeyboardAvoidingView,
    Linking,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";

import { api } from "../lib/api";
import { useViewer } from "../lib/auth";
import { CheckInSheet } from "./CheckInSheet";
import { DocumentPreview } from "./DocumentPreview";
import { BookingTreatmentNotes } from "./TreatmentNotes";

const c = theme.colors;
const s = strings.bookings;

function Departure({ event }: { event: ScheduleEvent }) {
    const departure = useDeparture(api, event, useViewer(), useSubjectKind());
    if (!departure.canDepart) return null;
    return (
        <View style={styles.depart}>
            <Text style={styles.name}>{s.departTitle}</Text>
            <Text style={styles.sub}>{s.departBody}</Text>
            <View style={styles.dueActions}>
                <Button grow icon="send" busy={departure.busy} onPress={departure.depart}>
                    {s.departAction}
                </Button>
            </View>
            {departure.error !== null ? <Notice tone="danger">{departure.error}</Notice> : null}
        </View>
    );
}

function CheckInCard({ event }: { event: ScheduleEvent }) {
    const viewer = useViewer();
    const kind = useSubjectKind();
    const zone = useBusinessZone();
    const [open, setOpen] = useState(false);
    const [done, setDone] = useState<string | null>(null);
    const undo = useUndoCheckIn(api);
    if (done !== null && event.bookingId !== null) {
        const id = event.bookingId;
        return (
            <View style={styles.checkIn}>
                <Notice tone="success" banner>
                    {done}
                </Notice>
                <Button
                    size="sm"
                    variant="outline"
                    busy={undo.busy}
                    onPress={() => {
                        undo.undo(id, () => {
                            setDone(null);
                        });
                    }}
                >
                    {strings.today.undoCheckIn}
                </Button>
            </View>
        );
    }
    if (event.bookingId === null || !canCheckIn(event, viewer, kind, zone)) return null;
    const bookingId = event.bookingId;
    return (
        <View style={styles.depart}>
            <Text style={styles.sub}>
                {kind === "site" ? strings.today.arriveBody : strings.today.checkInBody}
            </Text>
            <View style={styles.dueActions}>
                <Button
                    grow
                    icon="check"
                    onPress={() => {
                        setOpen(true);
                    }}
                >
                    {arrivalWords(kind).action}
                </Button>
            </View>
            {open ? (
                <CheckInSheet
                    bookingId={bookingId}
                    onClose={() => {
                        setOpen(false);
                    }}
                    onDone={(message) => {
                        setOpen(false);
                        setDone(message);
                    }}
                />
            ) : null}
        </View>
    );
}

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
    const amount = formatMoney(event.depositAmountCents, BUSINESS_CURRENCY);
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
                    <Text style={styles.dueBody}>
                        {deposit.settling !== null ? s.depositSettling : s.depositDueBody}
                    </Text>
                    {canCollectDeposit(event, viewer) && deposit.settling === null ? (
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

/** Job photo thumbnails; a photo whose link is still loading shows a blank tile. */
export function PhotoGrid({
    photos,
    sharing = null,
    onShare,
}: {
    photos: readonly (Photo & { shared?: boolean })[];
    sharing?: string | null;
    onShare?: (fileId: string, shared: boolean) => void;
}) {
    return (
        <View style={styles.photos}>
            {photos.map((p, i) => (
                <View key={p.id} style={styles.photoCell}>
                    <View style={styles.photo}>
                        {p.src !== null ? (
                            <Image
                                source={{ uri: p.src }}
                                style={styles.photoImage}
                                accessibilityLabel={s.photoAlt(i + 1)}
                            />
                        ) : null}
                    </View>
                    {onShare === undefined ? null : (
                        <Button
                            size="sm"
                            variant={p.shared === true ? "outline" : "quiet"}
                            full
                            busy={sharing === p.id}
                            onPress={() => {
                                onShare(p.id, p.shared !== true);
                            }}
                        >
                            {p.shared === true ? s.photoUnshare : s.photoShare}
                        </Button>
                    )}
                </View>
            ))}
        </View>
    );
}

function Photos({ event }: { event: ScheduleEvent }) {
    const photos = useBookingPhotos(api, event, useViewer());
    const picker = useAsyncAction();
    if (photos.photos.length === 0 && !photos.canAdd) return null;
    const pick = (camera: boolean): void => {
        picker.run(
            async () => {
                if (camera && !(await requestCameraPermissionsAsync()).granted) {
                    picker.setError(s.photoCameraDenied);
                    return;
                }
                const options = { mediaTypes: ["images" as const], quality: 0.8 };
                const result = camera
                    ? await launchCameraAsync(options)
                    : await launchImageLibraryAsync(options);
                const asset = result.assets?.[0];
                if (!asset) return;
                const blob = await (await fetch(asset.uri)).blob();
                photos.add(blob, asset.mimeType ?? "image/jpeg", asset.fileSize);
            },
            { errorMessage: strings.common.fileUploadError },
        );
    };
    return (
        <DetailSection title={s.detailPhotos}>
            {photos.photos.length === 0 ? (
                <Text style={styles.hint}>{s.photosNone}</Text>
            ) : (
                <PhotoGrid
                    photos={photos.photos}
                    sharing={photos.sharing}
                    {...(photos.canAdd ? { onShare: photos.share } : {})}
                />
            )}
            <Text style={styles.hint}>{s.photosHint}</Text>
            {photos.canAdd ? (
                <View style={styles.photoActions}>
                    <Button
                        size="sm"
                        variant="outline"
                        grow
                        busy={photos.busy || picker.busy}
                        onPress={() => {
                            pick(true);
                        }}
                    >
                        {s.photoTake}
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        grow
                        disabled={photos.busy || picker.busy}
                        onPress={() => {
                            pick(false);
                        }}
                    >
                        {s.photoChoose}
                    </Button>
                </View>
            ) : null}
            {(photos.error ?? picker.error) !== null ? (
                <Notice tone="danger">{photos.error ?? picker.error}</Notice>
            ) : null}
        </DetailSection>
    );
}

function Addons({ event }: { event: ScheduleEvent }) {
    const addons = useBookingAddons(api, event, useViewer());
    const canAdd = addons.canEdit && addons.choices.length > 0;
    if (addons.addons.length === 0 && !canAdd) return null;
    return (
        <DetailSection title={s.detailAddons}>
            {addons.addons.length > 0 ? (
                <View style={styles.card}>
                    {addons.addons.map((a, i) => (
                        <View key={a.id} style={[styles.cardRow, i > 0 && styles.divider]}>
                            <Icon name="bag" size={15} color={c.muted} />
                            <Text style={[styles.flex, styles.addon]} numberOfLines={1}>
                                {strings.common.quantityOf(a.quantity, a.description)}
                            </Text>
                            <Text style={styles.money}>
                                {formatMoney(a.quantity * a.unit_amount_cents, BUSINESS_CURRENCY)}
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
            ) : null}
            {canAdd ? (
                <Select
                    label={s.addonAdd}
                    size="sm"
                    value=""
                    placeholder={s.addonPick}
                    options={addons.choices}
                    onChange={addons.add}
                />
            ) : null}
            <Text style={styles.hint}>
                {s.addonsTotal(formatMoney(addons.totalCents, BUSINESS_CURRENCY))}
            </Text>
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

function Documents({ event }: { event: ScheduleEvent }) {
    const receipt = useBookingReceipt(api, event, useViewer(), c.accent);
    if (!receipt.available) return null;
    const doc = receipt.doc;
    return (
        <DetailSection title={strings.billing.doc.title}>
            <View style={styles.invoice}>
                <Button
                    size="sm"
                    variant="outline"
                    icon="receipt"
                    busy={receipt.busy}
                    onPress={receipt.open}
                >
                    {receipt.busy ? s.receiptLoading : s.receipt}
                </Button>
            </View>
            {receipt.error !== null ? <Notice tone="danger">{receipt.error}</Notice> : null}
            {doc !== null ? (
                <DocumentPreview
                    initial="receipt"
                    shareUrl={null}
                    docs={[{ kind: "receipt", doc, missing: "" }]}
                    onClose={receipt.close}
                />
            ) : null}
        </DetailSection>
    );
}

export function BookingBody({ detail }: { detail: BookingDetail }) {
    const photos = usePeoplePhotos();
    const zone = useBusinessZone();
    const e = detail.event;
    const { client, subject } = detail;
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
                />
                <Text style={styles.timing}>{detail.timing}</Text>
            </View>
            <View style={styles.facts}>
                <KeyValueList
                    rows={[
                        {
                            label: s.detailWhen,
                            value: `${formatFullDate(e.start, zone)}\n${e.timeLabel}`,
                        },
                        { label: s.detailWith, value: e.staffName },
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
            <Departure event={e} />
            <CheckInCard key={e.id} event={e} />
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
                            <Avatar name={client.name} src={photos.client(client.id)} />
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
                        {subject ? (
                            <View style={[styles.cardRow, styles.divider]}>
                                <Avatar name={subject.name} size="sm" />
                                <View style={styles.flex}>
                                    <Text style={styles.subjectName}>{subject.name}</Text>
                                    {detail.subjectLine !== null ? (
                                        <Text style={styles.sub} numberOfLines={1}>
                                            {detail.subjectLine}
                                        </Text>
                                    ) : null}
                                </View>
                                {detail.temperament !== null ? (
                                    <Badge
                                        style={{ alignSelf: "center" }}
                                        label={detail.temperament.label}
                                        intent={detail.temperament.nervous ? "warning" : "neutral"}
                                    />
                                ) : null}
                            </View>
                        ) : null}
                        {detail.directions !== null ? (
                            <View style={[styles.cardRow, styles.divider]}>
                                <Icon name="pin" size={15} color={c.muted} />
                                <Text style={[styles.sub, styles.flex]} numberOfLines={2}>
                                    {detail.directions.address}
                                </Text>
                                <Button
                                    style={{ alignSelf: "center" }}
                                    size="sm"
                                    variant="link"
                                    label={s.directionsTo(detail.directions.address)}
                                    onPress={() => {
                                        if (detail.directions !== null)
                                            Linking.openURL(detail.directions.url).catch(
                                                () => undefined,
                                            );
                                    }}
                                >
                                    {s.directions}
                                </Button>
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
                                <Avatar
                                    name={r.subjectName === "" ? r.name : r.subjectName}
                                    size="sm"
                                />
                                <Text style={[styles.flex, styles.subjectName]} numberOfLines={1}>
                                    {r.subjectName === ""
                                        ? r.name
                                        : formatParts([r.subjectName, r.name])}
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
            {detail.notes.length > 0 || e.bookingId !== null ? (
                <DetailSection title={s.detailNotes}>
                    {detail.notes.map((n) => (
                        <Text key={n.id} style={styles.note}>
                            {n.body}
                        </Text>
                    ))}
                    {e.bookingId !== null ? (
                        <BookingNoteBox key={e.bookingId} bookingId={e.bookingId} />
                    ) : null}
                </DetailSection>
            ) : null}
            {e.bookingId !== null ? <Photos event={e} /> : null}
            {e.bookingId !== null ? <Addons event={e} /> : null}
            {e.bookingId !== null ? <Documents event={e} /> : null}
            {e.bookingId !== null ? <BookingTreatmentNotes key={e.bookingId} event={e} /> : null}
            {detail.history.length > 0 ? (
                <DetailSection title={s.detailHistory}>
                    <ActivityTimeline entries={detail.history} />
                </DetailSection>
            ) : null}
        </View>
    );
}

function BookingNoteBox({ bookingId }: { bookingId: string }) {
    const composer = useNoteComposer(api, { bookingId });
    if (!composer.open)
        return (
            <Button size="sm" variant="outline" onPress={composer.show}>
                {s.noteAdd}
            </Button>
        );
    return (
        <View style={styles.noteBox}>
            <TextField
                multiline
                rows={3}
                name={s.notePlaceholder}
                value={composer.body}
                onChange={composer.setBody}
                placeholder={s.notePlaceholder}
                autoFocus
            />
            <View style={styles.photoActions}>
                <Button size="sm" variant="outline" grow onPress={composer.cancel}>
                    {strings.common.cancel}
                </Button>
                <Button
                    size="sm"
                    grow
                    busy={composer.busy}
                    disabled={composer.body.trim() === ""}
                    onPress={composer.submit}
                >
                    {composer.busy
                        ? strings.clients.history.savingNote
                        : strings.clients.history.saveNote}
                </Button>
            </View>
            {composer.error !== null ? <Notice tone="danger">{composer.error}</Notice> : null}
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
                {actions.canComplete || actions.notStartedNote !== null ? (
                    <Button
                        grow
                        busy={actions.pending === "complete"}
                        disabled={!actions.canComplete}
                        onPress={() => {
                            actions.run("complete");
                        }}
                    >
                        {actions.pending === "complete" ? s.working : s.complete}
                    </Button>
                ) : null}
                {actions.canNoShow || actions.notStartedNote !== null ? (
                    <Button
                        grow
                        variant="outline"
                        disabled={!actions.canNoShow}
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
            {actions.notStartedNote !== null ? (
                <Text style={styles.sub}>{actions.notStartedNote}</Text>
            ) : null}
            {actions.error !== null ? <Notice tone="danger">{actions.error}</Notice> : null}
        </View>
    );
}

/** Pick another person, day and open time; the same check as a drag on web decides what's open. */
export function RescheduleSheet({ event, onClose }: { event: ScheduleEvent; onClose: () => void }) {
    const r = useReschedule(api, event, useViewer(), onClose);
    return (
        <Modal size="xl" onClose={onClose}>
            <Text style={styles.sheetTitle}>{s.rescheduleTitle}</Text>
            <Text style={styles.sub} numberOfLines={1}>
                {formatParts([event.headline, event.timeLabel])}
            </Text>
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
                {r.loading ? (
                    <Skeleton variant="row" count={3} label={s.loading} />
                ) : r.open === 0 ? (
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

/** New booking docked under the calendar: a summary bar while the draft is placed, the whole form when expanded. */
export function BookingComposerSheet({
    form,
    expanded,
    onExpand,
    onCollapse,
    onClose,
}: {
    form: BookingComposer;
    expanded: boolean;
    onExpand: () => void;
    onCollapse: () => void;
    onClose: () => void;
}) {
    const photos = usePeoplePhotos();
    const zone = useBusinessZone();
    const draft = form.draft;
    const member = form.staffOptions.find((o) => o.id === form.staffId);
    const book = (
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
    );
    return (
        <KeyboardAvoidingView
            pointerEvents="box-none"
            style={styles.dockWrap}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
            <View style={[styles.dock, expanded && styles.dockOpen]}>
                <View style={styles.dockHead}>
                    <View style={styles.flex}>
                        <Text style={styles.sheetTitle} numberOfLines={1}>
                            {draft?.headline ?? s.composerTitle}
                        </Text>
                        {draft !== null ? (
                            <Text style={styles.sub} numberOfLines={1}>
                                {formatParts([
                                    formatShortDay(draft.start, zone),
                                    draft.timeLabel,
                                    member?.name.split(" ")[0],
                                ])}
                            </Text>
                        ) : null}
                    </View>
                    <Button
                        size="sm"
                        variant="outline"
                        icon={expanded ? "calendar" : "edit"}
                        onPress={expanded ? onCollapse : onExpand}
                    >
                        {expanded ? s.draftShowCalendar : s.draftShowForm}
                    </Button>
                    <IconButton icon="x" label={s.close} onPress={onClose} />
                </View>
                {expanded ? null : (
                    <>
                        {draft?.problem != null ? (
                            <Notice tone="danger">{draft.problem}</Notice>
                        ) : (
                            <Text style={styles.hint}>{s.draftHintMobile}</Text>
                        )}
                        {book}
                    </>
                )}
                {expanded ? (
                    <>
                        <ScrollView
                            style={styles.sheetScroll}
                            contentContainerStyle={styles.sheetBody}
                            keyboardShouldPersistTaps="handled"
                        >
                            <Text style={styles.label}>{s.composerClient}</Text>
                            {form.client ? (
                                <View style={styles.picked}>
                                    <Avatar
                                        name={form.client.name}
                                        src={photos.client(form.client.id)}
                                        size="sm"
                                    />
                                    <View style={styles.flex}>
                                        <Text style={styles.name}>{form.client.name}</Text>
                                        <Text style={styles.sub}>
                                            {formatList(
                                                form.subjects.map((x) => x.name),
                                                "unit",
                                            )}
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
                                        placeholder={s.composerClientSearch(kindWord(form.kind))}
                                    />
                                    <View style={styles.card}>
                                        {form.matches.slice(0, 4).map((m) => (
                                            <ListRow
                                                key={m.client.id}
                                                density="compact"
                                                leading={
                                                    <Avatar
                                                        name={m.client.name}
                                                        src={photos.client(m.client.id)}
                                                        size="sm"
                                                    />
                                                }
                                                title={m.client.name}
                                                detail={formatList(m.subjects, "unit")}
                                                onPress={() => {
                                                    form.pickClient(m.client.id);
                                                }}
                                            />
                                        ))}
                                    </View>
                                </>
                            )}
                            {form.kind !== null && form.subjects.length > 1 ? (
                                <Choice
                                    label={strings.subjects.one(form.kind)}
                                    options={form.subjects.map((x) => ({
                                        key: x.id,
                                        label: x.name,
                                    }))}
                                    value={form.subjectId}
                                    onChange={form.setSubjectId}
                                />
                            ) : null}

                            <SearchSelect
                                label={s.composerService}
                                placeholder={s.composerServicePlaceholder}
                                options={form.services.map((i) => ({
                                    key: i.id,
                                    label: i.name,
                                    media: itemMedia(i),
                                    detail: formatParts([
                                        strings.catalog.minutes(i.duration_min ?? 60),
                                        formatMoney(i.price_cents ?? 0, BUSINESS_CURRENCY),
                                    ]),
                                }))}
                                value={form.item?.id ?? ""}
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
                            {form.problem !== null ? (
                                <Notice tone="danger">{form.problem}</Notice>
                            ) : null}

                            {form.fromEstimate !== null ? (
                                <View style={styles.depart}>
                                    <Text style={styles.name}>{form.fromEstimate.title}</Text>
                                    {form.fromEstimate.lines.map((line, i) => (
                                        <Text key={i} style={styles.sub}>
                                            {line}
                                        </Text>
                                    ))}
                                    <Text style={styles.hint}>{s.composerFromEstimateHint}</Text>
                                </View>
                            ) : (
                                <Toggle
                                    label={s.composerRepeat}
                                    hint={
                                        form.repeat
                                            ? formatParts([
                                                  s.everyWeeks(form.every),
                                                  s.composerBookSeries(form.count),
                                              ])
                                            : undefined
                                    }
                                    value={form.repeat}
                                    onChange={form.setRepeat}
                                />
                            )}
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
                            <Toggle
                                label={s.composerConfirm}
                                value={form.notify}
                                onChange={form.setNotify}
                            />
                            {form.depositLine !== null ? (
                                <Notice tone="info" banner>
                                    {form.depositLine}
                                </Notice>
                            ) : null}
                            {form.notice !== null ? (
                                <Notice tone="success">{form.notice}</Notice>
                            ) : null}
                            {form.error !== null ? (
                                <Notice tone="danger">{form.error}</Notice>
                            ) : null}
                        </ScrollView>
                        {book}
                    </>
                ) : null}
            </View>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    body: { gap: 4 },
    checkIn: { marginBottom: 8, gap: 8 },
    photos: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    depart: {
        gap: 4,
        padding: 12,
        marginBottom: 8,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
    },
    photoCell: { width: "31%", gap: 4 },
    photo: {
        width: "100%",
        aspectRatio: 1,
        borderRadius: theme.radius,
        overflow: "hidden",
        backgroundColor: c.bg,
    },
    photoImage: { width: "100%", height: "100%" },
    photoActions: { flexDirection: "row", gap: 8, marginTop: 8 },
    noteBox: { gap: 8, marginTop: 4 },
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
    subjectName: { color: c.ink, fontSize: 14, fontWeight: "600" },
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
    dockWrap: {
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        justifyContent: "flex-end",
    },
    dock: {
        backgroundColor: c.surface,
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 16,
        gap: 8,
        shadowColor: SHADOW,
        shadowOpacity: 0.18,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: -4 },
        elevation: 12,
    },
    dockOpen: { height: "72%" },
    dockHead: { flexDirection: "row", alignItems: "center", gap: 8 },
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
