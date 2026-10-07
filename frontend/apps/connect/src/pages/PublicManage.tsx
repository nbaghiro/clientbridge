import {
    type Fact,
    type ManageBookingFlow,
    createManageBookingClient,
    durationLabel,
    strings,
    useManageBooking,
} from "@clientbridge/app-core/public";
import {
    Button,
    DateStrip,
    Empty,
    FactList,
    Icon,
    Notice,
    Skeleton,
    TimeSlotPicker,
} from "@clientbridge/ui";
import { useNavigate, useParams } from "react-router-dom";

import { addToCalendar } from "../components/BookingSteps";
import { PublicPage } from "../components/PublicPage";
import { PublicStatus } from "../components/PublicStatus";
import { config } from "../config";

const manage = createManageBookingClient(config.apiUrl);
const s = strings.publicManage;
const b = strings.publicBooking;

const upper = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

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
        <PublicPage name={v.business_name} brand={v.brand} width="narrow">
            <div className="rounded-xl border border-line bg-surface p-5 shadow-card sm:p-6">
                {mg.mode === "move" ? (
                    <MovePicker mg={mg} />
                ) : mg.mode === "cancel" ? (
                    <CancelConfirm mg={mg} />
                ) : mg.mode === "moved" || mg.mode === "canceled" ? (
                    <ManageDone mg={mg} />
                ) : (
                    <div className="space-y-5">
                        <div>
                            <p className="text-sm text-muted">{s.hello(v.client_name)}</p>
                            <h1 className="font-display text-2xl font-bold text-ink">{s.title}</h1>
                            {mg.live ? (
                                <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-accent">
                                    <Icon name="clock" size={15} />
                                    {mg.countdown}
                                </p>
                            ) : null}
                        </div>
                        {v.status === "canceled" ? (
                            <Notice tone="info" banner>
                                {s.canceledAlready}
                            </Notice>
                        ) : null}
                        <BookingFacts mg={mg} />
                        {mg.blocked !== null ? (
                            <Notice tone="info" banner>
                                {mg.blocked}
                            </Notice>
                        ) : null}
                        {mg.live ? (
                            <div className="grid gap-2 sm:grid-cols-2">
                                <Button
                                    variant="outline"
                                    icon="calendar"
                                    disabled={!mg.canMove}
                                    onPress={() => {
                                        mg.setMode("move");
                                    }}
                                >
                                    {s.reschedule}
                                </Button>
                                <Button
                                    variant="outline"
                                    icon="x"
                                    disabled={!mg.canCancel}
                                    onPress={() => {
                                        mg.setMode("cancel");
                                    }}
                                >
                                    {s.cancel}
                                </Button>
                            </div>
                        ) : null}
                    </div>
                )}
            </div>
            {mg.mode === "view" ? (
                <section className="mt-4 rounded-xl border border-line bg-surface p-5 text-sm shadow-card">
                    <h2 className="flex items-center gap-2 font-semibold text-ink">
                        <Icon name="shield" size={15} />
                        {s.policyTitle}
                    </h2>
                    <p className="mt-1 text-ink-soft">{mg.policyLine}</p>
                </section>
            ) : null}
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
            <DateStrip
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
                    <TimeSlotPicker
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
                {moved ? s.movedBody(mg.when) : s.canceledBody(mg.refundLabel)}
            </p>
            <div className="mt-5 flex justify-center gap-2">
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
