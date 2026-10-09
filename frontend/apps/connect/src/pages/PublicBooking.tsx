import { BusinessNavigation } from "../components/BusinessNavigation";
import {
    createPublicBookingClient,
    createReturningClient,
    useReturningClient,
    type PublicBookingFlow,
    strings,
    durationLabel,
    usePublicBookingFlow,
} from "@clientbridge/app-core/public";
import {
    Button,
    Choice,
    TextField,
    DocTotals,
    Notice,
    Icon,
    ItemImage,
    OptionCard,
} from "@clientbridge/ui";
import { type ReactNode, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import {
    DetailsForm,
    DoneCard,
    PayStep,
    ServicePicker,
    SuggestedExtras,
    WhenPicker,
} from "../components/BookingSteps";
import { brandStyle, PublicPage, Rating } from "../components/PublicPage";
import { PublicStatus } from "../components/PublicStatus";
import { config } from "../config";
import { useEmbedBrand, useEmbedSuccess } from "../embed";

const booking = createPublicBookingClient(config.apiUrl);
const returningClient = createReturningClient(config.apiUrl);
const s = strings.publicBooking;

const draftStorage = (() => {
    try {
        return window.sessionStorage;
    } catch {
        return undefined;
    }
})();

export function PublicBooking() {
    const { slug = "" } = useParams<{ slug: string }>();
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const guided = params.get("presentation") === "guided";
    const flow = usePublicBookingFlow(booking, slug, {
        storage: draftStorage,
        itemId: params.get("service") ?? undefined,
        staffId: params.get("staff") ?? undefined,
        startsAt: params.get("starts") ?? params.get("at") ?? undefined,
    });
    const returning = useReturningClient(returningClient, slug, flow);
    const page = flow.page;
    useEmbedBrand(page);
    useEmbedSuccess(flow.step === "done", "booking");

    if (flow.status === "loading") return <PublicStatus kind="loading" />;
    if (flow.status === "not-found")
        return <PublicStatus kind="notFound" title={s.notFoundTitle} body={s.notFoundBody} />;
    if (flow.status === "error" || page === null)
        return <PublicStatus kind="error" title={s.errorTitle} body={s.errorBody} />;

    const rating =
        page.rating !== null && page.review_count > 0 ? (
            <span className="hidden sm:block">
                <Rating label={s.reviews(page.rating.toFixed(1), page.review_count)} />
            </span>
        ) : null;

    if (flow.step === "done") {
        const token = flow.result?.manage_token ?? null;
        return (
            <PublicPage name={page.business_name} brand={page.brand} width="narrow">
                <div className="rounded-xl border border-line bg-surface p-6 shadow-card sm:p-8">
                    <DoneCard
                        flow={flow}
                        onManage={
                            token !== null && page.policy?.self_service === true
                                ? () => {
                                      const done = navigate(`/m/${encodeURIComponent(token)}`);
                                      if (done) done.catch(() => undefined);
                                  }
                                : null
                        }
                    />
                </div>
            </PublicPage>
        );
    }

    if (page.services.length === 0)
        return (
            <PublicPage name={page.business_name} brand={page.brand} width="narrow">
                <Notice tone="info" banner>
                    {s.nothingBookable}
                </Notice>
            </PublicPage>
        );

    if (guided) return <GuidedBooking flow={flow} returning={returning} />;

    const i = Math.max(
        0,
        flow.steps.findIndex((x) => x.state === "current"),
    );
    const cta =
        flow.step === "details"
            ? flow.busy
                ? s.booking
                : flow.totals.depositCents > 0
                  ? s.confirmAndPay(flow.totals.deposit)
                  : s.confirm
            : s.continue;
    const showNav = flow.step !== "pay";
    const hasExtras = flow.offered.length > 0;

    return (
        <PublicPage name={page.business_name} brand={page.brand}>
            <div className="mb-6">
                <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                    <h1 className="font-display text-[28px] font-bold tracking-tight text-ink md:text-[32px]">
                        {s.title}
                    </h1>
                    <div className="flex items-center gap-4">
                        {rating}
                        <span className="hidden items-center gap-1.5 text-xs text-muted sm:flex">
                            <Icon name="lock" size={13} />
                            {s.secureBooking}
                        </span>
                    </div>
                </div>
                {page.policy?.self_service ? (
                    <p className="mt-1 text-sm text-muted">
                        {s.payPolicy(
                            page.policy.cancel_cutoff_hours,
                            page.policy.reschedule_cutoff_hours,
                            false,
                        )}
                    </p>
                ) : null}
            </div>
            <div className="grid gap-6 pb-28 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8 lg:pb-0">
                <section className="min-w-0">
                    <div className="space-y-3">
                        <BookingSection
                            n={1}
                            title={s.stepService}
                            summary={flow.service?.name}
                            state={
                                flow.step === "service"
                                    ? "open"
                                    : flow.service !== null
                                      ? "done"
                                      : "todo"
                            }
                            onEdit={
                                flow.step === "pay"
                                    ? undefined
                                    : () => {
                                          flow.goTo("service");
                                      }
                            }
                        >
                            <ServicePicker flow={flow} />
                        </BookingSection>
                        <BookingSection
                            n={2}
                            title={s.stepTime}
                            summary={flow.when}
                            state={
                                flow.step === "time" ? "open" : flow.slot !== null ? "done" : "todo"
                            }
                            onEdit={
                                flow.step === "pay"
                                    ? undefined
                                    : () => {
                                          flow.goTo("time");
                                      }
                            }
                        >
                            <WhenPicker flow={flow} />
                        </BookingSection>
                        {hasExtras ? (
                            <BookingSection
                                n={3}
                                title={s.stepExtras}
                                summary={flow.addonLines.map((line) => line.addon.name).join(", ")}
                                state={
                                    flow.step === "extras"
                                        ? "open"
                                        : flow.step === "details" || flow.step === "pay"
                                          ? "done"
                                          : "todo"
                                }
                                onEdit={
                                    flow.step === "pay"
                                        ? undefined
                                        : () => {
                                              flow.goTo("extras");
                                          }
                                }
                            >
                                <SuggestedExtras flow={flow} />
                            </BookingSection>
                        ) : null}
                        <BookingSection
                            n={hasExtras ? 4 : 3}
                            title={s.stepDetails}
                            summary={flow.fields.name}
                            state={
                                flow.step === "details"
                                    ? "open"
                                    : flow.step === "pay"
                                      ? "done"
                                      : "todo"
                            }
                            onEdit={
                                flow.step === "pay"
                                    ? undefined
                                    : () => {
                                          flow.goTo("details");
                                      }
                            }
                        >
                            <div className="space-y-6">
                                <ReturningPanel returning={returning} flow={flow} />
                                <DetailsForm flow={flow} />
                                <div className="border-t border-line pt-4 lg:hidden">
                                    <DocTotals lines={flow.totalLines} density="compact" />
                                    <p className="pt-2 text-xs text-muted">{s.taxNote}</p>
                                </div>
                            </div>
                        </BookingSection>
                        {flow.totals.depositCents > 0 ? (
                            <BookingSection
                                n={hasExtras ? 5 : 4}
                                title={s.stepPay}
                                state={flow.step === "pay" ? "open" : "todo"}
                            >
                                <PayStep flow={flow} />
                            </BookingSection>
                        ) : null}
                    </div>
                    {flow.error !== null ? (
                        <div className="mt-4">
                            <Notice tone="danger">{flow.error}</Notice>
                        </div>
                    ) : null}
                </section>

                <aside className="hidden lg:block">
                    <div className="sticky top-24 rounded-2xl border border-line bg-surface p-5 shadow-card">
                        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                            {s.summary}
                        </h2>
                        {flow.service === null ? (
                            <p className="mt-3 text-sm text-muted">{s.chooseServiceHint}</p>
                        ) : (
                            <div className="mt-4 space-y-4">
                                <div className="flex items-center gap-3">
                                    <ItemImage
                                        src={flow.service.image_url}
                                        name={flow.service.name}
                                        size={56}
                                    />
                                    <div className="min-w-0">
                                        <p className="font-semibold text-ink">
                                            {flow.service.name}
                                        </p>
                                        <p className="mt-1 text-xs text-muted">
                                            {flow.service.duration_min !== null
                                                ? durationLabel(flow.service.duration_min)
                                                : null}
                                        </p>
                                    </div>
                                </div>
                                {flow.when ? (
                                    <p className="flex items-start gap-2 text-sm text-ink-soft">
                                        <Icon name="calendar" size={16} />
                                        {flow.when}
                                    </p>
                                ) : null}
                                <div className="border-t border-line pt-3">
                                    <DocTotals lines={flow.totalLines} density="compact" />
                                    <p className="pt-2 text-xs text-muted">{s.taxNote}</p>
                                </div>
                            </div>
                        )}
                        {flow.service !== null && page.policy?.self_service ? (
                            <p className="mt-4 border-t border-line pt-4 text-xs leading-relaxed text-muted">
                                {s.payPolicy(
                                    page.policy.cancel_cutoff_hours,
                                    page.policy.reschedule_cutoff_hours,
                                    flow.totals.depositCents > 0 &&
                                        page.policy.late_cancel_deposit === "keep",
                                )}
                            </p>
                        ) : null}
                        {showNav ? (
                            <div className="mt-5 space-y-2">
                                <Button
                                    className="w-full"
                                    size="lg"
                                    onPress={flow.next}
                                    disabled={!flow.canNext && flow.step !== "details"}
                                    busy={flow.busy}
                                >
                                    {cta}
                                </Button>
                                {i > 0 ? (
                                    <Button
                                        className="w-full"
                                        variant="quiet"
                                        icon="chevronLeft"
                                        onPress={flow.back}
                                    >
                                        {s.back}
                                    </Button>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                </aside>
            </div>

            {showNav ? (
                <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
                    <div className="mx-auto max-w-xl space-y-2">
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                            <span className="truncate text-ink-soft">
                                {flow.service ? (flow.when ?? flow.service.name) : s.chooseService}
                            </span>
                            {flow.service ? (
                                <span className="shrink-0 font-semibold text-ink">
                                    {flow.totals.depositCents > 0 ? `${s.dueNow} ` : ""}
                                    <span className="font-mono tabular-nums">
                                        {flow.totals.depositCents > 0
                                            ? flow.totals.deposit
                                            : flow.totals.total}
                                    </span>
                                </span>
                            ) : null}
                        </div>
                        <Button
                            className="w-full"
                            size="lg"
                            onPress={flow.next}
                            disabled={!flow.canNext && flow.step !== "details"}
                            busy={flow.busy}
                        >
                            {cta}
                        </Button>
                    </div>
                </div>
            ) : null}
        </PublicPage>
    );
}

function GuidedBooking({
    flow,
    returning,
}: {
    flow: PublicBookingFlow;
    returning: ReturnType<typeof useReturningClient>;
}) {
    const [entry, setEntry] = useState<"welcome" | "returning" | "booking">(
        flow.service === null ? "welcome" : "booking",
    );
    const page = flow.page;
    if (page === null) return null;
    const g = strings.publicBooking.guided;
    const welcome = entry !== "booking";
    const step = flow.steps.findIndex((value) => value.state === "current");
    const title = welcome
        ? returning.profile
            ? strings.publicReturning.welcome(returning.profile.name)
            : g.welcome(page.business_name)
        : (flow.steps[step]?.label ?? s.title);
    const back = (): void => {
        if (welcome) setEntry("welcome");
        else if (flow.step === "service") setEntry("welcome");
        else flow.back();
    };
    const begin = (): void => {
        flow.goTo("service");
        setEntry("booking");
    };
    return (
        <div style={brandStyle(page.brand)} className="min-h-screen bg-surface text-ink">
            <BusinessNavigation brand={page.brand} />
            <div className="px-5 pt-5 pb-32">
                {flow.step !== "pay" && (!welcome || entry === "returning") ? (
                    <Button variant="quiet" size="sm" icon="chevronLeft" onPress={back}>
                        {s.back}
                    </Button>
                ) : null}
                {!welcome ? (
                    <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">
                        {s.stepOf(step + 1, flow.steps.length)}
                    </p>
                ) : null}
                <h1 className="mt-3 font-display text-2xl font-bold tracking-tight">{title}</h1>
                {welcome ? <p className="mt-2 text-sm text-ink-soft">{g.intro}</p> : null}
                <div className="mt-6 space-y-4">
                    {welcome ? (
                        <>
                            {entry === "welcome" && returning.profile === null ? (
                                <>
                                    <OptionCard
                                        size="lg"
                                        title={g.first}
                                        subtitle={g.firstBody}
                                        leading={<Icon name="paw" size={24} />}
                                        trailing={<Icon name="chevronRight" size={18} />}
                                        onPress={begin}
                                    />
                                    <OptionCard
                                        size="lg"
                                        title={g.returning}
                                        subtitle={g.returningBody}
                                        leading={<Icon name="user" size={24} />}
                                        trailing={<Icon name="chevronRight" size={18} />}
                                        onPress={() => {
                                            setEntry("returning");
                                        }}
                                    />
                                </>
                            ) : (
                                <>
                                    <ReturningPanel
                                        returning={returning}
                                        flow={flow}
                                        expanded
                                        onUsual={() => {
                                            setEntry("booking");
                                        }}
                                    />
                                    <Button full variant="outline" onPress={begin}>
                                        {returning.profile ? g.different : g.continueNew}
                                    </Button>
                                </>
                            )}
                        </>
                    ) : (
                        <>
                            {flow.step === "service" ? <ServicePicker flow={flow} /> : null}
                            {flow.step === "time" ? <WhenPicker flow={flow} /> : null}
                            {flow.step === "extras" ? <SuggestedExtras flow={flow} /> : null}
                            {flow.step === "details" ? (
                                <>
                                    <DetailsForm flow={flow} />
                                    <div className="border-t border-line pt-4">
                                        <DocTotals lines={flow.totalLines} density="compact" />
                                        <p className="mt-2 text-xs text-muted">{s.taxNote}</p>
                                    </div>
                                </>
                            ) : null}
                            {flow.step === "pay" ? <PayStep flow={flow} /> : null}
                        </>
                    )}
                    {flow.error !== null ? <Notice tone="danger">{flow.error}</Notice> : null}
                </div>
            </div>
            {!welcome && flow.step !== "pay" && flow.step !== "service" ? (
                <div className="fixed inset-x-0 bottom-0 z-10 space-y-3 border-t border-line bg-surface px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                    <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate text-ink-soft">{flow.service?.name}</span>
                        <span className="shrink-0 font-semibold">
                            {flow.totals.depositCents > 0
                                ? `${s.dueNow} ${flow.totals.deposit}`
                                : flow.totals.total}
                        </span>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" icon="chevronLeft" onPress={back}>
                            {s.back}
                        </Button>
                        <Button
                            grow
                            size="lg"
                            busy={flow.busy}
                            disabled={!flow.canNext && flow.step !== "details"}
                            onPress={flow.next}
                        >
                            {flow.step === "details"
                                ? flow.totals.depositCents > 0
                                    ? s.confirmAndPay(flow.totals.deposit)
                                    : s.confirm
                                : s.continue}
                        </Button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function BookingSection({
    n,
    title,
    summary,
    state,
    onEdit,
    children,
}: {
    n: number;
    title: string;
    summary?: string | null | undefined;
    state: "open" | "done" | "todo";
    onEdit?: (() => void) | undefined;
    children: ReactNode;
}) {
    return (
        <section
            className={`rounded-2xl border bg-surface ${state === "open" ? "border-line shadow-card" : "border-line-soft"}`}
        >
            <div className="flex items-center gap-3 px-5 py-3.5">
                <span
                    aria-hidden
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${state === "done" ? "bg-accent text-accent-ink" : state === "open" ? "border-2 border-accent text-accent" : "border border-line text-muted"}`}
                >
                    {state === "done" ? <Icon name="check" size={14} /> : n}
                </span>
                <div className="min-w-0 flex-1">
                    <h2
                        className={`font-display font-bold ${state === "todo" ? "text-[15px] text-muted" : "text-[17px] text-ink"}`}
                    >
                        {title}
                    </h2>
                    {state === "done" && summary ? (
                        <p className="truncate text-sm text-ink-soft">{summary}</p>
                    ) : null}
                </div>
                {state === "done" && onEdit ? (
                    <Button size="sm" variant="quiet" onPress={onEdit}>
                        {s.change}
                    </Button>
                ) : null}
            </div>
            {state === "open" ? <div className="px-5 pb-5">{children}</div> : null}
        </section>
    );
}

function ReturningPanel({
    returning: r,
    flow,
    expanded = false,
    onUsual,
}: {
    expanded?: boolean;
    onUsual?: () => void;
    returning: ReturnType<typeof useReturningClient>;
    flow: PublicBookingFlow;
}) {
    const t = strings.publicReturning;
    const profile = r.profile;
    return (
        <section className="mb-5 rounded-xl border border-line bg-surface p-4">
            <h2 className="font-semibold text-ink">
                {profile ? t.welcome(profile.name) : t.title}
            </h2>
            {profile ? (
                <div className="mt-3 space-y-3">
                    {r.canBookUsual ? (
                        <Button
                            variant="outline"
                            onPress={() => {
                                r.bookUsual();
                                onUsual?.();
                            }}
                        >
                            {t.usual}
                        </Button>
                    ) : null}
                    {profile.pets.length ? (
                        <Choice
                            label={t.choosePet}
                            layout="chips"
                            value={flow.subjectId ?? ""}
                            options={[
                                ...profile.pets.map((pet) => ({ key: pet.id, label: pet.name })),
                                { key: "", label: t.newPet },
                            ]}
                            onChange={r.choosePet}
                        />
                    ) : null}
                    <Button variant="quiet" size="sm" onPress={r.reset}>
                        {t.changeContact}
                    </Button>
                </div>
            ) : r.stage === "missing" ? (
                <p className="mt-2 text-sm text-muted">{t.missing}</p>
            ) : (
                <details className="mt-2" open={expanded || undefined}>
                    <summary className="cursor-pointer text-sm text-accent">{t.intro}</summary>
                    <div className="mt-3 space-y-3">
                        {r.stage === "contact" ? (
                            <>
                                <Choice
                                    label={t.contact}
                                    layout="chips"
                                    value={r.channel}
                                    onChange={r.setChannel}
                                    options={[
                                        { key: "email", label: t.email },
                                        { key: "sms", label: t.sms },
                                    ]}
                                />
                                <TextField
                                    label={r.channel === "email" ? t.email : t.sms}
                                    type={r.channel === "email" ? "email" : "tel"}
                                    value={r.contact}
                                    onChange={r.setContact}
                                />
                                <Button variant="outline" busy={r.busy} onPress={r.requestCode}>
                                    {t.sendCode}
                                </Button>
                            </>
                        ) : (
                            <>
                                <p className="text-sm text-muted">{t.sent}</p>
                                <TextField
                                    label={t.code}
                                    value={r.code}
                                    onChange={r.setCode}
                                    maxLength={6}
                                    autoComplete="one-time-code"
                                />
                                <div className="flex gap-2">
                                    <Button busy={r.busy} onPress={r.verifyCode}>
                                        {t.verify}
                                    </Button>
                                    <Button variant="quiet" onPress={r.reset}>
                                        {t.changeContact}
                                    </Button>
                                </div>
                            </>
                        )}
                        {r.error ? <Notice tone="danger">{r.error}</Notice> : null}
                    </div>
                </details>
            )}
        </section>
    );
}
