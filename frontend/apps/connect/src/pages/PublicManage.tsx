import {
    type Fact,
    type ManageBookingFlow,
    createManageBookingClient,
    durationLabel,
    strings,
    useManageBooking,
} from "@clientbridge/app-core/public";
import {
    ActionTile,
    Modal,
    Button,
    DayRail,
    Empty,
    FactList,
    Icon,
    Notice,
    Skeleton,
    TextField,
    SlotChips,
} from "@clientbridge/ui";
import { useNavigate, useParams } from "react-router-dom";

import { addToCalendar } from "../components/BookingSteps";
import { PublicPage } from "../components/PublicPage";
import { PublicStatus } from "../components/PublicStatus";
import { config } from "../config";

const manage = createManageBookingClient(config.apiUrl);
const s = strings.publicManage;
const b = strings.publicBooking;
const upper = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

/** The link in every confirmation and reminder: see the visit, move it or cancel it within the cut-offs. */
export function PublicManage() {
    const { token = "" } = useParams<{ token: string }>();
    const mg = useManageBooking(manage, token);
    const v = mg.booking;
    if (mg.status === "loading") return <PublicStatus kind="loading" />;
    if (mg.status === "not-found")
        return <PublicStatus kind="notFound" title={s.notFoundTitle} body={s.notFoundBody} />;
    if (mg.status === "error" || v === null)
        return <PublicStatus kind="error" title={b.errorTitle} body={b.errorBody} />;

    return (
        <PublicPage name={v.business_name} brand={v.brand}>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8">
                <div className="min-w-0 space-y-5">
                    <p className="text-[15px] text-ink-soft">{s.hello(v.client_name)}</p>
                    {mg.mode === "moved" || mg.mode === "canceled" ? (
                        <div className="rounded-3xl border border-line bg-surface p-6 shadow-card">
                            <ManageDone mg={mg} />
                        </div>
                    ) : null}
                    <article
                        className={`overflow-hidden rounded-3xl bg-surface shadow-card ring-1 ring-line ${v.status === "canceled" ? "opacity-70" : ""}`}
                    >
                        <div className="relative bg-accent p-5 text-accent-ink sm:p-7">
                            <div className="relative flex items-start gap-4 sm:gap-6">
                                <div className="flex w-[72px] shrink-0 flex-col items-center rounded-2xl bg-white/10 py-2.5 ring-1 ring-white/20 sm:w-[88px]">
                                    <span className="text-xs font-semibold uppercase tracking-wide opacity-80">
                                        {mg.dateTile.month}
                                    </span>
                                    <span className="font-display text-[40px] font-bold leading-none sm:text-5xl">
                                        {mg.dateTile.day}
                                    </span>
                                    <span className="mt-1 text-xs opacity-80">
                                        {mg.dateTile.weekday}
                                    </span>
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-xs font-semibold uppercase tracking-wide opacity-75">
                                        {v.status === "canceled" ? s.canceledTitle : s.title}
                                    </p>
                                    <h1 className="mt-1 font-display text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
                                        {v.service.name}
                                    </h1>
                                    <p className="mt-1 text-[15px] font-medium opacity-90">
                                        {mg.when}
                                    </p>
                                    {mg.live ? (
                                        <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-xs font-semibold text-accent">
                                            <Icon name="clock" size={12} />
                                            {mg.countdown}
                                        </span>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                        <div aria-hidden className="relative h-0">
                            <span className="absolute -left-3 -top-3 h-6 w-6 rounded-full bg-bg ring-1 ring-line" />
                            <span className="absolute -right-3 -top-3 h-6 w-6 rounded-full bg-bg ring-1 ring-line" />
                            <span className="absolute inset-x-5 top-0 border-t-2 border-dashed border-line" />
                        </div>
                        <div className="p-5 sm:p-7">
                            <BookingFacts mg={mg} />
                        </div>
                    </article>
                    {v.status === "canceled" ? (
                        <Notice tone="info">{mg.refundMessage ?? s.canceledAlready}</Notice>
                    ) : null}
                    {mg.live ? (
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                            <ActionTile
                                icon="calendar"
                                label={s.reschedule}
                                disabled={!mg.canMove}
                                onPress={() => {
                                    mg.setMode("move");
                                }}
                            />
                            <ActionTile
                                icon="x"
                                label={s.cancel}
                                disabled={!mg.canCancel}
                                onPress={() => {
                                    mg.setMode("cancel");
                                }}
                            />
                            <ActionTile
                                icon="calendar"
                                label={s.addCalendar}
                                onPress={() => {
                                    addToCalendar(mg.calendar);
                                }}
                            />
                            {v.address ? (
                                <ActionTile
                                    icon="pin"
                                    label={s.directions}
                                    onPress={() => {
                                        window.open(
                                            `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.address ?? "")}`,
                                            "_blank",
                                            "noopener,noreferrer",
                                        );
                                    }}
                                />
                            ) : null}
                            <ActionTile
                                icon="message"
                                label={s.message}
                                onPress={() => {
                                    document
                                        .getElementById("visit-message")
                                        ?.scrollIntoView({ behavior: "smooth" });
                                }}
                            />
                        </div>
                    ) : null}
                    {mg.live ? (
                        <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
                            <h2 className="mb-2 font-display text-lg font-bold">{s.policyTitle}</h2>
                            <p className="text-sm text-ink-soft">{mg.policyLine}</p>
                            {v.policy.self_service ? (
                                <div className="mt-5">
                                    <div className="relative h-2.5 overflow-hidden rounded-full bg-line">
                                        <span
                                            className="absolute inset-y-0 left-0 bg-ok-fg/70"
                                            style={{ width: `${String(mg.windowMeter.first)}%` }}
                                        />
                                        <span
                                            className="absolute inset-y-0 bg-warn-fg/70"
                                            style={{
                                                left: `${String(mg.windowMeter.first)}%`,
                                                width: `${String(mg.windowMeter.second - mg.windowMeter.first)}%`,
                                            }}
                                        />
                                        <span
                                            className="absolute inset-y-0 right-0 bg-dan-fg/50"
                                            style={{ left: `${String(mg.windowMeter.second)}%` }}
                                        />
                                    </div>
                                    <div className="relative h-0">
                                        <span
                                            aria-hidden
                                            className="absolute -top-[15px] h-5 w-5 -translate-x-1/2 rounded-full border-[3px] border-surface bg-ink"
                                            style={{ left: `${String(mg.windowMeter.now)}%` }}
                                        />
                                    </div>
                                    <ol className="mt-3 grid grid-cols-3 gap-2 text-xs leading-snug text-muted">
                                        <li>{s.cancelDeadline(mg.cancelDeadline)}</li>
                                        <li className="text-center">
                                            {s.moveDeadline(mg.moveDeadline)}
                                        </li>
                                        <li className="text-right">{mg.when}</li>
                                    </ol>
                                </div>
                            ) : null}
                            {mg.blocked ? (
                                <p className="mt-4 text-sm text-muted">{mg.blocked}</p>
                            ) : null}
                        </section>
                    ) : null}
                    <section
                        id="visit-message"
                        className="scroll-mt-6 space-y-4 rounded-2xl border border-line bg-surface p-5 shadow-card"
                    >
                        <h2 className="font-display text-lg font-bold">{s.messageTitle}</h2>
                        {mg.messageSent ? <Notice tone="success">{s.messageSent}</Notice> : null}
                        <TextField
                            label={s.messageLabel}
                            value={mg.messageBody}
                            onChange={mg.setMessageBody}
                            multiline
                            maxLength={2000}
                        />
                        {mg.error ? <Notice tone="danger">{mg.error}</Notice> : null}
                        <Button
                            icon="message"
                            disabled={!mg.messageBody.trim()}
                            busy={mg.busy}
                            onPress={mg.sendMessage}
                        >
                            {s.messageSend}
                        </Button>
                    </section>
                </div>
                <aside className="space-y-5">
                    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
                        <h2 className="mb-3 font-display text-lg font-bold">{s.gettingThere}</h2>
                        <p className="font-semibold">{v.business_name}</p>
                        {v.address ? (
                            <>
                                <p className="mt-1 text-sm text-muted">{v.address}</p>
                                <Button
                                    variant="outline"
                                    icon="pin"
                                    full
                                    className="mt-4"
                                    onPress={() => {
                                        window.open(
                                            `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.address ?? "")}`,
                                            "_blank",
                                            "noopener,noreferrer",
                                        );
                                    }}
                                >
                                    {s.directions}
                                </Button>
                            </>
                        ) : null}
                        {v.parking_note ? (
                            <p className="mt-4 rounded-xl bg-bg p-3 text-sm text-ink-soft">
                                {v.parking_note}
                            </p>
                        ) : null}
                    </section>
                    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
                        <h2 className="mb-3 font-display text-lg font-bold">{s.payment}</h2>
                        <p className="text-sm text-ink-soft">
                            {mg.hasDeposit ? s.depositPaid(mg.deposit) : s.cancelNoDeposit}
                        </p>
                        <p className="mt-3 text-xs text-muted">{mg.policyLine}</p>
                    </section>
                </aside>
            </div>
            <Modal
                open={mg.mode === "move" || mg.mode === "cancel" || mg.mode === "message"}
                onClose={() => {
                    if (!mg.busy) mg.setMode("view");
                }}
                size="lg"
            >
                {mg.mode === "move" ? (
                    <MovePicker mg={mg} />
                ) : mg.mode === "cancel" ? (
                    <CancelConfirm mg={mg} />
                ) : mg.mode === "message" ? (
                    <div className="space-y-4">
                        <h2 className="font-display text-xl font-bold">{s.messageTitle}</h2>
                        {mg.messageSent ? <Notice tone="success">{s.messageSent}</Notice> : null}
                        <TextField
                            label={s.messageLabel}
                            value={mg.messageBody}
                            onChange={mg.setMessageBody}
                            multiline
                            maxLength={2000}
                        />
                        {mg.error ? <Notice tone="danger">{mg.error}</Notice> : null}
                        <div className="flex gap-3">
                            <Button
                                variant="quiet"
                                onPress={() => {
                                    mg.setMode("view");
                                }}
                            >
                                {s.back}
                            </Button>
                            <Button
                                grow
                                disabled={!mg.messageBody.trim()}
                                busy={mg.busy}
                                onPress={mg.sendMessage}
                            >
                                {s.messageSend}
                            </Button>
                        </div>
                    </div>
                ) : null}
            </Modal>
        </PublicPage>
    );
}

function BookingFacts({ mg }: { mg: ManageBookingFlow }) {
    const v = mg.booking;
    if (v === null) return null;
    const what = [
        v.service.name,
        v.service.duration_min !== null ? durationLabel(v.service.duration_min) : null,
    ]
        .filter(Boolean)
        .join(" · ");
    const facts: Fact[] = [
        { key: "when", icon: "calendar", title: upper(mg.when), detail: mg.timeRange },
        ...(v.staff.name !== null
            ? [
                  {
                      key: "who",
                      icon: "user" as const,
                      title: v.staff.name,
                      ...(v.staff.title !== null ? { detail: v.staff.title } : {}),
                  },
              ]
            : []),
        v.pet_name !== null
            ? { key: "what", icon: "paw", title: v.pet_name, detail: what }
            : { key: "what", icon: "paw", title: what },
        { key: "where", icon: "pin", title: v.business_name },
    ];
    return (
        <div className="space-y-4">
            <FactList facts={facts} label={s.title} />
            {v.addons.length > 0 || mg.hasDeposit ? (
                <dl className="space-y-1 border-t border-line-soft pt-3 text-sm">
                    {v.addons.map((a) => (
                        <div key={a.name} className="flex justify-between gap-3">
                            <dt className="text-ink-soft">{`${String(a.quantity)} × ${a.name}`}</dt>
                            <dd className="text-muted">{s.extras}</dd>
                        </div>
                    ))}
                    {mg.hasDeposit ? (
                        <div className="flex justify-between gap-3">
                            <dt className="text-ink-soft">{s.deposit}</dt>
                            <dd className="flex items-center gap-1 text-ok-fg">
                                <Icon name="check" size={13} />
                                {s.depositPaid(mg.deposit)}
                            </dd>
                        </div>
                    ) : null}
                </dl>
            ) : null}
        </div>
    );
}

function MovePicker({ mg }: { mg: ManageBookingFlow }) {
    const v = mg.booking;
    if (v === null) return null;
    return (
        <div className="space-y-4">
            <div>
                <h2 className="font-display text-xl font-bold text-ink">{s.moveTitle}</h2>
                <p className="mt-1 text-sm text-muted">
                    {s.moveHint(
                        (v.staff.name ?? "").split(" ")[0] ?? "",
                        v.service.duration_min !== null
                            ? durationLabel(v.service.duration_min)
                            : "",
                    )}
                </p>
            </div>
            <DayRail
                label={b.date}
                days={mg.strip}
                value={mg.date}
                onChange={mg.setDate}
                {...(mg.canPrevWeek ? { onPrev: mg.prevWeek } : {})}
                onNext={mg.nextWeek}
                prevLabel={b.prevWeek}
                nextLabel={b.nextWeek}
            />
            <div className="min-h-[120px]">
                {mg.slots === null ? (
                    <Skeleton variant="line" count={3} label={b.loadingTimes} />
                ) : mg.slots.length === 0 ? (
                    <Empty
                        icon="calendar"
                        message={s.noTimes}
                        actions={
                            <Button
                                size="sm"
                                variant="outline"
                                icon="chevronRight"
                                onPress={mg.nextWeek}
                            >
                                {b.nextWeek}
                            </Button>
                        }
                    />
                ) : (
                    <SlotChips
                        label={b.openTimes}
                        groups={mg.slotGroups}
                        value={mg.pick || null}
                        onChange={mg.setPick}
                    />
                )}
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-bg p-3 text-sm">
                <div>
                    <p className="text-xs text-muted">{s.current}</p>
                    <p className="font-medium text-ink-soft line-through">{upper(mg.when)}</p>
                </div>
                <div>
                    <p className="text-xs text-muted">{s.newTime}</p>
                    <p className="font-semibold text-ink">
                        {mg.pickLabel !== null ? upper(mg.pickLabel) : "—"}
                    </p>
                </div>
            </div>
            {mg.error !== null ? <Notice tone="danger">{mg.error}</Notice> : null}
            <div className="flex gap-2">
                <Button
                    variant="quiet"
                    onPress={() => {
                        mg.setMode("view");
                    }}
                >
                    {s.back}
                </Button>
                <Button grow disabled={mg.pick === ""} busy={mg.busy} onPress={mg.confirmMove}>
                    {mg.busy
                        ? s.moving
                        : mg.pickTime !== null
                          ? s.confirmMove(mg.pickTime)
                          : s.reschedule}
                </Button>
            </div>
        </div>
    );
}

function CancelConfirm({ mg }: { mg: ManageBookingFlow }) {
    return (
        <div className="space-y-4">
            <div>
                <h2 className="font-display text-xl font-bold text-ink">{s.cancelTitle}</h2>
                <p className="mt-1 text-sm text-ink-soft">{upper(mg.when)}</p>
            </div>
            <Notice tone="info" banner>
                {mg.cancelOutcome}
            </Notice>
            {mg.error !== null ? <Notice tone="danger">{mg.error}</Notice> : null}
            <div className="flex flex-col gap-2 sm:flex-row-reverse">
                <Button variant="danger" grow busy={mg.busy} onPress={mg.confirmCancel}>
                    {mg.busy ? s.canceling : s.cancelConfirm}
                </Button>
                <Button
                    variant="outline"
                    grow
                    onPress={() => {
                        mg.setMode("view");
                    }}
                >
                    {s.keep}
                </Button>
            </div>
        </div>
    );
}

function ManageDone({ mg }: { mg: ManageBookingFlow }) {
    const navigate = useNavigate();
    const moved = mg.mode === "moved";
    return (
        <div className="text-center">
            <span
                aria-hidden
                className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${moved ? "bg-ok-bg text-ok-fg" : "bg-bg text-muted"}`}
            >
                <Icon name={moved ? "check" : "x"} size={26} />
            </span>
            <h1 className="mt-4 font-display text-2xl font-bold text-ink">
                {moved ? s.movedTitle : s.canceledTitle}
            </h1>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
                {moved
                    ? s.movedBody(mg.when)
                    : (mg.refundMessage ?? s.canceledBody(mg.refundLabel))}
            </p>
            <div className="mt-5 flex justify-center gap-2">
                {mg.refundMessage ? (
                    <Button
                        variant="outline"
                        icon="message"
                        onPress={() => {
                            mg.setMode("message");
                        }}
                    >
                        {s.message}
                    </Button>
                ) : null}
                {moved ? (
                    <Button
                        variant="outline"
                        icon="calendar"
                        onPress={() => {
                            addToCalendar(mg.calendar);
                        }}
                    >
                        {s.addCalendar}
                    </Button>
                ) : (
                    <Button
                        icon="calendar"
                        onPress={() => {
                            const done = navigate(
                                `/book/${encodeURIComponent(mg.booking?.slug ?? "")}`,
                            );
                            if (done) done.catch(() => undefined);
                        }}
                    >
                        {s.bookAgain}
                    </Button>
                )}
            </div>
        </div>
    );
}
