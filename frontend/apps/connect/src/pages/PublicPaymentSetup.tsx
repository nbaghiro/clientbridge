import {
    createPublicPaymentSetupClient,
    strings,
    usePublicPaymentSetup,
} from "@clientbridge/app-core/public";
import { Button, CardForm, Notice } from "@clientbridge/ui";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

import { PublicPage } from "../components/PublicPage";
import { PublicStatus } from "../components/PublicStatus";
import { config } from "../config";

const client = createPublicPaymentSetupClient(config.apiUrl);
const s = strings.checkout;

export function PublicPaymentSetup() {
    const location = useLocation();
    const token = new URLSearchParams(location.hash.slice(1)).get("token") ?? "";
    const flow = usePublicPaymentSetup(client, token);
    useEffect(() => {
        const clean = new URL(window.location.href);
        clean.searchParams.delete("setup_intent_client_secret");
        clean.searchParams.delete("setup_intent");
        clean.searchParams.delete("redirect_status");
        window.history.replaceState(null, "", clean.toString());
    }, []);
    if (flow.status === "loading") return <PublicStatus kind="loading" />;
    if (flow.status !== "ready" || flow.data === null)
        return (
            <PublicStatus kind="notFound" title={s.bankSetupTitle} body={s.bankSetupUnavailable} />
        );
    const data = flow.data;
    const done = data.status === "succeeded";
    const pending =
        data.status === "processing" ||
        (data.status === "requires_action" && data.verification_url !== null);
    const unavailable = data.status === "canceled" || data.status === "revoked";
    const returnUrl = `${window.location.origin}/payment-method#token=${encodeURIComponent(token)}`;
    return (
        <PublicPage name={data.business_name} brand={data.brand} width="narrow">
            <main className="space-y-5 rounded-xl border border-line bg-surface p-6">
                <h1 className="font-display text-2xl font-bold text-ink">
                    {done ? s.bankSetupDone : s.bankSetupTitle}
                </h1>
                <p className="text-sm text-muted">{s.bankSetupFor(data.client_name)}</p>
                {done ? (
                    <Notice tone="success">{s.bankSetupDoneBody}</Notice>
                ) : unavailable ? (
                    <Notice tone="danger">{s.bankSetupUnavailable}</Notice>
                ) : (
                    <>
                        <p className="text-sm leading-relaxed text-ink-soft">{s.bankSetupBody}</p>
                        {pending ? (
                            <>
                                <Notice tone="info">{s.bankSetupPending}</Notice>
                                {data.verification_url ? (
                                    <Button
                                        onPress={() => {
                                            window.location.assign(data.verification_url ?? "");
                                        }}
                                    >
                                        {s.bankSetupVerify}
                                    </Button>
                                ) : null}
                                <Button variant="outline" busy={flow.busy} onPress={flow.refresh}>
                                    {s.bankSetupRefresh}
                                </Button>
                            </>
                        ) : data.client_secret !== null ? (
                            <CardForm
                                mode="setup"
                                returnUrl={returnUrl}
                                clientSecret={data.client_secret}
                                stripeAccount={data.stripe_account_id}
                                submitLabel={s.bankSetupConfirm}
                                busyLabel={strings.common.saving}
                                onDone={flow.refresh}
                            />
                        ) : (
                            <Button busy={flow.busy} onPress={flow.start}>
                                {s.bankSetupStart}
                            </Button>
                        )}
                    </>
                )}
                {flow.error !== null ? <Notice tone="danger">{flow.error}</Notice> : null}
            </main>
        </PublicPage>
    );
}
