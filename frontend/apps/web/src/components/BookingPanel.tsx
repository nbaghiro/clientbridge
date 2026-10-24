import {
    type BookingActions,
    type BookingDetail,
    type LifecycleAction,
    type ScheduleEvent,
    canCollectDeposit,
    checkoutMethods,
    formatFullDate,
    formatMoney,
    savedCardLabel,
    strings,
    useBookingAddons,
    useBookingCrew,
    useVisitResource,
    useBookingPhotos,
    useDeparture,
    usePeoplePhotos,
    useSubjectKind,
    useCollectDeposit,
    useNewMessage,
    useSavedCards,
    formatParts,
    BUSINESS_CURRENCY,
    useBusinessZone,
    arrivalWords,
    canCheckIn,
    useUndoCheckIn,
    useNoteComposer,
    useBookingReceipt,
} from "@clientbridge/app-core";
import { cssVar } from "@clientbridge/tokens";
import {
    ActivityTimeline,
    Avatar,
    Badge,
    Button,
    ChargeSheet,
    Choice,
    DetailSection,
    Icon,
    KeyValueList,
    Modal,
    Money,
    Notice,
    Select,
    StatusPill,
    TextField,
} from "@clientbridge/ui";
import { type ChangeEvent, useRef, useState } from "react";

import { api } from "../lib/api";
import { useViewer } from "../lib/auth";
import { CheckInSheet } from "./CheckInSheet";
import { DocumentPreview } from "./DocumentPreview";
import { BookingTreatmentNotes } from "./TreatmentNotes";

const s = strings.bookings;
const c = strings.classes;
const h = strings.clients.history;

export function BookingHeading({ detail }: { detail: BookingDetail }) {
    const e = detail.event;
    return (
        <div className="space-y-1">
            <div className="flex items-center gap-2">
                <StatusPill status={s.statusLabel(e.status)} intent={e.intent} />
                <span className="text-xs font-medium text-muted">{detail.timing}</span>
            </div>
            <h2 className="font-display text-xl font-bold text-ink">{e.headline}</h2>
            <p className="flex items-center gap-1.5 text-sm text-ink-soft">
                {e.color !== null ? (
                    <span
                        aria-hidden
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: e.color }}
                    />
                ) : null}
                {e.serviceName}
            </p>
        </div>
    );
}

