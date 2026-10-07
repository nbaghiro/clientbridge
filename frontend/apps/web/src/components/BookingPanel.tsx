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
    useCollectDeposit,
    useNewMessage,
    useSavedCards,
    useStationPicker,
} from "@clientbridge/app-core";
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
    StatusPill,
    TextField,
} from "@clientbridge/ui";
import { useState } from "react";

import { api } from "../lib/api";
import { useViewer } from "../lib/auth";

const s = strings.bookings;
const c = strings.classes;

export function BookingHeading({ detail }: { detail: BookingDetail }) {
    const e = detail.event;
    return (
        <div className="space-y-1">
            <div className="flex items-center gap-2">
                <StatusPill status={s.statusLabel(e.status)} intent={e.intent} asWritten />
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
                            : `${formatFullDate(e.start)} · ${e.timeLabel}`,
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
    );
}

function BookingClient({ detail }: { detail: BookingDetail }) {
    const { client, pet } = detail;
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
                    <Avatar name={client.name} />
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
                {pet ? (
                    <div className="flex items-center gap-3 border-t border-line-soft px-3 py-2.5">
                        <Avatar name={pet.name} size="sm" />
                        <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-ink">{pet.name}</div>
                            {detail.petLine !== null ? (
                                <div className="truncate text-xs text-muted">{detail.petLine}</div>
                            ) : null}
                        </div>
                        {pet.temperament !== null ? (
                            <Badge
                                label={pet.temperament}
                                intent={detail.petNervous ? "warning" : "neutral"}
                            />
                        ) : null}
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
    if (detail.notes.length === 0) return null;
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
            </div>
        </DetailSection>
    );
}

function BookingAddons({ event }: { event: ScheduleEvent }) {
    const viewer = useViewer();
    const addons = useBookingAddons(api, event, viewer);
    if (addons.addons.length === 0) return null;
    return (
        <DetailSection title={s.detailAddons}>
            <ul className="divide-y divide-line-soft rounded-md border border-line">
                {addons.addons.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                        <Icon name="bag" size={15} />
                        <span className="min-w-0 flex-1 truncate text-ink">
                            {a.quantity} × {a.description}
                        </span>
                        <Money cents={a.quantity * a.unit_amount_cents} />
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
            <div className="mt-1.5 flex items-center justify-between gap-2">
                <p className="text-xs text-muted">
                    {s.addonsTotal(formatMoney(addons.totalCents))}
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
                            <Avatar name={r.pet === "" ? r.name : r.pet} size="sm" />
                            <span className="min-w-0 flex-1 truncate">
                                <span className="font-medium text-ink">
                                    {r.pet === "" ? r.name : r.pet}
                                </span>
                                {r.pet !== "" ? (
                                    <span className="text-muted"> · {r.name}</span>
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

function StationPicker({ event }: { event: ScheduleEvent }) {
    const [saved, setSaved] = useState(false);
    const picker = useStationPicker(api, event, () => {
        setSaved(true);
    });
    if (event.kind !== "visit" || event.bookingId === null || picker.options.length === 0)
        return null;
    if (event.status !== "confirmed" && event.status !== "pending") return null;
    return (
        <DetailSection title={c.pickTitle}>
            <p className="mb-2 text-xs text-muted">{c.pickSubtitle}</p>
            <Choice
                layout="cards"
                label={c.pickTitle}
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
                onChange={(k) => {
                    setSaved(false);
                    picker.setValue(k);
                }}
            />
            {picker.changed && !saved ? (
                <div className="mt-2 flex justify-end">
                    <Button size="sm" busy={picker.busy} onPress={picker.save}>
                        {c.saveStation}
                    </Button>
                </div>
            ) : null}
            {picker.error !== null ? <Notice tone="danger">{picker.error}</Notice> : null}
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
            {actions.canComplete ? (
                <Button
                    busy={actions.pending === "complete"}
                    icon="check"
                    onPress={() => {
                        actions.run("complete");
                    }}
                >
                    {actions.pending === "complete" ? s.working : s.completeVisit}
                </Button>
            ) : null}
            {actions.canNoShow ? (
                <Button
                    variant="outline"
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
            {actions.error !== null ? (
                <div className="w-full">
                    <Notice tone="danger">{actions.error}</Notice>
                </div>
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
    const amount = formatMoney(event.depositAmountCents);
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
                    <p className="mt-1 text-sm text-ink-soft">{s.depositDueBody}</p>
                    {canCollectDeposit(event, viewer) ? (
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
                        asWritten
                    />
                    <span className="text-xs font-medium text-muted">{detail.timing}</span>
                </div>
            ) : null}
            <div className={`rounded-md border border-line bg-bg px-4 ${narrow ? "py-3" : "py-1"}`}>
                <BookingFacts detail={detail} layout={narrow ? "stack" : "inline"} />
            </div>
            <DepositDue event={detail.event} />
            <BookingClient detail={detail} />
            <BookingRoster detail={detail} />
            <BookingNotes detail={detail} />
            {detail.event.bookingId !== null ? <BookingAddons event={detail.event} /> : null}
            <StationPicker event={detail.event} />
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
                <TextField
                    label={s.messageBody}
                    multiline
                    rows={4}
                    value={m.body}
                    onChange={m.setBody}
                    placeholder={s.messagePlaceholder}
                    autoFocus
                />
                {m.error !== null ? <Notice tone="danger">{m.error}</Notice> : null}
                <div className="flex justify-end gap-2">
                    <Button variant="outline" onPress={onClose}>
                        {s.messageCancel}
                    </Button>
                    <Button busy={m.busy} onPress={m.submit} icon="send">
                        {s.messageSend}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
