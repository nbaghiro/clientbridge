import {
    createPublicBookingClient,
    strings,
    usePublicBookingFlow,
} from "@clientbridge/app-core/public";
import { Button, DocTotals, FactList, Notice, ProgressSteps } from "@clientbridge/ui";
import { useNavigate, useParams } from "react-router-dom";

import {
    DetailsForm,
    DoneCard,
    PayStep,
    ServicePicker,
    SuggestedExtras,
    WhenPicker,
    visitFacts,
} from "../components/BookingSteps";
import { PublicPage, Rating } from "../components/PublicPage";
import { PublicStatus } from "../components/PublicStatus";
import { config } from "../config";
import { useEmbedSuccess } from "../embed";

const booking = createPublicBookingClient(config.apiUrl);
const s = strings.publicBooking;

export function PublicBooking() {
    const { slug = "" } = useParams<{ slug: string }>();
    const navigate = useNavigate();
    const flow = usePublicBookingFlow(booking, slug);
    const page = flow.page;
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

    const i = Math.max(
        0,
        flow.steps.findIndex((x) => x.state === "current"),
    );
    const title =
        flow.step === "service"
            ? s.chooseService
            : flow.step === "time"
              ? s.chooseTime
              : flow.step === "details"
                ? s.detailsTitle
                : null;
    const cta =
        flow.step === "details"
            ? flow.busy
                ? s.booking
                : flow.totals.depositCents > 0
                  ? s.confirmAndPay(flow.totals.deposit)
                  : s.confirm
            : s.continue;
    const showNav = flow.step !== "pay";
    const facts = visitFacts(flow);

    return (
        <PublicPage name={page.business_name} brand={page.brand} actions={rating}>
            <div className="grid gap-8 pb-20 lg:grid-cols-[minmax(0,1fr)_300px] lg:pb-0">
                <section className="min-w-0">
                    <ProgressSteps label={s.stepsLabel} steps={flow.steps} />
                    <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted">
                        {s.stepOf(i + 1, flow.steps.length)} · {flow.steps[i]?.label}
                    </p>
                    {title !== null ? (
                        <h1 className="mt-1 font-display text-2xl font-bold text-ink">{title}</h1>
                    ) : null}
                    {flow.step === "service" ? (
                        <p className="mt-1 text-sm text-muted">{s.chooseServiceHint}</p>
                    ) : null}

                    <div className="mt-6">
                        {flow.step === "service" ? <ServicePicker flow={flow} /> : null}
                        {flow.step === "time" ? <WhenPicker flow={flow} /> : null}
                        {flow.step === "details" ? (
                            <div className="space-y-6">
                                <div className="rounded-lg border border-line bg-surface p-4 lg:hidden">
                                    <FactList facts={facts} label={s.summary} />
                                </div>
                                <SuggestedExtras flow={flow} />
                                <div className="rounded-lg border border-line bg-surface p-5">
                                    <h2 className="mb-3 text-sm font-semibold text-ink">
                                        {s.detailsTitle}
                                    </h2>
                                    <DetailsForm flow={flow} />
                                </div>
                                <div className="rounded-lg border border-line bg-surface p-5 lg:hidden">
                                    <DocTotals lines={flow.totalLines} density="compact" />
                                    <p className="pt-2 text-xs text-muted">{s.taxNote}</p>
                                </div>
                            </div>
                        ) : null}
                        {flow.step === "pay" ? (
                            <div className="max-w-md">
                                <PayStep flow={flow} />
                            </div>
                        ) : null}
                    </div>
                    {flow.error !== null ? (
                        <div className="mt-4">
                            <Notice tone="danger">{flow.error}</Notice>
                        </div>
                    ) : null}

                    {showNav ? (
                        <div className="mt-8 hidden items-center justify-between lg:flex">
                            {i > 0 ? (
                                <Button variant="quiet" icon="chevronLeft" onPress={flow.back}>
                                    {s.back}
                                </Button>
                            ) : (
                                <span />
                            )}
                            <Button
                                size="lg"
                                onPress={flow.next}
                                disabled={!flow.canNext && flow.step !== "details"}
                                busy={flow.busy}
                            >
                                {cta}
                            </Button>
                        </div>
                    ) : null}
                </section>

                <aside className="hidden lg:block">
                    <div className="sticky top-6 rounded-xl border border-line bg-surface p-5 shadow-card">
                        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                            {s.summary}
                        </h2>
                        {flow.service === null ? (
                            <p className="mt-3 text-sm text-muted">{s.chooseServiceHint}</p>
                        ) : (
                            <div className="mt-4 space-y-4">
                                <FactList facts={facts} />
                                <div className="border-t border-line pt-3">
                                    <DocTotals lines={flow.totalLines} density="compact" />
                                    <p className="pt-2 text-xs text-muted">{s.taxNote}</p>
                                </div>
                            </div>
                        )}
                    </div>
                </aside>
            </div>

            {showNav ? (
                <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface px-4 py-3 lg:hidden">
                    <div className="mx-auto flex max-w-xl items-center gap-3">
                        {i > 0 ? (
                            <Button
                                variant="outline"
                                icon="chevronLeft"
                                label={s.back}
                                onPress={flow.back}
                            >
                                {s.back}
                            </Button>
                        ) : null}
                        <div className="min-w-0 flex-1">
                            {flow.service !== null ? (
                                <>
                                    <p className="truncate text-sm font-semibold text-ink">
                                        {flow.service.name}
                                    </p>
                                    <p className="truncate text-xs text-muted first-letter:uppercase">
                                        {flow.when ?? flow.totals.total}
                                    </p>
                                </>
                            ) : (
                                <p className="text-sm text-muted">{s.chooseService}</p>
                            )}
                        </div>
                        <Button
                            onPress={flow.next}
                            disabled={!flow.canNext && flow.step !== "details"}
                            busy={flow.busy}
                        >
                            {flow.step === "details" ? (flow.busy ? s.booking : s.confirm) : cta}
                        </Button>
                    </div>
                </div>
            ) : null}
        </PublicPage>
    );
}
