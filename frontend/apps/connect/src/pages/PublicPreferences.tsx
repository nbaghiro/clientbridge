import {
    createPublicPreferencesClient,
    strings,
    usePreferencesPage,
} from "@clientbridge/app-core/public";
import { Badge, Button, Icon, Notice, Toggle } from "@clientbridge/ui";
import { useParams, useSearchParams } from "react-router-dom";

import { PublicFrame } from "../components/PublicFrame";
import { PublicStatus } from "../components/PublicStatus";
import { config } from "../config";

const client = createPublicPreferencesClient(config.apiUrl);
const s = strings.publicPreferences;

export function PublicPreferences() {
    const { token = "" } = useParams<{ token: string }>();
    const [params, setParams] = useSearchParams();
    const oneClick = params.get("unsubscribe") === "email";
    const page = usePreferencesPage(client, token, oneClick);
    const prefs = page.prefs;

    if (page.status === "loading") return <PublicStatus kind="loading" />;
    if (page.status === "not-found")
        return <PublicStatus kind="notFound" title={s.notFoundTitle} body={s.notFoundBody} />;
    if (page.status === "error" || prefs === null)
        return (
            <PublicStatus
                kind="error"
                title={s.errorTitle}
                body={s.errorBody}
                onRetry={page.retry}
            />
        );

    if (oneClick) {
        const subscribed = page.resubscribed;
        return (
            <PublicFrame brand={prefs.brand}>
                <div className="text-center">
                    <p className="text-sm font-semibold text-ink-soft">{prefs.business_name}</p>
                    <span
                        className={`mx-auto mt-5 flex h-12 w-12 items-center justify-center rounded-full ${subscribed ? "bg-accent-weak text-accent" : "bg-ok-bg text-ok-fg"}`}
                    >
                        <Icon name={subscribed ? "mail" : "checkCircle"} size={24} />
                    </span>
                    <h1 className="mt-4 font-display text-2xl font-bold text-ink">
                        {subscribed ? s.resubscribedTitle : s.unsubscribedTitle}
                    </h1>
                    <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                        {subscribed
                            ? s.resubscribedBody(prefs.business_name)
                            : s.unsubscribedBody(prefs.business_name, prefs.email_hint)}
                    </p>
                </div>
                {subscribed ? null : (
                    <div className="mt-5">
                        <Notice tone="info" banner>
                            {s.unsubscribedReminders}
                        </Notice>
                    </div>
                )}
                {page.error !== null ? <Notice tone="danger">{page.error}</Notice> : null}
                <div className="mt-6 flex flex-col items-center gap-3">
                    {subscribed ? null : (
                        <Button variant="outline" full busy={page.busy} onPress={page.resubscribe}>
                            {s.resubscribe}
                        </Button>
                    )}
                    <Button
                        variant="link"
                        onPress={() => {
                            setParams({});
                        }}
                    >
                        {s.manageAll}
                    </Button>
                </div>
                <p className="mt-8 border-t border-line pt-4 text-center text-[11px] text-muted">
                    {prefs.business_name}
                </p>
            </PublicFrame>
        );
    }

    return (
        <PublicFrame brand={prefs.brand}>
            <p className="text-sm font-semibold text-ink-soft">{prefs.business_name}</p>
            <h1 className="mt-1 font-display text-xl font-bold text-ink">{s.title}</h1>
            <p className="mt-1 text-sm text-muted">
                {s.greeting(prefs.first_name, prefs.business_name)}
            </p>
            <div className="mt-6 space-y-5">
                <section className="rounded-lg border border-line p-4">
                    <h2 className="text-sm font-semibold text-ink">{s.offers}</h2>
                    <p className="mb-3 mt-0.5 text-xs text-muted">{s.offersHint}</p>
                    <div className="space-y-3">
                        <Toggle
                            label={s.byEmail(prefs.email_hint)}
                            value={page.offersEmail}
                            onChange={page.setOffersEmail}
                        />
                        <Toggle
                            label={s.byText(prefs.phone_hint)}
                            value={page.offersSms}
                            onChange={page.setOffersSms}
                        />
                    </div>
                </section>
                <section className="rounded-lg border border-line bg-bg p-4">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h2 className="text-sm font-semibold text-ink">{s.reminders}</h2>
                            <p className="mt-0.5 text-xs leading-relaxed text-muted">
                                {s.remindersHint}
                            </p>
                        </div>
                        <span className="shrink-0">
                            <Badge label={s.alwaysOn} intent="success" />
                        </span>
                    </div>
                </section>
                {page.saved ? (
                    <Notice tone="success" banner>
                        {s.saved}
                    </Notice>
                ) : null}
                {page.error !== null ? <Notice tone="danger">{page.error}</Notice> : null}
                <Button full size="lg" busy={page.busy} onPress={page.save}>
                    {page.busy ? s.saving : s.save}
                </Button>
                <div className="text-center">
                    <Button variant="link" onPress={page.unsubscribeAll}>
                        {s.unsubscribeAll}
                    </Button>
                </div>
            </div>
            <p className="mt-8 border-t border-line pt-4 text-center text-[11px] text-muted">
                {prefs.business_name}
            </p>
        </PublicFrame>
    );
}