function BookingFacts({ detail, layout }: { detail: BookingDetail; layout: "inline" | "stack" }) {
    const zone = useBusinessZone();
    const e = detail.event;
    return (
        <KeyValueList
            layout={layout}
            columns={2}
            rows={[
                {
                    label: s.detailWhen,
                    value:
                        layout === "stack"
                            ? e.timeShort
                            : formatParts([formatFullDate(e.start, zone), e.timeLabel]),
                },
                {
                    label: s.detailWith,
                    value: (
                        <span className="inline-flex items-center gap-1.5">
                            {e.staffColor !== null ? (
                                <span
                                    className="h-2 w-2 rounded-full"
                                    style={{ backgroundColor: e.staffColor }}
                                />
                            ) : null}
                            {e.staffName}
                        </span>
                    ),
                },
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
    );
}

function BookingResource({ event }: { event: ScheduleEvent }) {
    const room = useVisitResource(api, event);
    if (room === null) return null;
    return (
        <DetailSection title={room.label}>
            {room.picker !== null ? (
                <Select
                    label={room.picker.label}
                    options={room.picker.options}
                    value={room.picker.value}
                    onChange={room.picker.pick}
                    disabled={room.busy}
                />
            ) : (
                <p className="text-sm text-ink">{room.name ?? s.problemResource}</p>
            )}
            {room.error !== null ? <Notice tone="danger">{room.error}</Notice> : null}
        </DetailSection>
    );
}

function BookingClient({ detail }: { detail: BookingDetail }) {
    const photos = usePeoplePhotos();
    const { client, subject } = detail;
    const [messaging, setMessaging] = useState(false);
    const cards = useSavedCards(client?.id ?? "");
    const card = cards.find((x) => x.preferred === 1) ?? cards[0];
    if (!client) return null;
    return (
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
            <div className="rounded-md border border-line">
                <div className="flex items-center gap-3 px-3 py-2.5">
                    <Avatar name={client.name} src={photos.client(client.id)} />
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-semibold text-ink">
                                {client.name}
                            </span>
                            {detail.tags.slice(0, 2).map((t) => (
                                <Badge key={t} label={t} intent="accent" />
                            ))}
                        </div>
                        <div className="truncate text-xs text-muted">{detail.clientLine}</div>
                    </div>
                </div>
                {subject ? (
                    <div className="flex items-center gap-3 border-t border-line-soft px-3 py-2.5">
                        <Avatar name={subject.name} size="sm" />
                        <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-ink">{subject.name}</div>
                            {detail.subjectLine !== null ? (
                                <div className="truncate text-xs text-muted">
                                    {detail.subjectLine}
                                </div>
                            ) : null}
                        </div>
                        {detail.temperament !== null ? (
                            <Badge
                                label={detail.temperament.label}
                                intent={detail.temperament.nervous ? "warning" : "neutral"}
                            />
                        ) : null}
                    </div>
                ) : null}
                {detail.directions !== null ? (
                    <div className="flex items-center gap-2 border-t border-line-soft px-3 py-2 text-xs text-muted">
                        <Icon name="pin" size={14} />
                        <span className="min-w-0 flex-1 truncate">{detail.directions.address}</span>
                        <Button
                            size="sm"
                            variant="link"
                            label={s.directionsTo(detail.directions.address)}
                            onPress={() => {
                                if (detail.directions !== null)
                                    window.open(
                                        detail.directions.url,
                                        "_blank",
                                        "noopener,noreferrer",
                                    );
                            }}
                        >
                            {s.directions}
                        </Button>
                    </div>
                ) : null}
                <div className="flex items-center gap-2 border-t border-line-soft px-3 py-2 text-xs text-muted">
                    <Icon name="card" size={14} />
                    {card ? s.cardOnFile(savedCardLabel(card)) : s.noCard}
                </div>
            </div>
            {messaging ? (
                <MessageDialog
                    clientId={client.id}
                    name={client.name}
                    onClose={() => {
                        setMessaging(false);
                    }}
                />
            ) : null}
        </DetailSection>
    );
}

function BookingNotes({ detail }: { detail: BookingDetail }) {
    const bookingId = detail.event.bookingId;
    if (bookingId === null && detail.notes.length === 0) return null;
    return (
        <DetailSection title={s.detailNotes}>
            <div className="space-y-2">
                {detail.notes.map((n) => (
                    <p
                        key={n.id}
                        className="rounded-md bg-warn-bg/60 px-3 py-2 text-sm leading-relaxed text-ink-soft"
                    >
                        {n.body}
                    </p>
                ))}
                {bookingId !== null ? (
                    <BookingNoteBox key={bookingId} bookingId={bookingId} />
                ) : null}
            </div>
        </DetailSection>
    );
}

function BookingNoteBox({ bookingId }: { bookingId: string }) {
    const composer = useNoteComposer(api, { bookingId });
    if (!composer.open)
        return (
            <Button size="sm" variant="quiet" icon="plus" onPress={composer.show}>
                {s.noteAdd}
            </Button>
        );
    return (
        <form
            className="space-y-2"
            onSubmit={(e) => {
                e.preventDefault();
                composer.submit();
            }}
        >
            <TextField
                multiline
                rows={3}
                name={s.notePlaceholder}
                value={composer.body}
                onChange={composer.setBody}
                placeholder={s.notePlaceholder}
                autoFocus
            />
            <div className="flex justify-end gap-2">
                <Button size="sm" variant="quiet" onPress={composer.cancel}>
                    {strings.common.cancel}
                </Button>
                <Button
                    size="sm"
                    submit
                    busy={composer.busy}
                    disabled={composer.body.trim() === ""}
                >
                    {composer.busy ? h.savingNote : h.saveNote}
                </Button>
            </div>
            {composer.error !== null ? <Notice tone="danger">{composer.error}</Notice> : null}
        </form>
    );
}

function BookingPhotos({ event }: { event: ScheduleEvent }) {
    const photos = useBookingPhotos(api, event, useViewer());
    const input = useRef<HTMLInputElement>(null);
    if (photos.photos.length === 0 && !photos.canAdd) return null;
    const onPick = (e: ChangeEvent<HTMLInputElement>): void => {
        const file = e.target.files?.[0];
        if (file !== undefined) photos.add(file, file.type || "image/jpeg", file.size);
        e.target.value = "";
    };
    return (
        <DetailSection
            title={s.detailPhotos}
            action={
                photos.canAdd ? (
                    <Button
                        size="sm"
                        variant="quiet"
                        icon="image"
                        busy={photos.busy}
                        onPress={() => {
                            input.current?.click();
                        }}
                    >
                        {s.photoAdd}
                    </Button>
                ) : undefined
            }
        >
            {photos.photos.length === 0 ? (
                <p className="text-sm text-muted">{s.photosNone}</p>
            ) : (
                <PhotoGrid
                    photos={photos.photos}
                    sharing={photos.sharing}
                    {...(photos.canAdd ? { onShare: photos.share } : {})}
                />
            )}
            <p className="mt-1.5 text-xs text-muted">{s.photosHint}</p>
            {photos.error !== null ? <Notice tone="danger">{photos.error}</Notice> : null}
            <input ref={input} type="file" accept="image/*" hidden onChange={onPick} />
        </DetailSection>
    );
}

/** Thumbnails that open the full photo; a photo whose link is still loading shows a blank tile. */
export function PhotoGrid({
    photos,
    sharing = null,
    onShare,
}: {
    photos: readonly { id: string; src: string | null; shared?: boolean }[];
    sharing?: string | null;
    onShare?: (fileId: string, shared: boolean) => void;
}) {
    return (
        <ul className="grid grid-cols-3 gap-2">
            {photos.map((p, i) => (
                <li key={p.id} className="space-y-1">
                    <div className="aspect-square overflow-hidden rounded-md bg-bg">
                        {p.src !== null ? (
                            <a href={p.src} target="_blank" rel="noreferrer">
                                <img
                                    src={p.src}
                                    alt={s.photoAlt(i + 1)}
                                    className="h-full w-full object-cover"
                                />
                            </a>
                        ) : null}
                    </div>
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
                </li>
            ))}
        </ul>
    );
}

function BookingAddons({ event }: { event: ScheduleEvent }) {
    const viewer = useViewer();
    const addons = useBookingAddons(api, event, viewer);
    const canAdd = addons.canEdit && addons.choices.length > 0;
    if (addons.addons.length === 0 && !canAdd) return null;
    return (
        <DetailSection title={s.detailAddons}>
            {addons.addons.length > 0 ? (
                <ul className="divide-y divide-line-soft rounded-md border border-line">
                    {addons.addons.map((a) => (
                        <li key={a.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                            <Icon name="bag" size={15} />
                            <span className="min-w-0 flex-1 truncate text-ink">
                                {strings.common.quantityOf(a.quantity, a.description)}
                            </span>
                            <Money
                                currency={BUSINESS_CURRENCY}
                                cents={a.quantity * a.unit_amount_cents}
                            />
                            {addons.canEdit ? (
                                <Button
                                    size="sm"
                                    variant="link"
                                    onPress={() => {
                                        addons.remove(a.id);
                                    }}
                                >
                                    {s.addonRemove}
                                </Button>
                            ) : null}
                        </li>
                    ))}
                </ul>
            ) : null}
            {canAdd ? (
                <div className="mt-2">
                    <Select
                        label={s.addonAdd}
                        size="sm"
                        value=""
                        placeholder={s.addonPick}
                        options={addons.choices}
                        onChange={addons.add}
                    />
                </div>
            ) : null}
            <div className="mt-1.5 flex items-center justify-between gap-2">
                <p className="text-xs text-muted">
                    {s.addonsTotal(formatMoney(addons.totalCents, BUSINESS_CURRENCY))}
                </p>
                {addons.invoiceId !== null ? (
                    <span className="text-xs text-muted">{s.visitInvoiced}</span>
                ) : addons.canInvoice ? (
                    <Button
                        size="sm"
                        variant="outline"
                        busy={addons.busy}
                        onPress={addons.createInvoice}
                    >
                        {s.invoiceVisit}
                    </Button>
                ) : null}
            </div>
            {addons.error !== null ? <Notice tone="danger">{addons.error}</Notice> : null}
        </DetailSection>
    );
}

function BookingCrew({ event }: { event: ScheduleEvent }) {
    const crew = useBookingCrew(api, event, useViewer());
    if (!crew.shown) return null;
    return (
        <DetailSection title={s.crewTitle}>
            {crew.members.length > 0 ? (
                <ul className="divide-y divide-line-soft rounded-md border border-line">
                    {crew.members.map((m) => (
                        <li key={m.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                            <Icon name="user" size={15} />
                            <span className="min-w-0 flex-1 truncate text-ink">{m.name}</span>
                            {crew.canEdit ? (
                                <Button
                                    size="sm"
                                    variant="link"
                                    busy={crew.busy}
                                    onPress={() => {
                                        crew.remove(m.id);
                                    }}
                                >
                                    {s.crewRemove}
                                </Button>
                            ) : null}
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-sm text-muted">{s.crewNone}</p>
            )}
            {crew.canEdit && crew.options.length > 0 ? (
                <div className="mt-2">
                    <Select
                        label={s.crewAdd}
                        size="sm"
                        value=""
                        placeholder={s.crewPick}
                        options={crew.options}
                        onChange={crew.add}
                    />
                </div>
            ) : null}
            <p className="mt-1.5 text-xs text-muted">{s.crewHint}</p>
            {crew.error !== null ? <Notice tone="danger">{crew.error}</Notice> : null}
        </DetailSection>
    );
}

function BookingDocuments({ event }: { event: ScheduleEvent }) {
    const receipt = useBookingReceipt(api, event, useViewer(), cssVar("accent"));
    if (!receipt.available) return null;
    const doc = receipt.doc;
    return (
        <DetailSection title={strings.billing.doc.title}>
            <Button
                size="sm"
                variant="outline"
                icon="receipt"
                busy={receipt.busy}
                onPress={receipt.open}
            >
                {receipt.busy ? s.receiptLoading : s.receipt}
            </Button>
            {receipt.error !== null ? <Notice tone="danger">{receipt.error}</Notice> : null}
            {doc !== null ? (
                <DocumentPreview
                    businessName={doc.business.name}
                    doc={doc}
                    attached={strings.billing.doc.attachedVisit}
                    onClose={receipt.close}
                />
            ) : null}
        </DetailSection>
    );
}

function BookingRoster({ detail }: { detail: BookingDetail }) {
    if (detail.event.kind !== "class") return null;
    return (
        <DetailSection title={s.classSeats(detail.event.bookedCount, detail.event.capacity)}>
            {detail.roster.length === 0 ? (
                <p className="text-sm text-muted">{c.emptyRoster}</p>
            ) : (
                <ul className="divide-y divide-line-soft rounded-md border border-line">
                    {detail.roster.map((r) => (
                        <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                            <Avatar
                                name={r.subjectName === "" ? r.name : r.subjectName}
                                size="sm"
                            />
                            <span className="min-w-0 flex-1 truncate">
                                <span className="font-medium text-ink">
                                    {r.subjectName === "" ? r.name : r.subjectName}
                                </span>
                                {r.subjectName !== "" ? (
                                    <span className="text-muted">
                                        {strings.common.separator}
                                        {r.name}
                                    </span>
                                ) : null}
                            </span>
                            {r.waiting ? (
                                <Badge label={s.waitlist} intent="neutral" />
                            ) : r.unpaid ? (
                                <Badge label={s.unpaid} intent="warning" />
                            ) : null}
                        </li>
                    ))}
                </ul>
            )}
        </DetailSection>
    );
}

function BookingHistory({ detail }: { detail: BookingDetail }) {
    if (detail.history.length === 0) return null;
    return (
        <DetailSection title={s.detailHistory}>
            <ActivityTimeline entries={detail.history} />
        </DetailSection>
    );
}

/** Lifecycle buttons with the consequence spelled out in place before a no-show or cancel goes through. */
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
            <div className="min-w-0 flex-1 space-y-3">
                <div>
                    <p className="text-sm font-semibold text-ink">
                        {noShow ? s.noShowTitle : s.cancelTitle}
                    </p>
                    <p className="mt-0.5 text-sm text-muted">
                        {noShow ? actions.noShowNote : actions.cancelNote}
                    </p>
                </div>
                {actions.error !== null ? <Notice tone="danger">{actions.error}</Notice> : null}
                <div className="flex justify-end gap-2">
                    <Button
                        variant="quiet"
                        onPress={() => {
                            setAsking(null);
                        }}
                    >
                        {s.keepVisit}
                    </Button>
                    <Button
                        variant="danger"
                        busy={actions.busy}
                        onPress={() => {
                            actions.run(asking);
                        }}
                    >
                        {actions.busy ? s.working : noShow ? s.confirmNoShow : s.confirmCancel}
                    </Button>
                </div>
            </div>
        );
    }
    return (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {actions.canComplete || actions.notStartedNote !== null ? (
                <Button
                    busy={actions.pending === "complete"}
                    disabled={!actions.canComplete}
                    icon="check"
                    onPress={() => {
                        actions.run("complete");
                    }}
                >
                    {actions.pending === "complete" ? s.working : s.completeVisit}
                </Button>
            ) : null}
            {actions.canNoShow || actions.notStartedNote !== null ? (
                <Button
                    variant="outline"
                    disabled={!actions.canNoShow}
                    onPress={() => {
                        setAsking("no_show");
                    }}
                >
                    {s.markNoShow}
                </Button>
            ) : null}
            {actions.canReschedule && onReschedule ? (
                <Button variant="outline" onPress={onReschedule}>
                    {s.reschedule}
                </Button>
            ) : null}
            {actions.canCancel ? (
                <span className="ml-auto">
                    <Button
                        variant="quiet"
                        onPress={() => {
                            setAsking("cancel");
                        }}
                    >
                        {s.cancel}
                    </Button>
                </span>
            ) : null}
            {actions.notStartedNote !== null ? (
                <p className="w-full text-xs text-muted">{actions.notStartedNote}</p>
            ) : null}
            {actions.error !== null ? (
                <div className="w-full">
                    <Notice tone="danger">{actions.error}</Notice>
                </div>
            ) : null}
        </div>
    );
}

function Departure({ event }: { event: ScheduleEvent }) {
    const departure = useDeparture(api, event, useViewer(), useSubjectKind());
    if (!departure.canDepart) return null;
    return (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface px-4 py-3">
            <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{s.departTitle}</p>
                <p className="mt-0.5 text-sm text-muted">{s.departBody}</p>
            </div>
            <Button icon="send" busy={departure.busy} onPress={departure.depart}>
                {s.departAction}
            </Button>
            {departure.error !== null ? (
                <div className="w-full">
                    <Notice tone="danger">{departure.error}</Notice>
                </div>
            ) : null}
        </div>
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
            <Notice tone="success" banner>
                <span className="flex items-center justify-between gap-3">
                    {done}
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
                </span>
            </Notice>
        );
    }
    if (event.bookingId === null || !canCheckIn(event, viewer, kind, zone)) return null;
    const bookingId = event.bookingId;
    const words = arrivalWords(kind);
    return (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface px-4 py-3">
            <p className="min-w-0 flex-1 text-sm text-muted">
                {kind === "site" ? strings.today.arriveBody : strings.today.checkInBody}
            </p>
            <Button
                icon="check"
                onPress={() => {
                    setOpen(true);
                }}
            >
                {words.action}
            </Button>
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
        </div>
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
        <div className="rounded-md border border-warn/30 bg-warn-bg px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-warn">
                <Icon name="dollar" size={16} />
                {s.depositDueTitle(amount)}
            </p>
            {collecting ? (
                <div className="mt-3">
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
                </div>
            ) : (
                <>
                    <p className="mt-1 text-sm text-ink-soft">
                        {deposit.settling !== null ? s.depositSettling : s.depositDueBody}
                    </p>
                    {canCollectDeposit(event, viewer) && deposit.settling === null ? (
                        <div className="mt-3 flex gap-2">
                            <Button
                                size="sm"
                                onPress={() => {
                                    setCollecting(true);
                                }}
                            >
                                {s.collectNow}
                            </Button>
                        </div>
                    ) : null}
                </>
            )}
        </div>
    );
}

export function BookingBody({
    detail,
    narrow = false,
    withStatus = false,
}: {
    detail: BookingDetail;
    narrow?: boolean;
    withStatus?: boolean;
}) {
    return (
        <>
            {withStatus ? (
                <div className="flex items-center gap-2">
                    <StatusPill
                        status={s.statusLabel(detail.event.status)}
                        intent={detail.event.intent}
                    />
                    <span className="text-xs font-medium text-muted">{detail.timing}</span>
                </div>
            ) : null}
            <div className={`rounded-md border border-line bg-bg px-4 ${narrow ? "py-3" : "py-1"}`}>
                <BookingFacts detail={detail} layout={narrow ? "stack" : "inline"} />
            </div>
            <BookingResource key={`room:${detail.event.id}`} event={detail.event} />
            <Departure event={detail.event} />
            <CheckInCard key={detail.event.id} event={detail.event} />
            <DepositDue event={detail.event} />
            <BookingClient detail={detail} />
            <BookingRoster detail={detail} />
            <BookingNotes detail={detail} />
            {detail.event.bookingId !== null ? <BookingPhotos event={detail.event} /> : null}
            {detail.event.bookingId !== null ? <BookingAddons event={detail.event} /> : null}
            {detail.event.bookingId !== null ? (
                <BookingCrew key={detail.event.bookingId} event={detail.event} />
            ) : null}
            {detail.event.bookingId !== null ? <BookingDocuments event={detail.event} /> : null}
            {detail.event.bookingId !== null ? (
                <BookingTreatmentNotes key={detail.event.bookingId} event={detail.event} />
            ) : null}
            <BookingHistory detail={detail} />
        </>
    );
}

function MessageDialog({
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
        <Modal size="sm" onClose={onClose}>
            <div className="space-y-4">
                <h2 className="font-display text-lg font-bold text-ink">{s.messageTitle(name)}</h2>
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
                    autoFocus
                />
                {m.error !== null ? <Notice tone="danger">{m.error}</Notice> : null}
                <div className="flex justify-end gap-2">
                    <Button variant="outline" onPress={onClose}>
                        {s.messageCancel}
                    </Button>
                    <Button busy={m.busy} disabled={m.smsBlocked} onPress={m.submit} icon="send">
                        {s.messageSend}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
